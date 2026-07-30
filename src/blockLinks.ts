import { BranchBlockId } from "./types";

const ANCHOR_PREFIX = "^arbor-";

export function blockAnchor(blockId: BranchBlockId): string {
  return ANCHOR_PREFIX + blockId;
}

export function parseArborBlockAnchor(subpath: string | null | undefined): BranchBlockId | null {
  if (!subpath?.startsWith("#" + ANCHOR_PREFIX)) {
    return null;
  }
  const blockId = subpath.slice(("#" + ANCHOR_PREFIX).length);
  return blockId.length > 0 ? blockId : null;
}

export function buildArborBlockLink(notePath: string, blockId: BranchBlockId, label: string): string {
  const href = "obsidian://arbor?file=" + encodeURIComponent(notePath) + "&block=" + encodeURIComponent(blockId);
  const safeLabel = label.split("[").join("").split("]").join("");
  return `[${safeLabel}](${href})`;
}
