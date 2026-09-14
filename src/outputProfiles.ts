import { getActivePath, getChildren, getDescendantIds } from "./model/tree";
import {
  ArborOutputProfile,
  ArborOutputResolution,
  ArborOutputRule,
  ArborOutputRuleState,
  ArborOutputState,
  BranchBlockId,
  BranchTreeMetadata
} from "./types";

export const FULL_OUTPUT_PROFILE_ID = "full";

function normalizeProfileId(profileId: string): string {
  return profileId.trim();
}

function fullOutputProfile(): ArborOutputProfile {
  return { id: FULL_OUTPUT_PROFILE_ID, name: "Full tree", rules: [] };
}

function cloneRules(rules: ArborOutputRule[]): ArborOutputRule[] {
  return rules.map((rule) => ({ ...rule }));
}

function isRuleState(value: unknown): value is ArborOutputRuleState {
  return value === "include" || value === "exclude";
}

function buildTreeOrder(metadata: BranchTreeMetadata | undefined): Map<BranchBlockId, number> {
  const order = new Map<BranchBlockId, number>();
  if (!metadata) {
    return order;
  }

  let index = 0;
  const visit = (parentId: BranchBlockId | null) => {
    for (const child of getChildren(metadata, parentId)) {
      order.set(child.id, index);
      index += 1;
      visit(child.id);
    }
  };
  visit(null);
  return order;
}

function cloneProfile(profile: ArborOutputProfile): ArborOutputProfile {
  return { id: profile.id, name: profile.name, rules: cloneRules(profile.rules) };
}

function profileNameKey(name: string): string {
  return name.toLocaleLowerCase();
}

