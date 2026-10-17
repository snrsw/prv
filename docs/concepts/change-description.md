---
type: Feature
title: Change description
description: A PR-body-like overview of the local changes, stored in .prv/description.md and shown in the Overview pane above the diff.
resource: https://github.com/snrsw/prv/blob/main/src/description/store.ts
tags: [description, agent, cli]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T12:00:00Z }
---

# Definition

The change description explains the local changes the way a pull request body does: a summary, what changed and why, and how to verify it. **There is one description per repository, in `.prv/description.md`** under the directory prv runs from, next to the [comment store](/concepts/comment-store.md). Run prv and `prv describe` from the repository root so both use the same file. It is plain Markdown; prv adds no metadata. The last-updated time is the file's modification time.

# Who writes it

| Writer            | How                                                                            |
| ----------------- | ------------------------------------------------------------------------------ |
| An agent or you   | `prv describe` saves Markdown from stdin or `--file <path>`                    |
| The agent, in prv | **Generate** runs one read-only turn over the current diff and saves the reply |
| You, in prv       | **Edit** opens a textarea; Save replaces the file                              |

Each write replaces the whole file. The CLI syntax is in [CLI targets](/notation/cli-targets.md).

# Size limit

**A description is at most 1 MiB (1,048,576 bytes) of UTF-8 Markdown.** Every writer refuses a larger one and keeps the old description:

| Writer         | What happens over the limit                                         |
| -------------- | ------------------------------------------------------------------- |
| `prv describe` | Exits 1 with an error on stderr                                     |
| Save (Edit)    | Shows the error under the textarea; the server answers PUT with 413 |
| Generate       | Shows the error; the reply is rejected, not truncated               |

Generate rejects rather than truncates because a cut-off description would read as complete.

# Overview pane

The Overview pane sits at the top of the diff column and renders the description as Markdown.

- The header shows how long ago the description was updated. The chevron collapses the pane; the browser remembers the choice.
- With no description, the pane explains `prv describe` and offers **Generate** and **Write**.
- prv re-reads the file on **Refresh** and when the tab regains focus, so a description written by `prv describe` while prv is open appears without a restart.
- The pane is hidden in files mode (see [Diff mode](/concepts/diff-mode.md)), which shows whole files rather than a change.

# Generate

1. Generate sends the current comparison to the server, which computes its diff.
2. The agent chosen in [Agent settings](/concepts/agent-settings.md) runs one read-only turn over the diff, asked for Summary, Changes, and How to verify sections. It may read the repository for context.
3. The pane shows the agent's activity while it runs. **Stop cancels the run and keeps the old description.**
4. The reply is saved to `.prv/description.md` and rendered. An empty or oversized reply, or a failed run, shows an error and saves nothing.

A diff longer than 100,000 characters is cut before it reaches the agent; the agent can read the rest from the repository.
