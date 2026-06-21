# Nix install for prv — design

**Date:** 2026-06-21
**Goal:** Let users install and run prv via Nix from the project's own flake.

## Scope

In scope:
- A flake **package output** so users can `nix run` / `nix profile install` prv and reference it from other flakes.
- Building the existing `bun build --compile` standalone binary inside a Nix derivation (sandboxed, no network in the main build).
- Runtime dependency wrapping so the binary "just works" after install.
- The minimal **companion CLI changes** that the install experience depends on (version surfacing, clean first-run errors, headless/port handling).
- Install documentation in the README.

Out of scope (tracked as separate follow-ups, see end):
- Submitting to nixpkgs.
- A dedicated home-manager *module* (the package output is already home-manager-consumable).
- An overlay output (no consumer yet — YAGNI).

## Architecture & flake outputs

Extend the existing `flake.nix` (keep the devShell). Add, via the existing `forEachSupportedSystem` helper over the 4 systems:

- `packages.prv` and `packages.default` — the wrapped prv binary. Set `meta.mainProgram = "prv"`.
- `checks.default` — runs `bun test` (so `nix flake check` is meaningful and doubles as our verification gate).
- `formatter` — `nixfmt` (so `nix fmt` formats the Nix files).

No separate `apps.*` output: with `meta.mainProgram = "prv"` set, `nix run` resolves to `packages.default`/`bin/prv` unambiguously, so an `apps` entry would just be a second path literal to keep in sync. Add one only if a non-default app ever appears (YAGNI, matching the overlay/home-manager-module stance).

Use a single `pname = "prv"` let-binding for every `prv` literal in the flake (package name, `mainProgram`, wrapper, install path) so the name has one source and renaming can't drift.

Keep everything inline in `flake.nix` for now (one maintainer, one package). Add a comment noting the extraction trigger: split into `package.nix` once the derivation exceeds ~40–50 lines or a second package appears.

The flakehub `nixpkgs 0.1` input stays — `flake.lock` already pins it to a concrete rev + narHash, so package builds are reproducible. (Optional future change: switch to `github:NixOS/nixpkgs/nixos-25.05` to drop the flakehub availability dependency.)

User-facing result:

```sh
nix run github:snrsw/prv                    # run without installing
nix run github:snrsw/prv -- diff a b        # pass args
nix profile install github:snrsw/prv        # install to profile
nix run github:snrsw/prv/v0.1.0             # pin to a tag (after first release)
```

## Build: dependencies (resolves the per-system-hash critical)

Bun apps can't fetch deps in the sandboxed main build, so deps come from a **fixed-output derivation (FOD)**:

