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
  /** The path before a rename (or copy); `path` is then the new one. */
  oldPath?: string;
  status: Status;
  hunks: Hunk[];
  binary: boolean;
  raw: string;
};

export type GitRight = { kind: "ref"; ref: string } | { kind: "worktree" };

export type GitMode = {
  kind: "git";
  cwd: string;
  leftRef: string;
  right: GitRight;
  // `paths`, when set, limits the diff to those git pathspecs (used by `prv <file>`).
  paths?: string[];
};

/**
 * Plain files shown whole, each as an added file. This is how `prv <path>`
 * views something git's diff cannot show: a file outside any repository (a
 * plan under `~/.claude/plans`), or one the repository ignores. A directory
 * expands to the files under it.
 */
export type FilesMode = {
  kind: "files";
  cwd: string;
  paths: string[];
};

export type DiffMode = GitMode | FilesMode;
