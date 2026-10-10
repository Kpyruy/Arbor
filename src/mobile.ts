import type { BranchColumnModel, BranchBlockId } from "./types";

export const MIN_ZOOM_LEVEL = 0.25;
export const MAX_ZOOM_LEVEL = 5;

export interface ZoomBounds { min: number; max: number }

export function normalizeZoomBounds(min?: number, max?: number): ZoomBounds {
  const lower = Number.isFinite(min) ? Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, min!)) : MIN_ZOOM_LEVEL;
  const upper = Number.isFinite(max) ? Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, max!)) : MAX_ZOOM_LEVEL;
  return { min: Math.min(lower, upper), max: Math.max(lower, upper) };
}

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

export function clampZoomLevel(zoom: number, bounds?: ZoomBounds): number {
  const { min, max } = normalizeZoomBounds(bounds?.min, bounds?.max);
  return Math.max(min, Math.min(max, Number.isFinite(zoom) ? zoom : 1));
}

export function resolvePinchZoom(startZoom: number, startDistance: number, distance: number, bounds?: ZoomBounds): number {
  return clampZoomLevel(startZoom * distance / Math.max(1, startDistance), bounds);
}

/** Keeps the world point beneath the pinch midpoint fixed as scale changes. */
export function pinchViewport(start: { zoom: number; left: number; top: number; midpoint: TouchPoint; distance: number }, midpoint: TouchPoint, distance: number, bounds?: ZoomBounds): { zoom: number; left: number; top: number } {
  const zoom = resolvePinchZoom(start.zoom, start.distance, distance, bounds);
  const ratio = zoom / start.zoom;
  return { zoom, left: (start.left + start.midpoint.x) * ratio - midpoint.x, top: (start.top + start.midpoint.y) * ratio - midpoint.y };
}
