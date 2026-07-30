import { describe, expect, it } from "vitest";
import { shouldShowNewArborMenuItem } from "../src/fileExplorerMenu";

describe("New arbor note File Explorer menu eligibility", () => {
  it("shows the action for a folder", () => {
    expect(shouldShowNewArborMenuItem("folder", false)).toBe(true);
  });

  it("shows the action for empty File Explorer space", () => {
    expect(shouldShowNewArborMenuItem("empty", false)).toBe(true);
  });

  it("does not show the action for a note or other file", () => {
    expect(shouldShowNewArborMenuItem("file", false)).toBe(false);
  });

  it("does not show the action on mobile", () => {
    expect(shouldShowNewArborMenuItem("folder", true)).toBe(false);
  });
});
