import type { BranchBlockId } from "./types";

export function getEnteringBreadcrumbIds(
  previousIds: Iterable<BranchBlockId>,
  nextIds: Iterable<BranchBlockId>
): Set<BranchBlockId> {
  const previous = new Set(previousIds);
  return new Set([...nextIds].filter((blockId) => !previous.has(blockId)));
}
