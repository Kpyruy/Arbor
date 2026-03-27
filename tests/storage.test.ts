import { describe, expect, it } from "vitest";
import { parseBranchDocument, buildBranchDocument } from "../src/storage/document";
import { linearizeTree, buildMetadataBlock } from "../src/storage/serializer";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { BranchBlock, BranchTreeMetadata } from "../src/types";

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

function legacyLinearize(metadata: BranchTreeMetadata): string {
  const byParent = new Map<string | null, BranchBlock[]>();
  metadata.blocks.forEach((block) => {
    const current = byParent.get(block.parentId) ?? [];
    current.push(block);
    byParent.set(block.parentId, current);
  });

  byParent.forEach((blocks, parentId) => {
    byParent.set(
      parentId,
      [...blocks].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    );
  });

  const visit = (parentId: string | null): string =>
    (byParent.get(parentId) ?? [])
      .map((block) => `${block.content}${block.after}${visit(block.id)}`)
      .join("");

  return visit(null);
}

describe("document and storage", () => {
  it("linearizes depth-first and preserves rich markdown", () => {
    const linearized = linearizeTree(metadataFixture());
    expect(linearized.body).toContain("const x = 1;");
    expect(linearized.body).toContain('<!-- arbor:block:v1 id="root-1" parent="" order="0" -->');
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

  it("reconstructs exact blocks from visible markers without hidden metadata", () => {
    const metadata = metadataFixture();
    const visibleBody = linearizeTree(metadata).body;
    const loaded = loadImportedBranchDocument(visibleBody);

    expect(loaded.origin).toBe("markers");
    expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
    expect(loaded.metadata.blocks[1].parentId).toBe("root-1");
  });

  it("preserves prefix content when reconstructing visible markers", () => {
    const metadata = metadataFixture();
    metadata.prefix = "> [!summary] Overview\n> Prefix content that should survive.\n\n";
    const visibleBody = linearizeTree(metadata).body;
    const staleMetadata: BranchTreeMetadata = {
      ...metadata,
      blocks: metadata.blocks.map((block) =>
        block.id === "root-1"
          ? { ...block, content: "Outdated root" }
          : block
      )
    };
    const note = buildBranchDocument("", visibleBody, staleMetadata, "multiline");
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("markers");
    expect(loaded.metadata.prefix).toBe(metadata.prefix);
    expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
  });

  it("prefers visible markers over stale hidden metadata", () => {
    const metadata = metadataFixture();
    const staleMetadata: BranchTreeMetadata = {
      ...metadata,
      blocks: metadata.blocks.map((block) =>
        block.id === "root-1"
          ? { ...block, content: "Outdated root" }
          : block
      )
    };
    const visibleBody = linearizeTree(metadata).body;
    const note = buildBranchDocument("", visibleBody, staleMetadata, "multiline");
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("markers");
    expect(loaded.staleMetadata?.blocks[0].content).toBe("Outdated root");
    expect(loaded.metadata.blocks[0].content).toContain("# Heading");
  });

  it("flags metadata-only notes as legacy so they can be migrated exactly", () => {
    const metadata = metadataFixture();
    const legacyBody = legacyLinearize(metadata);
    const note = buildBranchDocument("", legacyBody, metadata, "multiline");
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("legacy");
    expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
  });

  it("preserves block boundaries for legacy notes with plain-markdown drift", () => {
    const metadata = metadataFixture();
    const legacyBody = legacyLinearize(metadata).replace(
      "Child paragraph\n\nSecond paragraph",
      "Child paragraph\n\nInserted line\n\nSecond paragraph"
    );
    const note = buildBranchDocument("", legacyBody, metadata, "multiline");
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("legacy");
    expect(loaded.metadata.blocks[1].content).toContain("Inserted line");
    expect(loaded.metadata.blocks[2].content).toBe("Second root section");
  });

  it("ignores marker-like comments inside fenced code blocks", () => {
    const visibleMarkdown = [
      "```md",
      "<!-- arbor:block:v1 id=\"fake\" parent=\"\" order=\"0\" -->",
      "```",
      "",
      "# Real note"
    ].join("\n");
    const loaded = loadImportedBranchDocument(visibleMarkdown);

    expect(loaded.origin).toBe("imported");
    expect(loaded.metadata.blocks).toHaveLength(2);
    expect(loaded.metadata.blocks[0].content).toContain("arbor:block:v1");
    expect(loaded.metadata.blocks[1].content).toContain("# Real note");
  });

  it("does not treat marker examples with visible prefix content as managed marker notes", () => {
    const visibleMarkdown = [
      "Here is an example marker:",
      "",
      "<!-- arbor:block:v1 id=\"fake\" parent=\"\" order=\"0\" -->",
      "",
      "This is still a normal markdown note."
    ].join("\n");
    const loaded = loadImportedBranchDocument(visibleMarkdown);

    expect(loaded.origin).toBe("imported");
    expect(loaded.metadata.blocks).toHaveLength(1);
    expect(loaded.metadata.blocks[0].content).toContain("Here is an example marker:");
  });
});
