import { test, expect, describe, afterEach } from "bun:test";
import { $ } from "bun";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTempRepo } from "../support";
import { parseTarget, runCommentsCli } from "../../src/comments/cli";
import { readComments, writeComments } from "../../src/comments/store";
import type { Comment } from "../../src/shared/comments";

const repos: string[] = [];
async function tmpRepo(): Promise<string> {
  const repo = await mkTempRepo("prv-comments-cli-");
  repos.push(repo);
  return repo;
}
afterEach(() => {
  for (const d of repos.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Repo with a 10-line `a.ts` committed, then an 11th line added in the
 * worktree. Line 11 is added, lines 8-10 are hunk context, and line 1 is
 * outside the diff entirely.
 */
async function repoWithEdit(): Promise<string> {
  const repo = await tmpRepo();
  const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  writeFileSync(join(repo, "a.ts"), lines.join("\n") + "\n");
  await $`git -C ${repo} add a.ts`.quiet();
  await $`git -C ${repo} commit -qm init`.quiet();
  appendFileSync(join(repo, "a.ts"), "eleven\n");
  return repo;
}

const seeded = (over: Partial<Comment> = {}): Comment => ({
  id: "c:2_2:2_2",
  file: "a.ts",
  start: { old: 2, new: 2 },
  end: { old: 2, new: 2 },
  anchorText: [" two"],
  status: "open",
  messages: [{ role: "user", text: "seed message" }],
  ...over,
});

describe("parseTarget", () => {
  test("splits file and line on the last colon", () => {
    expect(parseTarget("src/a.ts:12")).toEqual({ file: "src/a.ts", line: 12 });
  });

  test("keeps colons inside the file name", () => {
    expect(parseTarget("weird:name.ts:5")).toEqual({ file: "weird:name.ts", line: 5 });
  });

  test.each(["a.ts", "a.ts:x", "a.ts:", ":5", "a.ts:0", "a.ts:-3", "a.ts:1.5"])(
    "rejects %p",
    (target) => {
      expect(parseTarget(target)).toBeNull();
    },
  );
});

describe("comments list", () => {
  test("empty store: exit 0, --json prints []", async () => {
    const repo = await tmpRepo();
    const res = await runCommentsCli(["comments", "list", "--json"], repo);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual([]);
  });

  test("human format shows id, file, status and excerpt", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.code).toBe(0);
    expect(res.out).toContain("c:2_2:2_2");
    expect(res.out).toContain("a.ts:2");
    expect(res.out).toContain("open");
    expect(res.out).toContain("seed message");
  });

  test("--unresolved filters out resolved comments", async () => {
    const repo = await tmpRepo();
    await writeComments(
      [seeded(), seeded({ id: "c:3_3:3_3", status: "resolved", anchorText: [" three"] })],
      repo,
    );
    const res = await runCommentsCli(["comments", "list", "--unresolved", "--json"], repo);
    const parsed = JSON.parse(res.out) as Comment[];
    expect(parsed.map((c) => c.id)).toEqual(["c:2_2:2_2"]);
  });

  test("--json round-trips the stored schema", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["comments", "list", "--json"], repo);
    expect(JSON.parse(res.out)).toEqual([seeded()]);
  });

  test("unknown subcommand under comments errors", async () => {
    const repo = await tmpRepo();
    const res = await runCommentsCli(["comments", "frobnicate"], repo);
    expect(res.code).toBe(1);
  });
});

