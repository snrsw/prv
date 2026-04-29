import { $ } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function mkTempRepo(label: string): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), label));
  await $`git -C ${repo} init -q -b main`.quiet();
  await $`git -C ${repo} config user.email t@t`.quiet();
  await $`git -C ${repo} config user.name T`.quiet();
  return repo;
}
