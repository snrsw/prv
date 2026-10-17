---
type: UiNotation
title: Agent activity
description: Tool glyphs, status text, the agent-settings summary, and the tab title.
resource: https://github.com/snrsw/prv/blob/main/src/ui/useDiffChat.ts
tags: [ui, chat, agent]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Tool glyphs

While the agent works, each tool call appears as a line with a glyph.

| Glyph | Tool |
|---|---|
| `▸` | Read |
| `✎` | Edit, Write |
| `✕` | Delete |
| `⌕` | Grep, Glob, WebSearch |
| `$` | Bash |
| `⚙` | MCP |
| `☑` | TodoWrite |
| `✓` | ExitPlanMode |
| `•` | Any other tool |

A line starting with `›` is the agent's progress narration.

# Status text

prv shows agent status as text, not as coloured dots.

| Text | Meaning |
|---|---|
| `thinking…` | Waiting for the first reply |
| `No response yet — check that the agent CLI is logged in.` | No output for 30 seconds |
| `stopped` | You pressed Stop |
| `⚠ {message}` | An error |

# Settings summary

The settings button shows the agent, model, and effort joined by ` · `, e.g. `Claude · default` or `Codex · gpt-5 · high`. `default` means the CLI's own configured value.

# Tab title

| Mode | Title |
|---|---|
| Git | `{repo}: {base} ↔ {compare}`, plus ` · {paths}` when scoped to paths |
| Files | `{first file}[ +N] · prv` |

`↔` separates the two sides of a comparison everywhere, including the base/compare picker.
