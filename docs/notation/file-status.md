---
type: UiNotation
title: File status
description: Icons, counts, and diffstat squares that mark how a file changed.
resource: https://github.com/snrsw/prv/blob/main/src/ui/components/StatusIcon.tsx
tags: [ui, file-list]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Status icons

Each file has one of four statuses. prv shows it as an SVG file icon, not a letter.

| Status   | Glyph in the icon | Colour | Assigned when                                  |
| -------- | ----------------- | ------ | ---------------------------------------------- |
| added    | `+`               | green  | old path is `/dev/null`, or git reports a copy |
| deleted  | `−`               | red    | new path is `/dev/null`                        |
| modified | pencil            | yellow | any other change                               |
| renamed  | `→`               | blue   | git reports `rename from`                      |

In files mode (`prv <path>` on a path git cannot diff), every file is `added`.

# Counts

| Where               | Notation                    | Meaning                                                                       |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Topbar              | `{n} changed` / `{n} files` | Changed files (git mode) / shown files (files mode)                           |
| Topbar, card header | `+{a}` `−{d}`               | Added and deleted lines; the minus is U+2212. Card headers hide a zero count. |
| Topbar              | `{v}/{t} viewed`            | Files marked Viewed out of all files                                          |
| Topbar              | `{n} open`                  | Open comment threads; hidden when zero                                        |
| File tree           | pill `{n}`                  | Open threads in the file; on a directory, the sum over its subtree            |
| File tree           | check icon, dimmed row      | The file is marked Viewed                                                     |

# Diffstat squares

Five squares after the counts show the add/delete ratio.

- At most 5 changed lines: one square per line.
- More than 5: green squares = round(adds / total × 5); red squares fill the rest.

Example: 30 adds and 10 deletes give 4 green squares and 1 red square.

# Other file markers

| Notation              | Meaning                                           |
| --------------------- | ------------------------------------------------- |
| `old → new` (italic)  | Renamed file, old path first                      |
| `a/b` in the tree     | Directories with a single child, shown as one row |
| `Binary file differs` | Binary content; no line diff                      |
| `↑ {n} change(s) ↓`   | File view: step between changed blocks            |

Line markers inside a file are in [Diff lines](/notation/diff-lines.md). Colours are in [Colour legend](/notation/colour-legend.md).
