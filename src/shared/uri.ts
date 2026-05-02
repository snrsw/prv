import { isAbsolute, relative } from "node:path";

export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  return decodeURIComponent(uri.slice("file://".length));
}

export function isInside(rootDir: string, candidate: string): boolean {
  const rel = relative(rootDir, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
