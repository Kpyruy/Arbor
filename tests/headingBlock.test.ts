import { describe, expect, it } from "vitest";
import type { CachedMetadata, HeadingCache, SectionCache } from "obsidian";
import type { BranchTreeMetadata } from "../src/types";
import { findHeadingBlock } from "../src/view/navigation/headingBlock";

const marker = (id: string, parent = "", order = 0): string =>
  `<!-- arbor:block:v1 id="${id}" parent="${parent}" order="${order}" -->`;

function position(source: string, offset: number): { line: number; col: number; offset: number } {
  const before = source.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line, col: offset - lineStart, offset };
}

function range(source: string, start: number, end: number) {
  return { start: position(source, start), end: position(source, end) };
}

function markerSection(source: string, id: string, type = "html"): SectionCache {
  const idToken = `id="${id}"`;
  const tokenOffset = source.indexOf(idToken);
  const start = source.lastIndexOf("<!-- ", tokenOffset);
  const end = source.indexOf("-->", tokenOffset) + 3;
  return {
    type,
    position: range(source, start, end)
  };
}

function headingAt(source: string, needle: string, occurrence = 0, label = needle.replace(/^#{1,6}\s*/, "")): HeadingCache {
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(needle, start + 1);
  }
  return { heading: label, level: 2, position: range(source, start, start + needle.length) };
}

function metadata(...blocks: BranchTreeMetadata["blocks"]): BranchTreeMetadata {
  return { version: 1, prefix: "", blocks };
}

function cache(sections: SectionCache[]): CachedMetadata {
  return { sections };
}

