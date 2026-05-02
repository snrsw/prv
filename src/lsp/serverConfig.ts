import type { LanguageId } from "./language";

export type ServerConfig = { command: string; args: string[] };

const BY_LANGUAGE: Record<LanguageId, ServerConfig> = {
  typescript: { command: "typescript-language-server", args: ["--stdio"] },
  typescriptreact: { command: "typescript-language-server", args: ["--stdio"] },
  javascript: { command: "typescript-language-server", args: ["--stdio"] },
  javascriptreact: { command: "typescript-language-server", args: ["--stdio"] },
  python: { command: "pyright-langserver", args: ["--stdio"] },
  go: { command: "gopls", args: [] },
  rust: { command: "rust-analyzer", args: [] },
};

export function serverConfigFor(language: LanguageId | null | undefined): ServerConfig | null {
  if (!language) return null;
  return BY_LANGUAGE[language] ?? null;
}
