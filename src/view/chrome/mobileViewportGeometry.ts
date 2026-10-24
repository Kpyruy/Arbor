export interface VisibleRect { left: number; top: number; right: number; bottom: number }

export function intersectVisibleRects(rects: VisibleRect[]): VisibleRect | null {
  if (!rects.length || rects.some(rect => !Object.values(rect).every(Number.isFinite))) return null;
  const intersection = {
    left: Math.max(...rects.map(rect => rect.left)), top: Math.max(...rects.map(rect => rect.top)),
    right: Math.min(...rects.map(rect => rect.right)), bottom: Math.min(...rects.map(rect => rect.bottom))
  };
  return intersection.right > intersection.left && intersection.bottom > intersection.top ? intersection : null;
}

/** Measure the unconstrained pane, never the previously capped frame. */
export function mobileViewportHeight(root: HTMLElement): number {
  const owner = root.win;
  const viewport = owner.visualViewport;
  const pane = root.getBoundingClientRect();
  const visible = intersectVisibleRects([pane, {
    left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? owner.innerWidth),
    bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? owner.innerHeight)
  }]);
  if (!visible) return 0;
  let bottom = visible.bottom;
  for (const bar of Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(".mobile-navbar, .mobile-toolbar"))) {
    const bounds = bar.getBoundingClientRect();
    const style = owner.getComputedStyle(bar);
    // A floating/other-pane toolbar is not a full-width pane obstruction.
    if (bar.isConnected && bounds.height > 0 && bounds.left <= visible.left + 1 && bounds.right >= visible.right - 1
      && bounds.top >= visible.top && bounds.top < bottom && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity || 1) > 0) bottom = bounds.top;
  }
  const padding = owner.getComputedStyle(root);
  return Math.max(0, bottom - Math.max(visible.top, pane.top + (parseFloat(padding.paddingTop) || 0))
    - (parseFloat(padding.paddingBottom) || 0));
}
