import { test, expect, describe } from "bun:test";
import {
  DESCRIBE_ACTIVITY_CAP,
  DESCRIBE_BUSY_MESSAGE,
  formatUpdatedAt,
  reduceDescribe,
  type DescribeRun,
} from "./useDescription";

const running: DescribeRun = { running: true, activity: [] };

describe("reduceDescribe", () => {
  test("ignores frames when no run is in flight", () => {
    expect(reduceDescribe(null, { type: "progress", text: "x" })).toBeNull();
  });

  test("collects activity, capped", () => {
    let run: DescribeRun | null = running;
    for (let i = 0; i < DESCRIBE_ACTIVITY_CAP + 2; i++) {
      run = reduceDescribe(run, { type: "progress", text: `p${i}` });
    }
    run = reduceDescribe(run, { type: "tool", name: "Read", target: "a.ts" });
    expect(run!.activity).toHaveLength(DESCRIBE_ACTIVITY_CAP);
    expect(run!.activity.at(-1)).toEqual({ role: "tool", name: "Read", target: "a.ts" });
  });

  test("a description ends the run, and the trailing done keeps it ended", () => {
    const after = reduceDescribe(running, {
      type: "description",
      description: { markdown: "x", updatedAt: "2026-10-18T00:00:00.000Z" },
    });
    expect(after).toBeNull();
    expect(reduceDescribe(after, { type: "done" })).toBeNull();
  });

  test("an error stops the run and survives the done that follows", () => {
    const failed = reduceDescribe(running, { type: "error", message: "boom" });
    expect(failed).toEqual({ running: false, activity: [], error: "boom" });
    expect(reduceDescribe(failed, { type: "done" })).toEqual(failed);
  });

  test("busy and a bare done each fail the run visibly", () => {
    expect(reduceDescribe(running, { type: "busy" })?.error).toBe(DESCRIBE_BUSY_MESSAGE);
    expect(reduceDescribe(running, { type: "done" })?.error).toBe("ended without a description");
  });
});

describe("formatUpdatedAt", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("relative within a week", () => {
    expect(formatUpdatedAt(ago(10_000), now)).toBe("updated just now");
    expect(formatUpdatedAt(ago(5 * 60_000), now)).toBe("updated 5 min ago");
    expect(formatUpdatedAt(ago(3 * 3_600_000), now)).toBe("updated 3 h ago");
    expect(formatUpdatedAt(ago(2 * 86_400_000), now)).toBe("updated 2 d ago");
  });

  test("a future time (clock skew) reads as just now", () => {
    expect(formatUpdatedAt(ago(-60_000), now)).toBe("updated just now");
  });

  test("absolute past a week, empty for garbage", () => {
    expect(formatUpdatedAt(ago(30 * 86_400_000), now)).toMatch(/^updated \S/);
    expect(formatUpdatedAt(ago(30 * 86_400_000), now)).not.toContain("ago");
    expect(formatUpdatedAt("not a date", now)).toBe("");
  });
});
