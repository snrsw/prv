---
type: IdFormat
title: Comment IDs
description: The c: and r: ID formats and the line-range labels.
resource: https://github.com/snrsw/prv/blob/main/src/shared/diffLines.ts
tags: [comments, cli, ids]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Hand-written comments: `c:`

```
c:<startOld>_<startNew>:<endOld>_<endNew>
```

The two halves are the first and last line of the range. Each line is written as `old_new`. **An empty number means the line does not exist on that side**, so the side is implied; there is no separate side field.

| ID | Range |
|---|---|
| `c:_42:_42` | One added line, new line 42 |
| `c:7_:7_` | One deleted line, old line 7 |
| `c:10_12:10_12` | One context line, old line 10 / new line 12 |
| `c:7_:_9` | From deleted old line 7 to added new line 9 |

IDs are unique within a file, not across files. When two files share an ID, CLI commands need `--file <path>`.

# Agent findings: `r:`

```
r:<runId>:<lens>:<index>
```

| Part | Meaning |
|---|---|
| `runId` | First 8 characters of a random UUID, one per review run |
| `lens` | A lens ID from [Review findings](/notation/review-findings.md) |
| `index` | Position of the finding in that lens's list, from 0 |

# Range labels

| Where | Separator | Examples |
|---|---|---|
| UI thread head | en dash | `12–15`, `old 7` |
| CLI list, Finish review prompt | ASCII hyphen | `12-15`, `old 7` |

The label uses new-side numbers when the range has any. Otherwise it uses old-side numbers with the prefix `old `. A file-level comment has an empty label.
