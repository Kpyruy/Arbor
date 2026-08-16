import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getChildArrowKey,
  getHorizontalWheelDelta,
  getParentArrowKey,
  getVisualColumnOrder,
  resolveInitialLayoutDirection
} from "../src/layoutDirection";

describe("Arbor layout direction", () => {
  it("uses Obsidian UI direction only for a genuinely fresh install", () => {
    expect(resolveInitialLayoutDirection({ hasStoredPluginData: false, documentDirection: "rtl" })).toBe("rtl");
    expect(resolveInitialLayoutDirection({ hasStoredPluginData: false, documentDirection: "ltr" })).toBe("ltr");
    expect(resolveInitialLayoutDirection({ hasStoredPluginData: true, documentDirection: "rtl" })).toBe("ltr");
    expect(resolveInitialLayoutDirection({ hasStoredPluginData: true, savedDirection: "rtl", documentDirection: "ltr" })).toBe("rtl");
  });

  it("maps physical arrows to the visual parent and child direction", () => {
    expect(getParentArrowKey("ltr")).toBe("ArrowLeft");
    expect(getChildArrowKey("ltr")).toBe("ArrowRight");
    expect(getParentArrowKey("rtl")).toBe("ArrowRight");
    expect(getChildArrowKey("rtl")).toBe("ArrowLeft");
  });

  it("reverses only visual placement and horizontal wheel direction in RTL", () => {
    const semanticColumns = [0, 1, 2];
    expect(getVisualColumnOrder(semanticColumns, "ltr")).toEqual([0, 1, 2]);
    expect(getVisualColumnOrder(semanticColumns, "rtl")).toEqual([2, 1, 0]);
    expect(semanticColumns).toEqual([0, 1, 2]);
    expect(getHorizontalWheelDelta(24, "ltr")).toBe(24);
    expect(getHorizontalWheelDelta(24, "rtl")).toBe(-24);
  });

  it("exposes a top-level setting that refreshes every open Arbor view", () => {
    const settings = readFileSync(fileURLToPath(new URL("../src/settings.ts", import.meta.url)), "utf8");
    const main = readFileSync(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");

    expect(settings).toContain('layoutDirection: "ltr"');
    expect(settings.indexOf('name: "Layout direction"')).toBeLessThan(settings.indexOf('name: "Default opening mode"'));
    expect(settings).toContain('"layoutDirection"');
    expect(main).toContain("resolveInitialLayoutDirection");
  });

  it("renders RTL as a visual mirror while keeping semantic depth for alignment", () => {
    const view = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

    expect(view).toContain("getVisualColumnOrder(columns, this.plugin.settings.layoutDirection)");
    expect(view).toContain("columnEl.dataset.columnDepth");
    expect(view).toContain("getParentArrowKey(this.plugin.settings.layoutDirection)");
    expect(view).toContain("getChildArrowKey(this.plugin.settings.layoutDirection)");
    expect(view).toContain("getHorizontalWheelDelta(event.deltaY, this.plugin.settings.layoutDirection)");
    expect(view).toContain('root.classList.toggle("is-rtl", this.plugin.settings.layoutDirection === "rtl")');
    expect(styles).toContain(".arbor-view.is-rtl .arbor-breadcrumbs");
  });

  it("anchors the mirrored editor scene to the right edge instead of leaving it on the LTR origin", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const rtlColumns = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-columns"),
      styles.indexOf(".arbor-column {")
    );

    expect(rtlColumns).toContain("margin-left: auto;");
  });
});
