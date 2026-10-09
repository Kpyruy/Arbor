import type { BranchTreeMetadata, BranchTreeMutationResult } from "../types";
import { nowIso } from "../utils";
import { cloneMetadata, getBlock } from "./tree";

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
