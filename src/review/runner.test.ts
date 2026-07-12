import { test, expect, describe } from "bun:test";
import { reviewCwd, runReviewPanel, type TurnRunner } from "./runner";
import { RETRY_PROMPT, LENSES, type Lens } from "./lenses";
import type { ChatEvent, RunTurnArgs } from "../chat/agent";
import type { ReviewFinding, ReviewServerFrame } from "../shared/review";

const lens = (id: string): Lens => LENSES.find((l) => l.id === id)!;

const rawFinding = {
  file: "a.ts",
  side: "new",
  startLine: 1,
  endLine: 1,
  severity: "minor",
  title: "T",
  body: "B",
};

const goodReply = `Looked around.\n\`\`\`json\n${JSON.stringify({ findings: [rawFinding] })}\n\`\`\``;

const done = (result: string): ChatEvent => ({ kind: "done", result });
const session = (id: string): ChatEvent => ({ kind: "session", sessionId: id });

/** Scripted TurnRunner: one event array per call, in call order; records args. */
function fakeRunner(...scripts: (ChatEvent[] | Error)[]): {
  runner: TurnRunner;
  calls: RunTurnArgs[];
} {
  const calls: RunTurnArgs[] = [];
  const runner: TurnRunner = (args) => {
    calls.push(args);
    const script = scripts[calls.length - 1] ?? [];
    return (async function* () {
      if (script instanceof Error) throw script;
      for (const event of script) yield event;
    })();
  };
  return { runner, calls };
}

async function run(runner: TurnRunner, lenses: readonly Lens[]): Promise<ReviewServerFrame[]> {
  const frames: ReviewServerFrame[] = [];
  await runReviewPanel({
    annotatedDiff: "### a.ts (modified)\n1\t1\t x",
    cwd: "/repo",
    emit: (f) => frames.push(f),
    lenses,
    turnRunner: runner,
  });
  return frames;
}

describe("runReviewPanel — one lens", () => {
  test("happy path: running → activity → findings → done, in order", async () => {
    const { runner, calls } = fakeRunner([
      session("s1"),
      { kind: "tool", name: "Read", target: "/repo/a.ts" },
      { kind: "progress", text: "Reading a.ts" },
      { kind: "text", text: "Narration" },
      done(goodReply),
    ]);
    const frames = await run(runner, [lens("correctness")]);
    expect(frames).toEqual([
      { type: "lens", lens: "correctness", state: "running" },
      { type: "tool", lens: "correctness", name: "Read", target: "a.ts" },
      { type: "progress", lens: "correctness", text: "Reading a.ts" },
      { type: "progress", lens: "correctness", text: "Narration" },
      {
        type: "findings",
        lens: "correctness",
        findings: [rawFinding as ReviewFinding],
        skipped: 0,
      },
      { type: "lens", lens: "correctness", state: "done" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cwd: "/repo", mode: "ask" });
    expect(calls[0]?.prompt).toContain("Your single review lens: Correctness.");
  });

  test("invalid entries surface through the skipped count", async () => {
    const reply = `\`\`\`json\n${JSON.stringify({ findings: [rawFinding, "junk"] })}\n\`\`\``;
    const { runner } = fakeRunner([done(reply)]);
    const frames = await run(runner, [lens("correctness")]);
    expect(frames[1]).toMatchObject({ type: "findings", skipped: 1 });
  });

  test("a malformed reply retries once via --resume, then succeeds", async () => {
    const { runner, calls } = fakeRunner([session("s1"), done("no json here")], [done(goodReply)]);
    const frames = await run(runner, [lens("correctness")]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ sessionId: "s1", prompt: RETRY_PROMPT, mode: "ask" });
    expect(frames.at(-1)).toEqual({ type: "lens", lens: "correctness", state: "done" });
  });

  test("an empty result string also takes the retry path", async () => {
    const { runner, calls } = fakeRunner([session("s1"), done("")], [done(goodReply)]);
    await run(runner, [lens("correctness")]);
    expect(calls).toHaveLength(2);
  });

  test("a failed retry ends in a lens error", async () => {
    const { runner } = fakeRunner([session("s1"), done("nope")], [done("still nope")]);
    const frames = await run(runner, [lens("correctness")]);
    expect(frames.at(-1)).toEqual({
      type: "lens",
      lens: "correctness",
      state: "error",
      message: "the reviewer did not return a parseable findings block",
    });
  });

  test("an error event with no result fails the lens without retrying", async () => {
    const { runner, calls } = fakeRunner([{ kind: "error", message: "claude CLI not found" }]);
    const frames = await run(runner, [lens("correctness")]);
    expect(calls).toHaveLength(1);
    expect(frames.at(-1)).toEqual({
      type: "lens",
      lens: "correctness",
      state: "error",
      message: "claude CLI not found",
    });
  });

  test("a malformed reply with no session cannot retry", async () => {
    const { runner, calls } = fakeRunner([done("no json")]);
    const frames = await run(runner, [lens("correctness")]);
    expect(calls).toHaveLength(1);
    expect(frames.at(-1)).toMatchObject({ type: "lens", state: "error" });
  });
});

