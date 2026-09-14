import { describe, expect, it } from "vitest";
import { BranchHistory } from "../src/history";
import { setActiveOutputProfile } from "../src/outputProfiles";
import { ArborOutputState, BranchHistoryEntry, BranchTreeMetadata } from "../src/types";

function tree(content: string): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [{ id: "root", parentId: null, order: 0, content, after: "" }]
  };
}

function outputState(activeProfileId = "draft"): ArborOutputState {
  return {
    version: 1,
    activeProfileId,
    profiles: [{
      id: "draft",
      name: "Draft",
      rules: [{ blockId: "root", state: "exclude" }]
    }]
  };
}

function snapshot(
  label: string,
  metadata: BranchTreeMetadata,
  state: ArborOutputState
): BranchHistoryEntry {
  return { label, metadata, outputState: state, selectedBlockId: "root" };
}

describe("branch history", () => {
  it("restores cloned tree and output state snapshots through undo and redo", () => {
    const history = new BranchHistory();
    const beforeTree = tree("Before");
    const beforeOutput = outputState();
    const afterTree = tree("After");
    const afterOutput = outputState("full");

    history.push("Tree mutation", beforeTree, beforeOutput, "root");
    beforeTree.blocks[0].content = "Mutated after push";
    beforeOutput.profiles[0].rules[0].state = "include";

    const previous = history.undo(snapshot("Current", afterTree, afterOutput));
    expect(previous?.metadata.blocks[0].content).toBe("Before");
    expect(previous?.outputState).toEqual(outputState());

    afterTree.blocks[0].content = "Mutated after undo";
    afterOutput.profiles[0].rules[0].state = "include";

    const next = history.redo(previous!);
    expect(next?.metadata.blocks[0].content).toBe("After");
    expect(next?.outputState).toEqual(outputState("full"));
  });

  it("does not create history when only the active output profile changes", () => {
    const history = new BranchHistory();
    const switched = setActiveOutputProfile(outputState("full"), "draft", tree("Tree"));

    expect(switched.activeProfileId).toBe("draft");
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
