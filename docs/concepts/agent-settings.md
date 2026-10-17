---
type: Setting
title: Agent settings
description: The agent, model, and effort used for every agent run, remembered in the browser.
resource: https://github.com/snrsw/prv/blob/main/src/shared/chat.ts
tags: [agent, settings]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Definition

Agent settings choose which local CLI answers and how. **One choice applies to every agent run**: the [diff chat](/concepts/diff-chat.md), thread actions, [agent review](/concepts/agent-review.md), and [Finish review](/concepts/finish-review.md). The browser remembers the choice.

# Values

| Setting | Claude Code (`claude`, default)                                 | Codex (`codex`)                                               |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| model   | `default`, `fable`, `opus`, `sonnet`, `haiku`, or a custom name | `default` or a custom name                                    |
| effort  | `default`, `low`, `medium`, `high`, `xhigh`, `max`              | `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

`default` leaves the value to the CLI's own configuration. Model maps to `--model`. Effort maps to `claude --effort` or Codex's `model_reasoning_effort`.

The selected CLI must be installed and logged in. Core diff viewing works without either CLI.

The settings summary on the button is in [Agent activity](/notation/agent-activity.md).
