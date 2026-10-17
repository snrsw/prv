---
type: ColorLegend
title: Colour legend
description: What green, red, yellow, and blue mean across the UI.
resource: https://github.com/snrsw/prv/blob/main/src/ui/styles.css
tags: [ui, colour]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

prv uses four colours from GitHub's Primer palette, in both light and dark themes. Each colour has one family of meanings.

| Colour | Meaning         | Used for                                                                        |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| Green  | added, done     | Added files and lines, `resolved`, finished lens, Viewed check                  |
| Red    | removed, broken | Deleted files and lines, errors, `major` and `critical`                         |
| Yellow | needs attention | Modified files, `minor`, `pending`, commented lines, banners                    |
| Blue   | neutral marker  | Renamed files, `info`, agent chip, hunk headers, selection, comment-count pills |

The favicon ignores the theme: a dark square with a green bar above a red bar.

Details per element: [File status](/notation/file-status.md), [Diff lines](/notation/diff-lines.md), [Review findings](/notation/review-findings.md).
