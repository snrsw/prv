---
type: Workflow
title: Finish review
description: Sends every pending comment thread to the agent in one apply-mode run; the agent edits files and answers each thread.
resource: https://github.com/snrsw/prv/blob/main/src/shared/batch.ts
tags: [review, agent, comments]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
sources:
  - id: decisions
    resource: https://github.com/snrsw/prv/blob/main/decisions.md
    title: prv decision log
---

# Definition

Finish review hands all your pending threads to the agent at once, like submitting a GitHub review. A thread is pending when it is open and you wrote its last message; the full rule is in [Comment thread](/concepts/comment-thread.md).

# Steps

1. **Finish review (n)** lists every pending thread. You can add one note for the whole batch.
2. Send to agent starts one run in apply mode, so the agent can edit files.
3. prv gives the agent each thread's anchored lines and messages, not the whole diff. The agent can read files itself.
4. The agent returns one result per thread: a reply, and whether it considers the thread done.
5. The browser adds each reply to its thread. **A thread marked done is resolved**; Reopen undoes it in one click.
6. The diff refreshes when the run ends. Stop cancels the run.

# Compared with per-thread actions

| Action           | Threads per run      | Can edit files |
| ---------------- | -------------------- | -------------- |
| Ask agent        | 1                    | no             |
| Apply with agent | 1                    | yes            |
| Finish review    | every pending thread | yes            |

Results are saved through the browser, the only writer of the [comment store](/concepts/comment-store.md) while the UI runs.[^decisions]

[^decisions]: decisions.md — "Finish review batches pending threads to one apply turn"
