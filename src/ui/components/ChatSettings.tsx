import { useEffect, useRef, useState } from "react";
import {
  AGENT_LABELS,
  CHAT_AGENTS,
  CHAT_EFFORTS_BY_AGENT,
  CHAT_MODEL_PRESETS_BY_AGENT,
  DEFAULT_CHAT_AGENT,
  isChatAgent,
  isChatEffort,
  isChatModel,
  type ChatEffort,
} from "../../shared/chat";
import { summarizeChatSettings, useChatSettings } from "../chatSettings";
import { GearIcon } from "./icons";

const CUSTOM = "__custom__";

const MODEL_PLACEHOLDER: Record<(typeof CHAT_AGENTS)[number], string> = {
  claude: "claude-…",
  codex: "gpt-…",
};

/**
 * Compact agent + model + effort pickers. The agent picker chooses which local
 * CLI runs the turn (Claude Code or Codex); model and effort are per-agent, so
 * switching agents clears them. An empty model/effort means "CLI default" and
 * sends no flag. The model picker lists the agent's aliases (Claude only) and
 * a "Custom…" entry that reveals a text field for a full model name; the field
 * keeps its raw text locally and only commits a well-formed value.
 */
export function ChatSettings({ disabled }: { disabled: boolean }) {
  const [settings, setSettings] = useChatSettings();
  const agent = settings.agent ?? DEFAULT_CHAT_AGENT;
  const presets: readonly string[] = CHAT_MODEL_PRESETS_BY_AGENT[agent];
  const efforts: readonly string[] = CHAT_EFFORTS_BY_AGENT[agent];
  const model = settings.model ?? "";
  const isPreset = model === "" || presets.includes(model);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : model);
  const draftInvalid = draft.trim() !== "" && !isChatModel(draft.trim());

  const onAgentChange = (value: string) => {
    if (!isChatAgent(value) || value === agent) return;
    // Model names and effort levels are agent-specific: start from defaults.
    setCustom(false);
    setDraft("");
    setSettings({ agent: value });
  };

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
          <option value="">default</option>
          {presets.map((alias) => (
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
          placeholder={MODEL_PLACEHOLDER[agent]}
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
              effort: isChatEffort(value, agent) ? (value as ChatEffort) : undefined,
            });
          }}
        >
          <option value="">default</option>
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

/**
 * The agent / model / effort pickers behind one compact gear button. The
 * settings are app-wide (one store, see `chatSettings`), so the same menu
 * sits in the topbar, the chat composer and every inline thread: wherever a
 * conversation happens, the agent it runs with is one press away, and the
 * popover says so. Opens above the button by default (composers sit at the
 * bottom of their panel) or below with `placement="below"`; `align="end"`
 * hangs it from the button's right edge for buttons near the viewport's right
 * side. Closes on an outside press or Escape, the way the topbar's
 * `SidePicker` does.
 */
export function ChatSettingsMenu({
  disabled = false,
  placement = "above",
  align = "start",
}: {
  /** Greyed while a turn streams; a change would only apply from the next turn anyway. */
  disabled?: boolean;
  placement?: "above" | "below";
  align?: "start" | "end";
}) {
  const [settings] = useChatSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const summary = summarizeChatSettings(settings);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <div
      className="chat-settings-menu"
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={"chat-settings-btn" + (open ? " is-active" : "")}
        aria-label="Agent settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Agent settings: ${summary}`}
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon />
        <span className="chat-settings-summary">{summary}</span>
      </button>
      {open && (
        <div
          className={
            "mode-picker-popover chat-settings-popover" +
            (placement === "below" ? " is-below" : "") +
            (align === "end" ? " is-end" : "")
          }
          role="dialog"
          aria-label="Agent settings"
        >
          <ChatSettings disabled={disabled} />
          <p className="chat-settings-note">Applies to chat, inline comments, and Review.</p>
        </div>
      )}
    </div>
  );
}
