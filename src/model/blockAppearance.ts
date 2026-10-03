import type {
  ArborBlockAppearance,
  ArborBlockColorResolution,
  ArborBlockColorScope,
  BranchBlock,
  BranchTreeMetadata
} from "../types";
import { cloneMetadata } from "./tree";

const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/i;

export function normalizeBlockColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return SIX_DIGIT_HEX.test(normalized) ? normalized.toLowerCase() : null;
}

export function normalizeBlockAppearance(value: unknown): ArborBlockAppearance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const cardColor = normalizeBlockColor(raw.cardColor);
  const branchColor = normalizeBlockColor(raw.branchColor);
  const appearance: ArborBlockAppearance = {};
  if (cardColor) {
    appearance.cardColor = cardColor;
  }
  if (branchColor) {
    appearance.branchColor = branchColor;
  }
  return Object.keys(appearance).length > 0 ? appearance : undefined;
}

function resolveBlockColor(
  block: BranchBlock,
  blockById: ReadonlyMap<string, BranchBlock>,
  blockLimit: number
): ArborBlockColorResolution {
  const ownAppearance = normalizeBlockAppearance(block.appearance);
  if (ownAppearance?.cardColor) {
    return { color: ownAppearance.cardColor, source: "card", ruleBlockId: block.id };
  }
  if (ownAppearance?.branchColor) {
    return { color: ownAppearance.branchColor, source: "branch", ruleBlockId: block.id };
  }

  const visited = new Set<string>([block.id]);
  let parentId = block.parentId;
  let steps = 0;
  while (parentId && steps < blockLimit && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = blockById.get(parentId);
    if (!parent) {
      break;
    }
    const branchColor = normalizeBlockAppearance(parent.appearance)?.branchColor;
    if (branchColor) {
      return { color: branchColor, source: "inherited", ruleBlockId: parent.id };
    }
    parentId = parent.parentId;
    steps += 1;
  }

  return { color: null, source: "theme", ruleBlockId: null };
}

export function resolveBlockColors(metadata: BranchTreeMetadata): Map<string, ArborBlockColorResolution> {
  const blockById = new Map(metadata.blocks.map((block) => [block.id, block]));
  return new Map(metadata.blocks.map((block) => [
    block.id,
    resolveBlockColor(block, blockById, metadata.blocks.length)
  ]));
}

export function setBlockColor(
  metadata: BranchTreeMetadata,
  id: string,
  scope: ArborBlockColorScope,
  color: string | null
): BranchTreeMetadata {
  const normalizedColor = color === null ? null : normalizeBlockColor(color);
  if (color !== null && !normalizedColor) {
    throw new Error("Block colour must be a six-digit hexadecimal value.");
  }
  if (!metadata.blocks.some((block) => block.id === id)) {
    return metadata;
  }

  const next = cloneMetadata(metadata);
  const target = next.blocks.find((block) => block.id === id)!;
  const appearance = normalizeBlockAppearance(target.appearance) ?? {};
  const key = scope === "card" ? "cardColor" : "branchColor";
  if (normalizedColor) {
    appearance[key] = normalizedColor;
    // A branch action includes its parent; leave descendant overrides untouched.
    if (scope === "branch") {
      delete appearance.cardColor;
    }
  } else {
    delete appearance[key];
  }
  if (Object.keys(appearance).length > 0) {
    target.appearance = appearance;
  } else {
    delete target.appearance;
  }
  return next;
}
