import { BranchBlock, BranchBlockId } from "./types";

export function resolveNumericChildTarget(
  parentId: BranchBlockId,
  parentBlockId: BranchBlockId | null,
  children: BranchBlock[],
  value: number
): BranchBlockId | null {
  if (value === 0) {
    return parentBlockId;
  }
  if (children.length === 0) {
    return null;
  }
  return children[Math.min(value, children.length) - 1]?.id ?? null;
}
