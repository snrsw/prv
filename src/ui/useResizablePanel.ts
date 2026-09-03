import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

export function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseStoredWidth(
  raw: string | null,
  defaultWidth: number,
  min: number,
  max: number,
): number {
  if (raw === null) return defaultWidth;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultWidth : clampWidth(parsed, min, max);
}

const KEYBOARD_STEP = 16;

type Options = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Which viewport edge the panel hugs; decides how pointer x maps to width. */
  side: "left" | "right";
};

export type ResizablePanel = {
  width: number;
  dragging: boolean;
  resizerProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
};

export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
}: Options): ResizablePanel {
  const [width, setWidth] = useState(() => {
    try {
      return parseStoredWidth(
        window.localStorage.getItem(storageKey),
        defaultWidth,
        minWidth,
        maxWidth,
      );
    } catch {
      return defaultWidth;
    }
  });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* localStorage unavailable; ignore */
    }
  }, [storageKey, width]);

  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add("prv-col-resize");
    return () => document.documentElement.classList.remove("prv-col-resize");
  }, [dragging]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      const raw = side === "left" ? e.clientX : window.innerWidth - e.clientX;
      setWidth(clampWidth(raw, minWidth, maxWidth));
    },
    [side, minWidth, maxWidth],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    setDragging(false);
  }, []);

  const onDoubleClick = useCallback(() => setWidth(defaultWidth), [defaultWidth]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      // Arrow keys move the panel's edge, so the same key grows one side and
      // shrinks the other depending on which viewport edge the panel hugs.
      const edgeDelta = e.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP;
      const delta = side === "left" ? edgeDelta : -edgeDelta;
      setWidth((w) => clampWidth(w + delta, minWidth, maxWidth));
    },
    [side, minWidth, maxWidth],
  );

  return {
    width,
    dragging,
    resizerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick,
      onKeyDown,
    },
  };
}
