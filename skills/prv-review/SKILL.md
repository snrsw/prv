---
name: prv-review
description: Read and act on prv review comments headlessly. Use when the user asks to check, address, or resolve prv review feedback, to act on unresolved review comments, or to leave inline review comments on a diff without opening the browser UI. Requires the prv CLI on PATH.
---

# prv-review

prv stores inline review comments in `.prv/comments.json` under the directory it
was launched from. The `prv` CLI reads and writes that file directly — no server
or browser needed. Always run these commands **from the repository root**.

## Comment model

One comment = one thread anchored to a range of diff lines:

- `id` — stable id derived from the anchored line numbers (e.g. `c:_42:_42`).
  Ids do not include the file, so the same range in two files collides — pass
  `--file <path>` to disambiguate when the CLI asks.
- `file`, `start`/`end` — the anchored range (old/new line numbers).
- `status` — `open` or `resolved`.
- `messages` — the thread transcript: `{ role: "user" | "assistant", text }`.

## Workflow: act on review feedback

1. List what needs attention:

   ```
   prv comments list --unresolved --json
   ```

2. For each comment: read `file`, the line range, and `messages`; make the
   requested change in the code.

3. Record what you did as a reply on the thread:

   ```
   prv reply <id> "Fixed: extracted the helper as suggested." [--file <path>]
   ```

4. Mark it done:

   ```
   prv resolve <id> [--file <path>]
   ```

## Leaving new comments (headless review)

```
prv comment <file>:<line> "This branch is dead code." [--json]
```

- The line must be part of the HEAD-vs-worktree diff (a changed line or nearby
  context) — prv anchors comments to diff lines so they render in the UI. If the
  line is not in the diff, the command fails with exit 1; pick a changed line.
- Messages default to `role: assistant`; pass `--role user` when scripting on
  the human's behalf.
- Use `--json` to capture the created comment (including its `id`).

## Showing the UI to the human

Launch `prv` (or `prv diff <a> <b>`) in the background and report the
`prv listening at <url>` line. CLI-created comments appear in the UI on the
anchored lines.

## Caveats

- Exit codes: 0 = success, 1 = any error (message on stderr).
- The browser UI saves the whole comment file shortly after any edit; avoid
  writing comments headlessly at the same moment a human is editing the same
  threads in the UI (last writer wins).
