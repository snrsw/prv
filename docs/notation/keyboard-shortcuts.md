---
type: Shortcut
title: Keyboard shortcuts
description: Global keys and keys on a focused diff line.
resource: https://github.com/snrsw/prv/blob/main/src/ui/shortcuts.ts
tags: [ui, keyboard]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Anywhere

These keys work outside text fields. Holding Ctrl, Alt, or Cmd disables them.

| Key       | Action                                                    |
| --------- | --------------------------------------------------------- |
| `]` / `[` | Next / previous file                                      |
| `n` / `p` | Next / previous open finding (agent-review comment)       |
| `v`       | Toggle Viewed on the current file                         |
| `x`       | Collapse / expand the current file                        |
| `f`       | Filter files                                              |
| `s`       | Toggle the file tree                                      |
| `t`       | Toggle the chat panel                                     |
| `?`       | Show the shortcut help                                    |
| `Esc`     | Close the shortcut help, or the drawers in compact layout |

File and finding steps wrap around at the end.

# On a diff line

Press Tab to move focus into a card's line numbers first.

| Key                   | Action                                                                       |
| --------------------- | ---------------------------------------------------------------------------- |
| `↑` / `↓`             | Move between lines                                                           |
| `Shift+↑` / `Shift+↓` | Extend the selection                                                         |
| `c` / `Enter`         | Comment on the line or selection; on a hunk header with one expander, expand |
| `Esc`                 | Clear the selection                                                          |

# Text inputs

In chat and thread inputs, `Enter` sends and `Shift+Enter` adds a newline.
