import { useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, FileTotals, Status } from "../types";
import type { FileUiState } from "../useFileUiState";
import { subtreeOpenCount } from "../progress";
import { fileTotals } from "../totals";
import { StatusIcon } from "./StatusIcon";
import { DiffStat } from "./DiffStat";
import { CheckIcon, ChevronDown, ChevronRight } from "./icons";

type DirNode = { kind: "dir"; name: string; path: string; children: TreeNode[] };
type FileNode = { kind: "file"; name: string; path: string; oldPath?: string; status: Status };
type TreeNode = DirNode | FileNode;

function buildTree(files: FileDiff[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/").filter((p) => p.length > 0);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isLast = i === parts.length - 1;
      if (isLast) {
        cursor.push({
          kind: "file",
          name,
          path: file.path,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
          status: file.status,
        });
        continue;
      }
      const existing = cursor.find((n) => n.kind === "dir" && n.name === name);
      if (existing && existing.kind === "dir") {
        cursor = existing.children;
        continue;
      }
      const dir: DirNode = {
        kind: "dir",
        name,
        path: parts.slice(0, i + 1).join("/"),
        children: [],
      };
      cursor.push(dir);
      cursor = dir.children;
    }
  }
  return root.map(collapseSingleChildDirs);
}

function collapseSingleChildDirs(node: TreeNode): TreeNode {
  if (node.kind !== "dir") return node;
  const children = node.children.map(collapseSingleChildDirs);
  if (children.length === 1) {
    const only = children[0]!;
    if (only.kind === "dir") {
      return {
        kind: "dir",
        name: `${node.name}/${only.name}`,
        path: only.path,
        children: only.children,
      };
    }
  }
  return { ...node, children };
}

/** Per-row review progress: the diffstat, open comments, and the Viewed mark. */
type RowMeta = {
  totals: Record<string, FileTotals>;
  openByFile: Record<string, number>;
  ui: FileUiState;
};

export function FileTree({
  files,
  onSelect,
  activePath,
  openByFile,
  ui,
}: {
  files: FileDiff[];
  onSelect: (path: string) => void;
  activePath: string | null;
  /** Open comment count per file path (any source). */
  openByFile: Record<string, number>;
  ui: FileUiState;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, filter]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const totals = useMemo(
    () => Object.fromEntries(files.map((f) => [f.path, fileTotals(f)])),
    [files],
  );
  const meta: RowMeta = useMemo(() => ({ totals, openByFile, ui }), [totals, openByFile, ui]);

  return (
    <>
      <div className="sidebar-search">
        <input
          type="search"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <ul className="file-tree">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            onSelect={onSelect}
            activePath={activePath}
            depth={0}
            meta={meta}
          />
        ))}
      </ul>
    </>
  );
}

function TreeItem({
  node,
  onSelect,
  activePath,
  depth,
  meta,
}: {
  node: TreeNode;
  onSelect: (path: string) => void;
  activePath: string | null;
  depth: number;
  meta: RowMeta;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.kind === "file") {
    return (
      <FileRow
        node={node}
        active={activePath === node.path}
        depth={depth}
        meta={meta}
        onSelect={onSelect}
      />
    );
  }

  const open = subtreeOpenCount(meta.openByFile, node.path);
  return (
    <li>
      <button
        type="button"
        className="tree-row dir"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="tree-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <FolderIcon />
        <span className="tree-name">{node.name}</span>
        {open > 0 && (
          <span className="tree-row-meta">
            <span className="tree-badge tree-badge-dir" title={openTitle(open)}>
              {open}
            </span>
          </span>
        )}
      </button>
      {expanded && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              onSelect={onSelect}
              activePath={activePath}
              depth={depth + 1}
              meta={meta}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function openTitle(n: number): string {
  return `${n} open comment${n === 1 ? "" : "s"}`;
}

function FileRow({
  node,
  active,
  depth,
  meta,
  onSelect,
}: {
  node: FileNode;
  active: boolean;
  depth: number;
  meta: RowMeta;
  onSelect: (path: string) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const open = meta.openByFile[node.path] ?? 0;
  const viewed = meta.ui[node.path]?.viewed === true;
  const totals = meta.totals[node.path];

  // Scroll-spy moves the selection while the reader is far from the sidebar;
  // keep the row in view there. After a click the row is already visible,
  // so "nearest" makes this a no-op.
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        className={`tree-row file ${active ? "active" : ""} ${viewed ? "viewed" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.oldPath ? `${node.oldPath} → ${node.path}` : node.path}
        onClick={() => onSelect(node.path)}
      >
        <span className="tree-chevron" aria-hidden="true" />
        <StatusIcon status={node.status} size={16} />
        <span className="tree-name">{node.name}</span>
        <span className="tree-row-meta">
          {open > 0 && (
            <span className="tree-badge" title={openTitle(open)}>
              {open}
            </span>
          )}
          {totals && <DiffStat totals={totals} />}
          {viewed && (
            <span className="tree-viewed" title="Viewed">
              <CheckIcon size={12} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function FolderIcon() {
  return (
    <span className="tree-icon tree-icon-dir">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1L6.1 1.4A1.748 1.748 0 0 0 4.7 1H1.75z" />
      </svg>
    </span>
  );
}
