import { useEffect, useRef } from "react";
import { DIFF_SHORTCUTS, GLOBAL_SHORTCUTS } from "../shortcuts";

/**
 * The `?` overlay (#56): a small centred dialog rendered from the shortcut
 * table. It takes focus while open, so Escape reaches App's key handler
 * wherever the reader was, and hands focus back when it closes.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div className="shortcut-help-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcut-help-head">
          <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="shortcut-help-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <ShortcutList title="Anywhere" rows={GLOBAL_SHORTCUTS} />
        <ShortcutList
          title="On a line of the Diff or File tab (Tab into the line numbers)"
          rows={DIFF_SHORTCUTS}
        />
      </div>
    </div>
  );
}

function ShortcutList({
  title,
  rows,
}: {
  title: string;
  rows: { keys: string[]; label: string }[];
}) {
  return (
    <section>
      <h3>{title}</h3>
      <dl className="shortcut-help-list">
        {rows.map((row) => (
          <div key={row.label} className="shortcut-help-row">
            <dt>{row.label}</dt>
            <dd>
              {row.keys.map((key, i) => (
                <span key={key}>
                  {i > 0 && <span className="shortcut-help-or"> / </span>}
                  <kbd>{key}</kbd>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
