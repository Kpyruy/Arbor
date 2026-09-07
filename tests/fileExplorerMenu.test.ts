import { describe, expect, it } from "vitest";
import { FILE_EXPLORER_CREATION_SECTION, shouldShowNewArborMenuItem } from "../src/fileExplorerMenu";

describe("New arbor note File Explorer menu eligibility", () => {
  it("uses Obsidian's primary creation section", () => {
    expect(FILE_EXPLORER_CREATION_SECTION).toBe("action-primary");
  });

  it("shows the action for a folder", () => {
    expect(shouldShowNewArborMenuItem("folder")).toBe(true);
  });

  it("shows the action for empty File Explorer space", () => {
    expect(shouldShowNewArborMenuItem("empty")).toBe(true);
  });

  it("does not show the action for a note or other file", () => {
    expect(shouldShowNewArborMenuItem("file")).toBe(false);
  });
});
