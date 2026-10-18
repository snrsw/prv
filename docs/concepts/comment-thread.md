---
type: Entity
title: Comment thread
description: A conversation anchored to a line range of one file, open or resolved, and pending when you spoke last.
resource: https://github.com/snrsw/prv/blob/main/src/shared/comments.ts
tags: [comments]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T04:45:00Z }
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

The thread input has one split send button. Its main part runs the selected action; the caret next to it switches between two actions. `Enter` also runs the selected action. **The agent, not you, decides whether a comment needs a file edit.**

| Action       | What happens                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Add to batch | Saves your message only; the thread becomes pending                                                          |
| Send now     | The agent handles this thread at once: it edits files if the comment asks for a change, or answers otherwise |

- The default action is Add to batch. The browser remembers your choice for every thread, across reloads.
- Send now runs in the `auto` [run mode](/concepts/diff-chat.md), which may edit files. The diff refreshes when the run ends, and Stop cancels it.
- Add to batch needs text. Send now needs text unless the thread is pending: with an empty input, Send now sends the thread's unanswered comments as they are and adds no new message.
- While a [Finish review](/concepts/finish-review.md) run is addressing a pending thread, Send now is disabled on that thread.
- The settings button at the start of the send row picks the agent, model, and effort Send now uses; see [Agent settings](/concepts/agent-settings.md).
- Resolve and Reopen change `status`.

The badges and labels for these states are in [Comment states](/notation/comment-states.md). Threads are saved in the [comment store](/concepts/comment-store.md).
