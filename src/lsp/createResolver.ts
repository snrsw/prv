import { readFileSync, realpathSync } from "node:fs";
import { LspGateway, type ClientResult, type Spawner, type SpawnedProcess } from "./gateway";
import type { Transport } from "./client";
import type { LanguageId } from "./language";
import type { DefinitionResolver, ReferencesResolver } from "./resolver";

export function createGatewayResolver(opts?: { spawner?: Spawner; rootUri?: string }): {
  resolver: DefinitionResolver;
  references: ReferencesResolver;
  shutdown: () => Promise<void>;
} {
  const spawner = opts?.spawner ?? defaultSpawner;
  const rootUri = opts?.rootUri ?? `file://${process.cwd()}`;
  const gateway = new LspGateway({ spawner, rootUri });
  const openDocs = new Set<string>();

  async function getReady(req: {
    language: LanguageId;
    fileUri: string;
    text: string;
  }): Promise<ClientResult> {
    const result = await gateway.getClient(req.language);
    if (result.kind !== "ready") return result;
    if (!openDocs.has(req.fileUri)) {
      await result.client.didOpen({
        uri: req.fileUri,
        languageId: req.language,
        text: req.text,
      });
      openDocs.add(req.fileUri);
    }
    return result;
  }

  const resolver: DefinitionResolver = async (req) => {
    const ready = await getReady(req);
    if (ready.kind === "unsupported") return { kind: "miss" };
    if (ready.kind === "missing-binary") {
      return { kind: "missing-binary", binary: ready.binary };
    }
    const locations = await ready.client.definition({
      uri: req.fileUri,
      line: req.line,
      character: req.character,
    });
    const first = locations[0];
    if (!first) return { kind: "miss" };
    return {
      kind: "found",
      uri: first.uri,
      line: first.range.start.line,
      character: first.range.start.character,
    };
  };

  const references: ReferencesResolver = async (req) => {
    const ready = await getReady(req);
    if (ready.kind === "unsupported") return { kind: "miss" };
    if (ready.kind === "missing-binary") {
      return { kind: "missing-binary", binary: ready.binary };
    }
    const locations = await ready.client.references({
      uri: req.fileUri,
      line: req.line,
      character: req.character,
      includeDeclaration: true,
    });
    return {
      kind: "found",
      locations: locations.map((l) => ({
        uri: l.uri,
        line: l.range.start.line,
        character: l.range.start.character,
      })),
    };
  };

  return { resolver, references, shutdown: () => gateway.shutdown() };
}

// Run node-shebang scripts through Bun so JS-based language servers
// (typescript-language-server, pyright-langserver) work without `node` on PATH.
function resolveCommand(command: string, args: string[]): { command: string; args: string[] } {
  const which = Bun.which(command);
  if (!which) {
    const error = new Error(`command not found: ${command}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  let target = which;
  try {
    target = realpathSync(which);
  } catch {
    /* keep which */
  }
  try {
    const head = readFileSync(target, "utf8").slice(0, 256);
    const shebang = head.startsWith("#!") ? head.split("\n", 1)[0] : null;
    if (shebang && /\bnode\b/.test(shebang)) {
      return { command: process.execPath, args: [target, ...args] };
    }
  } catch {
    /* not a text file; treat as native */
  }
  return { command: which, args };
}

function defaultSpawner(command: string, args: string[]): SpawnedProcess {
  const resolved = resolveCommand(command, args);
  const child = Bun.spawn([resolved.command, ...resolved.args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdin = child.stdin;
  const transport: Transport = {
    async write(bytes) {
      stdin.write(bytes);
      await stdin.flush();
    },
    async *read() {
      const stdout = child.stdout as ReadableStream<Uint8Array>;
      const reader = stdout.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    close() {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    },
  };
  return {
    transport,
    pid: child.pid,
    kill() {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    },
  };
}
