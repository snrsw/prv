---
type: UiNotation
title: Review findings
description: Severity and lens values on agent-review comments, and lens run phases.
resource: https://github.com/snrsw/prv/blob/main/src/review/lenses.ts
tags: [ui, review, agent]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Severity

Each finding carries one severity. An unknown or missing value is shown as `info`.

| Severity | Pill |
|---|---|
| `critical` | solid red, white text |
| `major` | light red |
| `minor` | yellow |
| `info` | blue |

The review card counts findings in this order, as `{n} {severity}`.

# Lens

The lens tag names which of the three review agents produced the finding. The tag shows the lens ID, not the label.

| Lens ID | Label | Looks for |
|---|---|---|
| `correctness` | Correctness | Logic errors: wrong conditions, off-by-one, broken invariants, unhandled edge cases |
| `silent-failures` | Silent failures | Failures nobody notices: swallowed exceptions, ignored exit codes, masking fallbacks |
| `test-coverage` | Test coverage | Changed behaviour that no test pins down |

Each lens reports at most 8 findings per run.

# Run phase

| Phase | Shown as | Colour |
|---|---|---|
| queued | `queued` | grey |
| running | `running…` | blue |
| done | `{n} finding(s)` | green |
| error | `error` | red |

While a review runs, the topbar shows `Stop ({done}/{total})`. `Clear agent comments ({n})` removes open findings that nobody has replied to.

The ID format of findings is in [Comment IDs](/notation/comment-ids.md).
