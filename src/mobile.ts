import type { BranchColumnModel, BranchBlockId } from "./types";

export function useCompactLayout(width: number): boolean {
  return width > 0 && width <= 600;
}

export function compactColumns(columns: BranchColumnModel[], selectedId: BranchBlockId | null): BranchColumnModel[] {
  return [columns.find((column) => column.blocks.some((block) => block.id === selectedId)) ?? columns[0]].filter(Boolean);
}

export function shouldSaveOnEnter(input: { key: string; shiftKey: boolean; isComposing: boolean; ctrlKey: boolean; metaKey: boolean }, mobile: boolean): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing && (!mobile || input.ctrlKey || input.metaKey);
}

export interface TouchPoint { x: number; y: number }

/** Keeps the world point beneath the pinch midpoint fixed as scale changes. */
export function pinchViewport(start: { zoom: number; left: number; top: number; midpoint: TouchPoint; distance: number }, midpoint: TouchPoint, distance: number): { zoom: number; left: number; top: number } {
  const zoom = Math.max(0.5, Math.min(1.6, start.zoom * distance / Math.max(1, start.distance)));
  const ratio = zoom / start.zoom;
  return { zoom, left: (start.left + start.midpoint.x) * ratio - midpoint.x, top: (start.top + start.midpoint.y) * ratio - midpoint.y };
}
