---
type: UiNotation
title: Comment states
description: Open, resolved, and pending threads, and where a thread is placed.
resource: https://github.com/snrsw/prv/blob/main/src/shared/comments.ts
tags: [ui, comments]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Status

A thread is `open` or `resolved`. **A thread is pending when it is open and its last message is a non-empty one from you.** Finish review sends every pending thread to the agent in one run.

| Badge | Meaning |
|---|---|
| `pending` (yellow) | Waiting for the agent; Finish review will send it |
| `resolved` (green) | Closed; body hidden and thread dimmed. Reopen restores it. |
| (none) | Open, and the agent wrote the last message |

`Finish review ({n})` in the topbar counts pending threads.

# Author

| Notation | Meaning |
|---|---|
| `agent review` chip | The thread came from an agent review; see [Review findings](/notation/review-findings.md) |
| Bubble message | Written by you (role `user`) |
| Rendered Markdown message | Written by the agent (role `assistant`) |

# Placement

| Label or banner | Meaning |
|---|---|
| `{path}:{lines}` | Anchored to those lines; the range format is in [Comment IDs](/notation/comment-ids.md) |
| `lines changed` | The lines the comment was on no longer match the diff; shown without an anchor |
| `File-level finding` | Not tied to any line |
