import { describe, expect, it } from "vitest";
import { buildCleanExportDocument } from "../src/storage/cleanExport";
import { BranchTreeMetadata } from "../src/types";

function metadataFixture(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "> [!note] Introduction\n> Keep this prefix.\n\n",
    blocks: [
      {
        id: "root",
        parentId: null,
        order: 0,
        content: "# Root",
        after: "\n\n"
      },
      {
        id: "child",
        parentId: "root",
        order: 0,
        content: "Child",
        after: "\n\n"
      },
      {
        id: "next",
        parentId: null,
        order: 1,
        content: "# Next",
        after: ""
      }
    ]
  };
}

describe("clean Arbor exports", () => {
  it("keeps exact YAML and depth-first Markdown without Arbor storage", () => {
    const output = buildCleanExportDocument(
      "---\ntags: [draft]\n---\n",
      metadataFixture(),
      "keep-yaml"
    );

    expect(output).toBe(
      "---\ntags: [draft]\n---\n> [!note] Introduction\n> Keep this prefix.\n\n# Root\n\nChild\n\n# Next"
    );
    expect(output).not.toContain("arbor:block:v1");
    expect(output).not.toContain("arbor:structure");
  });

  it("omits frontmatter exactly for a text-only export", () => {
    expect(buildCleanExportDocument("---\nalias: Draft\n---\n", metadataFixture(), "text-only")).toBe(
      "> [!note] Introduction\n> Keep this prefix.\n\n# Root\n\nChild\n\n# Next"
    );
  });

  it("exports an in-progress block edit without changing the source metadata", () => {
    const metadata = metadataFixture();
    const output = buildCleanExportDocument(
      "",
      metadata,
      "text-only",
      { blockId: "child", content: "Edited only in the export" }
    );

    expect(output).toContain("Edited only in the export");
    expect(metadata.blocks.find((block) => block.id === "child")?.content).toBe("Child");
  });
});
