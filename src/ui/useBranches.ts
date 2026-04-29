import { useEffect, useState } from "react";
import type { RefsResponse } from "./types";

export function useBranches(cwd: string): string[] {
  const [branches, setBranches] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const url = new URL("/api/refs", window.location.origin);
    url.searchParams.set("cwd", cwd);
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
  }, [cwd]);
  return branches;
}
