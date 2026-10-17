---
type: Entity
title: Comment thread
description: A conversation anchored to a line range of one file, open or resolved, and pending when you spoke last.
resource: https://github.com/snrsw/prv/blob/main/src/shared/comments.ts
tags: [comments]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Definition

A comment thread is a list of messages attached to a range of diff lines in one file. Each message has a role: `user` (you) or `assistant` (the agent). A thread starts from a hand-written comment or from an [agent review](/concepts/agent-review.md) finding.

# Fields

| Field                                          | Meaning                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                                           | Built from the range endpoints; format in [Comment IDs](/notation/comment-ids.md) |
| `file`                                         | Path of the file the thread is on                                                 |
| `start`, `end`                                 | First and last line, each as old and new line numbers                             |
| `anchorText`                                   | The text of the anchored lines, each with its `+`/`-`/space marker                |
| `status`                                       | `open` or `resolved`                                                              |
| `messages`                                     | The conversation, oldest first                                                    |
| `source`, `severity`, `lens`, `title`, `runId` | Present only on agent-review findings                                             |

# Pending

**A thread is pending when it is open and its last message is a non-empty one from you.** No field stores this; prv computes it from `status` and `messages`. A reply to an agent finding also makes that thread pending. [Finish review](/concepts/finish-review.md) sends every pending thread to the agent.

# Anchoring

prv shows a thread on its lines while `anchorText` still matches the current diff. When those lines change, the thread loses its anchor and shows `lines changed`. A thread with no line numbers at all is file-level.

# Acting on a thread

| Button           | What happens                                        |
| ---------------- | --------------------------------------------------- |
| Comment          | Saves your message only; the thread becomes pending |
| Ask agent        | The agent answers this thread, read-only            |
| Apply with agent | The agent edits files to address this thread alone  |
| Resolve / Reopen | Changes `status`                                    |

The badges and labels for these states are in [Comment states](/notation/comment-states.md). Threads are saved in the [comment store](/concepts/comment-store.md).
