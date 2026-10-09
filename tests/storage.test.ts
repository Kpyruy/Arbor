import { describe, expect, it, vi } from "vitest";
import { parseBranchDocument, buildBranchDocument, updateStoredOverviewOrientation } from "../src/storage/document";
import { createDefaultOutputState } from "../src/outputProfiles";
import { buildOutputBlock } from "../src/storage/outputProfiles";
import { buildStructureBlock, linearizeTree } from "../src/storage/serializer";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { ArborOutputState, BranchBlock, BranchTreeMetadata } from "../src/types";
import { fixtureTree, fixtureOutput } from "./helpers/arborFixtures";
import { validateIncoming } from "../src/view/ingestion/IncomingContent";
import { appendIncomingContent } from "../src/model/ingestContent";

describe("unfinished source fences at stored control boundaries", () => {
  const cases = ["```", "````"].flatMap(fence => [false, true].flatMap(customOutput =>
    ["\n", "\r\n"].flatMap(contentNewline => ["\n", "\r\n"].map(footerNewline =>
      ({ fence, customOutput, contentNewline, footerNewline })))));

  it.each(cases)("reopens the real appended cards and suffix without closing user code (%j)", ({ fence, customOutput, contentNewline, footerNewline }) => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    tree.blocks[1].content = `First\n\n\`\`\`\`md\n${buildStructureBlock(tree)}\n\`\`\`\``;
    tree.blocks[1].appearance = { cardColor: "#123456" };
    const incoming = `${fence}ts${contentNewline}const unfinished = true;`;
    expect(validateIncoming(incoming, "markdown").kind).toBe("content");
    const appended = appendIncomingContent(tree, "first", incoming).metadata;
    const output = customOutput ? fixtureOutput() : createDefaultOutputState();
    const body = linearizeTree(appended).body;
    const canonical = buildBranchDocument("", body, appended, output);
    const source = body + canonical.slice(body.length).replace(/\n/g, footerNewline);
    const parsed = parseBranchDocument(source);
    const reopened = loadImportedBranchDocument(source);

    expect(parsed.storageFormat).toBe("structure-v2");
    expect(parsed.metadata?.blocks.map(block => [block.id, block.parentId, block.order])).toEqual([
      ["root", null, 0], ["first", "root", 0], ["second", "root", 1], ["leaf", "first", 0]
    ]);
    expect(parsed.body).toBe(body);
    expect(parsed.outputRaw).toBe(customOutput ? buildOutputBlock(output).replace(/\n/g, footerNewline) : "");
    expect(parsed.outputError).toBeNull();
    expect(reopened.origin).toBe("metadata");
    expect(reopened.metadata.blocks.map(block => [block.id, block.parentId, block.order, block.content, block.after, block.appearance])).toEqual(
      appended.blocks.map(block => [block.id, block.parentId, block.order, block.content, block.after, block.appearance])
    );
    expect(reopened.metadata.blocks[1].content).toBe(`${tree.blocks[1].content}\n\n${incoming}`);
    expect(reopened.outputState).toEqual(output);
    expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(canonical);

    const updated = updateStoredOverviewOrientation(source, "vertical-bottom-up", appended);
    const footerStart = source.lastIndexOf("%% arbor:structure");
    expect(updated.slice(0, footerStart)).toBe(source.slice(0, footerStart));
    expect(parseBranchDocument(updated).metadata?.overviewOrientation).toBe("vertical-bottom-up");
    expect(parseBranchDocument(updated).outputRaw).toBe(parsed.outputRaw);
    expect(loadImportedBranchDocument(updated).metadata.blocks[1].content).toBe(`${tree.blocks[1].content}\n\n${incoming}`);
  });

  it("uses stored IDs only to recover unfinished boundaries, not to invent literal cards", () => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    const incoming = '````md\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\nliteral';
    expect(validateIncoming(incoming, "markdown").kind).toBe("content");
    const appended = appendIncomingContent(tree, "first", incoming).metadata;
    const reopened = loadImportedBranchDocument(buildBranchDocument("", linearizeTree(appended).body, appended));
    expect(reopened.metadata.blocks.map(block => [block.id, block.content])).toEqual([
      ["root", "Root"], ["first", `First\n\n${incoming}`], ["second", "Second"], ["leaf", "Leaf"]
    ]);
  });

  it("refuses stale evidence when external marker edits remain hidden by unfinished code", () => {
    const tree = fixtureTree();
    const appended = appendIncomingContent(tree, "first", "````ts\nconst unfinished = true;").metadata;
    const source = buildBranchDocument("", linearizeTree(appended).body, appended, fixtureOutput())
      .replace('id="second" parent="root" order="1"', 'id="second" parent="first" order="2"')
      .replace("Second", "Externally edited");
    expect(() => loadImportedBranchDocument(source)).toThrowError(/ambiguous/i);
  });

  it.each(["```", "````"])("does not let a later card's source fence complete the receiving %s scope", fence => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    tree.blocks.find(block => block.id === "leaf")!.content = `${fence}ts\nconst child = true;\n${fence}`;
    const appended = appendIncomingContent(tree, "first", `${fence}ts\nconst unfinished = true;`).metadata;
    const source = buildBranchDocument("", linearizeTree(appended).body, appended, fixtureOutput());
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.metadata.blocks.map(block => [block.id, block.content, block.after])).toEqual(
      appended.blocks.map(block => [block.id, block.content, block.after])
    );
    expect(reopened.outputState).toEqual(fixtureOutput());
  });

  it("does not turn closed examples of existing card IDs into real boundaries", () => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    tree.blocks[1].content = '````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nLiteral leaf\n````';
    const appended = appendIncomingContent(tree, "first", "```ts\nconst unfinished = true;").metadata;
    const reopened = loadImportedBranchDocument(buildBranchDocument("", linearizeTree(appended).body, appended));
    expect(reopened.metadata.blocks.map(block => [block.id, block.content, block.after])).toEqual(
      appended.blocks.map(block => [block.id, block.content, block.after])
    );
  });

  it("does not promote fenced example markers from a topology-only footer", () => {
    const tree = fixtureTree();
    const body = `Example\n\n\`\`\`\`md\n${linearizeTree(tree).body}\n\`\`\`\``;
    const reopened = loadImportedBranchDocument(buildBranchDocument("", body, tree));
    expect(reopened.origin).toBe("imported");
    expect(reopened.metadata.blocks).toHaveLength(1);
    expect(reopened.metadata.blocks[0].content).toBe(body);
    expect(reopened.metadata.blocks[0].id).not.toBe("root");
  });

  it.each(["nonmanaged", "legacy"])("preserves closed known-ID marker examples in %s notes", format => {
    const tree = fixtureTree();
    tree.blocks[1].content = 'Example\n\n````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nliteral\n````';
    tree.blocks[3].after = "\n\n";
    tree.blocks[2].after = "";
    const body = linearizeTree(tree).body;
    const footer = format === "legacy" ? `\n<!-- arbor:metadata:v1:${Buffer.from(JSON.stringify(tree), "utf8").toString("base64")} -->` : "";
    const reopened = loadImportedBranchDocument(body + footer);
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
    expect(reopened.metadata.blocks.map(({ id, parentId, order, content, after }) => ({ id, parentId, order, content, after })).sort(byId))
      .toEqual(tree.blocks.map(({ id, parentId, order, content, after }) => ({ id, parentId, order, content, after })).sort(byId));
  });

  it("does not restore a deleted card from stale structure metadata", () => {
    const tree = fixtureTree();
    const edited = structuredClone(tree);
    edited.blocks = edited.blocks.filter(block => block.id !== "leaf");
    const source = buildBranchDocument("", linearizeTree(edited).body, tree, fixtureOutput());
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.metadata.blocks.map(block => block.id)).toEqual(["root", "first", "second"]);
  });
});

