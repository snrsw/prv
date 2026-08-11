export type Status = "added" | "deleted" | "modified" | "renamed";

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
};

export type FileDiff = {
  path: string;
  status: Status;
  hunks: Hunk[];
  binary: boolean;
  raw: string;
};

export type GitRight = { kind: "ref"; ref: string } | { kind: "worktree" };

export type DiffMode = {
  kind: "git";
  cwd: string;
  leftRef: string;
  right: GitRight;
  // `paths`, when set, limits the diff to those git pathspecs (used by `prv <file>`).
  paths?: string[];
};
