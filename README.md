# prv — Pull-Request like View

Local GitHub-style diff viewer. Designed for two workflows:

- **Review AI-agent changes before committing** — `prv` opens a browser at a PR-style view of `HEAD` vs working tree.
- **Compare arbitrary directories** — `prv diff <a> <b>` works on any two paths, refs, or a mix, so you can diff `tmp/feature1/approach1` vs `tmp/feature1/approach2`, `HEAD` vs `./build`, or `main` vs `feature`.

## Usage

```sh
prv                                # HEAD vs working tree
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
