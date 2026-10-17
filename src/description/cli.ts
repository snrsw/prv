/**
 * Headless change-description CLI (`prv describe`) — lets an agent write the
 * PR-body-like overview prv shows above the diff, in `.prv/description.md`
 * next to the comment store, without a browser.
 */
import { resolve } from "node:path";
import type { CliResult } from "../comments/cli";
import {
  descriptionBytes,
  descriptionTooLargeMessage,
  MAX_DESCRIPTION_BYTES,
} from "../shared/description";
import { pathExists } from "../shared/fs";
import { clearDescription, readDescription, writeDescription } from "./store";

const USAGE =
  "usage: prv describe [--file <path>]   (markdown on stdin, or from <path>)\n" +
  "       prv describe --show | --clear";

const ok = (out = ""): CliResult => ({ code: 0, out, err: "" });
const fail = (err: string): CliResult => ({ code: 1, out: "", err });

/**
 * Where `prv describe` reads its markdown from when no `--file` is given.
 * `read` resolves null when the input passed `MAX_DESCRIPTION_BYTES` (see
 * `readCapped`), so an endless pipe is never buffered whole.
 */
export type DescribeStdin = { isTTY: boolean; read: () => Promise<string | null> };

type DescribeFlags = { action: "write" | "show" | "clear"; file?: string };

export function parseDescribeFlags(argv: string[]): DescribeFlags | { error: string } {
  const flags: DescribeFlags = { action: "write" };
  const setAction = (action: "show" | "clear"): string | null => {
    if (flags.action !== "write") return "`--show` and `--clear` cannot be combined";
    flags.action = action;
    return null;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let error: string | null = null;
    if (arg === "--show") error = setAction("show");
    else if (arg === "--clear") error = setAction("clear");
    else if (arg === "--file") {
      const next = argv[++i];
      if (!next) return { error: "`--file` requires a path" };
      flags.file = next;
    } else if (arg.startsWith("-")) error = `unknown flag: ${arg}`;
    else error = `unexpected argument '${arg}'\n${USAGE}`;
    if (error) return { error };
  }
  if (flags.file !== undefined && flags.action !== "write") {
    return { error: "`--file` cannot be combined with `--show` or `--clear`" };
  }
  return flags;
}

/** `argv` is everything after `describe`. `cwd` is the repo root, as for the comment store. */
export async function runDescribeCli(
  argv: string[],
  cwd: string,
  stdin: DescribeStdin,
): Promise<CliResult> {
  const flags = parseDescribeFlags(argv);
  if ("error" in flags) return fail(`prv describe: ${flags.error}`);

  try {
    switch (flags.action) {
      case "show": {
        const description = await readDescription(cwd);
        if (!description) {
          return fail("prv describe: no description yet — write one with `prv describe`");
        }
        return ok(description.markdown.trimEnd());
      }
      case "clear":
        return ok(
          (await clearDescription(cwd)) ? "cleared the description" : "no description to clear",
        );
      case "write": {
        let markdown: string;
        if (flags.file !== undefined) {
          const path = resolve(cwd, flags.file);
          if (!(await pathExists(path))) {
            return fail(`prv describe: '${flags.file}' does not exist`);
          }
          const file = Bun.file(path);
          // Checked before reading, so a huge file is never loaded.
          if (file.size > MAX_DESCRIPTION_BYTES) {
            return fail(`prv describe: ${descriptionTooLargeMessage(file.size)}`);
          }
          markdown = await file.text();
        } else {
          // Never sit waiting on an interactive terminal.
          if (stdin.isTTY) return fail(`prv describe: no input — pipe markdown in\n${USAGE}`);
          const read = await stdin.read();
          if (read === null) {
            return fail(`prv describe: the input is over the ${MAX_DESCRIPTION_BYTES}-byte limit`);
          }
          markdown = read;
        }
        const bytes = descriptionBytes(markdown);
        if (bytes > MAX_DESCRIPTION_BYTES) {
          return fail(`prv describe: ${descriptionTooLargeMessage(bytes)}`);
        }
        if (markdown.trim() === "") return fail("prv describe: the description is empty");
        await writeDescription(markdown, cwd);
        return ok("wrote .prv/description.md");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`prv describe: ${message}`);
  }
}
