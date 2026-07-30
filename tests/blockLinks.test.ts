import { describe, expect, it } from "vitest";
import { blockAnchor, buildArborBlockLink, parseArborBlockAnchor } from "../src/blockLinks";

describe("Arbor block links", () => {
  it("builds and parses stable native Obsidian anchors", () => {
    expect(blockAnchor("bw-x")).toBe("^arbor-bw-x");
    expect(parseArborBlockAnchor("#^arbor-bw-x")).toBe("bw-x");
    expect(parseArborBlockAnchor("#Heading")).toBeNull();
  });

  it("builds a protocol link from the existing block ID", () => {
    expect(buildArborBlockLink("Drafts/Essay.md", "bw-x", "Opening")).toBe(
      "[Opening](obsidian://arbor?file=Drafts%2FEssay.md&block=bw-x)"
    );
  });
});
