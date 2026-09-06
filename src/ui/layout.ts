import { useEffect, useState } from "react";

/**
 * Responsive layout (#60). Up to this viewport width the side panels no longer
 * fit next to the diff, so they become overlay drawers and the topbar drops its
 * secondary chips. The same number is repeated in styles.css (`@media
 * (max-width: 1000px)`), which cannot read it from here.
 */
export const COMPACT_MAX = 1000;

export type Layout = "wide" | "compact";

export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX}px)`;

export function layoutFor(width: number): Layout {
  return width <= COMPACT_MAX ? "compact" : "wide";
}

/**
 * The CSS width of a drawer: the user's panel width, but never so wide that it
 * swallows the whole viewport (a sliver of the page stays visible as a hint
 * that there is something to go back to).
 */
export const DRAWER_EDGE_PX = 16;

export function drawerWidth(width: number): string {
  return `min(${width}px, calc(100vw - ${DRAWER_EDGE_PX}px))`;
}

/**
 * Tracks the breakpoint through `matchMedia`, so the browser tells us when
 * the layout flips instead of every resize event re-rendering the app.
 */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setLayout(query.matches ? "compact" : "wide");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return layout;
}
