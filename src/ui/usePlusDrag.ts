import { useRef, useState, type RefObject } from "react";

/** Where the floating "comment" affordance is shown while hovering a line. */
export type HoverPlus = { index: number; top: number };

/** In-progress drag from the "+" button, as a span over the view's line index. */
export type DragSel = { start: number; end: number };

/**
 * The "+" comment trigger shared by the Diff and File views: hovering a line
 * shows "+" in its gutter, and pressing it and dragging selects a range of
 * lines, opened as one thread on release. Only the "+" starts a drag, so code
 * text stays selectable. Each view says what a line is: `lineAt` maps a hovered
 * element to its gutter cell and line index, `indexAtPoint` a pointer position
 * to a line index. The index is the view's own (diff row, or file line).
 */
export function usePlusDrag({
  wrapRef,
  lineAt,
  indexAtPoint,
  onSelect,
}: {
  /** The positioned element the "+" button is placed in. */
  wrapRef: RefObject<HTMLElement | null>;
  lineAt: (target: HTMLElement) => { cell: HTMLElement; index: number } | null;
  indexAtPoint: (x: number, y: number) => number | null;
  onSelect: (a: number, b: number) => void;
}) {
  const [hoverPlus, setHoverPlus] = useState<HoverPlus | null>(null);
  // The live drag lives in a ref (read by the pointer handlers without stale
  // closures); `dragViz` mirrors it for render.
  const dragRef = useRef<DragSel | null>(null);
  const [dragViz, setDragViz] = useState<DragSel | null>(null);

  // Pointer capture delivers every move/up during the drag to the wrap, even
  // outside it. Left button only.
  const beginDrag = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    wrapRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { start: index, end: index };
    setDragViz(dragRef.current);
    setHoverPlus(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const index = indexAtPoint(e.clientX, e.clientY);
    if (index != null && index !== drag.end) {
      dragRef.current = { ...drag, end: index };
      setDragViz(dragRef.current);
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragViz(null);
    setHoverPlus(null);
    onSelect(drag.start, drag.end);
  };

  const onMouseOver = (e: React.MouseEvent) => {
    if (dragRef.current) return; // an active drag is handled by the pointer handlers
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = e.target as HTMLElement;
    // Keep the affordance while the pointer is on it or inside an open thread.
    if (target.closest(".prv-add-comment, .prv-thread")) return;
    const line = lineAt(target);
    if (!line) {
      setHoverPlus(null);
      return;
    }
    const top = line.cell.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    setHoverPlus({ index: line.index, top });
  };

  return {
    hoverPlus,
    setHoverPlus,
    dragViz,
    beginDrag,
    onPointerMove,
    onPointerUp,
    onMouseOver,
    onMouseLeave: () => setHoverPlus(null),
  };
}
