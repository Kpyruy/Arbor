import { describe, expect, it } from "vitest";
import { buildOverviewLayout, buildOverviewLinkPath } from "../src/model/overviewLayout";
import { BranchTreeMetadata } from "../src/types";

const tree: BranchTreeMetadata = {
  version: 1,
  prefix: "",
  blocks: [
    { id: "root", parentId: null, order: 0, content: "# Root", after: "" },
    { id: "a", parentId: "root", order: 0, content: "A", after: "" },
    { id: "b", parentId: "root", order: 1, content: "B", after: "" },
    { id: "a1", parentId: "a", order: 0, content: "A.1", after: "" }
  ]
};

describe("overview layout", () => {
  it("shows every block once in depth columns and keeps sibling order", () => {
    const layout = buildOverviewLayout(tree);

    expect(layout.nodes.map((node) => node.id)).toEqual(["root", "a", "a1", "b"]);
    expect(layout.nodes.find((node) => node.id === "root")?.depth).toBe(0);
    expect(layout.nodes.find((node) => node.id === "a1")?.depth).toBe(2);
    expect(layout.nodes.find((node) => node.id === "a")!.y)
      .toBeLessThan(layout.nodes.find((node) => node.id === "b")!.y);
  });

  it("links all non-roots and does not hide collapsed descendants", () => {
    const collapsed = structuredClone(tree);
    collapsed.blocks.find((block) => block.id === "a")!.collapsed = true;

    const layout = buildOverviewLayout(collapsed);

    expect(layout.links).toEqual([
      { parentId: "root", childId: "a" },
      { parentId: "a", childId: "a1" },
      { parentId: "root", childId: "b" }
    ]);
    expect(layout.nodes.map((node) => node.id)).toContain("a1");
  });

  it("centres a parent vertically over the span of its children", () => {
    const branching: BranchTreeMetadata = {
      version: 1,
      prefix: "",
      blocks: [
        { id: "root", parentId: null, order: 0, content: "Root", after: "" },
        { id: "left", parentId: "root", order: 0, content: "Left", after: "" },
        { id: "right", parentId: "root", order: 1, content: "Right", after: "" }
      ]
    };

    const layout = buildOverviewLayout(branching);
    const root = layout.nodes.find((node) => node.id === "root")!;
    const left = layout.nodes.find((node) => node.id === "left")!;
    const right = layout.nodes.find((node) => node.id === "right")!;

    expect(root.y).toBe((left.y + right.y) / 2);
  });

  it("creates finite empty-tree bounds and cubic parent-child links", () => {
    expect(buildOverviewLayout({ version: 1, prefix: "", blocks: [] }).width).toBeGreaterThan(0);

    const layout = buildOverviewLayout(tree);
    const parent = layout.nodes.find((node) => node.id === "root")!;
    const child = layout.nodes.find((node) => node.id === "a")!;

    expect(buildOverviewLinkPath(parent, child)).toContain(`M ${parent.x + parent.width}`);
    expect(buildOverviewLinkPath(parent, child)).toContain(`${child.x} ${child.y + child.height / 2}`);
  });
});
