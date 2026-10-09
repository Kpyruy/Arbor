import { describe, expect, it } from "vitest";
import { BranchHistory } from "../src/history";
import { setActiveOutputProfile } from "../src/outputProfiles";
import { ArborOutputState, BranchHistoryEntry, BranchTreeMetadata } from "../src/types";
import { appendIncomingContent } from "../src/model/ingestContent";
import { fixtureTree, fixtureOutput } from "./helpers/arborFixtures";
import { buildBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { loadImportedBranchDocument } from "../src/storage/reconcile";

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
  it("keeps one same-receiver append snapshot with exact references through undo, redo and reopen", () => {
    const history = new BranchHistory();
    const before = fixtureTree();
    const output = fixtureOutput();
    const markdown = '> quote\n\n[[Books/A.pdf#page=7|Source]]';
    const appended = appendIncomingContent(before, "first", markdown);
    const current: BranchHistoryEntry = { label: "Append incoming content", metadata: appended.metadata, outputState: output, selectedBlockId: "first" };
    history.push(current.label, before, output, "second");
    const previous = history.undo(current)!;
    expect(previous.metadata).toEqual(before);
    expect(previous.selectedBlockId).toBe("second");
    expect(history.canUndo()).toBe(false);
    const next = history.redo(previous)!;
    expect(next).toEqual(current);
    expect(next.metadata.blocks).toHaveLength(before.blocks.length);
    const source = buildBranchDocument("", linearizeTree(next.metadata).body, next.metadata, next.outputState);
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.metadata.blocks.find(block => block.id === "first")?.content).toBe(`First\n\n${markdown}`);
    expect(reopened.outputState).toEqual(output);
    expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(source);
  });
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
