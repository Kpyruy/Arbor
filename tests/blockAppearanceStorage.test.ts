import { describe, expect, it } from "vitest";
import { setBlockColor } from "../src/model/blockAppearance";
import { buildCleanExportDocument } from "../src/storage/cleanExport";
import { buildBranchDocument } from "../src/storage/document";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { buildStructureBlock, linearizeTree, parseStructureBlock } from "../src/storage/serializer";
import { fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

describe("block appearance storage", () => {
  it("round-trips colour appearance through the document footer", () => {
    const tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");

    const note = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.metadata.blocks.find((block) => block.id === "root")?.appearance)
      .toEqual({ branchColor: "#44aa88" });
    expect(loaded.outputState).toEqual(fixtureOutput());
    expect(loaded.metadata.blocks.map(({ id, parentId, content }) => [id, parentId, content]))
      .toEqual(tree.blocks.map(({ id, parentId, content }) => [id, parentId, content]));
  });

  it("keeps visible text and topology authoritative while merging colours by ID", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "first", "card", "#9966DD");
    const note = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const externallyEdited = note
      .replace('id="first" parent="root" order="0"', 'id="first" parent="" order="1"')
      .replace("First\n\n", "First edited outside Arbor\n\n")
      .replace(/<!-- arbor:block:v1 id="second"[\s\S]*?(?=\n%% arbor:output)/, "")
      .replace(
        '<!-- arbor:block:v1 id="leaf"',
        '<!-- arbor:block:v1 id="new" parent="root" order="0" -->\nNew block\n\n<!-- arbor:block:v1 id="leaf"'
      );

    const loaded = loadImportedBranchDocument(externallyEdited);
    const byId = new Map(loaded.metadata.blocks.map((block) => [block.id, block]));

    expect(new Set(byId.keys())).toEqual(new Set(["root", "first", "new", "leaf"]));
    expect(byId.get("first")?.parentId).toBeNull();
    expect(byId.get("first")?.content).toBe("First edited outside Arbor");
    expect(byId.get("root")?.appearance).toEqual({ branchColor: "#44aa88" });
    expect(byId.get("first")?.appearance).toEqual({ cardColor: "#9966dd" });
    expect(byId.get("new")?.appearance).toBeUndefined();
  });

  it("sanitizes optional appearance without invalidating valid structure", () => {
    const tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    const structure = buildStructureBlock(tree)
      .replace('"branchColor": "#44aa88"', '"branchColor": "url(bad)",\n        "cardColor": " #9966DD ",\n        "extra": true');

    const parsed = parseStructureBlock(structure);

    expect(parsed?.blocks).toHaveLength(tree.blocks.length);
    expect(parsed?.blocks[0].appearance).toEqual({ cardColor: "#9966dd" });

    const allInvalid = structure.replace('"cardColor": " #9966DD "', '"cardColor": "bad"');
    expect(parseStructureBlock(allInvalid)?.blocks[0]).not.toHaveProperty("appearance");
  });

  it("keeps old uncoloured structure, marker-only and legacy documents colour-free", () => {
    const tree = fixtureTree();
    const visible = linearizeTree(tree).body;
    const structureDocument = buildBranchDocument("", visible, tree);
    const legacyFooter = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(tree), "utf8").toString("base64")}\n-->`;

    for (const document of [structureDocument, visible, `${visible}\n${legacyFooter}`]) {
      expect(loadImportedBranchDocument(document).metadata.blocks.every((block) => block.appearance === undefined))
        .toBe(true);
    }
  });

  it("merges valid legacy appearance after external visible-marker edits", () => {
    const tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    const visible = linearizeTree(tree).body.replace("Root\n\n", "Externally edited root\n\n");
    const legacyFooter = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(tree), "utf8").toString("base64")}\n-->`;

    const loaded = loadImportedBranchDocument(`${visible}\n${legacyFooter}`);

    expect(loaded.metadata.blocks[0].content).toBe("Externally edited root");
    expect(loaded.metadata.blocks[0].appearance).toEqual({ branchColor: "#44aa88" });
  });

  it("preserves malformed output bytes while reopening coloured rich Markdown", () => {
    let tree = fixtureTree();
    tree.blocks[0].content = "# Root\n\n> [!note] Rich\n> **Markdown** with `code`";
    tree = setBlockColor(tree, "root", "branch", "#44AA88");
    const malformedOutput = [
      "%% arbor:output",
      "```json",
      '{"arbor-plugin":"output","version":1,"active":"missing","profiles":[]}',
      "```",
      "%%"
    ].join("\n");
    const note = [linearizeTree(tree).body, malformedOutput, buildStructureBlock(tree)].join("\n\n");

    const loaded = loadImportedBranchDocument(note);

    expect(loaded.outputRaw).toBe(malformedOutput);
    expect(loaded.outputError).toBeTruthy();
    expect(loaded.metadata.blocks[0].content).toContain("> **Markdown** with `code`");
    expect(loaded.metadata.blocks[0].appearance).toEqual({ branchColor: "#44aa88" });
  });

  it("keeps clean exports free of decorative metadata", () => {
    let tree = setBlockColor(fixtureTree(), "root", "branch", "#44AA88");
    tree = setBlockColor(tree, "first", "card", "#9966DD");

    const clean = buildCleanExportDocument(
      "",
      tree,
      fixtureOutput("full"),
      { frontmatter: "omit", excluded: "omit" }
    );

    expect(clean).toContain("Root");
    expect(clean).toContain("First");
    expect(clean).not.toContain("appearance");
    expect(clean).not.toContain("#44aa88");
    expect(clean).not.toContain("#9966dd");
    expect(clean).not.toContain("arbor:structure");
  });
});