describe("comment", () => {
  test("anchors an added line with '+' marker and diff-derived id", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts:11", "check this"], repo);
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    const stored = await readComments(repo);
    expect(stored).toHaveLength(1);
    const c = stored[0]!;
    expect(c.file).toBe("a.ts");
    expect(c.start).toEqual({ old: null, new: 11 });
    expect(c.end).toEqual({ old: null, new: 11 });
    expect(c.anchorText).toEqual(["+eleven"]);
    expect(c.id).toBe("c:_11:_11");
    expect(c.status).toBe("open");
    expect(c.messages).toEqual([{ role: "assistant", text: "check this" }]);
    expect(res.out).toContain(c.id);
    expect(res.out).toContain("a.ts:11");
  });

  test("anchors a context line with ' ' marker", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts:9", "context note"], repo);
    expect(res.code).toBe(0);
    const c = (await readComments(repo))[0]!;
    expect(c.anchorText).toEqual([" nine"]);
    expect(c.start).toEqual({ old: 9, new: 9 });
  });

  test("--role user stores a user message", async () => {
    const repo = await repoWithEdit();
    await runCommentsCli(["comment", "a.ts:11", "note", "--role", "user"], repo);
    const c = (await readComments(repo))[0]!;
    expect(c.messages).toEqual([{ role: "user", text: "note" }]);
  });

  test("--json prints the created comment", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts:11", "note", "--json"], repo);
    const parsed = JSON.parse(res.out) as Comment;
    expect(parsed.id).toBe("c:_11:_11");
    expect(parsed.anchorText).toEqual(["+eleven"]);
  });

  test("line not part of the diff: exit 1, nothing stored", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts:1", "nope"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("not part of the HEAD-vs-worktree diff");
    expect(await readComments(repo)).toEqual([]);
  });

  test("missing file: exit 1", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "missing.ts:1", "nope"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("missing.ts");
  });

  test("bad target: exit 1", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts", "nope"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("<file>:<line>");
  });

  test("--role assistant is accepted as an explicit value", async () => {
    const repo = await repoWithEdit();
    await runCommentsCli(["comment", "a.ts:11", "note", "--role", "assistant"], repo);
    const c = (await readComments(repo))[0]!;
    expect(c.messages).toEqual([{ role: "assistant", text: "note" }]);
  });

  test("target present but message missing: exit 1 with usage", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "a.ts:11"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("usage: prv comment");
  });

  test("same id anchored in a different file does not block a new comment", async () => {
    const repo = await repoWithEdit();
    await writeComments([seeded({ id: "c:_11:_11", file: "b.ts", anchorText: ["+eleven"] })], repo);
    const res = await runCommentsCli(["comment", "a.ts:11", "on a"], repo);
    expect(res.code).toBe(0);
    const stored = await readComments(repo);
    expect(
      stored
        .filter((c) => c.id === "c:_11:_11")
        .map((c) => c.file)
        .sort(),
    ).toEqual(["a.ts", "b.ts"]);
  });

  test("duplicate range: exit 1 and suggests reply", async () => {
    const repo = await repoWithEdit();
    await runCommentsCli(["comment", "a.ts:11", "first"], repo);
    const res = await runCommentsCli(["comment", "a.ts:11", "second"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("prv reply");
    expect(await readComments(repo)).toHaveLength(1);
  });

  test("./-prefixed path stores the same file/id as the bare form", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "./a.ts:11", "note"], repo);
    expect(res.code).toBe(0);
    const c = (await readComments(repo))[0]!;
    expect(c.file).toBe("a.ts");
    expect(c.id).toBe("c:_11:_11");
  });

  test("tracked-but-unchanged file: exit 1, not part of the diff", async () => {
    const repo = await repoWithEdit();
    writeFileSync(join(repo, "b.ts"), "stable\n");
    await $`git -C ${repo} add b.ts`.quiet();
    await $`git -C ${repo} commit -qm add-b`.quiet();
    const res = await runCommentsCli(["comment", "b.ts:1", "note"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("not part of the HEAD-vs-worktree diff");
  });

  test("a '-'-leading path is rejected, not passed to git as an option", async () => {
    // Regression: `git diff --no-index <file>` without `--` let a filename
    // like `--output=X` truncate a sibling file. Guard + `--` fix it.
    const repo = await repoWithEdit();
    writeFileSync(join(repo, "important.txt"), "important data\n");
    writeFileSync(join(repo, "--output=important.txt"), "x\n");
    const res = await runCommentsCli(["comment", "./--output=important.txt:1", "x"], repo);
    expect(res.code).toBe(1);
    expect(readFileSync(join(repo, "important.txt"), "utf8")).toBe("important data\n");
  });
});

