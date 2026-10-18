---
type: Setting
title: Agent settings
description: The agent, model, and effort used for every agent run, remembered in the browser.
resource: https://github.com/snrsw/prv/blob/main/src/shared/chat.ts
tags: [agent, settings]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T04:45:00Z }
---

# Definition

Agent settings choose which local CLI answers and how. **One choice applies to every agent run**: the [diff chat](/concepts/diff-chat.md), thread actions, [agent review](/concepts/agent-review.md), and [Finish review](/concepts/finish-review.md). The browser remembers the choice.

**The settings button (gear and summary, such as `Claude · Opus 5.5`) sits in three places**: next to Send in the diff chat, at the start of a [comment thread](/concepts/comment-thread.md)'s send row, and next to Send to agent in the [Finish review](/concepts/finish-review.md) card. Each opens the same agent, model, and effort pickers, so a change in one place applies to all.

# Values

**The model list comes from the selected CLI's own files**, read by the server (`GET /api/agents/models?agent=claude|codex`):

| Setting | Claude Code (`claude`, default)                                                                                                                                                                                      | Codex (`codex`)                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| model   | `default`, every model in the account's model catalogue by display name (Opus 5.5, Fable 5.1, …; the `/model` picker's main models first), or a custom name; without a catalogue, `fable`, `opus`, `sonnet`, `haiku` | `default`, every model Codex's picker lists in `models_cache.json` (by priority), or a custom name                                |
| effort  | the selected model's levels from the catalogue; when unknown, `default`, `low`, `medium`, `high`, `xhigh`, `max`                                                                                                     | the selected model's levels from `models_cache.json`; when unknown, `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| files   | the newest `cache/model-catalog/*-cc.json` and `settings.json` under `$CLAUDE_CONFIG_DIR` (default `~/.claude`)                                                                                                      | `$CODEX_HOME/models_cache.json` and `config.toml` (default `~/.codex`)                                                            |

`default` leaves the value to the CLI's own configuration. Its entry names the resolved value when the CLI reports one, for example `default (gpt-6.1-sol)` from Codex's `config.toml` `model`, or `default (Opus 5.5)` from Claude Code's `settings.json` `model`, else the catalogue's account default. The effort default is `model_reasoning_effort` from `config.toml` or the catalogue's account default effort, else the model's own default level.

Model maps to `--model`. Effort maps to `claude --effort` or Codex's `model_reasoning_effort`.

The running model's description from the catalogue shows under the model picker, and the composer's settings button names the model by its display name (`Claude · Opus 5.5`), including for `default` when the default model is listed.

Choosing a model clears a chosen effort that the model does not support. A remembered Claude alias (`opus`) shows as the catalogue model it names and is still sent as the alias. A remembered model that the list no longer offers shows as a custom name and still runs. A missing or malformed CLI file falls back to the fixed lists above.

The selected CLI must be installed and logged in. Core diff viewing works without either CLI.

The settings summary on the button is in [Agent activity](/notation/agent-activity.md).