- FOD runs `bun install --frozen-lockfile` from `package.json` + `bun.lock`.
- Hygiene required for a stable hash: `export HOME=$TMPDIR`, a build-local cache (`BUN_INSTALL_CACHE_DIR=$TMPDIR/.bun-cache`), and a canonicalize step before the output is hashed. The canonicalize step is the load-bearing risk (it's where hand-rolled bun FODs usually produce unstable hashes), so commit to a concrete recipe: `rm -rf node_modules/.cache`, delete any `.bun-install` / install-state files, and repoint or delete symlinks targeting `/nix/store` (`find node_modules -type l -lname '/nix/store/*'`). **Drift rule:** if the hash differs between two clean rebuilds on the same machine, that is the trigger to stop hand-rolling and adopt `bun2nix`.
- **Hashes are per-system.** `bun install` resolves platform-specific optional/native dependencies (the devDeps `oxlint`/`oxfmt` are native; transitive optional deps may be too), so a single shared hash will fail on at least one target. Store an `outputHash` per system in an attrset keyed by system.
- Document the regen command in a `flake.nix` comment: set the hash to `lib.fakeHash`, run `nix build .#packages.<system>.deps`, copy the `got:` hash from the error.

**Simplification to try first (verify, don't assume):** install only runtime deps with `bun install --production`. Note this excludes **both** `devDependencies` **and** `optionalDependencies` — the real guarantee is "no dev and no optional deps," not just "no devtools." prv's runtime deps (react, react-dom, diff2html, highlight.js) are pure JS and the lockfile's ~38 `os`/`cpu`-constrained entries all belong to the `oxlint`/`oxfmt` devtools, so the prod tree is platform-independent and a single shared hash is safe *for this repo today*. The spec keeps the per-system map as the correct default; collapse to a single hash only after confirming the prod tree has no per-platform entries, and revisit if a future runtime dep ships an optional native binding (which `--production` would silently drop from the compiled binary).

**Alternative (documented, not adopted now):** `bun2nix` (nix-community) generates `bun.nix` from `bun.lock` and manages per-arch hashes via a regen command instead of by hand. Adopt it if the hand-maintained hashes become a chore. Default stays hand-rolled to avoid a new codegen dependency and because we control how it feeds `--compile`.

## Build: compile (resolves the sandbox-compile + cross-build hard issues)

Main derivation (no network):

1. Bring in the FOD `node_modules` by **copying** (or `lndir`) into the build dir rather than a single top-level symlink — a symlinked tree whose `.bin` points into the read-only store can break path-sensitive resolution.
2. **Pin `bun` explicitly and enforce a floor of `>= 1.3.13`.** The Nix-sandbox compile bug that produces a 0-byte / broken binary was a real regression (Bun 1.3.2–1.3.5) fixed in 1.3.13; relying on whatever bun the nixpkgs pin happens to ship makes the build hostage to a version bump. Assert it in the build (fail the derivation if `bun --version` is below the floor) so a future nixpkgs downgrade fails loudly instead of shipping a broken binary. The build bun and the devShell bun should be the same `pkgs.bun`, and `bun.lock` should be regenerated with that same bun (version skew between the lockfile author and the build bun is a realistic FOD-hash churn source).
3. Build via `bun run build` (call the npm script — single source of truth — resolves build-script drift), which runs `bun build --compile --target=bun src/cli.ts --outfile dist/prv`.
   - `--target=bun` = the host runtime; it embeds the already-installed bun runtime and performs **no network fetch** (network fetch only happens for cross-targets like `bun-linux-x64`). Confirm offline during verification.
4. **Smoke test in the build phase:** `test -s dist/prv` (non-empty), then actually **execute** the binary headlessly (`dist/prv --version`, and a `--no-open` diff of two temp dirs). Running it — not just size-checking — is what catches both the 0-byte failure and a binary that builds but won't start. The execute check must run on Linux too (see ELF note below), so it belongs in the derivation/CI, not only on this Mac.
5. `install -Dm755 dist/prv $out/bin/prv` (into the wrapper input; see next section).

**Linux ELF interpreter:** on a Nix host, `bun build --compile` writes the Nix-store path of the dynamic linker (`ld-linux`) into the produced ELF's interpreter field. For a *Nix-installed* package this is correct — the store `glibc` is a real runtime dependency — but it means the binary is **not relocatable outside the Nix store** (don't `scp` it to a non-Nix box and expect it to run). `makeBinaryWrapper` does not change the interpreter; it only sets env/PATH. The `>= 1.3.13` pin also covers the interpreter-rewrite behavior being predictable. The Linux smoke test must confirm the binary actually executes, since a wrong interpreter passes `test -s` but fails to run.

**Cross-build:** each system compiles its own binary with `--target=bun`; darwin↔linux cannot cross-build through this flake. This is documented as a per-system native-build requirement (CI matrix per OS/arch, or `nix build .#packages.<sys>` only on a matching machine). We do not promise universal `nix build` from one host. Note: nixpkgs marks x86_64-darwin bun as hanging under Rosetta and excludes it from Hydra — treat x86_64-darwin as best-effort.

## Runtime dependencies (resolves the chat/claude critical)

Wrap the binary with `makeBinaryWrapper`:

- `git` — always on PATH (prv shells out to git; path-vs-path mode works without it, but ref modes need it).
- Browser opener — **`xdg-utils` only on Linux** (`lib.optionals stdenv.isLinux`); on macOS `open` is part of the base system and already on PATH. Don't add `xdg-utils` on Darwin (it's a Linux no-op).
- **`claude` is NOT bundled.** The chat feature spawns the external `claude` CLI and already degrades gracefully with a clear message when it's absent (`src/chat/agent.ts:159`). It cannot reasonably be a Nix runtime dep. The wrapper prepends `git`/`xdg-utils` but leaves the user's existing PATH intact, so a user-installed `claude` is still found. Documented as an optional prerequisite for the chat/AI-review feature. Core diff viewing never depends on `claude`.

## Companion CLI changes (resolves version + first-run hard issues)

These are small but required for a real install experience:

1. **`--version` / `-v`** — print the version and exit. **`--help` / `-h`** — print usage and exit. **Unknown `--flags`** — error instead of silently ignoring (current `parseArgs` drops them). `--help` must document the non-obvious bits: the `diff <a> <b>` arg classification (path-vs-path / ref-vs-ref / ref+path, path-wins tiebreak), `--port`, `--no-open`, and the default mode (HEAD vs working tree).
2. **Version injection** — version is currently `"0.0.0"` and unwired. Use `bun build --define PRV_VERSION='"<value>"'` and add an ambient `declare const PRV_VERSION: string;` to the source so `bunx tsc --noEmit` / `bun test` stay green (the `--define` identifier must be declared, or typecheck fails — this is why we pick `--define` explicitly over leaving it open). For non-Nix dev builds the define is absent, so `cli.ts` falls back to the package.json version. **Format:** emit a clean `X.Y.Z` when building from a tagged ref (`self.rev` corresponds to a tag), and append `-g<shortRev>` only for untagged/dirty builds — so a user who installed `…/v0.1.0` sees `0.1.0`, not a noisy "unreleased"-looking string.
3. **Top-level error handling** — wrap `main()` in try/catch: print the error message to stderr and `process.exit(1)` instead of an unhandled rejection / stack trace. Special-case "not a git repository" with a hint to `cd` into a repo or use `prv diff <a> <b>`.
4. **Browser open robustness** — check the `openBrowser` spawn exit code (currently ignored); on failure print "couldn't open a browser — open <url> manually". Skip auto-open on headless/SSH (no `$DISPLAY` on Linux, or stdout not a TTY) with a hint. The listening URL is already printed unconditionally (good — keep that).
5. **Port-in-use** — the default run (no `--port`) uses port 0 (auto-pick) and can never hit this; the error only occurs with an explicit `--port N`. Catch the `Bun.serve` listen error and print "port N in use — pick another with `--port`, or omit `--port` to let prv choose a free one."

## Documentation

Add an **Install** section to the README:
- `nix run github:snrsw/prv` and `nix profile install github:snrsw/prv`.
- Upgrade / remove a profile install: `nix profile upgrade prv` / `nix profile remove prv`.
- Pinning to a tag/rev (`github:snrsw/prv/v0.1.0`).
- home-manager: add the flake input and `home.packages = [ inputs.prv.packages.${system}.default ];`.
- NixOS: `environment.systemPackages`.
- Platform note: macOS uses `open`, Linux uses `xdg-open`; **headless/SSH caveat** — no browser opens, use the printed URL (or `--no-open`). The Nix install targets the 4 unix systems only; Windows is not supported (the `win32` branch in `openBrowser` exists for bun-run-from-source, not the Nix package).
- The chat/AI-review feature needs Claude Code (`claude`) installed separately.

Cut a `v0.1.0` git **tag** once the package output builds and runs, so `nix run`/profile installs can pin to a stable ref instead of bleeding-edge `main`. Keep `version` in sync with the tag.

## Verification

- `nix build .#packages.aarch64-darwin.default` succeeds on this machine; the build-phase smoke test asserts a non-empty, runnable binary.
- `nix run . -- --version` prints the injected version; `nix run . -- --help` prints usage.
- `nix run . -- diff <tmpA> <tmpB> --no-open` renders a diff and shells out to git correctly.
- `nix flake check` passes (runs `bun test` via `checks.default`).
- **Cannot verify here:** Linux builds (x86_64/aarch64) from this Mac. Tracked as a follow-up (CI matrix or a Linux box) — do not claim Linux works until built natively.

## Decisions log (DR)

- **Deps strategy:** hand-rolled per-system FOD (default) over bun2nix — keeps zero new tooling, known to compose with `--compile`; bun2nix noted as the fallback when hash maintenance becomes painful. Try prod-only install to collapse to a single hash, verified not assumed.
- **claude runtime:** not bundled; documented prerequisite; chat degrades gracefully.
- **Cross-build:** per-system native builds; no cross-compile promise.

## Out-of-scope follow-ups

- nixpkgs submission (prv is pre-alpha).
- home-manager module + overlay (add when a consumer appears).
- CI matrix to build/cache all 4 systems (needed to validate Linux).
- Adding `oxlint`/`oxfmt`/`typescript` to the devShell for reproducible lint/format/typecheck (currently via `bunx`).
