# Nix install for prv — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install and run prv via Nix (`nix run` / `nix profile install` / flake reference) from the project's own flake, shipping a self-contained compiled binary with a usable first-run experience.

**Architecture:** Add a `packages.default` output to the existing `flake.nix` that (1) materializes `node_modules` via a fixed-output derivation (the only network-allowed step), (2) runs the existing `bun build --compile` to produce one standalone binary, and (3) wraps it with `makeBinaryWrapper` so `git` (and `xdg-utils` on Linux) are on its PATH. Companion CLI changes add `--version`/`--help`, clean error handling, and headless/port robustness so the installed tool behaves well on first run.

**Tech Stack:** Bun (compile target `bun`), Nix flakes (nixpkgs via flakehub pin), `makeBinaryWrapper`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-21-nix-install-design.md`

**Conventions for every task:**

- Run all `bun`/`git` test commands inside the dev shell. If `bun` is not on PATH, prefix with `nix develop -c` (e.g. `nix develop -c bun test`). The plan writes `bun …`; use the prefix if needed.
- Existing tests in `tests/cli/args.test.ts` assert individual fields (`opts.mode`, `opts.open`, `opts.port`), never whole-object equality — so **adding** optional fields to `CLIOptions` is safe.

---

## Part A — Companion CLI changes

### Task 1: Version module with build-time injection

**Files:**

- Create: `src/version.ts`
- Test: `tests/cli/version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/version.test.ts
import { test, expect } from "bun:test";
import { version } from "../../src/version";