describe("literal code read boundaries", () => {
  it.each(["inline-marker", "fenced-footer"])("keeps accepted %s byte-exact through real serialization and reopen", kind => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    const content = kind === "inline-marker"
      ? 'Example: `code\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\ncode`.'
      : `\`\`\`\`md\n${buildStructureBlock(fixtureTree())}\n\`\`\`\``;
    expect(validateIncoming(content, "plain").kind).toBe("content");
    tree.blocks[1].content = content;
    const source = buildBranchDocument("", linearizeTree(tree).body, tree);
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.origin).toBe("metadata");
    expect(reopened.metadata.blocks).toEqual(tree.blocks);
    expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata)).toBe(source);
  });

  it.each([
    '```md\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\n^arbor-example\n```',
    '~~~~md\n~~~\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\n~~~~',
    `\`\`\`\`md\n${buildOutputBlock(fixtureOutput())}\n\`\`\`\``,
    '> ```md\n> <!-- arbor:block:v1 id="example" parent="" order="0" -->\n> ```',
    '- Example:\n  ```md\n  <!-- arbor:block:v1 id="example" parent="" order="0" -->\n  ```'
  ])("keeps fenced marker, anchor and output examples with real controls untouched (%j)", content => {
    const tree = fixtureTree();
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    tree.blocks[1].content = content;
    tree.blocks[1].appearance = { cardColor: "#123456" };
    const output = fixtureOutput();
    const source = buildBranchDocument("", linearizeTree(tree).body, tree, output);
    expect(validateIncoming(content, "plain").kind).toBe("content");
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.origin).toBe("metadata");
    expect(reopened.metadata.blocks).toEqual(tree.blocks);
    expect(reopened.outputState).toEqual(output);
    expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(source);
  });

  it("changes only the actual orientation footer, not the literal fenced structure example", () => {
    const tree = fixtureTree();
    tree.blocks[1].content = `\`\`\`\`md\n${buildStructureBlock(tree)}\n\`\`\`\``;
    const source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const updated = updateStoredOverviewOrientation(source, "vertical-top-down", tree);
    const before = parseBranchDocument(source);
    const after = parseBranchDocument(updated);
    expect(after.body).toBe(before.body);
    expect(after.outputRaw).toBe(before.outputRaw);
    expect(after.metadata?.overviewOrientation).toBe("vertical-top-down");
    expect(loadImportedBranchDocument(updated).metadata.blocks.find(block => block.id === "first")?.content).toBe(tree.blocks[1].content);
  });

  it("does not extract a literal suffix structure or output example when there is no actual footer", () => {
    for (const footer of [buildStructureBlock(fixtureTree()), buildOutputBlock(fixtureOutput())]) {
      const source = `Example\n\n\`\`\`\`md\n${footer}\n\`\`\`\`\n`;
      const parsed = parseBranchDocument(source);
      expect(parsed.body).toBe(source);
      expect(parsed.metadataRaw).toBe("");
      expect(parsed.outputRaw).toBe("");
    }
  });
});

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
    expect(linearized.body).not.toContain("^arbor-root-1");
    expect(linearized.body.indexOf("Child paragraph")).toBeGreaterThan(linearized.body.indexOf("# Heading"));
    expect(linearized.body.indexOf("Second root section")).toBeGreaterThan(linearized.body.indexOf("Child paragraph"));
  });

  it("keeps a child marker on its own line when a former leaf has no separator", () => {
    const metadata: BranchTreeMetadata = {
      version: 1,
      prefix: "",
      blocks: [
        { id: "parent", parentId: null, order: 0, content: "Parent", after: "" },
        { id: "child", parentId: "parent", order: 0, content: "Child", after: "" }
      ]
    };

    const body = linearizeTree(metadata).body;
    const loaded = loadImportedBranchDocument(body);

    expect(body).toContain('Parent\n\n<!-- arbor:block:v1 id="child"');
    expect(loaded.metadata.blocks.map((block) => [block.id, block.content])).toEqual([
      ["parent", "Parent"],
      ["child", "Child"]
    ]);
  });

  it("strips legacy native Arbor anchors from block content", () => {
    const metadata = metadataFixture();
    const legacyBody = linearizeTree(metadata).body.replace(
      '<!-- arbor:block:v1 id="root-1" parent="" order="0" -->\n',
      '<!-- arbor:block:v1 id="root-1" parent="" order="0" -->\n^arbor-root-1\n'
    );
    const loaded = loadImportedBranchDocument(legacyBody);

    expect(loaded.metadata.blocks[0].content).toBe(metadata.blocks[0].content);
    expect(loaded.metadata.blocks[0].content).not.toContain("^arbor-root-1");
  });

  it("round-trips metadata inside the same markdown note", () => {
    const metadata = metadataFixture();
    const linearized = linearizeTree(metadata);
    const note = buildBranchDocument("---\naliases: []\n---\n", linearized.body, metadata);
    const parsed = parseBranchDocument(note);
    expect(parsed.frontmatter.startsWith("---")).toBe(true);
    expect(parsed.body).toBe(linearized.body);
    expect(parsed.metadata?.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
  });

  it("round-trips output metadata before the terminal structure footer", () => {
    const metadata = metadataFixture();
    const outputState: ArborOutputState = {
      version: 1,
      activeProfileId: "draft",
      profiles: [{
        id: "draft",
        name: "Draft",
        rules: [{ blockId: "child-1", state: "exclude" }]
      }]
    };
    const note = buildBranchDocument("", linearizeTree(metadata).body, metadata, outputState);

    expect(note).toMatch(/^.+\n%% arbor:output\n```json/m);
    expect(note.indexOf("%% arbor:output")).toBeLessThan(note.indexOf("%% arbor:structure"));
    const parsed = parseBranchDocument(note);
    expect(parsed.outputState).toEqual(outputState);
    expect(parsed.outputRaw).toBe(buildOutputBlock(outputState));
    expect(parsed.outputError).toBeNull();
    expect(parsed.body).not.toContain("arbor:output");
  });

  it("loads the clean default output state when output metadata is absent", () => {
    const metadata = metadataFixture();
    const note = buildBranchDocument("", linearizeTree(metadata).body, metadata);

    expect(parseBranchDocument(note).outputState).toEqual(createDefaultOutputState());
    expect(loadImportedBranchDocument(note).outputState).toEqual(createDefaultOutputState());
    expect(note).not.toContain("arbor:output");
  });

  it("preserves malformed output metadata byte-for-byte during a tree-only save", () => {
    const metadata = metadataFixture();
    const malformedOutput = [
      "%% arbor:output",
      "```json",
      "{\"arbor-plugin\":\"output\",\"version\":1,\"active\":\"missing\",\"profiles\":[]}",
      "```",
      "%%"
    ].join("\n");
    const note = [linearizeTree(metadata).body, malformedOutput, buildStructureBlock(metadata)].join("\n\n");
    const parsed = parseBranchDocument(note);
    const loaded = loadImportedBranchDocument(note);

    expect(parsed.outputRaw).toBe(malformedOutput);
    expect(parsed.outputError).toBeTruthy();
    expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
    expect(loaded.outputRaw).toBe(malformedOutput);
    expect(loaded.outputError).toBe(parsed.outputError);

    const saved = buildBranchDocument(
      parsed.frontmatter,
      linearizeTree(loaded.metadata).body,
      loaded.metadata,
      loaded.outputState,
      loaded.outputRaw
    );
    expect(saved).toContain(`\n${malformedOutput}\n\n%% arbor:structure`);
    expect(saved.split(malformedOutput)).toHaveLength(2);
  });

  it("preserves malformed CRLF output metadata byte-for-byte during a tree-only save", () => {
    const metadata = metadataFixture();
    const malformedOutput = [
      "%% arbor:output",
      "```json",
      "{\"arbor-plugin\":\"output\",\"version\":1,\"active\":\"missing\",\"profiles\":[]}",
      "```",
      "%%"
    ].join("\r\n");
    const note = [linearizeTree(metadata).body, malformedOutput, buildStructureBlock(metadata)].join("\r\n\r\n");
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.outputRaw).toBe(malformedOutput);

    const saved = buildBranchDocument(
      "",
      linearizeTree(loaded.metadata).body,
      loaded.metadata,
      loaded.outputState,
      loaded.outputRaw
    );
    expect(saved).toContain(`\n${malformedOutput}\n\n%% arbor:structure`);
  });

  it("drops output rules whose block IDs do not survive tree recovery", () => {
    const metadata = metadataFixture();
    const outputState: ArborOutputState = {
      version: 1,
      activeProfileId: "draft",
      profiles: [{
        id: "draft",
        name: "Draft",
        rules: [
          { blockId: "missing", state: "include" },
          { blockId: "root-1", state: "exclude" }
        ]
      }]
    };
    const note = buildBranchDocument("", linearizeTree(metadata).body, metadata, outputState);

    expect(loadImportedBranchDocument(note).outputState.profiles[0].rules).toEqual([
      { blockId: "root-1", state: "exclude" }
    ]);
  });

  it("keeps the note readable even if the plugin is disabled", () => {
    const metadata = metadataFixture();
    const linearized = linearizeTree(metadata);
    const note = buildBranchDocument("", linearized.body, metadata);
    expect(note).toContain("# Heading");
    expect(note).toContain("Second root section");
    expect(note).toContain("%% arbor:structure");
  });

  it("writes a readable v2 structure footer without duplicated content or hashes", () => {
    const metadata = metadataFixture();
    const note = buildBranchDocument("", linearizeTree(metadata).body, metadata);

    expect(note).toContain("%% arbor:structure");
    expect(note).toContain('"arbor-plugin": "tree"');
    expect(note).toContain('"id": "root-1"');
    expect(note).toContain('"parent": null');
    expect(note).toContain('"order": 0');
    expect(note).not.toContain("arbor:metadata:v1");
    expect(note).not.toContain("lastLinearHash");
    expect(note).not.toContain('"content"');

    const structureJson = note.match(/%% arbor:structure\n```json\n([\s\S]*?)\n```\n%%\n?$/)?.[1];
    if (!structureJson) {
      throw new Error("Expected the terminal structure footer JSON.");
    }
    const structure = JSON.parse(structureJson) as { blocks: Array<Record<string, unknown>> };
    expect(structure.blocks).toHaveLength(metadata.blocks.length);
    expect(structure.blocks).toEqual(metadata.blocks.map((block) => ({
      id: block.id,
      parent: block.parentId,
      order: block.order
    })));
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

  it("parses readable structure footers", () => {
    const block = buildStructureBlock(metadataFixture());
    expect(block).toContain("%% arbor:structure");
    const parsed = parseBranchDocument(`Visible body\n\n${block}`);
    expect(parsed.metadata?.blocks).toHaveLength(3);
    expect(parsed.storageFormat).toBe("structure-v2");
  });

  it("does not parse a structure footer example inside a fenced code block", () => {
    const example = ["```md", buildStructureBlock(metadataFixture()), "```", "", "# Normal note"].join("\n");
    expect(parseBranchDocument(example).storageFormat).toBeNull();
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
    const note = buildBranchDocument("", visibleBody, staleMetadata);
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("metadata");
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
    const note = buildBranchDocument("", visibleBody, staleMetadata);
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("metadata");
    expect(loaded.staleMetadata).toBeNull();
    expect(loaded.metadata.blocks[0].content).toContain("# Heading");
  });

  it("flags metadata-only notes as legacy so they can be migrated exactly", () => {
    const metadata = metadataFixture();
    const legacyBody = legacyLinearize(metadata);
    const legacy = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}\n-->`;
    const note = `${legacyBody}\n${legacy}`;
    const loaded = loadImportedBranchDocument(note);

    expect(loaded.origin).toBe("legacy");
    expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(metadata.blocks.map((block) => block.id));
  });

  it.each(["multiline", "compact-url-safe"])("loads %s legacy trees without Node Buffer and preserves Unicode and hierarchy", (format) => {
    const metadata: BranchTreeMetadata = {
      version: 1,
      prefix: "",
      blocks: [
        { id: "корінь-🌳", parentId: null, order: 0, content: "# Дерево 🌳", after: "\n\n" },
        { id: "гілка-🌿", parentId: "корінь-🌳", order: 0, content: "Дочірній блок: думки й ідеї 🌿", after: "" }
      ]
    };
    const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");
    const footer = format === "multiline"
      ? `<!-- arbor:metadata:v1\n${encoded.match(/.{1,40}/g)!.join("\n")}\n-->`
      : `<!-- arbor:metadata:v1:${encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")} -->`;
    const note = `${legacyLinearize(metadata)}\n${footer}`;
    let loaded: ReturnType<typeof loadImportedBranchDocument>;
    vi.stubGlobal("Buffer", undefined);
    try {
      loaded = loadImportedBranchDocument(note);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(loaded.origin).toBe("legacy");
    expect(loaded.metadata.blocks.map(({ id, parentId, content }) => ({ id, parentId, content }))).toEqual(
      metadata.blocks.map(({ id, parentId, content }) => ({ id, parentId, content }))
    );
  });

  it("marks legacy v1 notes with visible markers for automatic footer migration", () => {
    const metadata = metadataFixture();
    const visibleBody = linearizeTree(metadata).body;
    const legacyFooter = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}\n-->`;
    const loaded = loadImportedBranchDocument(`${visibleBody}\n${legacyFooter}`);

    expect(loaded.origin).toBe("metadata");
    expect(loaded.needsVisibleMarkerMigration).toBe(true);
  });

  it("preserves block boundaries for legacy notes with plain-markdown drift", () => {
    const metadata = metadataFixture();
    const legacyBody = legacyLinearize(metadata).replace(
      "Child paragraph\n\nSecond paragraph",
      "Child paragraph\n\nInserted line\n\nSecond paragraph"
    );
    const legacy = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}\n-->`;
    const note = `${legacyBody}\n${legacy}`;
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
