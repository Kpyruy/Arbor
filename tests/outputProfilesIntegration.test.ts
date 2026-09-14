import { describe, expect, it } from "vitest";
import { BranchHistory } from "../src/history";
import {
  cloneMetadata,
  deleteBlockAndLiftChildren,
  duplicateSubtree,
  getBlock,
  moveBlockToParentAtIndex,
  updateBlockContent
} from "../src/model/tree";
import {
  createDefaultOutputState,
  getActiveOutputProfile,
  reconcileProfilesAfterTreeChange,
  resolveOutputStates,
  setActiveOutputProfile,
  setBlockOnlyState,
  setSubtreeState
} from "../src/outputProfiles";
import { projectOutput } from "../src/outputProjection";
import { buildCleanExportDocument } from "../src/storage/cleanExport";
import { buildBranchDocument, parseBranchDocument } from "../src/storage/document";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { buildStructureBlock, linearizeTree, normalizeMetadata } from "../src/storage/serializer";
import {
  ArborOutputProfile,
  ArborOutputState,
  BranchHistoryEntry,
  BranchTreeMetadata
} from "../src/types";

const richMarkdown = [
  "# Корінь 🌳",
  "",
  "Paragraph with [[Wiki page]], ![[asset.png]] and <!-- a user comment -->.",
  "",
  "> [!note] Callout",
  "> Keep **formatting**.",
  "",
  "```ts",
  "const token = '--';",
  "```"
].join("\n");

function treeFixture(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "Project preface\n\n",
    blocks: [
      { id: "корінь", parentId: null, order: 0, content: richMarkdown, after: "\n\n" },
      { id: "обране", parentId: "корінь", order: 0, content: "Chosen branch", after: "\n\n" },
      { id: "альтернатива", parentId: "корінь", order: 1, content: "Alternative", after: "\n\n" },
      { id: "глибоко", parentId: "альтернатива", order: 0, content: "Nested alternative", after: "\n\n" },
      { id: "другий-root", parentId: null, order: 1, content: "# Second root", after: "" }
    ]
  };
}

function initialOutputState(): ArborOutputState {
  return {
    version: 1,
    activeProfileId: "full",
    profiles: [
      { id: "draft", name: "Draft", rules: [] },
      {
        id: "short",
        name: "Short version",
        rules: [{ blockId: "альтернатива", state: "exclude" }]
      }
    ]
  };
}

function snapshot(
  label: string,
  metadata: BranchTreeMetadata,
  outputState: ArborOutputState,
  selectedBlockId: string | null
): BranchHistoryEntry {
  return {
    label,
    metadata: cloneMetadata(metadata),
    outputState: structuredClone(outputState),
    selectedBlockId
  };
}

function replaceActiveProfile(
  state: ArborOutputState,
  profile: ArborOutputProfile
): ArborOutputState {
  return {
    ...state,
    profiles: state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate)
  };
}

function effectiveStates(metadata: BranchTreeMetadata, state: ArborOutputState): Record<string, boolean> {
  return Object.fromEntries(
    [...resolveOutputStates(metadata, getActiveOutputProfile(state))]
      .map(([blockId, resolution]) => [blockId, resolution.included])
  );
}

function blockTopology(metadata: BranchTreeMetadata): Array<{
  id: string;
  parentId: string | null;
  order: number;
  content: string;
}> {
  return metadata.blocks.map(({ id, parentId, order, content }) => ({ id, parentId, order, content }));
}

