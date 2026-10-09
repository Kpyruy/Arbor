import { describe, expect, it } from "vitest";
import { appendIncomingContent } from "../src/model/ingestContent";
import { buildBranchDocument, parseBranchDocument, updateStoredOverviewOrientation } from "../src/storage/document";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { buildStructureBlock, linearizeTree } from "../src/storage/serializer";
import { fingerprintBody } from "../src/storage/storageFingerprint";
import { StorageAmbiguityError } from "../src/storage/sourceMap";
import { fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

interface TestRange {
  id: string;
  markerStart: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  [key: string]: unknown;
}

interface TestSourceMap {
  version: number;
  algorithm: string;
  encoding: string;
  offsets: string;
  fingerprint: string;
  descriptorChecksum: string;
  prefixEnd: number;
  ranges: TestRange[];
  [key: string]: unknown;
}

interface TestPayload {
  sourceMap: TestSourceMap;
  blocks: Array<{ id: string; parent: string | null; order: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

function combinedTree() {
  const tree = fixtureTree();
  tree.blocks[1].content = 'First\n\n````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nliteral\n````';
  tree.blocks[1].appearance = { cardColor: "#123456", branchColor: "#abcdef" };
  tree.blocks[3].content = "```ts\nconst child = true;\n```";
  tree.blocks[3].after = "\n\n";
  tree.blocks[2].after = "";
  return appendIncomingContent(tree, "first", "```ts\nconst unfinished = true;").metadata;
}

function contents(tree: ReturnType<typeof fixtureTree>) {
  return tree.blocks.map(({ id, parentId, order, content, after, appearance }) => ({ id, parentId, order, content, after, appearance }));
}

function structure(source: string): TestPayload {
  return JSON.parse(parseBranchDocument(source).metadataRaw.match(/```json\n([\s\S]*?)\n```/)![1]) as TestPayload;
}

function changeStructure(source: string, change: (payload: TestPayload) => void): string {
  const raw = parseBranchDocument(source).metadataRaw;
  const payload = structure(source);
  change(payload);
  return source.replace(raw, raw.replace(/```json\n[\s\S]*?\n```/, `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``));
}

describe("storage source evidence", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "13e228567e8249fce53337f25d7970de3bd68ab2653424c7b8f9fd05e33caedf"],
    ["Дерево 🌳 e\u0301\r\n尾", "50c8acb72e2daeea2b88c21120f3d51a460b1f2d6f327af06a8b0ec19f298507"],
    ["\ud800\udfff", "2eae90f2d4b42d1b521fde1f672ce141aa4e2565ee64b6037684cfaf634fcd98"]
  ])("matches independent UTF-16LE SHA-256 vector for %j", (body, expected) => {
    expect(fingerprintBody(body)).toBe(expected);
  });

  it("recovers the combined literal existing ID, unfinished parent and fenced child exactly", () => {
    const tree = combinedTree();
    const body = linearizeTree(tree).body;
    const source = buildBranchDocument("", body, tree, fixtureOutput());
    expect(parseBranchDocument(source).body).toBe(body);
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.origin).toBe("metadata");
    expect(contents(reopened.metadata)).toEqual(contents(tree));
    expect(reopened.outputState).toEqual(fixtureOutput());
    expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(source);
  });

  it("refuses a range descriptor shifted by one newline while the body fingerprint is unchanged", () => {
    const tree = combinedTree();
    const source = buildBranchDocument("", linearizeTree(tree).body, tree);
    const tampered = changeStructure(source, payload => {
      const range = payload.sourceMap.ranges.find(item => item.id === "first");
      if (!range) throw new Error("Missing first source range");
      range.contentEnd += 1;
    });

    expect(parseBranchDocument(tampered).body).toBe(parseBranchDocument(source).body);
    expect(() => loadImportedBranchDocument(tampered)).toThrowError(/ambiguous/i);
  });

  it.each(["", "\n", "\r\n", "Text\n\n", "Дерево 🌳 e\u0301\r\n尾\n", "\ud800\udfff"])('preserves exact content and separators for %j', content => {
    const tree = fixtureTree();
    tree.prefix = "Preface 🌿\r\n\r\n";
    tree.blocks[1].content = content;
    tree.blocks[1].after = "\r\n\r\n";
    tree.blocks[3].after = "\r\n";
    const body = linearizeTree(tree).body;
    const source = buildBranchDocument("---\r\ntitle: Tree\r\n---\r\n", body, tree);
    expect(structure(source).sourceMap).toMatchObject({ version: 1, algorithm: "sha256", encoding: "utf-16le", offsets: "utf-16" });
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.metadata.prefix).toBe(tree.prefix);
    expect(contents(reopened.metadata)).toEqual(contents(tree));
  });

  it("writes evidence only for the same tree's exact body, never a stale tree or standalone footer", () => {
    const tree = fixtureTree();
    const body = linearizeTree(tree).body;
    expect(structure(buildBranchDocument("", body, tree)).sourceMap).toBeDefined();
    expect(structure(buildBranchDocument("", body.replace("First", "Edited"), tree)).sourceMap).toBeUndefined();
    expect((JSON.parse(buildStructureBlock(tree).match(/```json\n([\s\S]*?)\n```/)![1]) as Partial<TestPayload>).sourceMap).toBeUndefined();
  });

  const corruptions: Array<[string, (payload: TestPayload) => void]> = [
    ["absent", payload => { Reflect.deleteProperty(payload, "sourceMap"); }],
    ["version", payload => { payload.sourceMap.version = 99; }],
    ["algorithm", payload => { payload.sourceMap.algorithm = "weak"; }],
    ["encoding", payload => { payload.sourceMap.encoding = "utf-8"; }],
    ["offset units", payload => { payload.sourceMap.offsets = "bytes"; }],
    ["fingerprint", payload => { payload.sourceMap.fingerprint = "0".repeat(64); }],
    ["missing range", payload => { payload.sourceMap.ranges.pop(); }],
    ["duplicate ID", payload => { payload.sourceMap.ranges[1].id = payload.sourceMap.ranges[0].id; }],
    ["unknown ID", payload => { payload.sourceMap.ranges[1].id = "unknown"; }],
    ["fractional offset", payload => { payload.sourceMap.ranges[1].contentStart += 0.5; }],
    ["unsafe integer", payload => { payload.sourceMap.ranges[1].end = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative offset", payload => { payload.sourceMap.ranges[0].markerStart = -1; }],
    ["overlap", payload => { payload.sourceMap.ranges[1].markerStart = 0; }],
    ["out of bounds", payload => { payload.sourceMap.ranges[0].contentEnd = 1000000; }],
    ["truncated partition", payload => {
      const range = payload.sourceMap.ranges.at(-1);
      if (!range) throw new Error("Missing final source range");
      range.end--;
    }],
    ["prefix gap", payload => { payload.sourceMap.prefixEnd = 1; }],
    ["range order", payload => { payload.sourceMap.ranges.reverse(); }],
    ["marker topology", payload => {
      const block = payload.blocks.find(item => item.id === "leaf");
      if (!block) throw new Error("Missing leaf metadata");
      block.parent = "root";
    }],
    ["marker sibling order", payload => {
      const block = payload.blocks.find(item => item.id === "leaf");
      if (!block) throw new Error("Missing leaf metadata");
      block.order = 5;
    }]
  ];

  it.each(corruptions)("refuses %s evidence rather than silently losing the combined card", (_name, corrupt) => {
    const tree = combinedTree();
    const source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    expect(() => loadImportedBranchDocument(changeStructure(source, corrupt))).toThrowError(/ambiguous/i);
  });

  it("refuses stale evidence after an external edit to the combined ambiguous body", () => {
    const tree = combinedTree();
    const source = buildBranchDocument("", linearizeTree(tree).body, tree).replace("const unfinished", "let unfinished");
    expect(() => loadImportedBranchDocument(source)).toThrowError(/ambiguous/i);
  });

  it.each(["stale", "invalid", "absent"])("refuses %s evidence after deleting the real leaf but leaving its closed-code literal", evidence => {
    const tree = combinedTree();
    let source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    if (evidence !== "stale") source = changeStructure(source, payload => {
      if (evidence === "absent") Reflect.deleteProperty(payload, "sourceMap");
      else payload.sourceMap.descriptorChecksum = "0".repeat(64);
    });
    const leaf = tree.blocks.find(block => block.id === "leaf")!;
    const span = `<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\n${leaf.content}${leaf.after}`;
    expect(source).toContain(span);
    const external = source.replace(span, "");
    expect(external).toContain('<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nliteral');
    expect(() => loadImportedBranchDocument(external)).toThrowError(StorageAmbiguityError);
  });

  it.each(["stale", "invalid", "absent"].flatMap(evidence => ["```", "````"].map(fence => ({ evidence, fence }))))(
    "refuses $evidence evidence when an external $fence prefix fence hides every real marker", ({ evidence, fence }) => {
    const tree = fixtureTree();
    let source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    if (evidence !== "stale") source = changeStructure(source, payload => {
      if (evidence === "absent") Reflect.deleteProperty(payload, "sourceMap");
      else payload.sourceMap.fingerprint = "0".repeat(64);
    });
    expect(() => loadImportedBranchDocument(`${fence}md\n${source}`)).toThrowError(StorageAmbiguityError);
  });

  it("reconciles a plain external edit around closed examples of known and unknown marker IDs", () => {
    const tree = fixtureTree();
    tree.blocks[3].after = "\n\n";
    tree.blocks[2].after = "";
    tree.blocks[1].content = 'First\n\n````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\n````';
    const source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const external = source.replace("First", "Externally edited");
    const reopened = loadImportedBranchDocument(external);
    tree.blocks[1].content = tree.blocks[1].content.replace("First", "Externally edited");
    expect(contents(reopened.metadata)).toEqual(contents(tree));
    expect(reopened.outputState).toEqual(fixtureOutput());
  });

  it.each(["edit", "reparent", "add", "delete", "duplicate"])("reconciles ordinary external %s without applying stale slices", action => {
    const tree = fixtureTree();
    let source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    if (action === "edit") source = source.replace("First", "External 🌳\r\nText");
    if (action === "reparent") source = source.replace('id="leaf" parent="first" order="0"', 'id="leaf" parent="root" order="2"');
    if (action === "add") source = source.replace("\n%% arbor:structure", '\n<!-- arbor:block:v1 id="new" parent="" order="1" -->\nNew\n%% arbor:structure');
    if (action === "delete") source = source.replace(/<!-- arbor:block:v1 id="leaf"[^\n]*\nLeaf/, "");
    if (action === "duplicate") {
      source = source.replace("First", 'First\n<!-- arbor:block:v1 id="root" parent="" order="0" -->\nDuplicate');
      expect(() => loadImportedBranchDocument(source)).toThrowError(/ambiguous/i);
      return;
    }
    const reopened = loadImportedBranchDocument(source);
    if (action === "edit") expect(reopened.metadata.blocks.find(block => block.id === "first")?.content).toBe("External 🌳\r\nText");
    if (action === "reparent") expect(reopened.metadata.blocks.find(block => block.id === "leaf")?.parentId).toBe("root");
    if (action === "add") expect(reopened.metadata.blocks.find(block => block.id === "new")?.content).toBe("New");
    if (action === "delete") expect(reopened.metadata.blocks.some(block => block.id === "leaf")).toBe(false);
  });

  it("never extracts a valid evidence footer shown in a closed literal code example", () => {
    const tree = fixtureTree();
    const source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const example = `\`\`\`\`md\n${source}\n\`\`\`\`\n`;
    expect(parseBranchDocument(example)).toMatchObject({ body: example, metadataRaw: "", outputRaw: "" });
  });

  it.each(["horizontal", "vertical-top-down", "vertical-bottom-up"] as const)("preserves body, output bytes and evidence on orientation-only %s save", orientation => {
    const tree = combinedTree();
    const body = linearizeTree(tree).body;
    const source = buildBranchDocument("", body, tree, fixtureOutput());
    const changed = updateStoredOverviewOrientation(source, orientation, tree);
    expect(parseBranchDocument(changed).body).toBe(body);
    expect(parseBranchDocument(changed).outputRaw).toBe(parseBranchDocument(source).outputRaw);
    expect(structure(changed).sourceMap).toEqual(structure(source).sourceMap);
    expect(loadImportedBranchDocument(changed).metadata.overviewOrientation).toBe(orientation);
  });
});
