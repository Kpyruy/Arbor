import { describe, expect, it } from "vitest";
import { parseBranchDocument, buildBranchDocument } from "../src/storage/document";
import { linearizeTree, buildMetadataBlock } from "../src/storage/serializer";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { BranchTreeMetadata } from "../src/types";

const complexBlock = [
  "# Heading",
  "",
  "Paragraph with [[Wiki Link]] and ![[image.png]].",
  "",
  "> [!note] Callout",
  "> Still inside callout",
  "",
  "- [ ] Task item",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "[^1]: Footnote",
  "",
  "$$",
  "x^2 + y^2",
  "$$"
].join("\n");

function metadataFixture(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      {
        id: "root-1",
        parentId: null,
        order: 0,
        content: complexBlock,
        after: "\n\n"
      },
      {
        id: "child-1",
        parentId: "root-1",
        order: 0,
        content: "Child paragraph\n\nSecond paragraph",
        after: "\n\n"
      },
      {
        id: "root-2",
        parentId: null,
        order: 1,
        content: "Second root section",
        after: ""
      }
    ]
  };
}

describe("document and storage", () => {
  it("linearizes depth-first and preserves rich markdown", () => {
    const linearized = linearizeTree(metadataFixture());
    expect(linearized.body).toContain("const x = 1;");
    expect(linearized.body.indexOf("Child paragraph")).toBeGreaterThan(linearized.body.indexOf("# Heading"));
    expect(linearized.body.indexOf("Second root section")).toBeGreaterThan(linearized.body.indexOf("Child paragraph"));
  });

  it("round-trips metadata inside the same markdown note", () => {
    const metadata = metadataFixture();
    const linearized = linearizeTree(metadata);
    const note = buildBranchDocument("---\naliases: []\n---\n", linearized.body, metadata, "multiline");
    const parsed = parseBranchDocument(note);
    expect(parsed.frontmatter.startsWith("---")).toBe(true);
    expect(parsed.body).toBe(linearized.body);
    expect(parsed.metadata?.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
  });

  it("keeps the note readable even if the plugin is disabled", () => {
    const metadata = metadataFixture();
    const linearized = linearizeTree(metadata);
    const note = buildBranchDocument("", linearized.body, metadata, "compact");
    expect(note).toContain("# Heading");
    expect(note).toContain("Second root section");
    expect(note).toContain("arbor:metadata:v1");
  });

  it("rebuilds safely from plain markdown changes instead of losing content", () => {
    const visibleMarkdown = [
      "# Root One",
      "",
      "Paragraph one.",
      "",
      "## Nested detail",
      "",
      "More text.",
      "",
      "# Root Two",
      "",
      "Another paragraph."
    ].join("\n");
    const loaded = loadImportedBranchDocument(visibleMarkdown);
    expect(loaded.origin).toBe("imported");
    expect(loaded.metadata.blocks).toHaveLength(2);
    expect(loaded.metadata.blocks[0].content).toContain("# Root One");
  });

  it("parses previously stored metadata blocks", () => {
    const block = buildMetadataBlock(metadataFixture(), "multiline");
    expect(block).toContain("arbor:metadata:v1");
    const parsed = parseBranchDocument(`Visible body\n\n${block}`);
    expect(parsed.metadata?.blocks).toHaveLength(3);
  });
});