describe("findHeadingBlock", () => {
  it("maps headings to the root or deep child marker immediately before their content", () => {
    const source = [
      marker("root", "", 0), "\n## Root title\n",
      marker("child", "root", 0), "\n## Child title\n",
      marker("grandchild", "child", 0), "\n## Deep title\n"
    ].join("");
    const tree = metadata(
      { id: "root", parentId: null, order: 0, content: "## Root title\n", after: "" },
      { id: "child", parentId: "root", order: 0, content: "## Child title\n", after: "" },
      { id: "grandchild", parentId: "child", order: 0, content: "## Deep title\n", after: "" }
    );
    const parsed = cache([markerSection(source, "root"), markerSection(source, "child"), markerSection(source, "grandchild")]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Root title"))).toBe("root");
    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Child title"))).toBe("child");
    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Deep title"))).toBe("grandchild");
  });

  it("uses the core-resolved heading position for duplicate heading text", () => {
    const source = [
      marker("first", "", 0), "\n## Duplicate\n",
      marker("second", "", 1), "\n## Duplicate\n"
    ].join("");
    const tree = metadata(
      { id: "first", parentId: null, order: 0, content: "## Duplicate\n", after: "" },
      { id: "second", parentId: null, order: 1, content: "## Duplicate\n", after: "" }
    );
    const parsed = cache([markerSection(source, "first"), markerSection(source, "second")]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Duplicate", 1))).toBe("second");
  });

  it("accepts formatted and setext heading ranges resolved by the core", () => {
    const source = `${marker("root")}\n## **Bold title**\nSetext title\n---\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## **Bold title**\nSetext title\n---\n", after: "" });
    const parsed = cache([markerSection(source, "root")]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## **Bold title**", 0, "Bold title"))).toBe("root");
    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "Setext title\n---", 0, "Setext title"))).toBe("root");
  });

  it("uses full source positions across frontmatter, Unicode, and CRLF", () => {
    const source = [
      "---\r\ntitle: Кава ☕\r\n---\r\n",
      marker("café", "", 0), "\r\n^arbor-café\r\n## Розділ ☕\r\n"
    ].join("");
    const tree = metadata({ id: "café", parentId: null, order: 0, content: "## Розділ ☕\n", after: "" });
    const parsed = cache([markerSection(source, "café")]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Розділ ☕", 0, "Розділ ☕"))).toBe("café");
  });

  it("does not treat marker-looking code-section content as a block boundary", () => {
    const fake = marker("fake", "", 1);
    const source = `${marker("real")}\n\`\`\`md\n${fake}\n\`\`\`\n## Actual\n`;
    const tree = metadata({ id: "real", parentId: null, order: 0, content: `\`\`\`md\n${fake}\n\`\`\`\n## Actual\n`, after: "" });
    const parsed = cache([
      { type: "code", position: range(source, source.indexOf(fake), source.indexOf(fake) + fake.length) },
      markerSection(source, "real")
    ]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Actual"))).toBe("real");
  });

  it("rejects unknown IDs and marker text nested in a larger HTML comment", () => {
    const nestedMarker = marker("unknown");
    const nestedSource = `<!-- wrapper ${nestedMarker} -->\n## Title\n`;
    const nestedBlock = metadata({ id: "unknown", parentId: null, order: 0, content: "## Title\n", after: "" });
    const nestedCommentEnd = nestedSource.indexOf("-->\n") + 3;
    const nestedCache = cache([{ type: "html", position: range(nestedSource, 0, nestedCommentEnd) }]);
    expect(findHeadingBlock(nestedBlock, nestedCache, nestedSource, headingAt(nestedSource, "## Title"))).toBeNull();

    const source = `${marker("unknown")}\n## Title\n`;
    const tree = metadata({ id: "known", parentId: null, order: 0, content: "## Title\n", after: "" });
    expect(findHeadingBlock(tree, cache([markerSection(source, "unknown")]), source, headingAt(source, "## Title"))).toBeNull();
  });

  it("returns null when the heading is in the prefix before the first real marker", () => {
    const source = `## Prefix\n${marker("root")}\n## Body\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Body\n", after: "" });
    const parsed = cache([markerSection(source, "root")]);

    expect(findHeadingBlock(tree, parsed, source, headingAt(source, "## Prefix"))).toBeNull();
  });

  it("rejects stale and out-of-bounds cached marker positions", () => {
    const source = `${marker("root")}\n## Title\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Title\n", after: "" });
    const stale = markerSection(source, "root");
    stale.position = range(source, source.length - 1, source.length + 4);

    expect(findHeadingBlock(tree, cache([stale]), source, headingAt(source, "## Title"))).toBeNull();
    const shifted = ` ${source}`;
    expect(findHeadingBlock(tree, cache([markerSection(source, "root")]), shifted, headingAt(source, "## Title"))).toBeNull();
  });

  it("rejects headings in block footer content that is not part of the card", () => {
    const source = `${marker("root")}\n## Card\n\n# Footer\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Card\n", after: "\n\n# Footer\n" });

    expect(findHeadingBlock(tree, cache([markerSection(source, "root")]), source, headingAt(source, "# Footer"))).toBeNull();
  });

  it("rejects source content that diverges from the current block metadata", () => {
    const source = `${marker("root")}\n## Edited heading\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Old heading\n", after: "" });

    expect(findHeadingBlock(tree, cache([markerSection(source, "root")]), source, headingAt(source, "## Edited heading"))).toBeNull();
  });

  it("rejects a stale heading cache text even when the source and metadata agree", () => {
    const source = `${marker("root")}\n## Current heading\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Current heading\n", after: "" });

    expect(findHeadingBlock(tree, cache([markerSection(source, "root")]), source, headingAt(source, "## Current heading", 0, "Old heading"))).toBeNull();
  });

  it("returns null when Obsidian has no section cache to prove the marker location", () => {
    const source = `${marker("root")}\n## Title\n`;
    const tree = metadata({ id: "root", parentId: null, order: 0, content: "## Title\n", after: "" });

    expect(findHeadingBlock(tree, cache([]), source, headingAt(source, "## Title"))).toBeNull();
  });
});
