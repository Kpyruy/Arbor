import { getFirstChildBlock, getNextSibling, getParentBlock, getPreviousSibling } from "./model/tree";
import { getChildArrowKey, getParentArrowKey } from "./layoutDirection";
import { BranchBlockId, BranchTreeMetadata } from "./types";

export interface OverviewCardSelectionState {
  active: boolean;
  onPath: boolean;
  animate: boolean;
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
