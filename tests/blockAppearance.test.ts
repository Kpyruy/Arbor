import { describe, expect, it } from "vitest";
import { BranchHistory } from "../src/history";
import {
  normalizeBlockAppearance,
  normalizeBlockColor,
  resolveBlockColors,
  setBlockColor
} from "../src/model/blockAppearance";
import { addChild, duplicateSubtree, moveBlockToParentAtIndex } from "../src/model/tree";
import type { BranchHistoryEntry } from "../src/types";
import { fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

function snapshot(metadata: BranchHistoryEntry["metadata"]): BranchHistoryEntry {
  return {
    label: "Colour change",
    metadata,
    outputState: fixtureOutput(),
    selectedBlockId: "root"
  };
}

describe("block appearance", () => {
  it("normalizes only six-digit hex colours and known appearance fields", () => {
    expect(normalizeBlockColor("  #44AA88 ")).toBe("#44aa88");
    expect(normalizeBlockColor("#fff")).toBeNull();
    expect(normalizeBlockColor("rgba(1, 2, 3, 0.5)")).toBeNull();
    expect(normalizeBlockColor(null)).toBeNull();

    expect(normalizeBlockAppearance({
      cardColor: " #9966DD ",
      branchColor: "not-a-colour",
      unrelated: "keep-out"
    })).toEqual({ cardColor: "#9966dd" });
    expect(normalizeBlockAppearance({ cardColor: "bad", branchColor: 42 })).toBeUndefined();
    expect(normalizeBlockAppearance(null)).toBeUndefined();
    expect(normalizeBlockAppearance([])).toBeUndefined();
  });

  it("uses theme defaults independently for separate uncoloured roots", () => {
    const tree = fixtureTree();
    tree.blocks.push({ id: "other", parentId: null, order: 1, content: "Other", after: "" });

    const resolved = resolveBlockColors(tree);

    expect(resolved.get("root")).toEqual({ color: null, source: "theme", ruleBlockId: null });
    expect(resolved.get("leaf")).toEqual({ color: null, source: "theme", ruleBlockId: null });
    expect(resolved.get("other")).toEqual({ color: null, source: "theme", ruleBlockId: null });
    expect(tree.blocks[0].appearance).toBeUndefined();
  });

  it("inherits the nearest branch colour but never a card-only colour", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "first", "branch", "#2255CC");
    tree = setBlockColor(tree, "first", "card", "#9966DD");

    const resolved = resolveBlockColors(tree);

    expect(resolved.get("root")).toEqual({ color: "#44aa88", source: "branch", ruleBlockId: "root" });
    expect(resolved.get("first")).toEqual({ color: "#9966dd", source: "card", ruleBlockId: "first" });
    expect(resolved.get("leaf")).toEqual({ color: "#2255cc", source: "inherited", ruleBlockId: "first" });
    expect(resolved.get("second")).toEqual({ color: "#44aa88", source: "inherited", ruleBlockId: "root" });
  });

  it("preserves the other scope and restores inheritance when one override resets", () => {
    const branch = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    const both = setBlockColor(branch, "root", "card", "#9966DD");

    expect(both.blocks[0].appearance).toEqual({ branchColor: "#44aa88", cardColor: "#9966dd" });
    expect(resolveBlockColors(both).get("root")?.color).toBe("#9966dd");

    const resetCard = setBlockColor(both, "root", "card", null);
    expect(resetCard.blocks[0].appearance).toEqual({ branchColor: "#44aa88" });
    expect(resolveBlockColors(resetCard).get("root")?.color).toBe("#44aa88");

    const resetBranch = setBlockColor(resetCard, "root", "branch", null);
    expect(resetBranch.blocks[0].appearance).toBeUndefined();
    expect(resolveBlockColors(resetBranch).get("root")?.color).toBeNull();
  });

  it.each(["#2255CC", "#44AA88"])("applying branch colour %s replaces only its parent's card override", (color) => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "root", "card", "#9966DD");
    tree = setBlockColor(tree, "first", "card", "#AA3377");
    tree = setBlockColor(tree, "leaf", "branch", "#113355");
    const before = structuredClone(tree);

    const changed = setBlockColor(tree, "root", "branch", color);

    expect(changed.blocks[0].appearance).toEqual({ branchColor: color.toLowerCase() });
    const resolved = resolveBlockColors(changed);
    expect(resolved.get("root")?.color).toBe(color.toLowerCase());
    expect(resolved.get("second")?.color).toBe(color.toLowerCase());
    expect(resolved.get("first")?.color).toBe("#aa3377");
    expect(resolved.get("leaf")?.color).toBe("#113355");
    expect(tree).toEqual(before);
  });

  it("resetting branch colour leaves its parent's explicit card colour intact", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "root", "card", "#9966DD");

    const reset = setBlockColor(tree, "root", "branch", null);

    expect(reset.blocks[0].appearance).toEqual({ cardColor: "#9966dd" });
    expect(resolveBlockColors(reset).get("root")?.color).toBe("#9966dd");
    expect(resolveBlockColors(reset).get("second")?.color).toBeNull();
  });

  it("undo restores the card override replaced by a branch colour and redo removes it again", () => {
    const history = new BranchHistory();
    const before = setBlockColor(fixtureTree(), "root", "card", "#9966DD");
    history.push("Before branch colour", before, fixtureOutput(), "root");
    const after = setBlockColor(before, "root", "branch", "#44AA88");

    const undone = history.undo(snapshot(after));
    expect(undone!.metadata.blocks[0].appearance).toEqual({ cardColor: "#9966dd" });
    const redone = history.redo(undone!);
    expect(redone!.metadata.blocks[0].appearance).toEqual({ branchColor: "#44aa88" });
  });

  it("keeps descendant overrides and colours newly added children from the branch rule", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "first", "card", "#9966DD");
    tree = setBlockColor(tree, "leaf", "branch", "#113355");
    const added = addChild(tree, "second");

    expect(resolveBlockColors(tree).get("first")?.color).toBe("#9966dd");
    expect(resolveBlockColors(tree).get("leaf")).toEqual({
      color: "#113355",
      source: "branch",
      ruleBlockId: "leaf"
    });
    expect(resolveBlockColors(added.metadata).get(added.selectedBlockId)).toEqual({
      color: "#44aa88",
      source: "inherited",
      ruleBlockId: "root"
    });
  });

  it("rejects invalid set input and leaves a missing target semantically unchanged", () => {
    const tree = fixtureTree();

    expect(() => setBlockColor(tree, "root", "card", "url(bad)")).toThrow();
    expect(setBlockColor(tree, "missing", "branch", "#44aa88")).toBe(tree);
    expect(tree.blocks[0].appearance).toBeUndefined();
  });

  it("preserves explicit colours through moves while re-resolving inheritance", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree.blocks.push({ id: "other", parentId: null, order: 1, content: "Other", after: "" });
    tree = setBlockColor(tree, "other", "branch", "#AA3377");
    tree = setBlockColor(tree, "leaf", "card", "#9966DD");

    const moved = moveBlockToParentAtIndex(tree, "first", "other", 0);
    const resolved = resolveBlockColors(moved);

    expect(resolved.get("first")?.color).toBe("#aa3377");
    expect(resolved.get("leaf")?.color).toBe("#9966dd");
    expect(moved.blocks.find((block) => block.id === "leaf")?.appearance).toEqual({ cardColor: "#9966dd" });
  });

  it("duplicates subtree appearances as independent copies", () => {
    let tree = setBlockColor(fixtureTree(), "first", "branch", "#44AA88");
    tree = setBlockColor(tree, "leaf", "card", "#9966DD");
    const duplicated = duplicateSubtree(tree, "first");
    const duplicateRootId = duplicated.selectedBlockId!;
    const duplicateLeafId = Object.entries(duplicated.duplicateMap ?? {})
      .find(([, sourceId]) => sourceId === "leaf")?.[0];

    expect(resolveBlockColors(duplicated.metadata).get(duplicateRootId)?.color).toBe("#44aa88");
    expect(resolveBlockColors(duplicated.metadata).get(duplicateLeafId!)?.color).toBe("#9966dd");

    duplicated.metadata.blocks.find((block) => block.id === duplicateRootId)!.appearance!.branchColor = "#2255cc";
    expect(duplicated.metadata.blocks.find((block) => block.id === "first")?.appearance?.branchColor).toBe("#44aa88");

    const recoloured = setBlockColor(duplicated.metadata, duplicateRootId, "branch", "#2255CC");
    expect(resolveBlockColors(recoloured).get(duplicateRootId)?.color).toBe("#2255cc");
    expect(resolveBlockColors(recoloured).get("first")?.color).toBe("#44aa88");
  });

  it("restores colour snapshots through history undo and redo", () => {
    const history = new BranchHistory();
    const before = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    const after = setBlockColor(before, "root", "branch", "#9966DD");
    history.push("Before colour", before, fixtureOutput(), "root");

    const undone = history.undo(snapshot(after));
    expect(resolveBlockColors(undone!.metadata).get("leaf")?.color).toBe("#44aa88");

    const redone = history.redo(undone!);
    expect(resolveBlockColors(redone!.metadata).get("leaf")?.color).toBe("#9966dd");
  });

  it("terminates safely when malformed parent links form a cycle", () => {
    const tree = fixtureTree();
    tree.blocks.find((block) => block.id === "root")!.parentId = "leaf";

    expect(resolveBlockColors(tree).get("first")).toEqual({ color: null, source: "theme", ruleBlockId: null });
  });
});
