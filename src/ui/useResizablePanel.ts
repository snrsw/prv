import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Clamp a panel width to its own range and to the viewport (#60): the panel
 * may take at most `viewport - reserve`, so the column next to it keeps at
 * least `reserve`. `min` still wins on a viewport too small for both.
 */
export function clampWidth(
  value: number,
  min: number,
  max: number,
  viewport: number,
  reserve: number,
): number {
  const cap = Math.min(max, viewport - reserve);
  return Math.max(min, Math.min(cap, Math.round(value)));
}

export function parseStoredWidth(
  raw: string | null,
  defaultWidth: number,
  min: number,
  max: number,
  viewport: number,
  reserve: number,
): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return clampWidth(Number.isNaN(parsed) ? defaultWidth : parsed, min, max, viewport, reserve);
}

const KEYBOARD_STEP = 16;

type Options = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Viewport width the panel must leave for the rest of the page. */
  viewportReserve: number;
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
  viewportReserve,
  side,
}: Options): ResizablePanel {
  const [width, setWidth] = useState(() => {
    try {
      return parseStoredWidth(
        window.localStorage.getItem(storageKey),
        defaultWidth,
        minWidth,
        maxWidth,
        window.innerWidth,
        viewportReserve,
      );
    } catch {
      return defaultWidth;
    }
  });
  const clamp = useCallback(
    (value: number) => clampWidth(value, minWidth, maxWidth, window.innerWidth, viewportReserve),
    [minWidth, maxWidth, viewportReserve],
  );
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
      setWidth(clamp(raw));
    },
    [side, clamp],
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
      setWidth((w) => clamp(w + delta));
    },
    [side, clamp],
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