describe("reply", () => {
  test("appends an assistant message by default", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["reply", "c:2_2:2_2", "done, fixed"], repo);
    expect(res.code).toBe(0);
    const c = (await readComments(repo))[0]!;
    expect(c.messages).toEqual([
      { role: "user", text: "seed message" },
      { role: "assistant", text: "done, fixed" },
    ]);
  });

  test("--role user appends a user message", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    await runCommentsCli(["reply", "c:2_2:2_2", "human note", "--role", "user"], repo);
    const c = (await readComments(repo))[0]!;
    expect(c.messages.at(-1)).toEqual({ role: "user", text: "human note" });
  });

  test("unknown id: exit 1", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["reply", "c:9_9:9_9", "msg"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("no comment");
  });

  test("unknown id with --file names the file in the error", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["reply", "c:9_9:9_9", "msg", "--file", "a.ts"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("on a.ts");
  });

  test("id colliding across files: exit 1 naming files; --file disambiguates", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded(), seeded({ file: "b.ts" })], repo);
    const ambiguous = await runCommentsCli(["reply", "c:2_2:2_2", "msg"], repo);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain("a.ts");
    expect(ambiguous.err).toContain("b.ts");
    expect(ambiguous.err).toContain("--file");

    const ok = await runCommentsCli(["reply", "c:2_2:2_2", "msg", "--file", "b.ts"], repo);
    expect(ok.code).toBe(0);
    const stored = await readComments(repo);
    expect(stored.find((c) => c.file === "b.ts")!.messages).toHaveLength(2);
    expect(stored.find((c) => c.file === "a.ts")!.messages).toHaveLength(1);
  });
});

describe("bad inputs exit 1 with a pointed error", () => {
  test.each([
    [["reply", "c:2_2:2_2", "msg", "--role", "banana"], "--role"],
    [["resolve", "c:2_2:2_2", "--bogus"], "unknown flag"],
    [["reply", "c:2_2:2_2", "msg", "--file"], "--file"],
    [["reply", "c:2_2:2_2", "msg", "--role"], "--role"],
    [["reply", "c:2_2:2_2"], "usage"],
    [["resolve"], "usage"],
    [["unresolve"], "usage"],
    [["frobnicate"], "unknown command"],
  ])("%p -> error containing %p", async (argv, needle) => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(argv as string[], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain(needle as string);
  });
});

describe("-- end-of-options separator", () => {
  test("reply accepts a dash-leading message after --", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);
    const res = await runCommentsCli(["reply", "c:2_2:2_2", "--", "-nit: tighten this"], repo);
    expect(res.code).toBe(0);
    const c = (await readComments(repo))[0]!;
    expect(c.messages.at(-1)).toEqual({ role: "assistant", text: "-nit: tighten this" });
  });

  test("comment accepts a dash-leading message after --", async () => {
    const repo = await repoWithEdit();
    const res = await runCommentsCli(["comment", "--", "a.ts:11", "-1 on this rename"], repo);
    expect(res.code).toBe(0);
    const c = (await readComments(repo))[0]!;
    expect(c.messages[0]!.text).toBe("-1 on this rename");
  });
});

