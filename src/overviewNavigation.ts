import { getFirstChildBlock, getNextSibling, getParentBlock, getPreviousSibling } from "./model/tree";
import { getChildArrowKey, getParentArrowKey } from "./layoutDirection";
import { BranchBlockId, BranchTreeMetadata } from "./types";

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
