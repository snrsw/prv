---
type: UiNotation
title: Diff lines
description: Row markers, hunk headers, expanders, and line tints in the diff and File view.
resource: https://github.com/snrsw/prv/blob/main/src/shared/diffLines.ts
tags: [ui, diff]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Row markers

| Marker  | Row          | Line numbers present |
| ------- | ------------ | -------------------- |
| `+`     | added line   | new only             |
| `-`     | deleted line | old only             |
| (space) | context line | old and new          |

A hunk header has git's form `@@ -<old>,<count> +<new>,<count> @@ <context>`. A missing count means 1.

# Layouts

| Toggle  | Line-number columns                                                      |
| ------- | ------------------------------------------------------------------------ |
| Unified | One cell holds two numbers: old on the left, new on the right            |
| Split   | Old side in the left table, new side in the right table, one number each |

# Expanders

Hidden lines between hunks open in steps of 20.

| Glyph | Meaning                                          |
| ----- | ------------------------------------------------ |
| `↕`   | Show all hidden lines (gap of 20 lines or fewer) |
| `↑`   | Show 20 more lines above                         |
| `↓`   | Show 20 more lines below                         |

# Line tints and buttons

| Notation                        | Meaning                                      |
| ------------------------------- | -------------------------------------------- |
| Blue `+` square on hover        | Comment on this line; drag to select a range |
| Yellow tint with a 2px left bar | The line is under an open comment            |
| Blue tint                       | The line is in the current selection         |

# File view gutter

The File view shows the whole file and marks changed blocks in the gutter.

| Mark               | Meaning                        | Tooltip                     |
| ------------------ | ------------------------------ | --------------------------- |
| Green, solid bar   | Added lines                    | `Added N line(s)`           |
| Yellow, dashed bar | Replaced lines                 | `Replaced N line(s) with M` |
| Red, solid bar     | Deleted lines (old side)       | `Deleted N line(s)`         |
| Red seam with `▶`  | Lines removed between two rows | `N line(s) removed here`    |
