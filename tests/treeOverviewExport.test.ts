import { describe, expect, it } from "vitest";
import {
  buildAvailableTreeOverviewExportPath,
  DEFAULT_TREE_OVERVIEW_EXPORT_QUALITY,
  resolveTreeOverviewExportLinkStyle,
  resolveTreeOverviewExportSize
} from "../src/treeOverviewExport";

describe("Tree Overview export", () => {
  it("defaults to recommended High quality", () => {
    expect(DEFAULT_TREE_OVERVIEW_EXPORT_QUALITY).toBe("high");
  });

  it("maps quality presets to lossless export dimensions", () => {
    expect(resolveTreeOverviewExportSize(800, 600, "standard")).toEqual({
      scale: 1,
      width: 800,
      height: 600
    });
    expect(resolveTreeOverviewExportSize(800, 600, "high")).toEqual({
      scale: 2,
      width: 1600,
      height: 1200
    });
    expect(resolveTreeOverviewExportSize(800, 600, "ultra")).toEqual({
      scale: 4,
      width: 3200,
      height: 2400
    });
  });

  it("rejects an export larger than the browser canvas limit", () => {
    expect(resolveTreeOverviewExportSize(5_000, 5_000, "ultra")).toBeNull();
  });

  it("keeps High usable for large but supported trees", () => {
    expect(resolveTreeOverviewExportSize(6_400, 4_700, "high")).toEqual({
      scale: 2,
      width: 12_800,
      height: 9_400
    });
  });

  it("uses an explicit theme color for export connectors instead of CSS color mixing", () => {
    expect(resolveTreeOverviewExportLinkStyle("#b3b3b3")).toEqual({
      opacity: "0.52",
      stroke: "#b3b3b3"
    });
  });

  it("creates a numbered PNG or PDF next to the source note without overwriting a file", () => {
    const existing = new Set([
      "Drafts/Essay — Tree Overview.png",
      "Drafts/Essay — Tree Overview 2.png"
    ]);

    expect(buildAvailableTreeOverviewExportPath("Drafts", "Essay", "png", (path) => existing.has(path))).toBe(
      "Drafts/Essay — Tree Overview 3.png"
    );
    expect(buildAvailableTreeOverviewExportPath("", "Essay", "pdf", () => false)).toBe(
      "Essay — Tree Overview.pdf"
    );
  });
});
