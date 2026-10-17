---
type: Store
title: Comment store
description: The .prv/comments.json file that holds every comment thread, shared by the browser and the CLI.
resource: https://github.com/snrsw/prv/blob/main/src/comments/store.ts
tags: [comments, storage, cli]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
sources:
  - id: decisions
    resource: https://github.com/snrsw/prv/blob/main/decisions.md
    title: prv decision log
---

# Definition

The comment store is the file `.prv/comments.json` under the directory prv runs from. It holds every [comment thread](/concepts/comment-thread.md). Run prv and the `prv comment(s)` commands from the repository root so both use the same file.

# Shape

```json
{ "schema_version": "1.0", "comments": [ ... ] }
```

prv also reads a bare array of comments.

# Writers

| Writer                                         | When it writes                                       |
| ---------------------------------------------- | ---------------------------------------------------- |
| Browser                                        | After each change in the UI, as one whole-file write |
| `prv comment`, `reply`, `resolve`, `unresolve` | Directly, with no server needed                      |

**In the browser, the browser is the only writer.** Agent-review findings and [Finish review](/concepts/finish-review.md) results reach the store through the browser, not from the server or the agent. This avoids two writers overwriting each other.[^decisions]

The CLI syntax is in [CLI targets](/notation/cli-targets.md).

[^decisions]: decisions.md — "Where findings become comments" and "Finish review batches pending threads to one apply turn"
