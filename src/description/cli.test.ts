import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDescribeFlags, runDescribeCli, type DescribeStdin } from "./cli";
import { clearDescription, descriptionPath, readDescription, writeDescription } from "./store";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "prv-describe-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const piped = (text: string): DescribeStdin => ({ isTTY: false, read: async () => text });
const tty: DescribeStdin = {
  isTTY: true,
  read: async () => {
    throw new Error("must not read an interactive stdin");
  },
};

describe("description store", () => {
  test("lives next to the comment store", () => {
    expect(descriptionPath("/repo")).toBe("/repo/.prv/description.md");
  });

  test("missing file reads as null", async () => {
    expect(await readDescription(tmp())).toBeNull();
  });

  test("write then read round-trips, with one trailing newline and an ISO time", async () => {
    const dir = tmp();
    const written = await writeDescription("## Summary\n\nhi\n\n\n", dir);
    expect(written.markdown).toBe("## Summary\n\nhi\n");
    expect(await readDescription(dir)).toEqual(written);
    expect(Number.isNaN(Date.parse(written.updatedAt))).toBe(false);
  });

  test("clear reports whether there was a description", async () => {
    const dir = tmp();
    expect(await clearDescription(dir)).toBe(false);
    await writeDescription("x", dir);
    expect(await clearDescription(dir)).toBe(true);
    expect(await readDescription(dir)).toBeNull();
  });
});

describe("parseDescribeFlags", () => {
  test("defaults to writing from stdin", () => {
    expect(parseDescribeFlags([])).toEqual({ action: "write" });
  });

  test("reads --file, --show and --clear", () => {
    expect(parseDescribeFlags(["--file", "d.md"])).toEqual({ action: "write", file: "d.md" });
    expect(parseDescribeFlags(["--show"])).toEqual({ action: "show" });
    expect(parseDescribeFlags(["--clear"])).toEqual({ action: "clear" });
  });

  test("rejects bad combinations and stray arguments", () => {
    expect(parseDescribeFlags(["--show", "--clear"])).toHaveProperty("error");
    expect(parseDescribeFlags(["--show", "--file", "d.md"])).toHaveProperty("error");
    expect(parseDescribeFlags(["--file"])).toEqual({ error: "`--file` requires a path" });
    expect(parseDescribeFlags(["--json"])).toEqual({ error: "unknown flag: --json" });
    expect(parseDescribeFlags(["summary"])).toHaveProperty("error");
  });
});

describe("prv describe", () => {
  test("writes stdin to .prv/description.md, and --show prints it", async () => {
    const dir = tmp();
    const res = await runDescribeCli([], dir, piped("## Summary\n\nAdds X.\n"));
    expect(res).toEqual({ code: 0, out: "wrote .prv/description.md", err: "" });
    expect(await Bun.file(descriptionPath(dir)).text()).toBe("## Summary\n\nAdds X.\n");
    expect(await runDescribeCli(["--show"], dir, tty)).toEqual({
      code: 0,
      out: "## Summary\n\nAdds X.",
      err: "",
    });
  });

  test("--file reads a path relative to the repo directory", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "body.md"), "from a file");
    const res = await runDescribeCli(["--file", "body.md"], dir, tty);
    expect(res.code).toBe(0);
    expect((await readDescription(dir))?.markdown).toBe("from a file\n");
  });

  test("--file that does not exist fails", async () => {
    const res = await runDescribeCli(["--file", "nope.md"], tmp(), tty);
    expect(res).toEqual({ code: 1, out: "", err: "prv describe: 'nope.md' does not exist" });
  });

  test("--show without a description exits 1 with a message", async () => {
    const res = await runDescribeCli(["--show"], tmp(), tty);
    expect(res.code).toBe(1);
    expect(res.err).toContain("no description yet");
  });

  test("--clear removes the description", async () => {
    const dir = tmp();
    await writeDescription("x", dir);
    expect((await runDescribeCli(["--clear"], dir, tty)).out).toBe("cleared the description");
    expect(await readDescription(dir)).toBeNull();
    expect((await runDescribeCli(["--clear"], dir, tty)).out).toBe("no description to clear");
  });

  test("refuses an empty description and keeps the old one", async () => {
    const dir = tmp();
    await writeDescription("keep me", dir);
    const res = await runDescribeCli([], dir, piped("  \n"));
    expect(res).toEqual({ code: 1, out: "", err: "prv describe: the description is empty" });
    expect((await readDescription(dir))?.markdown).toBe("keep me\n");
  });

  test("does not wait on an interactive terminal", async () => {
    const res = await runDescribeCli([], tmp(), tty);
    expect(res.code).toBe(1);
    expect(res.err).toContain("no input");
  });

  test("flag errors carry the command prefix", async () => {
    const res = await runDescribeCli(["--bogus"], tmp(), tty);
    expect(res).toEqual({ code: 1, out: "", err: "prv describe: unknown flag: --bogus" });
  });
});
