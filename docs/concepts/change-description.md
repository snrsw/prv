---
type: Feature
title: Change description
description: A PR-body-like overview of the local changes, stored in .prv/description.md and shown in the Overview pane above the diff.
resource: https://github.com/snrsw/prv/blob/main/src/description/store.ts
tags: [description, agent, cli]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T04:30:00Z }
---

# Definition

The change description explains the local changes the way a pull request body does: why the change exists, what it does, how behavior differs, and where a reviewer should look closely. **There is one description per repository, in `.prv/description.md`** under the directory prv runs from, next to the [comment store](/concepts/comment-store.md). Run prv and `prv describe` from the repository root so both use the same file. It is plain Markdown; prv adds no metadata. The last-updated time is the file's modification time.

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

The Overview pane sits at the top of the diff column and renders the description as Markdown. **A ` ```mermaid ` code block renders as a diagram**; one mermaid cannot parse stays as code with the error under it. The File view renders mermaid in Markdown files the same way.

- The header shows how long ago the description was updated. The chevron collapses the pane; the browser remembers the choice.
- With no description, the pane explains `prv describe` and offers **Edit** and **Generate**.
- prv re-reads the file on **Refresh** and when the tab regains focus, so a description written by `prv describe` while prv is open appears without a restart.
- The pane is hidden in files mode (see [Diff mode](/concepts/diff-mode.md)), which shows whole files rather than a change.

# Generate

1. Generate opens the prompt: what the agent should write. **The prompt is editable**; the default is written to cut review time and asks for Aim (why), What changes (feature-level), Behavior (a before/after table), and Review guide (where to look closely, what else is affected, what to skim), under about 300 words; it adds a ` ```mermaid ` Data flow or Dependencies diagram only when that reads faster than text. The browser remembers the last prompt used, and **Reset to default** restores the default. The read-only rule, the diff, and the reply format are added around it and cannot be edited. A prompt longer than 20,000 characters is ignored and the default is used.
2. Generate in the prompt sends the current comparison to the server, which computes its diff. The agent chosen in [Agent settings](/concepts/agent-settings.md) runs one read-only turn over the diff with that prompt. It may read the repository for context.
3. The pane shows the agent's activity while it runs. **Stop cancels the run and keeps the old description.**
4. The reply is saved to `.prv/description.md` and rendered. An empty or oversized reply, or a failed run, shows an error and saves nothing.

A diff longer than 100,000 characters is cut before it reaches the agent; the agent can read the rest from the repository.
