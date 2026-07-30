import { getFirstChildBlock, getNextSibling, getParentBlock, getPreviousSibling } from "./model/tree";
import { BranchBlockId, BranchTreeMetadata } from "./types";

export function resolveOverviewArrowTarget(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId,
  key: string
): BranchBlockId | null {
  const target = key === "ArrowLeft"
    ? getParentBlock(metadata, selectedBlockId)
    : key === "ArrowRight"
      ? getFirstChildBlock(metadata, selectedBlockId)
      : key === "ArrowUp"
        ? getPreviousSibling(metadata, selectedBlockId)
        : key === "ArrowDown"
          ? getNextSibling(metadata, selectedBlockId)
          : null;

  return target?.id ?? null;
}
