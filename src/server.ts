import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { computeDiff } from "./diff/engine";
import type { DiffMode } from "./diff/types";
import { loadFile, resolveSource } from "./file/loader";
import { detectLanguage } from "./lsp/language";
import { groupReferences } from "./lsp/referencesGroup";
import type { DefinitionResolver, ReferencesResolver } from "./lsp/resolver";
import { decodeMode } from "./shared/modeQuery";
import { isInside, uriToPath } from "./shared/uri";
import index from "./ui/index.html";

export type ServerOptions = {
  port: number;
  defaultMode?: DiffMode;
  resolveDefinition?: DefinitionResolver;
  resolveReferences?: ReferencesResolver;
};

export function createServer(options: ServerOptions) {
  const { defaultMode, resolveDefinition, resolveReferences } = options;

  return Bun.serve({
    port: options.port,
    development: { hmr: true },
    routes: {
      "/": index,
      "/api/config": () => Response.json({ mode: defaultMode ?? null, serverCwd: process.cwd() }),
      "/api/diff": {
        GET: async (req) => {
          const mode = decodeMode(new URL(req.url).searchParams) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          return Response.json(await computeDiff(mode));
        },
      },
      "/api/file": {
        GET: async (req) => {
          const params = new URL(req.url).searchParams;
          const mode = decodeMode(params) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          const file = params.get("file");
          if (!file) return Response.json({ error: "file required" }, { status: 400 });
          const side = params.get("side");
          if (side !== "new" && side !== "old") {
            return Response.json({ error: "side must be 'new' or 'old'" }, { status: 400 });
          }
          return Response.json(await loadFile(mode, file, side));
        },
      },
      "/api/definition": {
        GET: async (req) => {
          const ctx = await prepareLspRequest(req, defaultMode);
          if (ctx instanceof Response) return ctx;
          if (!resolveDefinition) return Response.json({ kind: "unsupported-language" });
          const resolution = await resolveDefinition(ctx.lspRequest);
          if (resolution.kind === "missing-binary") return Response.json(resolution);
          if (resolution.kind === "miss") return Response.json({ kind: "miss" });
          return Response.json(formatHit(resolution, ctx.lspRequest.rootDir));
        },
      },
      "/api/references": {
        GET: async (req) => {
          const ctx = await prepareLspRequest(req, defaultMode);
          if (ctx instanceof Response) return ctx;
          if (!resolveReferences) return Response.json({ kind: "unsupported-language" });
          const resolution = await resolveReferences(ctx.lspRequest);
          if (resolution.kind === "missing-binary") return Response.json(resolution);
          if (resolution.kind === "miss") return Response.json({ kind: "miss" });
          const grouped = groupReferences(resolution.locations, ctx.lspRequest.rootDir, ctx.file);
          const localTexts = await Promise.all(
            grouped.local.map((g) =>
              Bun.file(join(ctx.lspRequest.rootDir, g.path))
                .text()
                .catch(() => ""),
            ),
          );
          return Response.json({
            kind: "ok",
            groups: {
              inFile: grouped.inFile.map((r) => ({
                line: r.line,
                character: r.character,
                snippet: snippetFor(ctx.lspRequest.text, r.line),
              })),
              local: grouped.local.map((g, i) => ({
                path: g.path,
                refs: g.refs.map((r) => ({
                  line: r.line,
                  character: r.character,
                  snippet: snippetFor(localTexts[i] ?? "", r.line),
                })),
              })),
              external: grouped.external,
            },
          });
        },
      },
      "/api/refs": {
        GET: async (req) => {
          const cwd = new URL(req.url).searchParams.get("cwd");
          if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
          const fmt = "%(symref)\t%(refname:short)";
          const r = await $`git -C ${cwd} for-each-ref --format=${fmt} refs/heads refs/remotes`
            .nothrow()
            .quiet();
          const branches = r.stdout
            .toString()
            .split("\n")
            .filter((line) => line.startsWith("\t"))
            .map((line) => line.slice(1));
          return Response.json({ branches });
        },
      },
      "/api/list-dirs": {
        GET: async (req) => {
          const path = new URL(req.url).searchParams.get("path");
          if (!path || !isAbsolute(path)) return Response.json({ dirs: [] });
          try {
            const entries = await readdir(path, { withFileTypes: true });
            const dirs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => join(path, e.name))
              .sort();
            return Response.json({ dirs });
          } catch {
            return Response.json({ dirs: [] });
          }
        },
      },
    },
  });
}

async function prepareLspRequest(
  req: Request,
  defaultMode: DiffMode | undefined,
): Promise<
  | Response
  | {
      file: string;
      lspRequest: import("./lsp/resolver").DefinitionRequest;
    }
> {
  const params = new URL(req.url).searchParams;
  const mode = decodeMode(params) ?? defaultMode;
  if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
  const file = params.get("file");
  if (!file) return Response.json({ error: "file required" }, { status: 400 });
  const side = params.get("side");
  if (side !== "new" && side !== "old") {
    return Response.json({ error: "side must be 'new' or 'old'" }, { status: 400 });
  }
  const line = Number(params.get("line"));
  const character = Number(params.get("character"));
  if (!Number.isInteger(line) || !Number.isInteger(character)) {
    return Response.json({ error: "line/character required" }, { status: 400 });
  }

  const language = detectLanguage(file);
  if (!language) return Response.json({ kind: "unsupported-language" });

  const source = resolveSource(mode, side);
  if (source.kind !== "disk") return Response.json({ kind: "unsupported-source" });

  const content = await loadFile(mode, file, side);
  if (content.kind !== "text") return Response.json({ kind: "miss" });

  const absPath = join(source.root, file);
  return {
    file,
    lspRequest: {
      rootDir: source.root,
      fileUri: `file://${absPath}`,
      language,
      text: content.content,
      line,
      character,
    },
  };
}

function snippetFor(text: string, line: number): string {
  const lines = text.split("\n");
  return (lines[line] ?? "").trim();
}

function formatHit(
  resolution: { kind: "found"; uri: string; line: number; character: number },
  rootDir: string,
) {
  const path = uriToPath(resolution.uri);
  if (path && isInside(rootDir, path)) {
    return {
      kind: "hit",
      path: relative(rootDir, path),
      line: resolution.line,
      character: resolution.character,
    };
  }
  return {
    kind: "hit-external",
    uri: resolution.uri,
    line: resolution.line,
    character: resolution.character,
  };
}
