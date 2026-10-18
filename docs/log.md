# Update Log

## 2026-10-18

- **Update**: [Change description](/concepts/change-description.md) — Generate's default prompt and the `prv describe` templates aim at the reviewer: Aim, What changes, Behavior (before/after), Review guide, with mermaid diagrams used actively (change map, sequence, data flow, dependencies).
- **Update**: [Change description](/concepts/change-description.md) — Generate's prompt is editable, the Overview renders ` ```mermaid ` blocks as diagrams, and the empty state offers Edit instead of Write.
- **Creation**: Added [Change description](/concepts/change-description.md) — `prv describe`, the Overview pane, and Generate (#81).
- **Update**: [Change description](/concepts/change-description.md) states the 1 MiB size limit and what each writer does over it.
- **Update**: [CLI targets](/notation/cli-targets.md) lists the forms of `prv describe`; [Agent activity](/notation/agent-activity.md) lists the Overview age texts.
- **Update**: [Agent settings](/concepts/agent-settings.md) — the settings button also sits in each comment thread's send row and in the Finish review card; [Comment thread](/concepts/comment-thread.md) links to it.
- **Update**: [Comment thread](/concepts/comment-thread.md) states when Send now needs text: a pending thread can be sent with an empty input.
- **Update**: A thread's Comment, Ask agent and Apply with agent buttons became one split button, Send now / Add to batch (#83). Updated [Comment thread](/concepts/comment-thread.md), [Finish review](/concepts/finish-review.md), [Diff chat](/concepts/diff-chat.md) (new `auto` run mode), [Agent review](/concepts/agent-review.md) and [Keyboard shortcuts](/notation/keyboard-shortcuts.md).
- **Update**: [Agent settings](/concepts/agent-settings.md) — Claude Code's models come from its cached model catalogue, shown by display name (Opus 5.5), with descriptions, per-model effort levels, and the account default (#84).
- **Update**: [Agent settings](/concepts/agent-settings.md) now describes the model list read from each CLI's files, the resolved `default`, the model description line, and effort levels that follow the selected model (#84).
- **Update**: [Diff lines](/notation/diff-lines.md) now describes the Rendered / Source toggle, moved into the card header, and `.markdown` files rendering in the File view.
- **Creation**: Added the [Concepts](/concepts/index.md) section with seven concepts; notation pages now link to the concept that owns each rule.
- **Creation**: Added the [Notation](/notation/index.md) section with nine concepts.
- **Removal**: Deleted `docs/superpowers/` (Nix install spec and plan) and `docs/ux-review-2026-09.md`.
