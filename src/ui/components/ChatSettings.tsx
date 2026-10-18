import { useState } from "react";
import {
  AGENT_LABELS,
  CHAT_AGENTS,
  DEFAULT_CHAT_AGENT,
  isChatAgent,
  isChatEffort,
  isChatModel,
} from "../../shared/chat";
import {
  defaultEffortFor,
  effortsFor,
  resolveOption,
  selectModel,
  useChatModels,
} from "../chatModels";
import { useChatSettings } from "../chatSettings";

const CUSTOM = "__custom__";

const MODEL_PLACEHOLDER: Record<(typeof CHAT_AGENTS)[number], string> = {
  claude: "claude-…",
  codex: "gpt-…",
};

/**
 * Compact agent + model + effort pickers. The agent picker chooses which local
 * CLI runs the turn (Claude Code or Codex); model and effort are per-agent, so
 * switching agents clears them. An empty model/effort means "CLI default" and
 * sends no flag; its option names the resolved default when the CLI reports
 * one. The model picker lists the models the agent's CLI offers (see
 * `useChatModels`) and a "Custom…" entry that reveals a text field for a full
 * model name; the field keeps its raw text locally and only commits a
 * well-formed value. A stored model the list does not offer shows as custom.
 * The effort picker follows the selected model's own levels when known.
 */
export function ChatSettings({ disabled }: { disabled: boolean }) {
  const [settings, setSettings] = useChatSettings();
  const agent = settings.agent ?? DEFAULT_CHAT_AGENT;
  const list = useChatModels(agent);
  // A stored alias (`opus`, chosen before the CLI's list was read) shows as the
  // model it names; the alias itself is still what gets sent.
  const model = settings.model ? (resolveOption(list, settings.model)?.id ?? settings.model) : "";
  const listed = model === "" || list.models.some((m) => m.id === model);
  const [customChosen, setCustomChosen] = useState(false);
  const custom = customChosen || !listed;
  const [draft, setDraft] = useState(model);
  const draftInvalid = draft.trim() !== "" && !isChatModel(draft.trim());
  const offered = effortsFor(agent, list, settings.model);
  // A stored level outside the offered ones (e.g. set before the list loaded)
  // still runs, so keep it visible rather than showing "default".
  const efforts =
    settings.effort && !offered.includes(settings.effort) ? [...offered, settings.effort] : offered;
  const defaultEffort = defaultEffortFor(list, settings.model);
  // Native <option> titles are not shown on every platform, so the running
  // model's description gets its own line. An empty custom field runs the
  // CLI default but should not describe it as if it had been picked.
  const description =
    custom && !settings.model ? undefined : resolveOption(list, settings.model)?.description;

  const onAgentChange = (value: string) => {
    if (!isChatAgent(value) || value === agent) return;
    // Model names and effort levels are agent-specific: start from defaults.
    setCustomChosen(false);
    setDraft("");
    setSettings({ agent: value });
  };

  const onModelChange = (value: string) => {
    if (value === CUSTOM) {
      setCustomChosen(true);
      setDraft("");
      setSettings(selectModel(settings, undefined, list));
      return;
    }
    setCustomChosen(false);
    setSettings(selectModel(settings, value || undefined, list));
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    const trimmed = value.trim();
    setSettings(selectModel(settings, isChatModel(trimmed) ? trimmed : undefined, list));
  };

  return (
    <div className="chat-settings">
      <label className="chat-setting">
        <span className="chat-setting-label">agent</span>
        <select
          className="chat-select"
          value={agent}
          disabled={disabled}
          onChange={(e) => onAgentChange(e.target.value)}
        >
          {CHAT_AGENTS.map((id) => (
            <option key={id} value={id}>
              {AGENT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="chat-setting">
        <span className="chat-setting-label">model</span>
        <select
          className="chat-select"
          value={custom ? CUSTOM : model}
          disabled={disabled}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">
            {list.defaultModel
              ? `default (${resolveOption(list, undefined)?.label ?? list.defaultModel})`
              : "default"}
          </option>
          {list.models.map((option) => (
            <option key={option.id} value={option.id} title={option.description}>
              {option.label}
            </option>
          ))}
          <option value={CUSTOM}>custom…</option>
        </select>
      </label>
      {custom && (
        <input
          className="chat-setting-input"
          type="text"
          value={draft}
          placeholder={MODEL_PLACEHOLDER[agent]}
          aria-label="Custom model name"
          aria-invalid={draftInvalid}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => onDraftChange(e.target.value)}
        />
      )}
      {description && (
        <p className="chat-setting-hint" title={description}>
          {description}
        </p>
      )}
      <label className="chat-setting">
        <span className="chat-setting-label">effort</span>
        <select
          className="chat-select"
          value={settings.effort ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value;
            setSettings({ ...settings, effort: isChatEffort(value, agent) ? value : undefined });
          }}
        >
          <option value="">{defaultEffort ? `default (${defaultEffort})` : "default"}</option>
          {efforts.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
