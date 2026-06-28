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

## Development

The repo ships a Nix flake; `direnv allow` will drop you into a shell with `bun` and `git`.

```sh
bun install
bun test
bun run dev
```

## Status

Pre-alpha. See [plan](./plan.md) for the implementation roadmap.
