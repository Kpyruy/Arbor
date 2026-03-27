import { describe, expect, it } from "vitest";
import { extractPathLabel, getNextNumberedName } from "../src/utils";

describe("path label extraction", () => {
  it("prefers heading-style lines with the configured prefix", () => {
    const markdown = "Plain intro\n## Focus Title\nSecond line";
    expect(extractPathLabel(markdown, { preferredPrefix: "#", fallback: "firstLine" })).toBe("Focus Title");
  });

  it("falls back to the first non-empty line when no preferred prefix line exists", () => {
    const markdown = "\nPlain intro line\nAnother line";
    expect(extractPathLabel(markdown, { preferredPrefix: "#", fallback: "firstLine" })).toBe("Plain intro line");
  });

  it("can disable fallback and return the empty label placeholder", () => {
    const markdown = "Plain intro line\nAnother line";
    expect(extractPathLabel(markdown, { preferredPrefix: "#", fallback: "none" })).toBe("Empty block");
  });
});

describe("numbered note names", () => {
  it("returns the base name when no matching notes exist", () => {
    expect(getNextNumberedName(["Arbor demo", "Something else"], "Untitled")).toBe("Untitled");
  });

  it("increments from the highest numbered matching note", () => {
    expect(getNextNumberedName(["Untitled", "Untitled 2", "Untitled 6"], "Untitled")).toBe("Untitled 7");
  });

  it("starts at 1 when the plain base name already exists", () => {
    expect(getNextNumberedName(["Untitled"], "Untitled")).toBe("Untitled 1");
  });
});
