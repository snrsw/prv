import { useState } from "react";
import { CHAT_EFFORTS, CHAT_MODEL_PRESETS, isChatModel } from "../../shared/chat";
import { useChatSettings } from "../chatSettings";

const CUSTOM = "__custom__";

/**
 * Compact model + effort pickers for the agent. An empty choice means "CLI
 * default" and sends no flag. The model picker lists the CLI aliases and a
 * "Custom…" entry that reveals a text field for a full model name; the field
 * keeps its raw text locally and only commits a well-formed value.
 */
export function ChatSettings({ disabled }: { disabled: boolean }) {
  const [settings, setSettings] = useChatSettings();
  const model = settings.model ?? "";
  const isPreset = model === "" || (CHAT_MODEL_PRESETS as readonly string[]).includes(model);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : model);
  const draftInvalid = draft.trim() !== "" && !isChatModel(draft.trim());

  const onModelChange = (value: string) => {
    if (value === CUSTOM) {
      setCustom(true);
      setDraft("");
      setSettings({ ...settings, model: undefined });
      return;
    }
    setCustom(false);
    setSettings({ ...settings, model: value || undefined });
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    const trimmed = value.trim();
    setSettings({ ...settings, model: isChatModel(trimmed) ? trimmed : undefined });
  };

  return (
    <div className="chat-settings">
      <label className="chat-setting">
        <span className="chat-setting-label">model</span>
        <select
          className="chat-select"
          value={custom ? CUSTOM : model}
          disabled={disabled}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">default</option>
          {CHAT_MODEL_PRESETS.map((alias) => (
            <option key={alias} value={alias}>
              {alias}
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
          placeholder="claude-…"
          aria-label="Custom model name"
          aria-invalid={draftInvalid}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => onDraftChange(e.target.value)}
        />
      )}
      <label className="chat-setting">
        <span className="chat-setting-label">effort</span>
        <select
          className="chat-select"
          value={settings.effort ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value;
            setSettings({
              ...settings,
              effort: (CHAT_EFFORTS as readonly string[]).includes(value)
                ? (value as (typeof CHAT_EFFORTS)[number])
                : undefined,
            });
          }}
        >
          <option value="">default</option>
          {CHAT_EFFORTS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
