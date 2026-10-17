---
type: Mode
title: Diff mode
description: What prv compares — two git sides in git mode, or whole files in files mode.
resource: https://github.com/snrsw/prv/blob/main/src/diff/types.ts
tags: [diff, cli]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Definition

A diff mode decides which two sides prv compares. Every page load has exactly one mode. There are two kinds.

| Kind | Base side | Compare side | Started by |
|---|---|---|---|
| git | a ref (`leftRef`) | a ref, or the working tree | `prv`, `prv <path>`, `prv diff <refA> <refB>` |
| files | nothing | the files as they are on disk | `prv <path>` on a path git cannot diff |

# Git mode

* `prv` compares `HEAD` with the working tree.
* `prv diff <refA> <refB>` compares two refs. Each argument must resolve to a branch, tag, SHA, or `HEAD`; anything else is an error.
* A path argument scopes git mode to one file or directory.
* The base/compare picker in the topbar changes either side without restarting prv.

# Files mode

Git cannot diff a file outside any repository, or one the repository ignores (for example `.claude/plans/x.md`). prv shows such a file whole, as an added file. A directory shows every file under it. The file can still get comments, an [agent review](/concepts/agent-review.md), and a [diff chat](/concepts/diff-chat.md).

# Related

* The mode decides the file statuses and counts: [File status](/notation/file-status.md).
* The tab title shows the mode: [Agent activity](/notation/agent-activity.md).
* CLI comments always anchor to the `HEAD` vs working-tree diff: [CLI targets](/notation/cli-targets.md).
