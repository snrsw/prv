# prv — Pull-Request like View

Local GitHub-style diff viewer for git repositories. Designed for two workflows:

- **Review AI-agent changes before committing** — `prv` opens a browser at a PR-style view of `HEAD` vs working tree.
- **Compare two refs** — `prv diff main feature` gives the same PR-style view for any two branches, tags, or SHAs.

## Install

Install with Nix (flakes enabled):

```sh
nix run github:snrsw/prv                 # run without installing
nix run github:snrsw/prv -- diff main HEAD   # pass args after --
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
- The "chat about the diff" / AI-review feature needs a local coding agent installed separately — Claude Code (the `claude` CLI) or OpenAI Codex (the `codex` CLI); core diff viewing works without either.

## Usage

```sh
prv                                # HEAD vs working tree
prv <path>                         # HEAD vs working tree, scoped to one file or directory
prv ~/.claude/plans/x.md           # a file git can't diff is shown whole
prv diff <refA> <refB>             # ref vs ref in the current repo

prv --port 8765                    # pin port
prv --no-open                      # don't auto-open browser
```

prv compares git refs, so it runs inside a git repository. Both `diff` arguments are resolved as refs — a branch, tag, SHA, or `HEAD` — and a name that resolves to none of those is an error. Comparing plain directories is not supported.

The one exception is `prv <path>` on a path git's diff cannot show: a file outside any repository, or one the repository ignores (a plan under `.claude/plans/`, say). prv then shows the file whole, as an added file, so it can still be read, commented on, and reviewed or discussed with the agent. A directory shows every file under it.

### Diff chat

The **Chat** button opens a read-only conversation with your local coding agent about the current diff. The **agent** picker next to Send chooses which CLI answers — **Claude Code** (`claude`, the default) or **Codex** (`codex`). The **model** and **effort** pickers map to that CLI's own setting (`claude --model` / `claude --effort`; `codex --model` / Codex's `model_reasoning_effort`); leave either on `default` to use the CLI's configured value. For Claude the model list offers the CLI aliases (`fable`, `opus`, `sonnet`, `haiku`); for Codex enter a full model name via the custom entry. The choice is remembered in the browser and also applies to inline comment threads (including "Apply with agent") and to agent reviews. Switching agents mid-conversation starts a fresh session, since neither CLI can resume the other's.

With Codex, read-only chat runs `codex exec` in its `read-only` sandbox and "Apply with agent" in `workspace-write`; approvals are set to `never` because there is no one to answer them.

### Agent review

The **Review** button in the topbar runs three read-only review agents in parallel over the current diff — correctness, silent failures, and test coverage. Their findings land as inline review comments, anchored to the diff lines they cite (with severity and lens badges). Each one is a normal comment thread: reply to discuss it with the agent, use "Apply with agent" to fix it, resolve or delete it. Re-running a review stacks new comments; "Clear agent comments" removes open ones no human has replied to. Stop cancels an in-flight run.

Like the diff chat, this needs the selected agent's CLI installed and logged in — Claude Code (`claude`) or Codex (`codex`). Each review spawns three runs of that CLI over the whole diff.

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

## Status

Pre-alpha. See [plan](./plan.md) for the implementation roadmap.
