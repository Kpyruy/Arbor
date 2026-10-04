import { ArborLayoutDirection, ArborOverviewOrientation } from "./types";

export interface OverviewDirectionKeys {
  parent: string;
  child: string;
  previous: string;
  next: string;
}

export function normalizeOverviewOrientation(value: unknown): ArborOverviewOrientation | null {
  return value === "horizontal" || value === "vertical-top-down" || value === "vertical-bottom-up" ? value : null;
}

export function resolveOverviewOrientation(defaultValue: unknown, override: unknown): ArborOverviewOrientation {
  return normalizeOverviewOrientation(override) ?? normalizeOverviewOrientation(defaultValue) ?? "horizontal";
}

export function getOverviewDirectionKeys(
  direction: ArborLayoutDirection,
  orientation: ArborOverviewOrientation
): OverviewDirectionKeys {
  return orientation !== "horizontal"
    ? {
      parent: orientation === "vertical-bottom-up" ? "ArrowDown" : "ArrowUp",
      child: orientation === "vertical-bottom-up" ? "ArrowUp" : "ArrowDown",
      previous: direction === "rtl" ? "ArrowRight" : "ArrowLeft",
      next: direction === "rtl" ? "ArrowLeft" : "ArrowRight"
    }
    : {
      parent: direction === "rtl" ? "ArrowRight" : "ArrowLeft",
      child: direction === "rtl" ? "ArrowLeft" : "ArrowRight",
      previous: "ArrowUp",
      next: "ArrowDown"
    };
}
