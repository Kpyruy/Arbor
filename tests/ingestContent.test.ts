import { describe, expect, it } from "vitest";
import { appendIncomingContent } from "../src/model/ingestContent";
import { validateIncoming } from "../src/view/ingestion/IncomingContent";
import { buildBranchDocument } from "../src/storage/document";
import { buildStructureBlock, linearizeTree } from "../src/storage/serializer";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { fixtureOutput, fixtureTree } from "./helpers/arborFixtures";
import type { ArborOverviewOrientation } from "../src/types";

describe("appendIncomingContent", () => {
  it.each([
    ["First", "> New quote\n\n[[Books/A.pdf#page=7|Source]]", "First\n\n> New quote\n\n[[Books/A.pdf#page=7|Source]]"],
    ["", "  exact\n\n", "  exact\n\n"],
    ["First\n", "new", "First\n\nnew"],
    ["First\n\n\n", "new", "First\n\n\nnew"],
    ["First", " \n- one\n  - two\n\n```ts\nconst value = 1;\n```\n ", "First\n\n \n- one\n  - two\n\n```ts\nconst value = 1;\n```\n "],
    ["First", "first", "First\n\nfirst"]
  ])("preserves exact text and only changes the explicit receiver (%j)", (existing, markdown, expected) => {
    const tree = fixtureTree();
    const block = tree.blocks.find(candidate => candidate.id === "first")!;
    Object.assign(block, { content: existing, collapsed: true, createdAt: "old", updatedAt: "old", appearance: { cardColor: "#123456", branchColor: "#abcdef" } });
    const before = structuredClone(tree);
    const result = appendIncomingContent(tree, "first", markdown);
    const next = result.metadata.blocks.find(candidate => candidate.id === "first")!;
    expect(result.selectedBlockId).toBe("first");
    expect(next).toEqual({ ...block, content: expected, updatedAt: next.updatedAt });
    expect(next.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(next.updatedAt).not.toBe("old");
    expect(result.metadata.blocks.filter(candidate => candidate.id !== "first")).toEqual(tree.blocks.filter(candidate => candidate.id !== "first"));
    expect(tree).toEqual(before);
    expect(result.metadata).not.toBe(tree);
    expect(result.metadata.blocks[0]).not.toBe(tree.blocks[0]);
  });

  it("rejects a missing target without modifying the source or selecting a root", () => {
    const tree = fixtureTree();
    const before = structuredClone(tree);
    expect(() => appendIncomingContent(tree, "missing", "incoming")).toThrow();
    expect(tree).toEqual(before);
  });

  it.each<ArborOverviewOrientation>(["horizontal", "vertical-top-down", "vertical-bottom-up"])("round-trips references, code examples, topology, output and appearance in %s", orientation => {
    const tree = fixtureTree();
    tree.overviewOrientation = orientation;
    tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
    tree.blocks.find(block => block.id === "second")!.after = "";
    tree.blocks[1].appearance = { cardColor: "#123456", branchColor: "#abcdef" };
    const marker = '<!-- arbor:block:v1 id="example" parent="" order="0" -->';
    const markdown = `> Quote\n\n[[Books/A.pdf#page=7|Source]]\n\nExample: \`code\n${marker}\ncode\`.\n\n\`\`\`\`md\n${buildStructureBlock(fixtureTree())}\n\`\`\`\`\n\n\`\`\`md\n${marker}\n^arbor-example\n\`\`\``;
    expect(validateIncoming(markdown, "plain").kind).toBe("content");
    const before = structuredClone(tree);
    const appended = appendIncomingContent(tree, "first", markdown).metadata;
    const output = fixtureOutput();
    const source = buildBranchDocument("---\ntitle: Exact\n---\n", linearizeTree(appended).body, appended, output);
    const reopened = loadImportedBranchDocument(source);
    expect(reopened.origin).toBe("metadata");
    expect(reopened.metadata.blocks.map(({ updatedAt: _updatedAt, ...block }) => block)).toEqual(appended.blocks.map(({ updatedAt: _updatedAt, ...block }) => block));
    expect(reopened.metadata.overviewOrientation).toBe(orientation);
    expect(reopened.outputState).toEqual(output);
    expect(buildBranchDocument("---\ntitle: Exact\n---\n", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(source);
    expect(tree).toEqual(before);
  });
});
