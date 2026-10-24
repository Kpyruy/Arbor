import type { VisibleRect } from "../chrome/mobileViewportGeometry";

interface Size { width: number; height: number }
export function fitDropOptions(input: { bounds: VisibleRect; preferred: { x: number; y: number }; stackSize: Size; rowSize: Size }): { x: number; y: number; layout: "stack" | "row" } | null {
  const { bounds, preferred } = input;
  for (const layout of ["stack", "row"] as const) {
    const size = layout === "stack" ? input.stackSize : input.rowSize;
    if (!Object.values(size).every(Number.isFinite) || size.width < (layout === "row" ? 96 : 44)
      || size.height < 44 || size.width > bounds.right - bounds.left || size.height > bounds.bottom - bounds.top) continue;
    return {
      x: Math.max(bounds.left, Math.min(preferred.x, bounds.right - size.width)),
      y: Math.max(bounds.top, Math.min(preferred.y, bounds.bottom - size.height)), layout
    };
  }
  return null;
}
