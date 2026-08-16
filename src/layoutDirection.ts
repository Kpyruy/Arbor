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

export function getChildArrowIcon(direction: ArborLayoutDirection): "arrow-left" | "arrow-right" {
  return direction === "rtl" ? "arrow-left" : "arrow-right";
}

export function getParentArrowIcon(direction: ArborLayoutDirection): "arrow-left" | "arrow-right" {
  return direction === "rtl" ? "arrow-right" : "arrow-left";
}

export function getVisualColumnOrder<T>(columns: readonly T[], direction: ArborLayoutDirection): T[] {
  return direction === "rtl" ? [...columns].reverse() : [...columns];
}

export function getVisualBreadcrumbOrder<T>(path: readonly T[], direction: ArborLayoutDirection): T[] {
  return direction === "rtl" ? [...path].reverse() : [...path];
}

export function getHorizontalWheelDelta(delta: number, direction: ArborLayoutDirection): number {
  return direction === "rtl" ? -delta : delta;
}

export function getBreadcrumbScrollInsets(direction: ArborLayoutDirection): { left: number; right: number } {
  return { left: 28, right: 28 };
}
