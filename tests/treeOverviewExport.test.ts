import { describe, expect, it } from "vitest";
import {
  buildAvailableTreeOverviewExportPath,
  resolveTreeOverviewExportLinkStyle,
  resolveTreeOverviewExportSize
} from "../src/treeOverviewExport";

describe("Tree Overview export", () => {
  it("maps quality presets to lossless export dimensions", () => {
    expect(resolveTreeOverviewExportSize(800, 600, "standard")).toEqual({
      scale: 2,
      width: 1600,
      height: 1200
    });
    expect(resolveTreeOverviewExportSize(800, 600, "high")).toEqual({
      scale: 4,
      width: 3200,
      height: 2400
    });
    expect(resolveTreeOverviewExportSize(800, 600, "ultra")).toEqual({
      scale: 8,
      width: 6400,
      height: 4800
    });
  });

  it("rejects an export larger than the browser canvas limit", () => {
    expect(resolveTreeOverviewExportSize(3_000, 1_000, "ultra")).toBeNull();
  });

  it("keeps Standard usable for large but supported trees", () => {
    expect(resolveTreeOverviewExportSize(6_400, 4_700, "standard")).toEqual({
      scale: 2,
      width: 12_800,
      height: 9_400
    });
  });

  it("uses an explicit theme color for export connectors instead of CSS color mixing", () => {
    expect(resolveTreeOverviewExportLinkStyle("#b3b3b3")).toEqual({
      fill: "none",
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
