import type { BranchColumnModel, BranchBlockId } from "./types";

export const MIN_ZOOM_LEVEL = 0.25;
export const MAX_ZOOM_LEVEL = 1.6;

export function useCompactLayout(_width: number, isMobile: boolean): boolean {
  return isMobile;
}

export function compactColumns(columns: BranchColumnModel[], selectedId: BranchBlockId | null): BranchColumnModel[] {
  return [columns.find((column) => column.blocks.some((block) => block.id === selectedId)) ?? columns[0]].filter(Boolean);
}

export function shouldSaveOnEnter(input: { key: string; shiftKey: boolean; isComposing: boolean; ctrlKey: boolean; metaKey: boolean }, mobile: boolean): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing && (!mobile || input.ctrlKey || input.metaKey);
}

export interface TouchPoint { x: number; y: number }

export function clampZoomLevel(zoom: number): number {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, zoom));
}

export function resolvePinchZoom(startZoom: number, startDistance: number, distance: number): number {
  return clampZoomLevel(startZoom * distance / Math.max(1, startDistance));
}

/** Keeps the world point beneath the pinch midpoint fixed as scale changes. */
export function pinchViewport(start: { zoom: number; left: number; top: number; midpoint: TouchPoint; distance: number }, midpoint: TouchPoint, distance: number): { zoom: number; left: number; top: number } {
  const zoom = resolvePinchZoom(start.zoom, start.distance, distance);
  const ratio = zoom / start.zoom;
  return { zoom, left: (start.left + start.midpoint.x) * ratio - midpoint.x, top: (start.top + start.midpoint.y) * ratio - midpoint.y };
}