test("version falls back to a dev string when PRV_VERSION is not defined", () => {
  // In plain `bun test` (no --define), PRV_VERSION is undefined,
  // so version must be the fallback, never the literal "undefined".
  expect(typeof version).toBe("string");
  expect(version.length).toBeGreaterThan(0);
  expect(version).not.toBe("undefined");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/version.test.ts`
Expected: FAIL — `Cannot find module '../../src/version'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/version.ts
// `PRV_VERSION` is replaced at Nix build time via `bun build --define`.
// In dev (`bun test`, `bun run dev`) it is not defined; `typeof` is the one
// operator that is safe to apply to an undeclared identifier, so the guard
// never throws.
declare const PRV_VERSION: string;

export const version: string = typeof PRV_VERSION === "string" ? PRV_VERSION : "0.0.0-dev";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/version.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify typecheck stays green**

Run: `bunx tsc --noEmit`
Expected: no errors (the `declare const` satisfies the strict typecheck).

- [ ] **Step 6: Commit**

```bash
git add src/version.ts tests/cli/version.test.ts
git commit -m "✨ Add build-time-injectable version module"
```

---

### Task 2: `--version`, `--help`, `-v`, `-h`, and unknown-flag handling in parseArgs

**Files:**

- Modify: `src/cli.ts:7-11` (extend `CLIOptions`), `src/cli.ts:43-67` (extend `parseArgs`)
- Test: `tests/cli/args.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/cli/args.test.ts`)

```ts
test("--version sets the version flag", async () => {
  const opts = await parseArgs(["--version"], "/work");
  expect(opts.version).toBe(true);
});

test("-v sets the version flag", async () => {
  const opts = await parseArgs(["-v"], "/work");
  expect(opts.version).toBe(true);
});

test("--help sets the help flag", async () => {
  const opts = await parseArgs(["--help"], "/work");
  expect(opts.help).toBe(true);
});

test("-h sets the help flag", async () => {
  const opts = await parseArgs(["-h"], "/work");
  expect(opts.help).toBe(true);
});

test("default opts have help=false and version=false", async () => {
  const opts = await parseArgs([], "/work");
  expect(opts.help).toBe(false);
  expect(opts.version).toBe(false);
});

test("unknown flag throws", async () => {
  await expect(parseArgs(["--nope"], "/work")).rejects.toThrow("unknown flag: --nope");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/args.test.ts`
Expected: FAIL — `opts.version`/`opts.help` undefined; unknown flag does not throw.

- [ ] **Step 3: Extend `CLIOptions`** (`src/cli.ts:7-11`)

```ts
export type CLIOptions = {
  mode: DiffMode;
  port: number;
  open: boolean;
  help: boolean;
  version: boolean;
};
```

- [ ] **Step 4: Extend `parseArgs`** — replace the body of `parseArgs` (`src/cli.ts:43-67`) with:

```ts
export async function parseArgs(argv: string[], cwd: string): Promise<CLIOptions> {
  let mode: DiffMode = { kind: "git", cwd, leftRef: "HEAD", right: { kind: "worktree" } };
  let port = 0;
  let open = true;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "diff") {
      const a = argv[i + 1];
      const b = argv[i + 2];
      if (!a || !b) throw new Error("`diff` requires two args: prv diff <a> <b>");
      mode = await classifyDiffArgs(cwd, a, b);
      i += 2;
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--port") {
      const next = argv[i + 1];
      if (!next) throw new Error("`--port` requires a number");
      port = parseInt(next, 10);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  return { mode, port, open, help, version };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/args.test.ts`
Expected: PASS (new tests + all pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli/args.test.ts
git commit -m "✨ Parse --version/--help and reject unknown flags"
```

---

### Task 3: Headless detection helper

**Files:**

- Modify: `src/cli.ts` (add `shouldAutoOpen` helper near `openBrowser`)
- Test: `tests/cli/open.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/open.test.ts
import { test, expect } from "bun:test";
import { shouldAutoOpen } from "../../src/cli";

test("open=false always means no auto-open", () => {
  expect(shouldAutoOpen(false, "linux", { DISPLAY: ":0" })).toBe(false);
});

test("darwin auto-opens regardless of DISPLAY", () => {
  expect(shouldAutoOpen(true, "darwin", {})).toBe(true);
});

test("linux with DISPLAY auto-opens", () => {
  expect(shouldAutoOpen(true, "linux", { DISPLAY: ":0" })).toBe(true);
});

test("linux with WAYLAND_DISPLAY auto-opens", () => {
  expect(shouldAutoOpen(true, "linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
});

test("linux headless (no DISPLAY/WAYLAND) does not auto-open", () => {
  expect(shouldAutoOpen(true, "linux", {})).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/open.test.ts`
Expected: FAIL — `shouldAutoOpen` is not exported.

- [ ] **Step 3: Add the helper** — insert into `src/cli.ts` directly above `openBrowser` (currently `src/cli.ts:78`):

```ts
export function shouldAutoOpen(
  open: boolean,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): boolean {
  if (!open) return false;
  // macOS/Windows have a system opener that works without an X/Wayland session.
  if (platform !== "linux") return true;
  // On Linux a GUI needs a display server; otherwise xdg-open is pointless.
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/open.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/open.test.ts
git commit -m "✨ Add headless-aware shouldAutoOpen helper"
```

---

### Task 4: Wire help/version/errors/robust-open into `main`

**Files:**

- Modify: `src/cli.ts:69-90` (the `main`, `openBrowser`, and entrypoint section), add `import { version } from "./version"`

This task has no unit test (it starts a server / exits the process). It is verified manually in Step 4 and by the Nix smoke test in Task 6.

- [ ] **Step 1: Add the version import** at the top of `src/cli.ts` (after the existing imports, around line 5):

```ts
import { version } from "./version";
```

- [ ] **Step 2: Replace `main`, `openBrowser`, and the entrypoint** (`src/cli.ts:69-90`) with:

```ts
const HELP = `prv — Pull-Request like View. Local GitHub-style diff viewer.

Usage:
  prv                          Diff HEAD vs the working tree (default)
  prv diff <a> <b>             Diff two args; each is auto-classified:
                                 path vs path, ref vs ref, or ref + path.
                                 If an arg is both a ref name and an existing
                                 path, the path wins. Force ref with HEAD/a SHA/
                                 origin/<branch>; force path with ./name.
  prv --port <n>               Pin the server port (default: a free port)
  prv --no-open                Do not open a browser
  prv --version, -v            Print version and exit
  prv --help, -h               Print this help and exit

Notes:
  The "chat about the diff" feature requires Claude Code (the \`claude\` CLI)
  installed separately.`;

async function main() {
  const opts = await parseArgs(Bun.argv.slice(2), process.cwd());

  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    console.log(version);
    return;
  }

  let server: ReturnType<typeof createServer>;
  try {
    server = createServer({ port: opts.port, defaultMode: opts.mode });
  } catch (err) {
    if (err instanceof Error && /EADDRINUSE|in use|address already/i.test(err.message)) {
      throw new Error(
        `port ${opts.port} in use — pick another with --port, or omit --port to let prv choose a free one.`,
      );
    }
    throw err;
  }

  const url = String(server.url);
  console.log(`prv listening at ${url}`);

  if (shouldAutoOpen(opts.open, process.platform, process.env)) {
    await openBrowser(url);
  } else if (opts.open) {
    console.log(`(no display detected — open ${url} in a browser manually)`);
  }
}

async function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", url]
        : ["xdg-open", url];
  const code = await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
  if (code !== 0) {
    console.log(`(couldn't open a browser — open ${url} manually)`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a git repository/i.test(message)) {
      console.error(
        "prv: not a git repository. cd into a repo, or compare folders with `prv diff <a> <b>`.",
      );
    } else {
      console.error(`prv: ${message}`);
    }
    process.exit(1);
  }
}
```

- [ ] **Step 3: Run the full test suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Manual smoke test**

Run: `bun src/cli.ts --version` → prints `0.0.0-dev`.
Run: `bun src/cli.ts --help` → prints the help text.
Run: `bun src/cli.ts --bogus` → prints `prv: unknown flag: --bogus` to stderr and exits non-zero (`echo $status` in fish shows non-zero).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "✨ Add --help/--version output, clean errors, headless-safe open"
```

---

## Part B — Nix package

### Task 5: node_modules fixed-output derivation

**Files:**

- Modify: `flake.nix` (add `let`-bindings + a `deps` derivation; full file rewrite below in Task 7 — this task introduces the pieces incrementally, but you may write the whole file once and tick Tasks 5–7 together).

> **FOD hash flow (not a placeholder):** fixed-output derivation hashes are computed by building once. You will set the hash to `lib.fakeHash`, build, and paste the real hash Nix reports. This is the standard, expected flow.

- [ ] **Step 1: Add the source filter, version, and deps derivation to `flake.nix`**

In the `let` block (after `forEachSupportedSystem`), add:

```nix
      pname = "prv";

      baseVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      # Clean version on any committed (clean) tree; bump package.json to the tag
      # value before tagging a release so `prv --version` shows e.g. 0.1.0.
      version = if self ? rev then baseVersion else "${baseVersion}-dirty";

      # Per-system hash for the node_modules FOD.
      # Regenerate after any dependency change:
      #   1. set the relevant entry to nixpkgs.lib.fakeHash
      #   2. nix build .#packages.<system>.deps
      #   3. copy the `got:` sha256 from the error into this map.
      depsHashes = {
        x86_64-linux = inputs.nixpkgs.lib.fakeHash;
        aarch64-linux = inputs.nixpkgs.lib.fakeHash;
        x86_64-darwin = inputs.nixpkgs.lib.fakeHash;
        aarch64-darwin = inputs.nixpkgs.lib.fakeHash;
      };
```

Then inside `forEachSupportedSystem` (see full file in Task 7), define `deps`:

```nix
          # Only package.json + bun.lock affect dependency resolution, so the FOD
          # source is filtered to just those — source edits won't trigger rebuilds.
          depsSrc = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [ ./package.json ./bun.lock ];
          };

          deps = pkgs.stdenvNoCC.mkDerivation {
            pname = "${pname}-node-modules";
            inherit version;
            src = depsSrc;
            nativeBuildInputs = [ pkgs.bun ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              export BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache
              # --production excludes dev AND optional deps; prv's runtime deps are
              # pure JS, so the tree is platform-independent (single hash is safe).
              bun install --production --frozen-lockfile --no-progress
            '';
            installPhase = ''
              # Canonicalize so the output hash is stable across machines.
              rm -rf node_modules/.cache
              find node_modules -type l -lname '/nix/store/*' -delete || true
              mkdir -p $out
              cp -R node_modules $out/node_modules
            '';
            dontFixup = true;
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = depsHashes.${system};
          };
```

- [ ] **Step 2: (deferred)** The build to obtain the real hash happens in Task 8, once the full flake exists. For now just confirm the expression evaluates.

Run: `nix flake check --no-build 2>&1 | head -20` (or `nix eval .#packages.aarch64-darwin.deps.drvPath`)
Expected: evaluates without a syntax/attribute error (it will not _build_ yet — fakeHash).

- [ ] **Step 3: Commit (WIP)** — commit together with Tasks 6–7 (single coherent flake).

---

### Task 6: Package derivation (compile + smoke test + wrapper)

**Files:**

- Modify: `flake.nix` (add `prv` derivation; full file in Task 7)

- [ ] **Step 1: Add the bun-version floor assertion** to the `let` block:

```nix
      # The Nix-sandbox `bun build --compile` 0-byte/broken-binary bug was fixed
      # in Bun 1.3.13; fail loudly rather than ship a broken binary.
      assertBun = pkgs:
        assert inputs.nixpkgs.lib.versionAtLeast pkgs.bun.version "1.3.13";
        pkgs.bun;
```

- [ ] **Step 2: Add the `prv` derivation** inside `forEachSupportedSystem`:

```nix
          bun = assertBun pkgs;

          prv = pkgs.stdenvNoCC.mkDerivation {
            inherit pname version;
            src = ./.;
            nativeBuildInputs = [ bun pkgs.makeBinaryWrapper pkgs.git ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              cp -R ${deps}/node_modules ./node_modules
              chmod -R u+w node_modules
              # KEEP IN SYNC with package.json "build" script. Inlined (not
              # `bun run build`) because we must add --define for version
              # injection. --target=bun embeds the host bun runtime; no fetch.
              bun build --compile --target=bun \
                --define PRV_VERSION='"${version}"' \
                src/cli.ts --outfile dist/prv

              # Smoke test: a non-empty binary that actually runs. On Linux this
              # also confirms the embedded ELF interpreter (a /nix/store path) is
              # valid — `test -s` alone would miss a binary that won't start.
              test -s dist/prv
              ./dist/prv --version
            '';
            installPhase = ''
              install -Dm755 dist/prv $out/bin/.prv-wrapped
              makeBinaryWrapper $out/bin/.prv-wrapped $out/bin/prv \
                --prefix PATH : ${pkgs.lib.makeBinPath (
                  [ pkgs.git ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.xdg-utils ]
                )}
            '';
            dontFixup = true;
            meta = {
              description = "Pull-Request like View — local GitHub-style diff viewer";
              mainProgram = pname;
              license = pkgs.lib.licenses.mit;
              platforms = supportedSystems;
            };
          };
```

> Note: `--prefix PATH` prepends the Nix-pinned `git`; the user's existing PATH is still appended, so a user-installed `claude` remains reachable for the chat feature (which degrades gracefully if absent).

- [ ] **Step 3: (deferred)** Built/verified in Task 8.

---

### Task 7: Full flake.nix (packages + checks + formatter), assembled

**Files:**

- Modify: `flake.nix` (replace whole file)

- [ ] **Step 1: Replace `flake.nix` entirely** with:

```nix
{
  description = "prv — Pull-Request like View. Local GitHub-style diff viewer.";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";
  };

  outputs =
    { self, ... }@inputs:

    let
      pname = "prv";

      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f {
            pkgs = import inputs.nixpkgs { inherit system; };
            inherit system;
          }
        );

      baseVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      version = if self ? rev then baseVersion else "${baseVersion}-dirty";

      # Per-system hash for the node_modules FOD. Regenerate after dependency
      # changes: set the entry to inputs.nixpkgs.lib.fakeHash, run
      #   nix build .#packages.<system>.deps
      # and paste the `got:` sha256 here.
      depsHashes = {
        x86_64-linux = inputs.nixpkgs.lib.fakeHash;
        aarch64-linux = inputs.nixpkgs.lib.fakeHash;
        x86_64-darwin = inputs.nixpkgs.lib.fakeHash;
        aarch64-darwin = inputs.nixpkgs.lib.fakeHash;
      };

      # Bun 1.3.13 fixed the sandbox compile bug; fail eval if older.
      assertBun = pkgs: assert inputs.nixpkgs.lib.versionAtLeast pkgs.bun.version "1.3.13"; pkgs.bun;

      # NOTE: extraction trigger — if this derivation grows past ~40-50 lines or a
      # second package appears, move it to ./package.nix and callPackage it.
    in
    {
      packages = forEachSupportedSystem (
        { pkgs, system }:
        let
          bun = assertBun pkgs;

          depsSrc = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [ ./package.json ./bun.lock ];
          };

          deps = pkgs.stdenvNoCC.mkDerivation {
            pname = "${pname}-node-modules";
            inherit version;
            src = depsSrc;
            nativeBuildInputs = [ bun ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              export BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache
              bun install --production --frozen-lockfile --no-progress
            '';
            installPhase = ''
              rm -rf node_modules/.cache
              find node_modules -type l -lname '/nix/store/*' -delete || true
              mkdir -p $out
              cp -R node_modules $out/node_modules
            '';
            dontFixup = true;
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = depsHashes.${system};
          };

          prv = pkgs.stdenvNoCC.mkDerivation {
            inherit pname version;
            src = ./.;
            nativeBuildInputs = [ bun pkgs.makeBinaryWrapper pkgs.git ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              cp -R ${deps}/node_modules ./node_modules
              chmod -R u+w node_modules
              # KEEP IN SYNC with package.json "build" script (inlined for --define).
              bun build --compile --target=bun \
                --define PRV_VERSION='"${version}"' \
                src/cli.ts --outfile dist/prv
              test -s dist/prv
              ./dist/prv --version
            '';
            installPhase = ''
              install -Dm755 dist/prv $out/bin/.prv-wrapped
              makeBinaryWrapper $out/bin/.prv-wrapped $out/bin/prv \
                --prefix PATH : ${pkgs.lib.makeBinPath (
                  [ pkgs.git ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.xdg-utils ]
                )}
            '';
            dontFixup = true;
            meta = {
              description = "Pull-Request like View — local GitHub-style diff viewer";
              mainProgram = pname;
              license = pkgs.lib.licenses.mit;
              platforms = supportedSystems;
            };
          };
        in
        {
          inherit deps;
          ${pname} = prv;
          default = prv;
        }
      );

      checks = forEachSupportedSystem (
        { pkgs, system }:
        {
          tests = pkgs.stdenvNoCC.mkDerivation {
            name = "${pname}-tests";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun pkgs.git ];
            dontConfigure = true;
            buildPhase = ''
              export HOME=$TMPDIR
              git config --global user.email test@example.com
              git config --global user.name test
              git config --global init.defaultBranch main
              cp -R ${self.packages.${system}.deps}/node_modules ./node_modules
              chmod -R u+w node_modules
              bun test
            '';
            installPhase = "touch $out";
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.nixfmt-rfc-style);

      devShells = forEachSupportedSystem (
        { pkgs, ... }:
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              git
            ];
          };
        }
      );
    };
}
```

> **Risk note for the executor:** the `checks.tests` derivation runs `bun test` against the `--production` node_modules. Two things can make it fail in the sandbox: (1) a test that needs a devDependency at runtime — if so, give `checks` its own full-deps FOD (drop `--production`, its own hash) or scope the run; (2) a test that shells out to `claude` (e.g. `src/chat/agent.test.ts`) — that binary is absent in the sandbox, so confirm those tests are pure or exclude them with a path filter (`bun test tests/`). The `git config` lines exist because several tests (`tests/support.ts → mkTempRepo`) create real repos and git refuses to commit without an identity.

- [ ] **Step 2: Commit the WIP flake**

```bash
git add flake.nix
git commit -m "✨ Add Nix package, checks, and formatter outputs (hashes pending)"
```

---

### Task 8: Build, fill per-system hash, verify on this machine

**Files:**

- Modify: `flake.nix` (`depsHashes.aarch64-darwin`)

- [ ] **Step 1: Build deps to get the real hash**

Run: `nix build .#packages.aarch64-darwin.deps -L`
Expected: FAILS with a hash mismatch:

```
error: hash mismatch in fixed-output derivation '...':
         specified: sha256-AAAA...0000=
            got:    sha256-<REAL>=
```

- [ ] **Step 2: Paste the real hash** into `depsHashes.aarch64-darwin` in `flake.nix` (replace `inputs.nixpkgs.lib.fakeHash` for that one system with the `got:` string).

- [ ] **Step 3: Re-build deps**

Run: `nix build .#packages.aarch64-darwin.deps -L`
Expected: SUCCESS, produces `./result` symlink to a store path containing `node_modules`.

- [ ] **Step 4: Build the package**

Run: `nix build .#packages.aarch64-darwin.default -L`
Expected: SUCCESS; build log shows the in-build `./dist/prv --version` printing `0.0.0-dirty` (or `0.0.0` if committed clean). `./result/bin/prv` exists.

- [ ] **Step 5: Run the built binary**

Run:

```bash
./result/bin/prv --version    # prints the injected version
./result/bin/prv --help       # prints help
```

Expected: both succeed.

- [ ] **Step 6: End-to-end run via the flake**

Run:

```bash
mkdir -p /tmp/prv-a /tmp/prv-b
echo one > /tmp/prv-a/f.txt
echo two > /tmp/prv-b/f.txt
nix run . -- diff /tmp/prv-a /tmp/prv-b --no-open
```

Expected: prints `prv listening at http://localhost:<port>` (no crash). Stop with Ctrl-C.

- [ ] **Step 7: Run flake check**

Run: `nix flake check -L`
Expected: PASS (runs `checks.tests` → `bun test`). If a test needs devDeps, apply the risk-note fix from Task 7.

- [ ] **Step 8: Commit**

```bash
git add flake.nix
git commit -m "✨ Pin aarch64-darwin node_modules FOD hash"
```

> **Linux hashes:** `x86_64-linux`, `aarch64-linux`, and `x86_64-darwin` cannot be built from this aarch64-darwin machine (no cross-compile). Leave them as `fakeHash` with the regen comment, and fill them via CI or a native machine. This is tracked as a follow-up, not a blocker for the darwin install path.

---

## Part C — Docs

### Task 9: README install section + chat prerequisite + headless note

**Files:**

- Modify: `README.md` (add an Install section before "## Usage"; tweak Development note)

- [ ] **Step 1: Insert an Install section** after the intro bullets and before `## Usage`:

````markdown
## Install

Install with Nix (flakes enabled):

```sh
nix run github:snrsw/prv                 # run without installing
nix run github:snrsw/prv -- diff a b     # pass args after --
nix profile install github:snrsw/prv     # install to your profile
nix profile upgrade prv                  # later: upgrade
nix profile remove prv                   # later: remove
```
````

Pin to a released tag for reproducibility:

```sh
nix run github:snrsw/prv/v0.1.0
```

Add to a home-manager config:

```nix
# flake inputs: prv.url = "github:snrsw/prv";
home.packages = [ inputs.prv.packages.${pkgs.system}.default ];
```

Or NixOS:

```nix
environment.systemPackages = [ inputs.prv.packages.${pkgs.system}.default ];
```

**Notes**

- macOS opens your browser with `open`; Linux uses `xdg-open`. On a headless/SSH
  box no browser opens — use the printed URL (or pass `--no-open`).
- The Nix package targets Linux and macOS only (not Windows).
- The "chat about the diff" / AI-review feature needs Claude Code (the `claude`
  CLI) installed separately; core diff viewing works without it.

````

- [ ] **Step 2: Verify the README renders** (visual check of the markdown; no command).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "📝 Document Nix install, headless behavior, and claude prerequisite"
````

---

### Task 10: Final verification pass

- [ ] **Step 1: Full local gate**

Run:

```bash
bun test
bunx tsc --noEmit
nix build .#packages.aarch64-darwin.default -L
./result/bin/prv --version
nix flake check -L
```

Expected: all green; `prv --version` prints the injected version.

- [ ] **Step 2: Confirm the spec's "Verification" section items** are all satisfied for the darwin path, and that the Linux items remain explicitly listed as follow-ups (do not claim Linux works).

- [ ] **Step 3: Tag guidance (do not auto-run)** — once happy, the maintainer bumps `package.json` `version` to `0.1.0`, commits, and tags `v0.1.0` so `nix run github:snrsw/prv/v0.1.0` resolves and `prv --version` shows a clean `0.1.0`.

---

## Out-of-scope follow-ups (tracked, not in this plan)

- CI matrix to build/cache and fill the three non-darwin `depsHashes` and run Linux smoke tests.
- nixpkgs submission; home-manager _module_; overlay output.
- Adding `oxlint`/`oxfmt`/`typescript` to the devShell for reproducible lint/format/typecheck.
