import { test, expect, describe } from "bun:test";
import { ACTIVITY_CAP, initialRun, reduceReview, type ReviewRun } from "./useReview";
import type { ReviewFinding, ReviewServerFrame } from "../shared/review";

const finding = {} as ReviewFinding; // the reducer only counts findings

const runFrame: ReviewServerFrame = {
  type: "run",
  runId: "abc12345",
  lenses: ["correctness", "silent-failures"],
};

const reduceAll = (frames: ReviewServerFrame[], from: ReviewRun | null = null) =>
  frames.reduce(reduceReview, from);

describe("initialRun / run frame", () => {
  test("seeds every lens as queued with the run running", () => {
    const run = initialRun(["a", "b"]);
    expect(run.running).toBe(true);
    expect(Object.keys(run.lenses)).toEqual(["a", "b"]);
    expect(run.lenses.a).toEqual({ phase: "queued", findings: 0, activity: [] });
  });

  test("a run frame (re)initializes state, even from null", () => {
    expect(reduceReview(null, runFrame)).toEqual(initialRun(["correctness", "silent-failures"]));
  });
});

describe("reduceReview — per-lens transitions", () => {
  test("lens frames drive queued → running → done", () => {
    const run = reduceAll([
      runFrame,
      { type: "lens", lens: "correctness", state: "running" },
      { type: "lens", lens: "correctness", state: "done" },
    ]);
    expect(run?.lenses.correctness?.phase).toBe("done");
    expect(run?.lenses["silent-failures"]?.phase).toBe("queued");
  });

  test("a lens error records its message", () => {
    const run = reduceAll([
      runFrame,
      { type: "lens", lens: "correctness", state: "error", message: "boom" },
    ]);
    expect(run?.lenses.correctness).toMatchObject({ phase: "error", error: "boom" });
  });

  test("frames for unknown lenses create a row instead of crashing", () => {
    const run = reduceAll([runFrame, { type: "lens", lens: "novel" as never, state: "running" }]);
    expect(run?.lenses.novel?.phase).toBe("running");
  });

  test("activity lines append in ChatMessage shape and stay capped", () => {
    const tools: ReviewServerFrame[] = Array.from({ length: ACTIVITY_CAP + 2 }, (_, i) => ({
      type: "tool",
      lens: "correctness",
      name: "Read",
      target: `f${i}.ts`,
    }));
    const run = reduceAll([
      runFrame,
      ...tools,
      { type: "progress", lens: "correctness", text: "thinking" },
    ]);
    const activity = run?.lenses.correctness?.activity ?? [];
    expect(activity).toHaveLength(ACTIVITY_CAP);
    expect(activity.at(-1)).toEqual({ role: "progress", text: "thinking" });
    expect(activity[0]).toEqual({ role: "tool", name: "Read", target: "f3.ts" });
  });

  test("findings accumulate across frames", () => {
    const run = reduceAll([
      runFrame,
      { type: "findings", lens: "correctness", findings: [finding, finding], skipped: 1 },
      { type: "findings", lens: "correctness", findings: [finding], skipped: 0 },
    ]);
    expect(run?.lenses.correctness?.findings).toBe(3);
  });
});

describe("reduceReview — terminal frames", () => {
  test("a run-level error fails unfinished lenses but keeps done ones", () => {
    const run = reduceAll([
      runFrame,
      { type: "lens", lens: "correctness", state: "done" },
      { type: "error", message: "connection closed" },
    ]);
    expect(run).toMatchObject({ running: false, error: "connection closed" });
    expect(run?.lenses.correctness?.phase).toBe("done");
    expect(run?.lenses["silent-failures"]).toMatchObject({
      phase: "error",
      error: "connection closed",
    });
  });

  test("an error before the run frame still surfaces", () => {
    const run = reduceReview(null, { type: "error", message: "no diff mode" });
    expect(run).toEqual({ running: false, error: "no diff mode", lenses: {} });
  });

  test("done fails stragglers and stops the run, keeping finished lenses", () => {
    const run = reduceAll([
      runFrame,
      { type: "lens", lens: "correctness", state: "done" },
      { type: "lens", lens: "silent-failures", state: "error", message: "boom" },
      { type: "done" },
    ]);
    expect(run?.running).toBe(false);
    expect(run?.lenses.correctness?.phase).toBe("done");
    expect(run?.lenses["silent-failures"]).toMatchObject({ phase: "error", error: "boom" });
  });

  test("done marks a never-started lens as ended without result", () => {
    const run = reduceAll([runFrame, { type: "done" }]);
    expect(run?.lenses.correctness).toMatchObject({
      phase: "error",
      error: "ended without result",
    });
  });

  test("busy and pre-run frames are no-ops", () => {
    const run = initialRun(["a"]);
    expect(reduceReview(run, { type: "busy" })).toBe(run);
    expect(reduceReview(null, { type: "done" })).toBeNull();
    expect(
      reduceReview(null, { type: "progress", lens: "correctness", text: "x" }),
    ).toBeNull();
  });
});
