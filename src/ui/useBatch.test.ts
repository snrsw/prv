import { test, expect, describe } from "bun:test";
import {
  BATCH_ACTIVITY_CAP,
  BUSY_MESSAGE,
  reduceBatch,
  startedRun,
  summarizeBatchResults,
  type BatchRun,
} from "./useBatch";
import type { BatchResult, BatchServerFrame } from "../shared/batch";

const runFrame: BatchServerFrame = { type: "run", runId: "abc12345", count: 3 };

const outcome = (done: boolean): BatchResult => ({ id: "c", file: "a.ts", reply: "ok", done });

const reduceAll = (frames: BatchServerFrame[], from: BatchRun | null = null) =>
  frames.reduce(reduceBatch, from);

describe("startedRun / run frame", () => {
  test("a started run is running, with the client's own count", () => {
    expect(startedRun(4)).toEqual({ running: true, count: 4, activity: [] });
  });

  test("the run frame (re)initializes state with the server's count, even from null", () => {
    expect(reduceBatch(null, runFrame)).toEqual(startedRun(3));
    expect(reduceBatch(startedRun(9), runFrame)).toEqual(startedRun(3));
  });
});

describe("reduceBatch — activity", () => {
  test("tool and progress lines append in ChatMessage shape and stay capped", () => {
    const tools: BatchServerFrame[] = Array.from({ length: BATCH_ACTIVITY_CAP + 2 }, (_, i) => ({
      type: "tool",
      name: "Edit",
      target: `f${i}.ts`,
    }));
    const run = reduceAll([runFrame, ...tools, { type: "progress", text: "thinking" }]);
    expect(run?.activity).toHaveLength(BATCH_ACTIVITY_CAP);
    expect(run?.activity.at(-1)).toEqual({ role: "progress", text: "thinking" });
    expect(run?.activity[0]).toEqual({ role: "tool", name: "Edit", target: "f3.ts" });
  });
});

describe("reduceBatch — results", () => {
  test("results count the addressed threads against the run's own count", () => {
    const run = reduceAll([
      runFrame,
      { type: "results", results: [outcome(true), outcome(false)], skipped: 1 },
    ]);
    expect(run?.results).toEqual({ applied: 1, total: 3, skipped: 1 });
    expect(run?.running).toBe(true); // `done` ends the run, not `results`
  });

  test("more results than threads sent never summarize as more than all of them", () => {
    const run = reduceAll([
      { type: "run", runId: "r", count: 1 },
      { type: "results", results: [outcome(true), outcome(true)], skipped: 0 },
    ]);
    expect(run?.results).toEqual({ applied: 2, total: 2, skipped: 0 });
  });

  test("done after results ends the run without an error", () => {
    const run = reduceAll([
      runFrame,
      { type: "results", results: [outcome(true)], skipped: 0 },
      { type: "done" },
    ]);
    expect(run).toMatchObject({ running: false, count: 3 });
    expect(run?.error).toBeUndefined();
  });
});

describe("reduceBatch — terminal frames", () => {
  test("an error stops the run and is kept through the following done", () => {
    const run = reduceAll([runFrame, { type: "error", message: "agent failed" }, { type: "done" }]);
    expect(run).toMatchObject({ running: false, error: "agent failed" });
  });

  test("an error before the run frame still surfaces", () => {
    expect(reduceBatch(null, { type: "error", message: "no pending comments" })).toEqual({
      running: false,
      count: 0,
      activity: [],
      error: "no pending comments",
    });
  });

  test("done with nothing to show says so instead of claiming success", () => {
    const run = reduceAll([runFrame, { type: "done" }]);
    expect(run).toMatchObject({ running: false, error: "ended without result" });
  });

  test("busy ends the run — no done follows it", () => {
    expect(reduceAll([runFrame, { type: "busy" }])).toMatchObject({
      running: false,
      error: BUSY_MESSAGE,
    });
    expect(reduceBatch(null, { type: "busy" })).toMatchObject({ error: BUSY_MESSAGE });
  });

  test("frames before a run (other than error and busy) are no-ops", () => {
    expect(reduceBatch(null, { type: "done" })).toBeNull();
    expect(reduceBatch(null, { type: "progress", text: "x" })).toBeNull();
  });
});

describe("summarizeBatchResults", () => {
  test("reports what was addressed and what was left", () => {
    expect(summarizeBatchResults({ applied: 3, total: 4, skipped: 1 })).toBe(
      "3 of 4 addressed, 1 left open, 1 skipped",
    );
  });

  test("a clean sweep is one clause", () => {
    expect(summarizeBatchResults({ applied: 2, total: 2, skipped: 0 })).toBe("2 of 2 addressed");
  });

  test("more addressed than sent never reads as a negative remainder", () => {
    expect(summarizeBatchResults({ applied: 3, total: 2, skipped: 0 })).toBe("3 of 2 addressed");
  });
});