describe("Output Profiles integrated lifecycle", () => {
  it("preserves content, topology and effective output through mutations, history and storage", () => {
    const frontmatter = "---\ntags: [Arbor]\n---\n";
    const sourceTree = treeFixture();
    const note = buildBranchDocument(
      frontmatter,
      linearizeTree(sourceTree).body,
      sourceTree,
      initialOutputState()
    );
    const loaded = loadImportedBranchDocument(note);
    const history = new BranchHistory();
    let metadata = loaded.metadata;
    let outputState = setActiveOutputProfile(loaded.outputState, "draft", metadata);
    let selectedBlockId: string | null = "обране";

    expect(history.canUndo()).toBe(false);
    expect(outputState.activeProfileId).toBe("draft");
    expect(effectiveStates(metadata, outputState)).toEqual({
      "корінь": true,
      "обране": true,
      "альтернатива": true,
      "глибоко": true,
      "другий-root": true
    });

    history.push("Exclude root only", metadata, outputState, selectedBlockId);
    outputState = replaceActiveProfile(
      outputState,
      setBlockOnlyState(metadata, getActiveOutputProfile(outputState), "корінь", "exclude")
    );
    expect(effectiveStates(metadata, outputState)).toEqual({
      "корінь": false,
      "обране": true,
      "альтернатива": true,
      "глибоко": true,
      "другий-root": true
    });
    history.push("Exclude alternative subtree", metadata, outputState, selectedBlockId);
    outputState = replaceActiveProfile(
      outputState,
      setSubtreeState(metadata, getActiveOutputProfile(outputState), "альтернатива", "exclude")
    );
    expect(effectiveStates(metadata, outputState)).toEqual({
      "корінь": false,
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true
    });

    history.push("Duplicate chosen subtree", metadata, outputState, selectedBlockId);
    const duplicated = duplicateSubtree(metadata, "обране");
    const beforeDuplicate = metadata;
    metadata = duplicated.metadata;
    outputState = reconcileProfilesAfterTreeChange(
      beforeDuplicate,
      metadata,
      outputState,
      duplicated.duplicateMap
    );
    selectedBlockId = duplicated.selectedBlockId;
    if (!selectedBlockId) {
      throw new Error("Expected duplicateSubtree to select the duplicated block.");
    }
    const duplicateBlockId = selectedBlockId;
    expect(selectedBlockId).not.toBe("обране");
    expect(getBlock(metadata, selectedBlockId)).toMatchObject({
      parentId: "корінь",
      order: 1,
      content: "Chosen branch"
    });
    expect(effectiveStates(metadata, outputState)).toEqual({
      "корінь": false,
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });

    history.push("Move duplicate", metadata, outputState, selectedBlockId);
    const beforeMove = metadata;
    metadata = moveBlockToParentAtIndex(metadata, selectedBlockId, "другий-root", 0);
    outputState = reconcileProfilesAfterTreeChange(beforeMove, metadata, outputState);
    expect(getBlock(metadata, selectedBlockId)).toMatchObject({
      parentId: "другий-root",
      order: 0,
      content: "Chosen branch"
    });
    expect(effectiveStates(metadata, outputState)).toEqual({
      "корінь": false,
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });

    history.push("Delete root and lift children", metadata, outputState, selectedBlockId);
    const beforeDelete = metadata;
    const deleted = deleteBlockAndLiftChildren(metadata, "корінь");
    metadata = deleted.metadata;
    outputState = reconcileProfilesAfterTreeChange(beforeDelete, metadata, outputState);
    selectedBlockId = deleted.selectedBlockId;
    const deletedSnapshot = snapshot("Deleted", metadata, outputState, selectedBlockId);
    expect(getBlock(metadata, "корінь")).toBeNull();
    expect(getBlock(metadata, "обране")?.parentId).toBeNull();
    expect(getBlock(metadata, "альтернатива")?.parentId).toBeNull();
    expect(getBlock(metadata, "глибоко")?.content).toBe("Nested alternative");
    expect(blockTopology(metadata)).toEqual([
      { id: "обране", parentId: null, order: 0, content: "Chosen branch" },
      { id: "альтернатива", parentId: null, order: 1, content: "Alternative" },
      { id: "глибоко", parentId: "альтернатива", order: 0, content: "Nested alternative" },
      { id: "другий-root", parentId: null, order: 2, content: "# Second root" },
      { id: duplicateBlockId, parentId: "другий-root", order: 0, content: "Chosen branch" }
    ]);
    expect(effectiveStates(metadata, outputState)).toEqual({
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });

    const expectedBeforeDeleteTopology = [
      { id: "корінь", parentId: null, order: 0, content: richMarkdown },
      { id: "обране", parentId: "корінь", order: 0, content: "Chosen branch" },
      { id: "альтернатива", parentId: "корінь", order: 1, content: "Alternative" },
      { id: "глибоко", parentId: "альтернатива", order: 0, content: "Nested alternative" },
      { id: "другий-root", parentId: null, order: 1, content: "# Second root" },
      { id: duplicateBlockId, parentId: "другий-root", order: 0, content: "Chosen branch" }
    ];

    const beforeDeleteSnapshot = history.undo(deletedSnapshot);
    expect(beforeDeleteSnapshot).not.toBeNull();
    expect(getBlock(beforeDeleteSnapshot!.metadata, "корінь")?.content).toBe(richMarkdown);
    expect(beforeDeleteSnapshot!.outputState.activeProfileId).toBe("draft");
    expect(blockTopology(beforeDeleteSnapshot!.metadata)).toEqual(expectedBeforeDeleteTopology);
    expect(effectiveStates(beforeDeleteSnapshot!.metadata, beforeDeleteSnapshot!.outputState)).toEqual({
      "корінь": false,
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });
    const redone = history.redo(beforeDeleteSnapshot!);
    expect(redone).not.toBeNull();
    metadata = redone!.metadata;
    outputState = redone!.outputState;
    selectedBlockId = redone!.selectedBlockId;
    expect(metadata).toEqual(deletedSnapshot.metadata);
    expect(outputState.activeProfileId).toBe("draft");
    expect(blockTopology(metadata)).toEqual([
      { id: "обране", parentId: null, order: 0, content: "Chosen branch" },
      { id: "альтернатива", parentId: null, order: 1, content: "Alternative" },
      { id: "глибоко", parentId: "альтернатива", order: 0, content: "Nested alternative" },
      { id: "другий-root", parentId: null, order: 2, content: "# Second root" },
      { id: duplicateBlockId, parentId: "другий-root", order: 0, content: "Chosen branch" }
    ]);
    expect(effectiveStates(metadata, outputState)).toEqual({
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });
    expect(effectiveStates(metadata, outputState)).toEqual(
      effectiveStates(deletedSnapshot.metadata, deletedSnapshot.outputState)
    );

    const saved = buildBranchDocument(
      frontmatter,
      linearizeTree(metadata).body,
      metadata,
      outputState
    );
    const reparsed = parseBranchDocument(saved);
    const reloaded = loadImportedBranchDocument(saved);
    expect(reparsed.frontmatter).toBe(frontmatter);
    expect(reparsed.outputState).toEqual(outputState);
    expect(reparsed.outputState.activeProfileId).toBe("draft");
    expect(reparsed.body).toContain("Chosen branch");
    expect(reparsed.body).toContain("Nested alternative");
    expect(reloaded.metadata.prefix).toBe(metadata.prefix);
    expect(blockTopology(reloaded.metadata)).toEqual([
      { id: "обране", parentId: null, order: 0, content: "Chosen branch" },
      { id: "альтернатива", parentId: null, order: 1, content: "Alternative" },
      { id: "глибоко", parentId: "альтернатива", order: 0, content: "Nested alternative" },
      { id: "другий-root", parentId: null, order: 2, content: "# Second root" },
      { id: duplicateBlockId, parentId: "другий-root", order: 0, content: "Chosen branch" }
    ]);
    expect(effectiveStates(reloaded.metadata, reloaded.outputState)).toEqual({
      "обране": true,
      "альтернатива": false,
      "глибоко": false,
      "другий-root": true,
      [duplicateBlockId]: true
    });
    expect(selectedBlockId && getBlock(reloaded.metadata, selectedBlockId)).not.toBeNull();
  });

  it("keeps old, invalid and rich-profile notes compatible", () => {
    const metadata = treeFixture();
    const oldNote = buildBranchDocument("", linearizeTree(metadata).body, metadata);
    expect(oldNote).not.toContain("arbor:output");
    expect(parseBranchDocument(oldNote).outputState).toEqual(createDefaultOutputState());

    const malformedOutput = [
      "%% arbor:output",
      "```json",
      '{"arbor-plugin":"output","version":1,"active":"missing","profiles":[]}',
      "```",
      "%%"
    ].join("\n");
    const invalidNote = [linearizeTree(metadata).body, malformedOutput, buildStructureBlock(metadata)].join("\n\n");
    const invalid = loadImportedBranchDocument(invalidNote);
    const changed = normalizeMetadata(updateBlockContent(invalid.metadata, "обране", "Changed safely"));
    const savedInvalid = buildBranchDocument("", linearizeTree(changed).body, changed, invalid.outputState, invalid.outputRaw);
    expect(savedInvalid.split(malformedOutput)).toHaveLength(2);
    expect(parseBranchDocument(savedInvalid).outputRaw).toBe(malformedOutput);
    expect(savedInvalid).toContain("Changed safely");

    const state = setActiveOutputProfile(initialOutputState(), "short", metadata);
    const projection = projectOutput(metadata, state);
    const exported = buildCleanExportDocument("", metadata, state, {
      frontmatter: "omit",
      excluded: "omit"
    });
    const expected = (
      projection.prefix +
      projection.included.map((entry) => entry.block.content + entry.block.after).join("")
    ).trimEnd();
    expect(exported).toBe(expected);
    expect(exported).toContain("[[Wiki page]]");
    expect(exported).not.toContain("Alternative");
  });
});
