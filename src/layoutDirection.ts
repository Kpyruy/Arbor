import type { ArborLayoutDirection } from "./types";

export interface InitialLayoutDirectionOptions {
  hasStoredPluginData: boolean;
  savedDirection?: unknown;
  documentDirection?: string | null;
}

export function resolveInitialLayoutDirection({
  hasStoredPluginData,
  savedDirection,
  documentDirection
}: InitialLayoutDirectionOptions): ArborLayoutDirection {
  if (savedDirection === "rtl" || savedDirection === "ltr") {
    return savedDirection;
  }

  if (hasStoredPluginData) {
    return "ltr";
  }

  return documentDirection?.toLowerCase() === "rtl" ? "rtl" : "ltr";
}

export function getParentArrowKey(direction: ArborLayoutDirection): "ArrowLeft" | "ArrowRight" {
  return direction === "rtl" ? "ArrowRight" : "ArrowLeft";
}

export function getChildArrowKey(direction: ArborLayoutDirection): "ArrowLeft" | "ArrowRight" {
  return direction === "rtl" ? "ArrowLeft" : "ArrowRight";
}

export function getVisualColumnOrder<T>(columns: readonly T[], direction: ArborLayoutDirection): T[] {
  return direction === "rtl" ? [...columns].reverse() : [...columns];
}

export function getHorizontalWheelDelta(delta: number, direction: ArborLayoutDirection): number {
  return direction === "rtl" ? -delta : delta;
}
