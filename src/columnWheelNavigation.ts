import { getActivePath, getPreferredChildBlock } from "./model/tree";
import { BranchColumnModel, BranchTreeMetadata, BranchBlockId } from "./types";

export function resolveColumnWheelTarget(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId | null,
  hoveredColumn: BranchColumnModel
): BranchBlockId | null {
  if (!selectedBlockId) {
    return null;
  }

  if (hoveredColumn.blocks.some((block) => block.id === selectedBlockId)) {
    return null;
  }

  const activeAncestor = [...getActivePath(metadata, selectedBlockId)]
    .reverse()
    .find((block) => hoveredColumn.blocks.some((candidate) => candidate.id === block.id));
  if (activeAncestor) {
    return activeAncestor.id;
  }

  if (hoveredColumn.parentId !== selectedBlockId) {
    return null;
  }

  return getPreferredChildBlock(metadata, selectedBlockId)?.id ?? null;
}
