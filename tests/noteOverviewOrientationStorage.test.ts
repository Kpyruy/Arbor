import { describe, expect, it } from "vitest";
import { addChild, cloneMetadata, deleteSubtree, updateBlockContent } from "../src/model/tree";
import { createDefaultOutputState } from "../src/outputProfiles";
import { buildCleanExportDocument } from "../src/storage/cleanExport";
import { buildBranchDocument, parseBranchDocument } from "../src/storage/document";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { buildStructureBlock, linearizeTree, normalizeMetadata, parseStructureBlock } from "../src/storage/serializer";
import { ArborOverviewOrientation, BranchTreeMetadata } from "../src/types";

function fixture(overviewOrientation?: ArborOverviewOrientation): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    ...(overviewOrientation ? { overviewOrientation } : {}),
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "child", parentId: "root", order: 0, content: "Child", after: "" }
    ]
  };
}

describe("per-note overview orientation storage", () => {
  it.each(["horizontal", "vertical-top-down", "vertical-bottom-up"] as const)("round-trips %s through the structure footer and note import", (orientation) => {
    const metadata = fixture(orientation);
    const note = buildBranchDocument("", linearizeTree(metadata).body, metadata);
    expect(parseBranchDocument(note).metadata?.overviewOrientation).toBe(orientation);
    expect(loadImportedBranchDocument(note).metadata.overviewOrientation).toBe(orientation);
  });

  it("retains the note preference when visible markers replace stale footer topology", () => {
    const stored = fixture("vertical-bottom-up");
    const visible = fixture();
    visible.blocks[1].parentId = null;
    visible.blocks[1].order = 1;
    visible.blocks[1].content = "Edited child";
    const loaded = loadImportedBranchDocument(buildBranchDocument("", linearizeTree(visible).body, stored));
    expect(loaded.metadata.overviewOrientation).toBe("vertical-bottom-up");
    expect(loaded.metadata.blocks[1]).toMatchObject({ parentId: null, order: 1, content: "Edited child" });
  });

  it("retains the note preference when plain body text is imported with a structure footer", () => {
    const loaded = loadImportedBranchDocument(buildBranchDocument("", "Plain paragraph", fixture("horizontal")));
    expect(loaded.metadata.overviewOrientation).toBe("horizontal");
    expect(loaded.metadata.blocks[0].content).toBe("Plain paragraph");
  });

  it.each(["diagonal", "", null, 42, {}, ["horizontal"]])("ignores invalid orientation %j without discarding topology", (invalid) => {
    const footer = buildStructureBlock(fixture()).replace('"version": 2,', `"version": 2,\n  "overviewOrientation": ${JSON.stringify(invalid)},`);
    const parsed = parseStructureBlock(footer);
    expect(parsed?.blocks.map((block) => [block.id, block.parentId])).toEqual([["root", null], ["child", "root"]]);
    expect(parsed).not.toHaveProperty("overviewOrientation");
    expect(normalizeMetadata({ ...fixture(), overviewOrientation: invalid } as unknown as BranchTreeMetadata)).not.toHaveProperty("overviewOrientation");
  });

  it("does not invent a preference for notes without one", () => {
    expect(loadImportedBranchDocument("Legacy plain note").metadata).not.toHaveProperty("overviewOrientation");
    expect(buildStructureBlock(fixture())).not.toContain("overviewOrientation");
    const legacyFooter = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(fixture()), "utf8").toString("base64")}\n-->`;
    expect(loadImportedBranchDocument(`Root\n\nChild\n${legacyFooter}`).metadata).not.toHaveProperty("overviewOrientation");
  });

  it("preserves the preference through normalization, clone and tree mutations", () => {
    const original = fixture("vertical-top-down");
    const added = addChild(normalizeMetadata(cloneMetadata(original)), "root");
    const edited = updateBlockContent(added.metadata, "root", "Edited root");
    const deleted = deleteSubtree(edited, added.selectedBlockId).metadata;
    expect(deleted.overviewOrientation).toBe("vertical-top-down");
    expect(original.blocks[0].content).toBe("Root");
  });

  it("keeps clean Markdown exports free of note presentation metadata", () => {
    const clean = buildCleanExportDocument("", fixture("vertical-bottom-up"), createDefaultOutputState(), { frontmatter: "omit", excluded: "omit" });
    expect(clean).toBe("Root\n\nChild");
    expect(clean).not.toContain("overviewOrientation");
    expect(clean).not.toContain("arbor:");
  });
});
