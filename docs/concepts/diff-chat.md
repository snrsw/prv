---
type: Workflow
title: Diff chat
description: A read-only conversation with the local coding agent about the current diff.
resource: https://github.com/snrsw/prv/blob/main/src/chat/agent.ts
tags: [chat, agent]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T12:00:00Z }
---

# Definition

The diff chat is a conversation about the whole current diff, opened with the **Chat** button. The agent answers read-only: it can read files but not change them.

# Run modes

Every agent run in prv is in one of three modes.

| Mode    | Agent can edit files | Used by                                                     |
| ------- | -------------------- | ----------------------------------------------------------- |
| `ask`   | no                   | Diff chat, [agent review](/concepts/agent-review.md)        |
| `auto`  | yes                  | Send now in a [comment thread](/concepts/comment-thread.md) |
| `apply` | yes                  | [Finish review](/concepts/finish-review.md)                 |

In `auto` the prompt tells the agent to decide whether the comment asks for a code change: if it does, the agent makes a minimal edit; otherwise it answers without changing files. `auto` and `apply` have the same permissions. For Claude Code they allow Read, Edit, Write, Grep and Glob, but not Bash. For Codex, `ask` runs in the `read-only` sandbox and `auto` and `apply` in `workspace-write`. Approvals are `never`, because no one can answer them.

# Sessions

A chat keeps one agent session across turns. New chat starts a new session. Switching the agent mid-conversation also starts a new session, because neither CLI can resume the other's session.

The agent, model, and effort come from [agent settings](/concepts/agent-settings.md). Status text and tool glyphs are in [Agent activity](/notation/agent-activity.md).
