import type { FileDiff, FileTotals } from "./types";

export function fileTotals(file: FileDiff): FileTotals {
  let adds = 0;
  let dels = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) adds++;
      else if (line.startsWith("-")) dels++;
    }
  }
  return { adds, dels };
}

export function sumTotals(files: FileDiff[]): FileTotals {
  return files.reduce<FileTotals>(
    (acc, f) => {
      const t = fileTotals(f);
      return { adds: acc.adds + t.adds, dels: acc.dels + t.dels };
    },
    { adds: 0, dels: 0 },
  );
}
