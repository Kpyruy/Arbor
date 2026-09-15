import { describe, expect, it } from "vitest";
import { buildAvailableMarkdownPath } from "../src/markdownPaths";

describe("available Markdown paths", () => {
  it("uses the requested export filename when it is free", () => {
    expect(buildAvailableMarkdownPath("Drafts", "Essay — export", () => false)).toBe(
      "Drafts/Essay — export.md"
    );
  });

  it("uses the first free numbered filename without overwriting an existing export", () => {
    const existing = new Set([
      "Drafts/Essay — export.md",
      "Drafts/Essay — export 1.md",
      "Drafts/Essay — export 2.md"
    ]);

    expect(buildAvailableMarkdownPath("Drafts", "Essay — export", (path) => existing.has(path))).toBe(
      "Drafts/Essay — export 3.md"
    );
  });

  it("does not add a leading slash in the vault root", () => {
    expect(buildAvailableMarkdownPath("", "Essay — export", () => false)).toBe("Essay — export.md");
  });

  it("normalizes Obsidian's root folder and numbers repeated exports from one", () => {
    const existing = new Set(["Essay — export.md"]);

    expect(buildAvailableMarkdownPath("/", "Essay — export", (path) => existing.has(path))).toBe(
      "Essay — export 1.md"
    );
  });
});
