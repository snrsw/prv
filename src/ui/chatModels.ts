import { useEffect, useState } from "react";
import {
  CHAT_EFFORTS_BY_AGENT,
  CHAT_MODEL_PRESETS_BY_AGENT,
  DEFAULT_CHAT_AGENT,
  type ChatAgent,
  type ChatModelList,
  type ChatModelOption,
  type ChatSettings,
} from "../shared/chat";

/**
 * The model picker's options per agent, fetched from the server (which reads
 * them from the agent's CLI, see `src/chat/models.ts`) once per page load.
 * Until the fetch lands, or when it fails, the hardcoded presets apply.
 */

/** The picker list used before (or instead of) the server's answer. Pure. */
export function fallbackModelList(agent: ChatAgent): ChatModelList {
  return { models: CHAT_MODEL_PRESETS_BY_AGENT[agent].map((id) => ({ id, label: id })) };
}

/** The option `model` runs, or for "default" (`undefined`) the CLI's default model. Pure. */
export function resolveOption(
  list: ChatModelList,
  model: string | undefined,
): ChatModelOption | undefined {
  const id = model ?? list.defaultModel;
  if (id === undefined) return undefined;
  return list.models.find((m) => m.id === id) ?? list.models.find((m) => m.alias === id);
}

/**
 * The effort levels offered for `model`: the model's own levels when the CLI
 * reports them, else the agent's fixed list. Pure.
 */
export function effortsFor(
  agent: ChatAgent,
  list: ChatModelList,
  model: string | undefined,
): readonly string[] {
  return resolveOption(list, model)?.efforts ?? CHAT_EFFORTS_BY_AGENT[agent];
}

/**
 * The effort the CLI applies when none is chosen: its configured level, else
 * the model's own default. `undefined` when the CLI reports neither. Pure.
 */
export function defaultEffortFor(
  list: ChatModelList,
  model: string | undefined,
): string | undefined {
  return list.defaultEffort ?? resolveOption(list, model)?.defaultEffort;
}

/**
 * `settings` with `model` selected (`undefined` = CLI default). A chosen
 * effort the new model does not support is cleared, so the CLI default
 * applies instead of a level the model would reject. Pure.
 */
export function selectModel(
  settings: ChatSettings,
  model: string | undefined,
  list: ChatModelList,
): ChatSettings {
  const agent = settings.agent ?? DEFAULT_CHAT_AGENT;
  const next: ChatSettings = { ...settings, model };
  if (next.effort && !effortsFor(agent, list, model).includes(next.effort)) next.effort = undefined;
  return next;
}

const cache = new Map<ChatAgent, ChatModelList>();

export function useChatModels(agent: ChatAgent): ChatModelList {
  const [list, setList] = useState<ChatModelList>(
    () => cache.get(agent) ?? fallbackModelList(agent),
  );
  useEffect(() => {
    const cached = cache.get(agent);
    if (cached) {
      setList(cached);
      return;
    }
    setList(fallbackModelList(agent));
    let cancelled = false;
    fetch(`/api/agents/models?agent=${agent}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ChatModelList>;
      })
      .then((data) => {
        if (!Array.isArray(data.models)) return;
        cache.set(agent, data);
        if (!cancelled) setList(data);
      })
      .catch(() => {
        /* the list is a nicety; the presets and the custom entry still work */
      });
    return () => {
      cancelled = true;
    };
  }, [agent]);
  return list;
}
