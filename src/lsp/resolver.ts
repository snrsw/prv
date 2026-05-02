import type { LanguageId } from "./language";

export type DefinitionRequest = {
  rootDir: string;
  fileUri: string;
  language: LanguageId;
  text: string;
  line: number;
  character: number;
};

export type DefinitionResolution =
  | { kind: "found"; uri: string; line: number; character: number }
  | { kind: "miss" }
  | { kind: "missing-binary"; binary: string };

export type DefinitionResolver = (req: DefinitionRequest) => Promise<DefinitionResolution>;

export type ReferencesResolution =
  | { kind: "found"; locations: { uri: string; line: number; character: number }[] }
  | { kind: "missing-binary"; binary: string }
  | { kind: "miss" };

export type ReferencesResolver = (req: DefinitionRequest) => Promise<ReferencesResolution>;
