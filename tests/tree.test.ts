import { describe, expect, it } from "vitest";
import {
  buildColumnModels,
  buildLinearOrder,
  cloneMetadata,
  deleteBlockAndLiftChildren,
  duplicateSubtree,
  ensureSelectedBlock,
  getPreferredChildBlock,
  moveBlockDown,
  moveBlockRight,
  moveBlockToParentAtIndex
} from "../src/model/tree";
import { BranchTreeMetadata } from "../src/types";

function sampleTree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      { id: "a", parentId: null, order: 0, content: "A", after: "\n\n" },
      { id: "b", parentId: null, order: 1, content: "B", after: "\n\n" },
      { id: "a1", parentId: "a", order: 0, content: "A.1", after: "\n\n" },
      { id: "a2", parentId: "a", order: 1, content: "A.2", after: "\n\n" },
      { id: "a11", parentId: "a1", order: 0, content: "A.1.1", after: "" }
    ]
  };
}

describe("tree operations", () => {
  it("builds active-path columns left to right", () => {
    const columns = buildColumnModels(sampleTree(), "a1", 120);
    expect(columns.map((column) => column.parentId)).toEqual([null, "a", "a1"]);
    expect(columns[0].blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(columns[1].blocks.map((block) => block.id)).toEqual(["a1", "a2"]);
    expect(columns[2].blocks.map((block) => block.id)).toEqual(["a11"]);
  });

  it("keeps selection on the current block and uses middle fallbacks separately", () => {
    expect(ensureSelectedBlock(sampleTree(), null)).toBe("a");
    expect(getPreferredChildBlock(sampleTree(), null)?.id).toBe("a");
    expect(getPreferredChildBlock(sampleTree(), "a")?.id).toBe("a1");
    expect(getPreferredChildBlock(sampleTree(), "a2")).toBeNull();
  });

  it("moves a block across columns without losing descendants", () => {
    const moved = moveBlockToParentAtIndex(sampleTree(), "a1", null, 2);
    const linearOrder = buildLinearOrder(moved).map((block) => block.id);
    expect(linearOrder).toEqual(["a", "a2", "b", "a1", "a11"]);
    expect(moved.blocks.find((block) => block.id === "a11")?.parentId).toBe("a1");
  });

  it("moves right under the previous sibling", () => {
    const moved = moveBlockRight(sampleTree(), "b");
    expect(moved.blocks.find((block) => block.id === "b")?.parentId).toBe("a");
    expect(moved.blocks.find((block) => block.id === "b")?.order).toBe(2);
  });

  it("moves down among siblings deterministically", () => {
    const moved = moveBlockDown(sampleTree(), "a");
    expect(moved.blocks.filter((block) => block.parentId === null).sort((l, r) => l.order - r.order).map((block) => block.id)).toEqual(["b", "a"]);
  });

  it("deletes a block but lifts its children", () => {
    const { metadata } = deleteBlockAndLiftChildren(sampleTree(), "a1");
    const roots = metadata.blocks.filter((block) => block.parentId === null).sort((l, r) => l.order - r.order).map((block) => block.id);
    expect(roots).toEqual(["a", "b"]);
    const childrenOfA = metadata.blocks.filter((block) => block.parentId === "a").sort((l, r) => l.order - r.order).map((block) => block.id);
    expect(childrenOfA).toEqual(["a11", "a2"]);
  });

  it("duplicates an entire subtree and preserves descendant structure", () => {
    const { metadata, selectedBlockId } = duplicateSubtree(sampleTree(), "a1");
    const duplicate = metadata.blocks.find((block) => block.id === selectedBlockId)!;
    const duplicateChildren = metadata.blocks.filter((block) => block.parentId === duplicate.id);
    expect(duplicate.parentId).toBe("a");
    expect(duplicateChildren).toHaveLength(1);
    expect(duplicateChildren[0].content).toBe("A.1.1");
  });

  it("clones metadata before mutation helpers rely on snapshots", () => {
    const original = sampleTree();
    const cloned = cloneMetadata(original);
    cloned.blocks[0].content = "Changed";
    expect(original.blocks[0].content).toBe("A");
  });
});
