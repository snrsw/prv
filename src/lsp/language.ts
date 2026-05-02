export type LanguageId =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact"
  | "python"
  | "go"
  | "rust";

const BY_EXTENSION: Record<string, LanguageId> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  py: "python",
  go: "go",
  rs: "rust",
};

export function detectLanguage(path: string): LanguageId | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? null;
}
