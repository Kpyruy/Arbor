import { describe, expect, it } from "vitest";
import { buildCleanExportDocument, CleanExportOptions } from "../src/storage/cleanExport";
import { createDefaultOutputState, setBlockOnlyState } from "../src/outputProfiles";
import { ArborOutputProfile, ArborOutputState, BranchTreeMetadata } from "../src/types";

function metadataFixture(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "> [!note] Introduction\n> Keep this prefix.\n\n",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "# Root", after: "\n\n" },
      { id: "child", parentId: "root", order: 0, content: "Child", after: "\n\n" },
      { id: "next", parentId: null, order: 1, content: "# Next", after: "" }
    ]
  };
}

function outputState(rules: ArborOutputProfile["rules"]): ArborOutputState {
  return {
    version: 1,
    activeProfileId: "draft",
    profiles: [{ id: "draft", name: "Draft", rules }]
  };
}

describe("clean Arbor exports", () => {
  it("keeps the legacy full-tree Markdown result for old notes", () => {
    const output = buildCleanExportDocument(
      "---\nalias: Draft\n---\n",
      metadataFixture(),
      createDefaultOutputState(),
      { frontmatter: "keep", excluded: "omit" }
    );

    expect(output).toBe(
      "---\nalias: Draft\n---\n> [!note] Introduction\n> Keep this prefix.\n\n# Root\n\nChild\n\n# Next"
    );
  });
  it.each([
    { frontmatter: "keep", excluded: "omit" },
    { frontmatter: "omit", excluded: "omit" },
    { frontmatter: "keep", excluded: "comment" },
    { frontmatter: "omit", excluded: "comment" }
  ] satisfies CleanExportOptions[])(
    "supports $frontmatter YAML and $excluded excluded blocks",
    (options) => {
      const output = buildCleanExportDocument(
        "---\ntags: [draft]\n---\n",
        metadataFixture(),
        outputState([{ blockId: "next", state: "exclude" }]),
        options
      );

      expect(output.startsWith("---\ntags: [draft]\n---\n")).toBe(options.frontmatter === "keep");
      expect(output).toContain("> [!note] Introduction");
      expect(output).toContain("# Root\n\nChild");
      expect(output).not.toContain("arbor:excluded");
      const hasCommentedNextBlock = output.includes("<!--\n# Next\n-->");
      expect(hasCommentedNextBlock).toBe(options.excluded === "comment");
      expect(output.includes("# Next")).toBe(options.excluded === "comment");
      expect(output).not.toContain("arbor:block:v1");
      expect(output).not.toContain("arbor:structure");
      expect(output).not.toContain("arbor:output");
    }
  );

  it("keeps included descendants in depth-first order when their parent alone is excluded", () => {
    const metadata = metadataFixture();
    metadata.blocks[0].after = "";
    const base: ArborOutputProfile = { id: "draft", name: "Draft", rules: [] };
    const blockOnly = setBlockOnlyState(metadata, base, "root", "exclude");
    const state: ArborOutputState = { version: 1, activeProfileId: "draft", profiles: [blockOnly] };

    const omitted = buildCleanExportDocument("", metadata, state, {
      frontmatter: "omit",
      excluded: "omit"
    });
    const commented = buildCleanExportDocument("", metadata, state, {
      frontmatter: "omit",
      excluded: "comment"
    });

    expect(omitted).not.toContain("# Root");
    expect(omitted.indexOf("Child")).toBeLessThan(omitted.indexOf("# Next"));
    expect(commented.indexOf('<!-- arbor:excluded id="root"')).toBeLessThan(commented.indexOf("Child"));
    expect(commented).toContain("-->\nChild");
  });

  it("exports a pending edit from a clone without changing the source metadata", () => {
    const metadata = metadataFixture();
    const output = buildCleanExportDocument(
      "",
      metadata,
      outputState([]),
      { frontmatter: "omit", excluded: "omit" },
      { blockId: "child", content: "Edited only in the export" }
    );

    expect(output).toContain("Edited only in the export");
    expect(metadata.blocks.find((block) => block.id === "child")?.content).toBe("Child");
  });

  it("escapes arbitrary excluded Markdown into one valid HTML comment", () => {
    const metadata: BranchTreeMetadata = {
      version: 1,
      prefix: "",
      blocks: [{
        id: "unsafe--id",
        parentId: null,
        order: 0,
        content: [
          "<!-- nested -->",
          "alpha--beta",
          "> [!warning] Callout",
          "![[asset.png]]",
          "```js",
          "const token = '--';",
          "```"
        ].join("\n"),
        after: ""
      }]
    };

    const output = buildCleanExportDocument(
      "",
      metadata,
      outputState([{ blockId: "unsafe--id", state: "exclude" }]),
      { frontmatter: "omit", excluded: "comment" }
    );

    expect(output.startsWith("<!--\n")).toBe(true);
    expect(output).not.toContain("unsafe--id");
    expect(output).not.toContain("arbor:");
    expect(output).toContain("<!&#45;&#45; nested &#45;&#45;>");
    expect(output).toContain("alpha&#45;&#45;beta");
    expect(output).toContain("const token = '&#45;&#45;';");
    expect(output.match(/-->/g)).toHaveLength(1);
  });
});
