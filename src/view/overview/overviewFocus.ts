import { getBlock, getDescendantIds } from "../../model/tree";
import type { BranchBlockId, BranchTreeMetadata } from "../../types";

/** A drawing/navigation projection only. Never pass this to document mutations. */
export function projectOverviewSubtree(metadata: BranchTreeMetadata, rootId: BranchBlockId | null): BranchTreeMetadata {
  if (!rootId || !getBlock(metadata, rootId)) return metadata;
  const included = new Set([rootId, ...getDescendantIds(metadata, rootId)]);
  return { ...metadata, blocks: metadata.blocks.filter(block => included.has(block.id)).map(block =>
    block.id === rootId ? { ...block, parentId: null, order: 0 } : block) };
}
