import { describe, expect, it } from "vitest";
import { verticalOverviewQaFixtures } from "./helpers/verticalOverviewFixtures";
import { getChildren } from "../src/model/tree";
import { resolveBlockColors } from "../src/model/blockAppearance";
import { buildBranchDocument, parseBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { buildCleanExportDocument } from "../src/storage/cleanExport";

function fixtures() {
  let nextId = 0;
  return verticalOverviewQaFixtures(() => `qa-${++nextId}`, "reference.png");
}

describe("manual vertical Overview fixtures", () => {
  it("provides a forest, wide siblings and tall native Markdown resources", () => {
    const { metadata } = fixtures()[0];
    expect(getChildren(metadata, null)).toHaveLength(2);
    const wide = metadata.blocks.find(block => block.content.startsWith("## Wide siblings"))!;
    expect(getChildren(metadata, wide.id)).toHaveLength(12);
    expect(metadata.blocks.some(block => block.content.includes("Paragraph 18"))).toBe(true);
    expect(metadata.blocks.some(block => block.content.includes("![[reference.png|200]]"))).toBe(true);
    expect(metadata.blocks.some(block => block.content.includes("```typescript") && block.content.includes("| 12 |"))).toBe(true);
  });

  it("provides exactly 50 edges with unique IDs across both notes", () => {
    const notes = fixtures();
    const { metadata } = notes[1];
    expect(metadata.blocks).toHaveLength(51);
    for (const [index, block] of metadata.blocks.entries()) {
      expect(block.parentId).toBe(index === 0 ? null : metadata.blocks[index - 1].id);
      expect(getChildren(metadata, block.id)).toHaveLength(index === 50 ? 0 : 1);
    }
    const ids = notes.flatMap(note => note.metadata.blocks.map(block => block.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a card colour override local inside a branch override", () => {
    const { metadata } = fixtures()[0];
    const orange = metadata.blocks.find(block => block.appearance?.cardColor)!;
    const inherited = getChildren(metadata, orange.parentId).find(block => block.id !== orange.id)!;
    expect(resolveBlockColors(metadata).get(orange.id)?.color).toBe("#dd8844");
    expect(resolveBlockColors(metadata).get(inherited.id)?.color).toBe("#8866cc");
  });

  it("round-trips through native documents with valid output profiles and no orientation metadata", () => {
    for (const note of fixtures()) {
      const source = buildBranchDocument("", linearizeTree(note.metadata).body, note.metadata, note.outputState);
      const parsed = parseBranchDocument(source);
      expect(parsed.storageFormat).toBe("structure-v2");
      expect(parsed.metadata?.blocks.map(block => block.id)).toEqual(note.metadata.blocks.map(block => block.id));
      expect(parsed.outputError).toBeNull();
      expect(parsed.outputState.activeProfileId).toBe(note.outputState.activeProfileId);
      expect(source).not.toContain("vertical-top-down");
      expect(source).not.toContain("vertical-bottom-up");
    }
  });

  it("exports readable clean Markdown without excluded branch content or Arbor metadata", () => {
    const note = fixtures()[0];
    const clean = buildCleanExportDocument("", note.metadata, note.outputState, { frontmatter: "omit", excluded: "omit" });
    expect(clean).toContain("# Second forest root");
    expect(clean).toContain("Needle");
    expect(clean).not.toContain("## Excluded branch");
    expect(clean).not.toContain("### Excluded descendant");
    expect(clean).not.toContain("arbor:block");
    expect(clean).not.toContain("arbor:structure");
  });
});
