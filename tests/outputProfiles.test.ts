import { describe, expect, it } from "vitest";
import {
  FULL_OUTPUT_PROFILE_ID,
  createDefaultOutputState,
  createProfile,
  deleteProfile,
  getActiveOutputProfile,
  normalizeOutputState,
  reconcileProfilesAfterTreeChange,
  renameProfile,
  resolveOutputStates,
  setActiveOutputProfile,
  setBlockOnlyState,
  setSubtreeState
} from "../src/outputProfiles";
import {
  addChild,
  deleteBlockAndLiftChildren,
  deleteSubtree,
  duplicateSubtree,
  moveBlockToParentAtIndex
} from "../src/model/tree";
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

function outputState(rules: ArborOutputProfile["rules"]): ArborOutputState {
  return { version: 1, activeProfileId: "draft", profiles: [profile(rules)] };
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

  it("treats whitespace-padded full IDs as the immutable built-in", () => {
    const paddedState: ArborOutputState = {
      version: 1,
      activeProfileId: " full ",
      profiles: [{ id: " full ", name: "Spoof", rules: [{ blockId: "root", state: "exclude" }] }]
    };
    const paddedProfile: ArborOutputProfile = {
      id: " full ",
      name: "Spoof",
      rules: [{ blockId: "root", state: "exclude" }]
    };

    expect(normalizeOutputState(paddedState, sampleTree())).toEqual(createDefaultOutputState());
    expect(getActiveOutputProfile(paddedState)).toEqual({ id: "full", name: "Full tree", rules: [] });
    expect(createProfile(createDefaultOutputState(), " full ", "Draft", sampleTree())).toEqual(createDefaultOutputState());
    expect(renameProfile(paddedState, " full ", "Renamed", sampleTree())).toEqual(createDefaultOutputState());
    expect(deleteProfile(paddedState, " full ", sampleTree())).toEqual(createDefaultOutputState());
    expect(setActiveOutputProfile(createDefaultOutputState(), " full ", sampleTree())).toEqual(createDefaultOutputState());
    expect(setSubtreeState(sampleTree(), paddedProfile, "root", "include")).toEqual({ id: "full", name: "Full tree", rules: [] });
    expect(setBlockOnlyState(sampleTree(), paddedProfile, "root", "include")).toEqual({ id: "full", name: "Full tree", rules: [] });
  });

  it("preserves a moved subtree's effective state under its new parent", () => {
    const before = sampleTree();
    const afterMove = moveBlockToParentAtIndex(before, "other", null, 2);
    const reconciled = reconcileProfilesAfterTreeChange(before, afterMove, outputState([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" }
    ]));

    expect(resolveOutputStates(afterMove, reconciled.profiles[0]).get("other")?.included).toBe(false);
    expect(reconciled.profiles[0].rules).toContainEqual({ blockId: "other", state: "exclude" });
  });

  it("preserves lifted children's effective states after deleting their parent", () => {
    const before = sampleTree();
    const { metadata: afterDelete } = deleteBlockAndLiftChildren(before, "root");
    const reconciled = reconcileProfilesAfterTreeChange(before, afterDelete, outputState([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" }
    ]));
    const resolutions = resolveOutputStates(afterDelete, reconciled.profiles[0]);

    expect(resolutions.get("chosen")?.included).toBe(true);
    expect(resolutions.get("nested")?.included).toBe(true);
    expect(resolutions.get("other")?.included).toBe(false);
    expect(reconciled.profiles[0].rules).toEqual([{ blockId: "other", state: "exclude" }]);
  });

  it("prunes rules for blocks removed by a tree mutation", () => {
    const before = sampleTree();
    const { metadata: afterDelete } = deleteSubtree(before, "chosen");
    const reconciled = reconcileProfilesAfterTreeChange(before, afterDelete, outputState([
      { blockId: "root", state: "exclude" },
      { blockId: "chosen", state: "include" },
      { blockId: "nested", state: "exclude" }
    ]));

    expect(reconciled.profiles[0].rules).toEqual([{ blockId: "root", state: "exclude" }]);
  });

  it("lets genuinely new children inherit their new parent's effective state", () => {
    const before = sampleTree();
    const { metadata: afterAdd, selectedBlockId } = addChild(before, "root");
    const reconciled = reconcileProfilesAfterTreeChange(before, afterAdd, outputState([
      { blockId: "root", state: "exclude" }
    ]));

    expect(resolveOutputStates(afterAdd, reconciled.profiles[0]).get(selectedBlockId)?.included).toBe(false);
    expect(reconciled.profiles[0].rules.some((rule) => rule.blockId === selectedBlockId)).toBe(false);
  });

  it("copies source effective states onto duplicated subtree IDs", () => {
    const before = sampleTree();
    const duplicated = duplicateSubtree(before, "chosen");
    const reconciled = reconcileProfilesAfterTreeChange(
      before,
      duplicated.metadata,
      outputState([
        { blockId: "root", state: "exclude" },
        { blockId: "chosen", state: "include" }
      ]),
      duplicated.duplicateMap
    );
    const duplicateChildId = Object.entries(duplicated.duplicateMap ?? {})
      .find(([, sourceId]) => sourceId === "nested")?.[0];
    const resolutions = resolveOutputStates(duplicated.metadata, reconciled.profiles[0]);

    expect(duplicated.duplicateMap?.[duplicated.selectedBlockId!]).toBe("chosen");
    expect(resolutions.get(duplicated.selectedBlockId!)?.included).toBe(true);
    expect(resolutions.get(duplicateChildId!)?.included).toBe(true);
    expect(reconciled.profiles[0].rules).toContainEqual({
      blockId: duplicated.selectedBlockId!,
      state: "include"
    });
    expect(reconciled.profiles[0].rules.some((rule) => rule.blockId === duplicateChildId)).toBe(false);
  });
});