describe("runReviewPanel — the panel", () => {
  test("lenses run in parallel with correctly tagged frames", async () => {
    const { runner } = fakeRunner([done(goodReply)], [done(goodReply)]);
    const frames = await run(runner, [lens("correctness"), lens("silent-failures")]);
    const of = (id: string) => frames.filter((f) => "lens" in f && f.lens === id);
    for (const id of ["correctness", "silent-failures"]) {
      expect(of(id).map((f) => f.type)).toEqual(["lens", "findings", "lens"]);
    }
  });

  test("one lens throwing does not stop the other", async () => {
    const { runner } = fakeRunner(new Error("boom"), [done(goodReply)]);
    const frames = await run(runner, [lens("correctness"), lens("silent-failures")]);
    expect(frames).toContainEqual({
      type: "lens",
      lens: "correctness",
      state: "error",
      message: "boom",
    });
    expect(frames).toContainEqual({ type: "lens", lens: "silent-failures", state: "done" });
  });

  test("the abort signal reaches every turn and stops lenses silently", async () => {
    const controller = new AbortController();
    const calls: RunTurnArgs[] = [];
    // First (and only) turn: aborts mid-stream, then returns a reply that
    // would normally trigger a retry — the abort must win.
    const runner: TurnRunner = (args) => {
      calls.push(args);
      return (async function* () {
        yield session("s1");
        controller.abort();
        yield done("no json here");
      })();
    };
    const frames: ReviewServerFrame[] = [];
    await runReviewPanel({
      annotatedDiff: "### a.ts (modified)\n1\t1\t x",
      cwd: "/repo",
      emit: (f) => frames.push(f),
      signal: controller.signal,
      lenses: [lens("correctness")],
      turnRunner: runner,
    });
    expect(calls).toHaveLength(1); // no retry after abort
    expect(calls[0]?.signal).toBe(controller.signal); // forwarded to the turn
    expect(frames).toEqual([{ type: "lens", lens: "correctness", state: "running" }]);
  });
});

describe("reviewCwd", () => {
  test("uses the diff's repo when it has one, the fallback otherwise", () => {
    expect(reviewCwd({ kind: "path-vs-path", a: "/x", b: "/y" }, "/fb")).toBe("/fb");
    expect(
      reviewCwd({ kind: "git", cwd: "/repo", leftRef: "HEAD", right: { kind: "worktree" } }, "/fb"),
    ).toBe("/repo");
    expect(
      reviewCwd(
        { kind: "ref-vs-path", cwd: "/repo", ref: "HEAD", path: "/p", refOnLeft: true },
        "/fb",
      ),
    ).toBe("/repo");
  });
});
