import type { BranchTreeMetadata, BranchTreeMutationResult } from "../types";
import { nowIso } from "../utils";
import { addChild, addSibling, cloneMetadata, getBlock, setBlockCollapsed, updateBlockContent } from "./tree";

export function createIncomingBlock(metadata: BranchTreeMetadata, anchorId: string, kind: "sibling" | "child", markdown: string): BranchTreeMutationResult {
  if (!getBlock(metadata, anchorId)) throw new Error(`Content anchor "${anchorId}" no longer exists`);
  const result = kind === "child" ? addChild(metadata, anchorId) : addSibling(metadata, anchorId, "below");
  result.metadata = updateBlockContent(result.metadata, result.selectedBlockId, markdown);
  if (kind === "child" && getBlock(metadata, anchorId)?.collapsed) {
    result.metadata = setBlockCollapsed(result.metadata, anchorId, false);
  }
  return result;
}

export function appendIncomingContent(metadata: BranchTreeMetadata, blockId: string, markdown: string): BranchTreeMutationResult {
  if (!getBlock(metadata, blockId)) throw new Error(`Content receiver "${blockId}" no longer exists`);
  const next = cloneMetadata(metadata);
  const block = getBlock(next, blockId)!;
  const trailingNewlines = block.content.match(/\n*$/)![0].length;
  const separator = block.content.length ? "\n".repeat(Math.max(0, 2 - trailingNewlines)) : "";
  block.content += separator + markdown;
  block.updatedAt = nowIso();
  return { metadata: next, selectedBlockId: blockId };
}
