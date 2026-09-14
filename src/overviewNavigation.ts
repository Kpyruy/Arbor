import { getFirstChildBlock, getNextSibling, getParentBlock, getPreviousSibling } from "./model/tree";
import { getChildArrowKey, getParentArrowKey } from "./layoutDirection";
import { BranchBlockId, BranchTreeMetadata } from "./types";

export interface OverviewCardSelectionState {
  active: boolean;
  onPath: boolean;
  animate: boolean;
}

export function startOverviewSelectionAnimation(
  card: HTMLElement,
  previous: Animation | null,
  reducedMotion: boolean
): Animation | null {
  previous?.cancel();
  if (reducedMotion) {
    return null;
  }

  return card.animate([
    {
      transform: "translate3d(0, 2px, 0) scale(0.992)",
      boxShadow: "0 12px 26px rgba(0, 0, 0, 0.18)"
    },
    {
      transform: "translate3d(0, -1px, 0) scale(1.004)",
      boxShadow: "0 0 0 3px color-mix(in srgb, var(--interactive-accent) 24%, transparent), 0 16px 32px rgba(0, 0, 0, 0.24)"
    },
    {
      transform: "translate3d(0, 0, 0) scale(1)",
      boxShadow: "0 12px 26px rgba(0, 0, 0, 0.18)"
    }
  ], {
    duration: 240,
    easing: "cubic-bezier(0.16, 0.9, 0.3, 1)",
    fill: "none"
  });
}

export function resolveOverviewCardSelectionState(
  blockId: BranchBlockId,
  selectedBlockId: BranchBlockId | null,
  activePathIds: ReadonlySet<BranchBlockId>,
  selectionChanged: boolean
): OverviewCardSelectionState {
  const active = blockId === selectedBlockId;
  return {
    active,
    onPath: !active && activePathIds.has(blockId),
    animate: active && selectionChanged
  };
}

export function resolveOverviewArrowTarget(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId,
  key: string,
  direction: "ltr" | "rtl" = "ltr"
): BranchBlockId | null {
  const target = key === getParentArrowKey(direction)
    ? getParentBlock(metadata, selectedBlockId)
    : key === getChildArrowKey(direction)
      ? getFirstChildBlock(metadata, selectedBlockId)
      : key === "ArrowUp"
        ? getPreviousSibling(metadata, selectedBlockId)
        : key === "ArrowDown"
          ? getNextSibling(metadata, selectedBlockId)
          : null;

  return target?.id ?? null;
}
