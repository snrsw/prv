# prv — Pull-Request like View

Local GitHub-style diff viewer. Designed for two workflows:

- **Review AI-agent changes before committing** — `prv` opens a browser at a PR-style view of `HEAD` vs working tree.
- **Compare arbitrary directories** — `prv diff <a> <b>` works on any two paths, refs, or a mix, so you can diff `tmp/feature1/approach1` vs `tmp/feature1/approach2`, `HEAD` vs `./build`, or `main` vs `feature`.

## Install

Install with Nix (flakes enabled):

```sh
nix run github:snrsw/prv                 # run without installing
nix run github:snrsw/prv -- diff a b     # pass args after --
nix profile install github:snrsw/prv     # install to your profile
nix profile upgrade prv                  # later: upgrade
nix profile remove prv                   # later: remove
```

Pin to a released tag for reproducibility:

```sh
nix run github:snrsw/prv/v0.1.0
```

Add to a home-manager config (`prv.url = "github:snrsw/prv";` in your flake inputs):

```nix
home.packages = [ inputs.prv.packages.${pkgs.system}.default ];
```

Or NixOS:

```nix
environment.systemPackages = [ inputs.prv.packages.${pkgs.system}.default ];
```

**Notes**

- macOS opens your browser with `open`; Linux uses `xdg-open`. On a headless/SSH box no browser opens — use the printed URL (or pass `--no-open`).
- The Nix package targets Linux and macOS only (not Windows).
- The "chat about the diff" / AI-review feature needs Claude Code (the `claude` CLI) installed separately; core diff viewing works without it.

## Usage

```sh
prv                                # HEAD vs working tree
prv <file>                         # HEAD vs working tree, scoped to one file
prv diff <pathA> <pathB>           # folder vs folder (works outside a git repo)
prv diff <ref> <path>              # git ref vs an arbitrary folder (or path vs ref)
prv diff <refA> <refB>             # ref vs ref in the current repo

prv --port 8765                    # pin port
prv --no-open                      # don't auto-open browser
```

`diff` auto-classifies each argument: an existing path is treated as a path; otherwise it is resolved against the current repo as a git ref. **When an argument is both an existing path and a valid ref name, the path wins.** To force ref interpretation, use `HEAD`, a SHA, or `origin/<branch>`. To force path interpretation, use `./name`.

### Agent review

The **Review** button in the topbar runs three read-only review agents in parallel over the current diff — correctness, silent failures, and test coverage. Their findings land as inline review comments, anchored to the diff lines they cite (with severity and lens badges). Each one is a normal comment thread: reply to discuss it with the agent, use "Apply with agent" to fix it, resolve or delete it. Re-running a review stacks new comments; "Clear agent comments" removes open ones no human has replied to. Stop cancels an in-flight run.

Like the diff chat, this needs Claude Code (the `claude` CLI) installed and logged in. Each review spawns three `claude` runs over the whole diff.

## Use with Claude Code

prv ships as a Claude Code plugin (requires the `prv` binary on PATH — install it with Nix as above):

```sh
claude plugin marketplace add snrsw/prv
claude plugin install prv@prv
```

This adds:

- **`/prv`** — launches the review UI on the current repo state, or on two refs/paths (`/prv main feature`).
- **`prv-review` skill** — teaches the agent to read and act on review comments headlessly.

### Headless review comments (for agents and scripts)

The same review comments the browser UI shows live in `.prv/comments.json` and can be driven from the CLI — no server needed:

```sh
prv comments list --unresolved --json   # what needs attention
prv comment src/app.ts:42 "This branch is dead code."
prv reply c:_42:_42 "Fixed: removed the branch."
prv resolve c:_42:_42
```

A typical agent loop: list unresolved comments, make the requested change, reply on the thread, resolve. Notes:

- Run from the repo root — comments are stored under the current directory.
- `prv comment` anchors to lines of the `HEAD` vs working-tree diff (changed lines plus nearby context), so CLI-created comments render in the UI on the right lines.
- Use `--json` for machine-readable output; errors exit 1 with a message on stderr.

## Development

The repo ships a Nix flake; `direnv allow` will drop you into a shell with `bun` and `git`.

```sh
bun install
bun test
bun run dev
```

### Releasing

Releases are cut by [tagpr](https://github.com/Songmu/tagpr). Merging any PR into `main` opens — or updates — a **Release for vX.Y.Z** pull request that bumps the version files and the changelog. Merging that release PR tags the version and publishes the GitHub Release.

- The version lives in `package.json` and `.claude-plugin/plugin.json`; tagpr keeps them in step. `flake.nix` reads `package.json`, so the Nix package version and `prv --version` follow along.
- The release PR bumps the patch digit by default. Add a `minor` or `major` label to it to bump those instead.
- CI does not run on the release PR, because pull requests opened with the default `GITHUB_TOKEN` do not trigger `pull_request` workflows.

## Status

Pre-alpha. See [plan](./plan.md) for the implementation roadmap.
