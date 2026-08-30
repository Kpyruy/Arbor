export interface BranchCardInteractionInput {
  target: EventTarget | null;
  isActive: boolean;
  clickCount: number;
}

export interface BranchCardInteraction {
  select: boolean;
  edit: boolean;
  preserveDefault: boolean;
}

interface ClosestTarget extends EventTarget {
  closest?: (selector: string) => unknown;
}

function isMarkdownLinkTarget(target: EventTarget | null): boolean {
  const candidate = target as ClosestTarget | null;
  return typeof candidate?.closest === "function" && candidate.closest("a") !== null;
}

export function resolveBranchCardInteraction({
  target,
  isActive,
  clickCount
}: BranchCardInteractionInput): BranchCardInteraction {
  if (isMarkdownLinkTarget(target)) {
    return { select: false, edit: false, preserveDefault: true };
  }

  if (clickCount >= 2) {
    return { select: false, edit: true, preserveDefault: false };
  }

  return { select: !isActive, edit: false, preserveDefault: false };
}
