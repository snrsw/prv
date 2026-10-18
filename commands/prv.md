---
description: Open the prv diff-review UI on the current repo state, or on two refs/paths
argument-hint: "[<a> <b>]"
allowed-tools: ["Bash"]
---

Launch the prv local diff-review UI for the user.

## Steps

1. Check that prv is installed: run `command -v prv`. If it is NOT found, tell the
   user prv is not installed and stop. Install options (Nix):

   ```
   nix run github:snrsw/prv            # try it without installing
   nix profile install github:snrsw/prv
   ```

2. Decide what to review from the arguments:
   - No arguments → review the working tree against HEAD: `prv`
   - Exactly two arguments → diff them (each is auto-classified as a git ref or a
     path): `prv diff $ARGUMENTS`
   - One argument that is an existing file or directory → view its diff:
     `prv $ARGUMENTS`. A path git cannot diff (outside a repository, or ignored —
     e.g. a plan under `~/.claude/plans/`) is shown whole instead.

3. Run the chosen command **in the background** (the server keeps running; do not
   wait for it to exit) from the repository root.

4. Read the `prv listening at <url>` line from its output and report the URL to
   the user. If a browser did not open automatically, tell them to open the URL
   manually.

5. If you made the changes under review in this session, write or update the
   change description shown in prv's Overview pane, from the repository root:

   ```
   prv describe <<'EOF'
   ## Summary
   <one or two sentences: what changed and why>

   ## Changes
   - <file or area>: <what changed>
   EOF
   ```

   Add `## Data flow`, `## Dependencies` (module/function), and `## Blast radius`
   sections only when the change calls for them; draw data flow and
   dependencies as ` ```mermaid ` diagrams.

   Each call replaces the whole description. The open UI picks it up on Refresh
   or when its tab regains focus.

## Notes

- Review comments are stored in `.prv/comments.json` under the directory prv was
  launched from — launch from the repo root.
- To read or act on review comments headlessly (without the browser), use the
  `prv-review` skill: `prv comments list --unresolved --json`, `prv reply`,
  `prv resolve`.
- The change description lives in `.prv/description.md` next to the comments;
  `prv describe --show` prints it and `prv describe --clear` removes it.
