// `PRV_VERSION` is replaced at Nix build time via `bun build --define`.
// In dev (`bun test`, `bun run dev`) it is not defined; `typeof` is the one
// operator that is safe to apply to an undeclared identifier, so the guard
// never throws.
declare const PRV_VERSION: string;

export const version: string = typeof PRV_VERSION === "string" ? PRV_VERSION : "0.0.0-dev";
