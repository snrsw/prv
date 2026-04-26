# prv — Pull-Request like View

Local GitHub-style diff viewer. Designed for two workflows:

- **Review AI-agent changes before committing** — `prv` opens a browser at a PR-style view of `HEAD` vs working tree.
- **Compare arbitrary directories** — `prv diff <pathA> <pathB>` works on any two paths, even outside a git repo, so you can diff `tmp/feature1/approach1` vs `tmp/feature1/approach2`.

## Usage

```sh
prv                                # HEAD vs working tree
prv staged                         # HEAD vs index
prv diff <pathA> <pathB>           # arbitrary directory or file comparison

prv --port 8765                    # pin port
prv --no-open                      # don't auto-open browser
```

## Development

The repo ships a Nix flake; `direnv allow` will drop you into a shell with `bun` and `git`.

```sh
bun install
bun test
bun run dev
```

## Status

Pre-alpha. See [plan](./plan.md) for the implementation roadmap.
