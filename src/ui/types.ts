export type { FileDiff, GitRight, Hunk, Status } from "../diff/types";
export type { DiffMode as ServerMode } from "../diff/types";

export type RefsResponse = { branches: string[] };

export type DirsResponse = { dirs: string[] };

export type FileTotals = { adds: number; dels: number };
