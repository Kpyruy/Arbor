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

function hasClosest(target: EventTarget | null): target is EventTarget & { closest: (selector: string) => unknown } {
  return target !== null && "closest" in target && typeof target.closest === "function";
}

function isMarkdownLinkTarget(target: EventTarget | null): boolean {
  return hasClosest(target) && target.closest("a") !== null;
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
