import { useEffect, useState } from "react";
import type { GitRight, RefsResponse, ServerMode } from "../types";
import { SidePicker } from "./ModePicker";
import { PathSide } from "./PathPicker";

type RefPathMode = Extract<ServerMode, { kind: "ref-vs-path" }>;

export function RefPathPicker({
  mode,
  onChange,
}: {
  mode: RefPathMode;
  onChange: (next: RefPathMode) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const url = new URL("/api/refs", window.location.origin);
    url.searchParams.set("cwd", mode.cwd);
    fetch(url)
      .then((r) => r.json() as Promise<RefsResponse>)
      .then((data) => {
        if (!cancelled) setBranches(data.branches);
      })
      .catch(() => {
        /* refs are a nicety; free-text input still works */
      });
    return () => {
      cancelled = true;
    };
  }, [mode.cwd]);

  const refSide = (
    <SidePicker
      label={mode.refOnLeft ? "base" : "compare"}
      branches={branches}
      value={{ kind: "ref", ref: mode.ref }}
      allowWorktree={false}
      onChange={(side: GitRight) => {
        if (side.kind === "ref") onChange({ ...mode, ref: side.ref });
      }}
    />
  );

  const pathSide = (
    <PathSide
      label={mode.refOnLeft ? "compare" : "base"}
      value={mode.path}
      onChange={(path) => onChange({ ...mode, path })}
    />
  );

  return (
    <div className="mode-picker">
      {mode.refOnLeft ? refSide : pathSide}
      <button
        type="button"
        className="mode-picker-sep mode-picker-swap"
        aria-label="Swap base and compare"
        title="Swap base ↔ compare"
        onClick={() => onChange({ ...mode, refOnLeft: !mode.refOnLeft })}
      >
        ↔
      </button>
      {mode.refOnLeft ? pathSide : refSide}
    </div>
  );
}
