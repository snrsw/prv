---
type: Setting
title: Agent settings
description: The agent, model, and effort used for every agent run, remembered in the browser.
resource: https://github.com/snrsw/prv/blob/main/src/shared/chat.ts
tags: [agent, settings]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T14:00:00Z }
---

# Definition

Agent settings choose which local CLI answers and how. **One choice applies to every agent run**: the [diff chat](/concepts/diff-chat.md), thread actions, [agent review](/concepts/agent-review.md), and [Finish review](/concepts/finish-review.md). The browser remembers the choice.

# Values

**The model list comes from the selected CLI's own files**, read by the server (`GET /api/agents/models?agent=claude|codex`):

| Setting | Claude Code (`claude`, default)                                                                 | Codex (`codex`)                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| model   | `default`, `fable`, `opus`, `sonnet`, `haiku`, the `model` in `settings.json`, or a custom name | `default`, every model Codex's picker lists in `models_cache.json` (by priority), or a custom name                                |
| effort  | `default`, `low`, `medium`, `high`, `xhigh`, `max`                                              | the selected model's levels from `models_cache.json`; when unknown, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| files   | `$CLAUDE_CONFIG_DIR/settings.json` (default `~/.claude`)                                        | `$CODEX_HOME/models_cache.json` and `config.toml` (default `~/.codex`)                                                            |

`default` leaves the value to the CLI's own configuration. Its entry names the resolved value when the CLI reports one, for example `default (gpt-6.1-sol)` from Codex's `config.toml` `model`. The effort default is `model_reasoning_effort` from `config.toml`, else the model's own default level.

Model maps to `--model`. Effort maps to `claude --effort` or Codex's `model_reasoning_effort`.

The running model's description from `models_cache.json` shows under the model picker, including for `default` when the default model is listed.

Choosing a model clears a chosen effort that the model does not support. A remembered model that the list no longer offers shows as a custom name and still runs. A missing or malformed CLI file falls back to the fixed lists above.

The selected CLI must be installed and logged in. Core diff viewing works without either CLI.

The settings summary on the button is in [Agent activity](/notation/agent-activity.md).
