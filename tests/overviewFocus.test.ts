import { describe, expect, it } from "vitest";
import { projectOverviewSubtree } from "../src/view/overview/overviewFocus";
import { buildOverviewLayout } from "../src/model/overviewLayout";
import { fixtureTree } from "./helpers/arborFixtures";

describe("Overview subtree focus", () => {
  it("makes only the chosen branch a visual root without mutating source topology", () => {
    const original = fixtureTree(); const saved = structuredClone(original);
    const projected = projectOverviewSubtree(original, "first");
    expect(projected.blocks.map(b => b.id)).toEqual(["first", "leaf"]);
    expect(projected.blocks[0].parentId).toBeNull();
    expect(projected.blocks[1].parentId).toBe("first");
    expect(buildOverviewLayout(projected).links).toEqual([{ parentId: "first", childId: "leaf" }]);
    expect(original).toEqual(saved);
  });

  it("falls back to the original tree for a missing or cleared root", () => {
    const original = fixtureTree();
    expect(projectOverviewSubtree(original, "removed")).toBe(original);
    expect(projectOverviewSubtree(original, null)).toBe(original);
  });
});
