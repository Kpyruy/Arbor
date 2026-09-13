import { OUTPUT_MARKER } from "../constants";
import { createDefaultOutputState, FULL_OUTPUT_PROFILE_ID, normalizeOutputState } from "../outputProfiles";
import { ArborOutputProfile, ArborOutputRule, ArborOutputState } from "../types";

export { OUTPUT_MARKER };

export type ParsedOutputBlock =
  | { ok: true; state: ArborOutputState }
  | { ok: false; error: string; raw: string };

type StoredOutputProfile = {
  id: string;
  name: string;
  rules: ArborOutputRule[];
};

type StoredOutputState = {
  "arbor-plugin": "output";
  version: 1;
  active: string;
  profiles: StoredOutputProfile[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function invalid(raw: string, error: string): ParsedOutputBlock {
  return { ok: false, error, raw };
}

function parseRule(value: unknown): ArborOutputRule | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["blockId", "state"])) {
    return null;
  }

  if (typeof value.blockId !== "string" || value.blockId.trim().length === 0) {
    return null;
  }
  if (value.state !== "include" && value.state !== "exclude") {
    return null;
  }

  return { blockId: value.blockId, state: value.state };
}

function parseProfile(value: unknown): StoredOutputProfile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "rules"])) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    value.id.trim() === FULL_OUTPUT_PROFILE_ID ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    !Array.isArray(value.rules)
  ) {
    return null;
  }

  const seenRuleBlockIds = new Set<string>();
  const rules: ArborOutputRule[] = [];
  for (const valueRule of value.rules) {
    const rule = parseRule(valueRule);
    if (!rule || seenRuleBlockIds.has(rule.blockId)) {
      return null;
    }
    seenRuleBlockIds.add(rule.blockId);
    rules.push(rule);
  }

  return { id: value.id, name: value.name, rules };
}

function parseState(value: unknown): ArborOutputState | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["arbor-plugin", "version", "active", "profiles"])) {
    return null;
  }
  if (
    value["arbor-plugin"] !== "output" ||
    value.version !== 1 ||
    typeof value.active !== "string" ||
    value.active.trim().length === 0 ||
    !Array.isArray(value.profiles)
  ) {
    return null;
  }

  const profiles: ArborOutputProfile[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const valueProfile of value.profiles) {
    const profile = parseProfile(valueProfile);
    const id = profile?.id.trim();
    const name = profile?.name.trim();
    if (!profile || !id || !name || seenIds.has(id) || seenNames.has(name.toLocaleLowerCase())) {
      return null;
    }
    seenIds.add(id);
    seenNames.add(name.toLocaleLowerCase());
    profiles.push(profile);
  }

  const activeProfileId = value.active.trim();
  if (activeProfileId !== FULL_OUTPUT_PROFILE_ID && !seenIds.has(activeProfileId)) {
    return null;
  }

  return normalizeOutputState({ version: 1, activeProfileId, profiles });
}

export function buildOutputBlock(state: ArborOutputState): string {
  const normalized = normalizeOutputState(state);
  const stored: StoredOutputState = {
    "arbor-plugin": "output",
    version: 1,
    active: normalized.activeProfileId,
    profiles: normalized.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      rules: profile.rules.map((rule) => ({ blockId: rule.blockId, state: rule.state }))
    }))
  };

  return [`%% ${OUTPUT_MARKER}`, "```json", JSON.stringify(stored, null, 2), "```", "%%"].join("\n");
}

export function parseOutputBlock(raw: string): ParsedOutputBlock {
  try {
    const marker = OUTPUT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(new RegExp("^%%\\s*" + marker + "\\s*\\n```json\\n([\\s\\S]*?)\\n```\\n%%$"));
    if (!match?.[1]) {
      return invalid(raw, "Invalid output metadata block.");
    }

    const state = parseState(JSON.parse(match[1]) as unknown);
    return state
      ? { ok: true, state }
      : invalid(raw, "Invalid output metadata schema.");
  } catch {
    return invalid(raw, "Invalid output metadata JSON.");
  }
}

export function isDefaultOutputState(state: ArborOutputState): boolean {
  return state.activeProfileId === FULL_OUTPUT_PROFILE_ID && state.profiles.length === 0 && state.version === createDefaultOutputState().version;
}
