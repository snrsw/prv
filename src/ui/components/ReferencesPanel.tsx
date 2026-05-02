import { useEffect } from "react";

export type RefRow = { line: number; character: number; snippet: string };
export type RefGroup = { path: string; refs: RefRow[] };

export type ReferencesResponse =
  | {
      kind: "ok";
      groups: { inFile: RefRow[]; local: RefGroup[]; external: number };
    }
  | { kind: "missing-binary"; binary: string }
  | { kind: "unsupported-language" }
  | { kind: "unsupported-source" }
  | { kind: "miss" };

export type ReferencesOrigin = { file: string; line: number; character: number };

export function ReferencesPanel({
  origin,
  response,
  loading,
  onClose,
  onJump,
}: {
  origin: ReferencesOrigin | null;
  response: ReferencesResponse | null;
  loading: boolean;
  onClose: () => void;
  onJump: (target: { path: string; line: number }) => void;
}) {
  useEffect(() => {
    if (!origin) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [origin, onClose]);

  if (!origin) return null;

  return (
    <aside className="refs-panel" role="dialog" aria-label="References">
      <header className="refs-panel-header">
        <span className="refs-panel-title">References</span>
        <button type="button" className="refs-panel-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="refs-panel-body">
        {loading && <div className="refs-panel-empty">searching…</div>}
        {!loading && response && <Body response={response} origin={origin} onJump={onJump} />}
      </div>
    </aside>
  );
}

function Body({
  response,
  origin,
  onJump,
}: {
  response: ReferencesResponse;
  origin: ReferencesOrigin;
  onJump: (t: { path: string; line: number }) => void;
}) {
  if (response.kind === "missing-binary") {
    return (
      <div className="refs-panel-notice">
        Install <code>{response.binary}</code> to enable references.
      </div>
    );
  }
  if (response.kind === "unsupported-language") {
    return <div className="refs-panel-notice">No language server for this file type.</div>;
  }
  if (response.kind === "unsupported-source") {
    return (
      <div className="refs-panel-notice">
        References are disabled for files loaded from a git ref.
      </div>
    );
  }
  if (response.kind === "miss") {
    return <div className="refs-panel-notice">No references found.</div>;
  }
  const { groups } = response;
  const total = groups.inFile.length + groups.local.reduce((n, g) => n + g.refs.length, 0);
  if (total === 0 && groups.external === 0) {
    return <div className="refs-panel-notice">No references found.</div>;
  }
  return (
    <>
      <div className="refs-panel-count">
        {total} reference{total === 1 ? "" : "s"}
      </div>
      {groups.inFile.length > 0 && (
        <Group
          title="In this file"
          rows={groups.inFile}
          onPick={(row) => onJump({ path: origin.file, line: row.line })}
        />
      )}
      {groups.local.map((g) => (
        <Group
          key={g.path}
          title={g.path}
          titleIsPath
          rows={g.refs}
          onPick={(row) => onJump({ path: g.path, line: row.line })}
        />
      ))}
      {groups.external > 0 && (
        <section className="refs-panel-group">
          <h3 className="refs-panel-group-title">External ({groups.external})</h3>
        </section>
      )}
    </>
  );
}

function Group({
  title,
  titleIsPath,
  rows,
  onPick,
}: {
  title: string;
  titleIsPath?: boolean;
  rows: RefRow[];
  onPick: (row: RefRow) => void;
}) {
  return (
    <section className="refs-panel-group">
      <h3 className={`refs-panel-group-title${titleIsPath ? " is-path" : ""}`} title={title}>
        {title}
      </h3>
      <ul className="refs-panel-list">
        {rows.map((row, i) => (
          <li key={`${row.line}-${row.character}-${i}`}>
            <button
              type="button"
              className="refs-panel-row"
              onClick={() => onPick(row)}
              title={row.snippet}
            >
              <span className="refs-panel-line">{row.line + 1}</span>
              <span className="refs-panel-snippet">{row.snippet || " "}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
