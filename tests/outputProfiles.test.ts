import { describe, expect, it } from "vitest";
import {
  FULL_OUTPUT_PROFILE_ID,
  createDefaultOutputState,
  createProfile,
  deleteProfile,
  getActiveOutputProfile,
  normalizeOutputState,
  renameProfile,
  resolveOutputStates,
  setActiveOutputProfile,
  setBlockOnlyState,
  setSubtreeState
} from "../src/outputProfiles";
import { ArborOutputProfile, ArborOutputState, BranchTreeMetadata } from "../src/types";

function sampleTree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "sibling", parentId: null, order: 1, content: "Sibling", after: "\n\n" },
      { id: "chosen", parentId: "root", order: 0, content: "Chosen", after: "\n\n" },
      { id: "nested", parentId: "chosen", order: 0, content: "Nested", after: "" },
      { id: "other", parentId: "root", order: 1, content: "Other", after: "" }
    ]
  };
}

function profile(rules: ArborOutputProfile["rules"]): ArborOutputProfile {
  return { id: "draft", name: "Draft", rules };
}

describe("output profile state", () => {
  it("starts with the immutable full-tree profile active", () => {
    const state = createDefaultOutputState();

    expect(FULL_OUTPUT_PROFILE_ID).toBe("full");
    expect(state).toEqual({ version: 1, activeProfileId: "full", profiles: [] });
    expect(getActiveOutputProfile(state)).toEqual({ id: "full", name: "Full tree", rules: [] });
  });

  it("resolves the nearest explicit rule and otherwise includes root blocks", () => {
    const resolutions = resolveOutputStates(sampleTree(), profile([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" }
    ]));

    expect(resolutions.get("chosen")).toMatchObject({
      included: true,
      source: "direct",
      ruleBlockId: "chosen"
    });
    expect(resolutions.get("nested")).toMatchObject({
      included: true,
      source: "inherited",
      ruleBlockId: "chosen"
    });
    expect(resolutions.get("other")).toMatchObject({
      included: false,
      source: "inherited",
      ruleBlockId: "root"
    });
    expect(resolutions.get("sibling")).toEqual({
      included: true,
      source: "default",
      ruleBlockId: null
    });
  });

  it("normalizes duplicate profiles and rules into tree order", () => {
    const state: ArborOutputState = {
      version: 1,
      activeProfileId: "missing",
      profiles: [
        profile([
          { blockId: "other", state: "include" },
          { blockId: "chosen", state: "exclude" },
          { blockId: "other", state: "exclude" },
          { blockId: "unknown", state: "include" }
        ]),
        { id: "draft", name: "Other", rules: [] },
        { id: "final", name: " draft ", rules: [] },
        { id: "full", name: "Attempted built-in", rules: [{ blockId: "root", state: "exclude" }] }
      ]
    };

    expect(normalizeOutputState(state, sampleTree(), new Set(["root", "sibling", "chosen", "nested", "other"]))).toEqual({
      version: 1,
      activeProfileId: "full",
      profiles: [{
        id: "draft",
        name: "Draft",
        rules: [
          { blockId: "chosen", state: "exclude" },
          { blockId: "other", state: "exclude" }
        ]
      }]
    });
  });

  it("creates a profile from active rules and keeps names unique without case", () => {
    const initial: ArborOutputState = {
      version: 1,
      activeProfileId: "draft",
      profiles: [profile([{ blockId: "root", state: "exclude" }])]
    };

    const created = createProfile(initial, "final", "Final", sampleTree());
    const renamed = renameProfile(created, "final", "  DRAFT  ", sampleTree());

    expect(created.profiles.find((item) => item.id === "final")).toEqual({
      id: "final",
      name: "Final",
      rules: [{ blockId: "root", state: "exclude" }]
    });
    expect(renamed).toEqual(created);
  });

  it("does not create duplicate profile IDs and falls back to full after deleting the active profile", () => {
    const created = createProfile(createDefaultOutputState(), "draft", "Draft", sampleTree());
    const duplicate = createProfile(created, "draft", "Another", sampleTree());
    const active = setActiveOutputProfile(duplicate, "draft", sampleTree());
    const deleted = deleteProfile(active, "draft", sampleTree());

    expect(duplicate).toEqual(created);
    expect(deleted).toEqual(createDefaultOutputState());
  });

  it("keeps direct children at their effective states when a block-only rule changes", () => {
    const changed = setBlockOnlyState(sampleTree(), profile([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" }
    ]), "root", "include");
    const resolutions = resolveOutputStates(sampleTree(), changed);

    expect(changed.rules).toEqual([
      { blockId: "root", state: "include" },
      { blockId: "chosen", state: "include" },
      { blockId: "other", state: "exclude" }
    ]);
    expect(resolutions.get("chosen")?.included).toBe(true);
    expect(resolutions.get("nested")?.included).toBe(true);
    expect(resolutions.get("other")?.included).toBe(false);
  });

  it("sets one subtree rule and drops all descendant rules", () => {
    const changed = setSubtreeState(sampleTree(), profile([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" },
      { blockId: "nested", state: "exclude" }
    ]), "chosen", "exclude");

    expect(changed.rules).toEqual([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "exclude" }
    ]);
  });

  it("never mutates the built-in full-tree profile", () => {
    const full = getActiveOutputProfile(createDefaultOutputState());
    const forgedFull: ArborOutputProfile = {
      id: FULL_OUTPUT_PROFILE_ID,
      name: "Changed",
      rules: [{ blockId: "root", state: "exclude" }]
    };

    expect(setSubtreeState(sampleTree(), full, "root", "exclude")).toEqual(full);
    expect(setBlockOnlyState(sampleTree(), full, "root", "exclude")).toEqual(full);
    expect(setSubtreeState(sampleTree(), forgedFull, "root", "exclude")).toEqual(full);
    expect(setBlockOnlyState(sampleTree(), forgedFull, "root", "exclude")).toEqual(full);
  });
});