describe("corrupt comment store", () => {
  const corrupt = (repo: string) => {
    mkdirSync(join(repo, ".prv"), { recursive: true });
    writeFileSync(join(repo, ".prv/comments.json"), '{"comments": [ {"id": "c:1_1:1_1", TRUNC');
  };

  test("list refuses with exit 1 instead of reporting an empty store", async () => {
    const repo = await tmpRepo();
    corrupt(repo);
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("comments.json");
  });

  test("comment refuses to overwrite a corrupt store", async () => {
    const repo = await repoWithEdit();
    corrupt(repo);
    const before = readFileSync(join(repo, ".prv/comments.json"), "utf8");
    const res = await runCommentsCli(["comment", "a.ts:11", "x"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("comments.json");
    expect(readFileSync(join(repo, ".prv/comments.json"), "utf8")).toBe(before);
  });

  test("reply reports the corruption, not a missing id", async () => {
    const repo = await tmpRepo();
    corrupt(repo);
    const res = await runCommentsCli(["reply", "c:1_1:1_1", "msg"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("comments.json");
  });
});

describe("more list output", () => {
  test("empty store human format says 'no comments'", async () => {
    const repo = await tmpRepo();
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.code).toBe(0);
    expect(res.out).toBe("no comments");
  });

  test("old-side-only anchor labels as 'old N'", async () => {
    const repo = await tmpRepo();
    await writeComments(
      [
        seeded({
          id: "c:5_:5_",
          start: { old: 5, new: null },
          end: { old: 5, new: null },
          anchorText: ["-five"],
        }),
      ],
      repo,
    );
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.out).toContain("a.ts:old 5");
  });

  test("multi-line anchor labels as a range and pluralizes messages", async () => {
    const repo = await tmpRepo();
    await writeComments(
      [
        seeded({
          start: { old: 2, new: 2 },
          end: { old: 4, new: 4 },
          anchorText: [" two", " three", " four"],
          messages: [
            { role: "user", text: "first" },
            { role: "assistant", text: "second" },
          ],
        }),
      ],
      repo,
    );
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.out).toContain("a.ts:2-4");
    expect(res.out).toContain("2 messages");
  });

  test("all-null endpoints and no messages render without an excerpt line", async () => {
    const repo = await tmpRepo();
    await writeComments(
      [
        seeded({
          id: "c:_:_",
          start: { old: null, new: null },
          end: { old: null, new: null },
          anchorText: [],
          messages: [],
        }),
      ],
      repo,
    );
    const res = await runCommentsCli(["comments", "list"], repo);
    expect(res.code).toBe(0);
    expect(res.out).toBe("c:_:_  a.ts:  open  0 messages");
  });

  test("list with extra args errors", async () => {
    const repo = await tmpRepo();
    const res = await runCommentsCli(["comments", "list", "extra"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("usage");
  });

  test("resolve on a corrupt store reports the corruption", async () => {
    const repo = await tmpRepo();
    mkdirSync(join(repo, ".prv"), { recursive: true });
    writeFileSync(join(repo, ".prv/comments.json"), '{"comments": [ TRUNC');
    const res = await runCommentsCli(["resolve", "c:2_2:2_2"], repo);
    expect(res.code).toBe(1);
    expect(res.err).toContain("comments.json");
  });
});

describe("outside a git repository", () => {
  test("comment exits 1 naming the real cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prv-nongit-"));
    repos.push(dir);
    writeFileSync(join(dir, "x.txt"), "hello\n");
    const res = await runCommentsCli(["comment", "x.txt:1", "m"], dir);
    expect(res.code).toBe(1);
    expect(res.err).toContain("not a git repository");
  });
});

describe("cli dispatch (e2e)", () => {
  const cliPath = join(import.meta.dir, "../../src/cli.ts");

  test("`prv comments list --json` runs headless and prints []", async () => {
    const repo = await tmpRepo();
    const proc = Bun.spawn(["bun", cliPath, "comments", "list", "--json"], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(out)).toEqual([]);
  });

  test("`prv comment` with missing args exits 1 with usage", async () => {
    const repo = await tmpRepo();
    const proc = Bun.spawn(["bun", cliPath, "comment"], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(err).toContain("usage: prv comment");
  });

  test("keyword wins over a file literally named 'comments'", async () => {
    const repo = await tmpRepo();
    writeFileSync(join(repo, "comments"), "i am a file\n");
    const proc = Bun.spawn(["bun", cliPath, "comments", "list", "--json"], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(out)).toEqual([]);
  });

  test("`prv --help` documents the comments commands", async () => {
    const proc = Bun.spawn(["bun", cliPath, "--help"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toContain("prv comments list");
    expect(out).toContain("prv comment <file>:<line>");
    expect(out).toContain("prv reply");
    expect(out).toContain("prv resolve");
  });
});

describe("resolve / unresolve", () => {
  test("resolve sets status, unresolve reverts, both idempotent", async () => {
    const repo = await tmpRepo();
    await writeComments([seeded()], repo);

    expect((await runCommentsCli(["resolve", "c:2_2:2_2"], repo)).code).toBe(0);
    expect((await readComments(repo))[0]!.status).toBe("resolved");

    // idempotent
    expect((await runCommentsCli(["resolve", "c:2_2:2_2"], repo)).code).toBe(0);
    expect((await readComments(repo))[0]!.status).toBe("resolved");

    expect((await runCommentsCli(["unresolve", "c:2_2:2_2"], repo)).code).toBe(0);
    expect((await readComments(repo))[0]!.status).toBe("open");
  });

  test("unknown id: exit 1", async () => {
    const repo = await tmpRepo();
    const res = await runCommentsCli(["resolve", "c:9_9:9_9"], repo);
    expect(res.code).toBe(1);
  });
});
