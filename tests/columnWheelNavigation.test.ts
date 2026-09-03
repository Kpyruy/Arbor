import { describe, expect, it } from "vitest";
import { resolveColumnWheelTarget } from "../src/columnWheelNavigation";
import { BranchColumnModel, BranchTreeMetadata } from "../src/types";

const metadata: BranchTreeMetadata = {
  version: 1,
  prefix: "",
  blocks: [
    { id: "root", parentId: null, order: 0, content: "Root", after: "" },
    { id: "first", parentId: "root", order: 0, content: "First", after: "" },
    { id: "second", parentId: "root", order: 1, content: "Second", after: "" },
    { id: "leaf", parentId: "first", order: 0, content: "Leaf", after: "" }
  ]
};

const rootColumn: BranchColumnModel = {
  key: "root",
  label: "Root",
  parentId: null,
  blocks: [metadata.blocks[0]]
};

const siblingColumn: BranchColumnModel = {
  key: "depth-1",
  label: "Children",
  parentId: "root",
  blocks: [metadata.blocks[1], metadata.blocks[2]]
};

const childColumn: BranchColumnModel = {
  key: "depth-2",
  label: "Grandchildren",
  parentId: "first",
  blocks: [metadata.blocks[3]]
};

describe("column wheel navigation", () => {
  it("enters the hovered child column from its parent", () => {
    expect(resolveColumnWheelTarget(metadata, "first", childColumn)).toBe("leaf");
  });

  it("returns to the active ancestor shown in a hovered earlier column", () => {
    expect(resolveColumnWheelTarget(metadata, "leaf", rootColumn)).toBe("root");
  });

  it("keeps sibling navigation when the hovered column already contains the selection", () => {
    expect(resolveColumnWheelTarget(metadata, "first", siblingColumn)).toBeNull();
  });
});