function normalizeRules(
  rules: ArborOutputRule[],
  treeOrder: ReadonlyMap<BranchBlockId, number>,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputRule[] {
  const lastRuleByBlockId = new Map<BranchBlockId, ArborOutputRule>();
  for (const rule of rules) {
    if (!rule || typeof rule.blockId !== "string" || !isRuleState(rule.state)) {
      continue;
    }
    if (validBlockIds && !validBlockIds.has(rule.blockId)) {
      continue;
    }
    lastRuleByBlockId.set(rule.blockId, { blockId: rule.blockId, state: rule.state });
  }

  return [...lastRuleByBlockId.values()].sort((left, right) => {
    const leftOrder = treeOrder.get(left.blockId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = treeOrder.get(right.blockId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.blockId.localeCompare(right.blockId);
  });
}

function validTreeBlockIds(metadata: BranchTreeMetadata): Set<BranchBlockId> {
  return new Set(metadata.blocks.map((block) => block.id));
}

function normalizeProfile(profile: ArborOutputProfile, metadata: BranchTreeMetadata): ArborOutputProfile {
  const state = normalizeOutputState(
    { version: 1, activeProfileId: profile.id, profiles: [profile] },
    metadata,
    validTreeBlockIds(metadata)
  );
  return state.profiles[0] ?? cloneProfile(profile);
}

function withRules(profile: ArborOutputProfile, rules: ArborOutputRule[]): ArborOutputProfile {
  return { id: profile.id, name: profile.name, rules };
}

function buildProfileFromDesiredStates(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  desiredStates: ReadonlyMap<BranchBlockId, boolean>
): ArborOutputProfile {
  if (normalizeProfileId(profile.id) === FULL_OUTPUT_PROFILE_ID) {
    return fullOutputProfile();
  }

  const normalized = normalizeProfile(profile, metadata);
  const rules: ArborOutputRule[] = [];
  const visit = (parentId: BranchBlockId | null, inheritedIncluded: boolean) => {
    for (const block of getChildren(metadata, parentId)) {
      const included = desiredStates.get(block.id) ?? inheritedIncluded;
      if (included !== inheritedIncluded) {
        rules.push({
          blockId: block.id,
          state: included ? "include" : "exclude"
        });
      }
      visit(block.id, included);
    }
  };

  visit(null, true);
  return normalizeProfile(withRules(normalized, rules), metadata);
}

export function createDefaultOutputState(): ArborOutputState {
  return { version: 1, activeProfileId: FULL_OUTPUT_PROFILE_ID, profiles: [] };
}

export function normalizeOutputState(
  state: ArborOutputState,
  metadata?: BranchTreeMetadata,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputState {
  const treeOrder = buildTreeOrder(metadata);
  const profiles: ArborOutputProfile[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const profile of state.profiles) {
    if (!profile || typeof profile.id !== "string") {
      continue;
    }
    const id = normalizeProfileId(profile.id);
    if (id === FULL_OUTPUT_PROFILE_ID) {
      continue;
    }
    const name = typeof profile.name === "string" ? profile.name.trim() : "";
    const nameKey = profileNameKey(name);
    if (!id || !name || seenIds.has(id) || seenNames.has(nameKey)) {
      continue;
    }

    seenIds.add(id);
    seenNames.add(nameKey);
    profiles.push({
      id,
      name,
      rules: normalizeRules(profile.rules ?? [], treeOrder, validBlockIds)
    });
  }

  const normalizedActiveProfileId = typeof state.activeProfileId === "string"
    ? normalizeProfileId(state.activeProfileId)
    : "";
  const activeProfileId = normalizedActiveProfileId === FULL_OUTPUT_PROFILE_ID || seenIds.has(normalizedActiveProfileId)
    ? normalizedActiveProfileId
    : FULL_OUTPUT_PROFILE_ID;

  return { version: 1, activeProfileId, profiles };
}

export function getActiveOutputProfile(state: ArborOutputState): ArborOutputProfile {
  const activeProfileId = normalizeProfileId(state.activeProfileId);
  if (activeProfileId === FULL_OUTPUT_PROFILE_ID) {
    return fullOutputProfile();
  }

  const profile = state.profiles.find((candidate) => candidate.id === activeProfileId);
  return profile ? cloneProfile(profile) : fullOutputProfile();
}

export function resolveOutputStates(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): Map<BranchBlockId, ArborOutputResolution> {
  const rules = new Map(profile.rules.map((rule) => [rule.blockId, rule]));
  const resolved = new Map<BranchBlockId, ArborOutputResolution>();

  const visit = (parentId: BranchBlockId | null, parent: ArborOutputResolution | null) => {
    for (const block of getChildren(metadata, parentId)) {
      const rule = rules.get(block.id);
      const resolution: ArborOutputResolution = rule
        ? {
            included: rule.state === "include",
            source: "direct",
            ruleBlockId: block.id
          }
        : parent?.ruleBlockId
          ? {
              included: parent.included,
              source: "inherited",
              ruleBlockId: parent.ruleBlockId
            }
          : { included: true, source: "default", ruleBlockId: null };
      resolved.set(block.id, resolution);
      visit(block.id, resolution);
    }
  };

  visit(null, null);
  return resolved;
}

export function createProfile(
  state: ArborOutputState,
  profileId: string,
  name: string,
  metadata?: BranchTreeMetadata,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputState {
  const normalized = normalizeOutputState(state, metadata, validBlockIds);
  const normalizedId = normalizeProfileId(profileId);
  const normalizedName = name.trim();
  if (
    !normalizedId ||
    normalizedId === FULL_OUTPUT_PROFILE_ID ||
    !normalizedName ||
    normalized.profiles.some((profile) => profile.id === normalizedId) ||
    normalized.profiles.some((profile) => profileNameKey(profile.name) === profileNameKey(normalizedName))
  ) {
    return normalized;
  }

  const active = getActiveOutputProfile(normalized);
  return normalizeOutputState({
    ...normalized,
    profiles: [...normalized.profiles, { id: normalizedId, name: normalizedName, rules: cloneRules(active.rules) }]
  }, metadata, validBlockIds);
}

export function renameProfile(
  state: ArborOutputState,
  profileId: string,
  name: string,
  metadata?: BranchTreeMetadata,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputState {
  const normalized = normalizeOutputState(state, metadata, validBlockIds);
  const normalizedProfileId = normalizeProfileId(profileId);
  const normalizedName = name.trim();
  if (
    normalizedProfileId === FULL_OUTPUT_PROFILE_ID ||
    !normalizedName ||
    normalized.profiles.some((profile) => profile.id !== normalizedProfileId && profileNameKey(profile.name) === profileNameKey(normalizedName))
  ) {
    return normalized;
  }

  return normalizeOutputState({
    ...normalized,
    profiles: normalized.profiles.map((profile) => profile.id === normalizedProfileId ? { ...profile, name: normalizedName } : profile)
  }, metadata, validBlockIds);
}

export function deleteProfile(
  state: ArborOutputState,
  profileId: string,
  metadata?: BranchTreeMetadata,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputState {
  const normalized = normalizeOutputState(state, metadata, validBlockIds);
  const normalizedProfileId = normalizeProfileId(profileId);
  if (normalizedProfileId === FULL_OUTPUT_PROFILE_ID) {
    return normalized;
  }

  return normalizeOutputState({
    ...normalized,
    activeProfileId: normalized.activeProfileId === normalizedProfileId ? FULL_OUTPUT_PROFILE_ID : normalized.activeProfileId,
    profiles: normalized.profiles.filter((profile) => profile.id !== normalizedProfileId)
  }, metadata, validBlockIds);
}

export function setActiveOutputProfile(
  state: ArborOutputState,
  profileId: string,
  metadata?: BranchTreeMetadata,
  validBlockIds?: ReadonlySet<BranchBlockId>
): ArborOutputState {
  return normalizeOutputState({ ...state, activeProfileId: profileId }, metadata, validBlockIds);
}

export function setSubtreeState(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  blockId: BranchBlockId,
  state: ArborOutputRuleState
): ArborOutputProfile {
  if (normalizeProfileId(profile.id) === FULL_OUTPUT_PROFILE_ID) {
    return fullOutputProfile();
  }
  if (!metadata.blocks.some((block) => block.id === blockId)) {
    return cloneProfile(profile);
  }

  const normalized = normalizeProfile(profile, metadata);
  const descendantIds = new Set(getDescendantIds(metadata, blockId));
  return normalizeProfile(withRules(normalized, [
    ...normalized.rules.filter((rule) => rule.blockId !== blockId && !descendantIds.has(rule.blockId)),
    { blockId, state }
  ]), metadata);
}

export function setBlockOnlyState(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  blockId: BranchBlockId,
  state: ArborOutputRuleState
): ArborOutputProfile {
  if (normalizeProfileId(profile.id) === FULL_OUTPUT_PROFILE_ID) {
    return fullOutputProfile();
  }
  if (!metadata.blocks.some((block) => block.id === blockId)) {
    return cloneProfile(profile);
  }

  const normalized = normalizeProfile(profile, metadata);
  const before = resolveOutputStates(metadata, normalized);
  const changed = withRules(normalized, [
    ...normalized.rules.filter((rule) => rule.blockId !== blockId),
    { blockId, state }
  ]);
  const changedResolutions = resolveOutputStates(metadata, changed);
  const childOverrides = getChildren(metadata, blockId).flatMap((child) => {
    const prior = before.get(child.id);
    const current = changedResolutions.get(child.id);
    if (!prior || !current || prior.included === current.included) {
      return [];
    }
    return [{ blockId: child.id, state: prior.included ? "include" : "exclude" } satisfies ArborOutputRule];
  });

  return normalizeProfile(withRules(changed, [...changed.rules, ...childOverrides]), metadata);
}

export function includeAll(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): ArborOutputProfile {
  const desiredStates = new Map(metadata.blocks.map((block) => [block.id, true]));
  return buildProfileFromDesiredStates(metadata, profile, desiredStates);
}

export function excludeAll(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): ArborOutputProfile {
  const desiredStates = new Map(metadata.blocks.map((block) => [block.id, false]));
  return buildProfileFromDesiredStates(metadata, profile, desiredStates);
}

export function invertSelection(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): ArborOutputProfile {
  const normalized = normalizeProfileId(profile.id) === FULL_OUTPUT_PROFILE_ID
    ? fullOutputProfile()
    : normalizeProfile(profile, metadata);
  if (normalized.id === FULL_OUTPUT_PROFILE_ID) {
    return normalized;
  }

  const current = resolveOutputStates(metadata, normalized);
  const desiredStates = new Map(
    metadata.blocks.map((block) => [block.id, !(current.get(block.id)?.included ?? true)])
  );
  return buildProfileFromDesiredStates(metadata, normalized, desiredStates);
}

export function includeOnlySelectedBranch(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  selectedBlockId: BranchBlockId
): ArborOutputProfile {
  if (normalizeProfileId(profile.id) === FULL_OUTPUT_PROFILE_ID) {
    return fullOutputProfile();
  }
  if (!metadata.blocks.some((block) => block.id === selectedBlockId)) {
    return normalizeProfile(profile, metadata);
  }

  const includedIds = new Set<BranchBlockId>([
    ...getActivePath(metadata, selectedBlockId).map((block) => block.id),
    ...getDescendantIds(metadata, selectedBlockId)
  ]);
  const desiredStates = new Map(metadata.blocks.map((block) => [block.id, includedIds.has(block.id)]));
  return buildProfileFromDesiredStates(metadata, profile, desiredStates);
}

export function rootBlocksOnly(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): ArborOutputProfile {
  const desiredStates = new Map(metadata.blocks.map((block) => [block.id, block.parentId === null]));
  return buildProfileFromDesiredStates(metadata, profile, desiredStates);
}

export function resetProfile(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile
): ArborOutputProfile {
  return includeAll(metadata, profile);
}

export function reconcileProfilesAfterTreeChange(
  before: BranchTreeMetadata,
  after: BranchTreeMetadata,
  state: ArborOutputState,
  duplicateMap: Readonly<Record<BranchBlockId, BranchBlockId>> = {}
): ArborOutputState {
  const beforeBlockIds = validTreeBlockIds(before);
  const afterBlockIds = validTreeBlockIds(after);
  const normalized = normalizeOutputState(state, before, beforeBlockIds);

  const profiles = normalized.profiles.map((profile) => {
    const priorResolutions = resolveOutputStates(before, profile);
    const rules: ArborOutputRule[] = [];

    const visit = (parentId: BranchBlockId | null, inheritedIncluded: boolean) => {
      for (const block of getChildren(after, parentId)) {
        const sourceId = priorResolutions.has(block.id) ? block.id : duplicateMap[block.id];
        const desiredIncluded = sourceId === undefined
          ? inheritedIncluded
          : priorResolutions.get(sourceId)?.included ?? inheritedIncluded;

        if (desiredIncluded !== inheritedIncluded) {
          rules.push({
            blockId: block.id,
            state: desiredIncluded ? "include" : "exclude"
          });
        }

        visit(block.id, desiredIncluded);
      }
    };

    visit(null, true);
    return withRules(profile, rules);
  });

  return normalizeOutputState({ ...normalized, profiles }, after, afterBlockIds);
}
