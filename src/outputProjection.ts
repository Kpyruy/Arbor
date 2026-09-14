import { getChildren } from "./model/tree";
import { getActiveOutputProfile, resolveOutputStates } from "./outputProfiles";
import {
  ArborOutputProjection,
  ArborOutputProjectionEntry,
  ArborOutputResolution,
  ArborOutputState,
  BranchBlock,
  BranchBlockId,
  BranchTreeMetadata
} from "./types";

function cloneFrozenBlock(block: BranchBlock): Readonly<BranchBlock> {
  return Object.freeze({ ...block });
}

function cloneFrozenResolution(
  resolution: ArborOutputResolution
): Readonly<ArborOutputResolution> {
  return Object.freeze({ ...resolution });
}

export function projectOutput(
  metadata: BranchTreeMetadata,
  state: ArborOutputState
): ArborOutputProjection {
  const activeProfile = getActiveOutputProfile(state);
  const resolutions = resolveOutputStates(metadata, activeProfile);
  const included: ArborOutputProjectionEntry[] = [];
  const excluded: ArborOutputProjectionEntry[] = [];

  const visit = (parentId: BranchBlockId | null, depth: number) => {
    for (const block of getChildren(metadata, parentId)) {
      const resolution = resolutions.get(block.id) ?? {
        included: true,
        source: "default",
        ruleBlockId: null
      } satisfies ArborOutputResolution;
      const entry = Object.freeze({
        block: cloneFrozenBlock(block),
        resolution: cloneFrozenResolution(resolution),
        depth
      });
      (resolution.included ? included : excluded).push(entry);
      visit(block.id, depth + 1);
    }
  };

  visit(null, 0);
  const frozenIncluded = Object.freeze(included);
  const frozenExcluded = Object.freeze(excluded);
  return Object.freeze({
    prefix: metadata.prefix,
    profile: Object.freeze({ id: activeProfile.id, name: activeProfile.name }),
    included: frozenIncluded,
    excluded: frozenExcluded,
    excludedCount: frozenExcluded.length
  });
}
