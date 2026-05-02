import { relative } from "node:path";
import { isInside, uriToPath } from "../shared/uri";

export type RawReference = { uri: string; line: number; character: number };

export type ReferenceRow = { line: number; character: number };

export type LocalGroup = { path: string; refs: ReferenceRow[] };

export type GroupedReferences = {
  inFile: ReferenceRow[];
  local: LocalGroup[];
  external: number;
};

export function groupReferences(
  refs: RawReference[],
  rootDir: string,
  currentFile: string,
): GroupedReferences {
  const inFile: ReferenceRow[] = [];
  const localByPath = new Map<string, ReferenceRow[]>();
  let external = 0;

  for (const r of refs) {
    const path = uriToPath(r.uri);
    if (!path || !isInside(rootDir, path)) {
      external++;
      continue;
    }
    const rel = relative(rootDir, path);
    const row: ReferenceRow = { line: r.line, character: r.character };
    if (rel === currentFile) {
      inFile.push(row);
      continue;
    }
    const existing = localByPath.get(rel);
    if (existing) existing.push(row);
    else localByPath.set(rel, [row]);
  }

  const local: LocalGroup[] = [...localByPath.entries()].map(([path, rows]) => ({
    path,
    refs: rows,
  }));
  return { inFile, local, external };
}
