import { describe, expect, it } from "vitest";
import { projectOutput } from "../src/outputProjection";
import { setBlockOnlyState } from "../src/outputProfiles";
import { ArborOutputProfile, ArborOutputState, BranchTreeMetadata } from "../src/types";

function tree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "# Document title\n\n",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "chosen", parentId: "root", order: 0, content: "Chosen", after: "\n\n" },
      { id: "nested", parentId: "chosen", order: 0, content: "Nested", after: "\n\n" },
      { id: "hidden", parentId: "root", order: 1, content: "Hidden", after: "\n\n" },
      { id: "other", parentId: null, order: 1, content: "Other", after: "" }
    ]
  };
}

function outputState(profile: ArborOutputProfile): ArborOutputState {
  return { version: 1, activeProfileId: profile.id, profiles: [profile] };
}

describe("output projection", () => {
  it("projects included and excluded blocks in depth-first order with the prefix", () => {
    const metadata = tree();
    const state = outputState({
      id: "draft",
      name: "Draft",
      rules: [
        { blockId: "hidden", state: "exclude" },
        { blockId: "other", state: "exclude" }
      ]
    });

    const projection = projectOutput(metadata, state);

    expect(projection.prefix).toBe("# Document title\n\n");
    expect(projection.profile).toEqual({ id: "draft", name: "Draft" });
    expect(projection.entries.map((entry) => entry.block.id)).toEqual([
      "root",
      "chosen",
      "nested",
      "hidden",
      "other"
    ]);
    expect(projection.included.map((entry) => entry.block.id)).toEqual(["root", "chosen", "nested"]);
    expect(projection.excluded.map((entry) => entry.block.id)).toEqual(["hidden", "other"]);
    expect(projection.excludedCount).toBe(2);
    expect(projection.included.map((entry) => entry.depth)).toEqual([0, 1, 2]);
  });

  it("keeps included descendants in order when their parent alone is excluded", () => {
    const metadata = tree();
    const base: ArborOutputProfile = { id: "draft", name: "Draft", rules: [] };
    const blockOnly = setBlockOnlyState(metadata, base, "root", "exclude");

    const projection = projectOutput(metadata, outputState(blockOnly));

    expect(projection.excluded.map((entry) => entry.block.id)).toEqual(["root"]);
    expect(projection.included.map((entry) => entry.block.id)).toEqual([
      "chosen",
      "nested",
      "hidden",
      "other"
    ]);
  });

  it("returns frozen cloned entries without mutating the tree or output state", () => {
    const metadata = tree();
    const state = outputState({ id: "draft", name: "Draft", rules: [] });
    const beforeTree = structuredClone(metadata);
    const beforeState = structuredClone(state);

    const projection = projectOutput(metadata, state);

    expect(projection.included[0].block).not.toBe(metadata.blocks[0]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.included)).toBe(true);
    expect(Object.isFrozen(projection.included[0])).toBe(true);
    expect(Object.isFrozen(projection.included[0].block)).toBe(true);
    expect(metadata).toEqual(beforeTree);
    expect(state).toEqual(beforeState);
  });
});
