import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveOverviewArrowTarget } from "../src/overviewNavigation";
import { BranchTreeMetadata } from "../src/types";

const tree: BranchTreeMetadata = {
  version: 1,
  prefix: "",
  blocks: [
    { id: "root", parentId: null, order: 0, content: "Root", after: "" },
    { id: "first", parentId: "root", order: 0, content: "First", after: "" },
    { id: "second", parentId: "root", order: 1, content: "Second", after: "" },
    { id: "leaf", parentId: "first", order: 0, content: "Leaf", after: "" }
  ]
};

describe("overview arrow navigation", () => {
  it("moves to the parent, first child, and neighbouring siblings", () => {
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowLeft")).toBe("root");
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowRight")).toBe("leaf");
    expect(resolveOverviewArrowTarget(tree, "second", "ArrowUp")).toBe("first");
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowDown")).toBe("second");
  });

  it("does not leave the tree at an edge", () => {
    expect(resolveOverviewArrowTarget(tree, "root", "ArrowLeft")).toBeNull();
    expect(resolveOverviewArrowTarget(tree, "leaf", "ArrowRight")).toBeNull();
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowUp")).toBeNull();
  });

  it("reuses numeric child navigation inside the overview keyboard handler", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain("this.tryHandleNumericChildNavigation(event, this.state.selectedBlockId)");
  });
});
