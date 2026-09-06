import { useEffect, useRef, useState } from "react";
import {
  SEND_MODE_HINTS,
  SEND_MODE_LABELS,
  sendButtonLabel,
  sendButtonTitle,
  type SendMode,
} from "../sendMode";
import { CheckIcon, ChevronDown } from "./icons";

const MODES: readonly SendMode[] = ["ask", "apply"];

/**
 * The composer's Send control: a primary button that sends in the current
 * mode, and an attached toggle that opens a two-entry radio menu (Read only /
 * Write). One component for the diff chat and inline threads, so the modes
 * look and behave the same everywhere. While a turn streams the primary
 * button becomes Stop and the mode cannot change; the menu closes on an
 * outside press or Escape and walks with the arrow keys, like the topbar's
 * `SidePicker`.
 */
export function SendButton({
  mode,
  onModeChange,
  onSend,
  onStop,
  streaming,
  disabled,
}: {
  mode: SendMode;
  onModeChange: (mode: SendMode) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  /** Nothing to send in this mode (see `canSend`); ignored while streaming. */
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SendMode>(mode);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Partial<Record<SendMode, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  // Opening moves focus into the menu, onto the current mode, so the arrow
  // keys and Enter work without a pointer.
  useEffect(() => {
    if (!open) return;
    setActive(mode);
    requestAnimationFrame(() => itemRefs.current[mode]?.focus());
  }, [open, mode]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleRef.current?.focus();
  };

  const choose = (next: SendMode) => {
    onModeChange(next);
    close(true);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.indexOf(active);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = MODES[(index + step + MODES.length) % MODES.length] ?? mode;
      setActive(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = (e.key === "Home" ? MODES[0] : MODES[MODES.length - 1]) ?? mode;
      setActive(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div
      className={"send-split" + (mode === "apply" && !streaming ? " is-write" : "")}
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }}
    >
      {streaming ? (
        <button type="button" className="chat-send send-split-main" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="chat-send send-split-main"
          title={sendButtonTitle(mode)}
          onClick={onSend}
          disabled={disabled}
        >
          {sendButtonLabel(mode)}
        </button>
      )}
      <button
        ref={toggleRef}
        type="button"
        className={"chat-send send-split-toggle" + (open ? " is-active" : "")}
        aria-label="Send mode"
        title={`Send mode: ${SEND_MODE_LABELS[mode]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={streaming}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDown />
      </button>
      {open && (
        <div
          className="mode-picker-popover send-mode-menu"
          role="menu"
          aria-label="Send mode"
          onKeyDown={onMenuKeyDown}
        >
          {MODES.map((m) => (
            <button
              key={m}
              ref={(el) => {
                itemRefs.current[m] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              tabIndex={m === active ? 0 : -1}
              className={"send-mode-item" + (m === active ? " is-active" : "")}
              onPointerEnter={() => setActive(m)}
              onClick={() => choose(m)}
            >
              <span className="send-mode-item-check" aria-hidden="true">
                {m === mode && <CheckIcon />}
              </span>
              <span className="send-mode-item-text">
                <span className="send-mode-item-label">{SEND_MODE_LABELS[m]}</span>
                <span className="send-mode-item-hint">{SEND_MODE_HINTS[m]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The one-time "the agent will edit files" check shown in place of the
 * composer before a conversation's first Write send.
 */
export function WriteConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="prv-thread-confirm" role="alertdialog" aria-label="Confirm Write mode">
      <span>
        The agent will edit files in your repo. Changes are git-tracked and shown as a diff to
        review. Continue?
      </span>
      <div className="prv-thread-confirm-actions">
        <button type="button" className="chat-send" onClick={onConfirm} autoFocus>
          Yes, send
        </button>
        <button type="button" className="prv-thread-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
