import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compactColumns, pinchViewport, resolvePinchZoom, shouldSaveOnEnter, useCompactLayout } from "../src/mobile";
import { buildColumnModels } from "../src/model/tree";
import type { BranchTreeMetadata } from "../src/types";

describe("mobile interaction policy", () => {
  it("uses the actual leaf width, ignoring unmeasured leaves", () => {
    expect([0, 360, 600, 601, 1024].map(useCompactLayout)).toEqual([false, true, true, false, false]);
  });
  it("shows selected siblings and preserves their order and IDs", () => {
    const metadata: BranchTreeMetadata = { version: 1, prefix: "", blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "" },
      { id: "a", parentId: "root", order: 0, content: "A", after: "" },
      { id: "b", parentId: "root", order: 1, content: "B", after: "" }
    ] };
    const columns = compactColumns(buildColumnModels(metadata, "b", 200), "b");
    expect(columns).toHaveLength(1);
    expect(columns[0].blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(compactColumns([], null)).toEqual([]);
  });
  it("keeps mobile newline and IME input, retaining desktop Enter and explicit save shortcut", () => {
    const event = { key: "Enter", shiftKey: false, isComposing: false, ctrlKey: false, metaKey: false };
    expect(shouldSaveOnEnter(event, true)).toBe(false);
    expect(shouldSaveOnEnter(event, false)).toBe(true);
    expect(shouldSaveOnEnter({ ...event, ctrlKey: true }, true)).toBe(true);
    expect(shouldSaveOnEnter({ ...event, metaKey: true, isComposing: true }, true)).toBe(false);
    expect(shouldSaveOnEnter({ ...event, shiftKey: true }, false)).toBe(false);
  });
  it("anchors pinch zoom to the fingers, including movement and scale limits", () => {
    const start = { zoom: 1, left: 100, top: 200, midpoint: { x: 100, y: 100 }, distance: 100 };
    expect(pinchViewport(start, { x: 120, y: 110 }, 150)).toEqual({ zoom: 1.5, left: 180, top: 340 });
    expect(pinchViewport(start, { x: 100, y: 100 }, 400).zoom).toBe(1.6);
    expect(pinchViewport(start, { x: 100, y: 100 }, 10).zoom).toBe(0.25);
  });

  it("uses the same bounded pinch scale for the branch editor and Tree Overview", () => {
    expect(resolvePinchZoom(1, 100, 125)).toBe(1.25);
    expect(resolvePinchZoom(1.4, 80, 160)).toBe(1.6);
    expect(resolvePinchZoom(0.6, 100, 20)).toBe(0.25);
  });

  it("scales the complete compact Branch Editor scene instead of only its text", () => {
    const styles = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
    const compactStart = styles.indexOf(".arbor-view.is-compact .arbor-columns-viewport");
    const compactBranchStyles = styles.slice(
      compactStart,
      styles.indexOf(".arbor-overview-viewport", compactStart)
    );

    expect(compactBranchStyles).toContain("overflow-x: auto;");
    expect(compactBranchStyles).toContain("width: calc(100% * var(--bw-zoom));");
    expect(compactBranchStyles).toContain("min-width: calc(100% * var(--bw-zoom));");
    expect(compactBranchStyles).toContain("gap: calc(12px * var(--bw-zoom));");
    expect(compactBranchStyles).toContain("padding: calc(16px * var(--bw-zoom));");
    expect(compactBranchStyles).toContain("min-height: calc(100px * var(--bw-zoom));");
    expect(compactBranchStyles).toContain("font-size: calc(16px * var(--bw-content-zoom));");
  });
});
