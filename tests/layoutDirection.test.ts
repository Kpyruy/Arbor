import { describe, expect, it } from "vitest";
import {
  getChildArrowKey,
  getBreadcrumbScrollInsets,
  getVisualBreadcrumbOrder,
  getHorizontalWheelDelta,
  getParentArrowKey,
  getVisualColumnOrder,
  resolveInitialLayoutDirection
} from "../src/layoutDirection";
import { readSource, sourceMethod } from "./helpers/viewSource";

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

  it("places the breadcrumb root at the physical right edge in RTL", () => {
    const semanticPath = ["root", "child", "selected"];

    expect(getVisualBreadcrumbOrder(semanticPath, "ltr")).toEqual(["root", "child", "selected"]);
    expect(getVisualBreadcrumbOrder(semanticPath, "rtl")).toEqual(["selected", "child", "root"]);
    expect(semanticPath).toEqual(["root", "child", "selected"]);
  });

  it("keeps the active breadcrumb clear of the controls on either edge", () => {
    expect(getBreadcrumbScrollInsets("ltr")).toEqual({ left: 28, right: 28 });
    expect(getBreadcrumbScrollInsets("rtl")).toEqual({ left: 28, right: 28 });
  });

  it("keeps RTL breadcrumbs in a scrollable left-to-right track", () => {
    const styles = readSource("styles.css");
    const rtlBreadcrumbs = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-breadcrumbs"),
      styles.indexOf(".arbor-breadcrumbs button,")
    );

    expect(rtlBreadcrumbs).not.toContain("flex-direction: row-reverse;");
    expect(rtlBreadcrumbs).toContain("margin-left: 208px;");
    expect(rtlBreadcrumbs).not.toContain("clip-path:");
  });

  it("keeps RTL breadcrumb steps compact around their directional connector", () => {
    const styles = readSource("styles.css");
    const rtlBreadcrumbs = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-breadcrumbs"),
      styles.indexOf(".arbor-breadcrumbs::after")
    );

    expect(rtlBreadcrumbs).toContain("gap: 3px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-breadcrumb-connector {\n  width: 24px;");
  });

  it("mirrors the full LTR breadcrumb arrow in RTL instead of collapsing its line into the chevron", () => {
    const styles = readSource("styles.css");

    expect(styles).toContain(".arbor-view.is-rtl .arbor-breadcrumb-connector::before {\n  left: 8px;\n  right: 2px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-breadcrumb-connector::after {\n  right: auto;\n  left: 4px;");
  });

  it("exposes a top-level setting that refreshes every open Arbor view", () => {
    const settings = readSource("src/settings.ts");
    const main = readSource("src/main.ts");

    expect(settings).toContain('layoutDirection: "ltr"');
    expect(settings.indexOf('name: "Layout direction"')).toBeLessThan(settings.indexOf('name: "Default opening mode"'));
    expect(settings).toContain('"layoutDirection"');
    expect(main).toContain("resolveInitialLayoutDirection");
  });

  it("renders RTL as a CSS mirror while keeping semantic depth and card text in place", () => {
    const view = readSource("src/view/ArborView.ts");
    const renderer = readSource("src/view/branch/BranchRenderer.ts");
    const directionalCreate = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleDirectionalCreateShortcut");
    const editorArrow = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleEditorArrow");
    const styles = readSource("styles.css");

    expect(renderer).toContain("columnEl.dataset.columnDepth");
    expect(directionalCreate).toContain("getParentArrowKey(direction)");
    expect(directionalCreate).toContain("getChildArrowKey(direction)");
    expect(editorArrow).toContain("getParentArrowKey(direction)");
    expect(editorArrow).toContain("getChildArrowKey(direction)");
    expect(renderer).toContain("getHorizontalWheelDelta(event.deltaY, settings.layoutDirection)");
    expect(view).toContain('root.classList.toggle("is-rtl", this.plugin.settings.layoutDirection === "rtl")');
    expect(styles).toContain(".arbor-view.is-rtl .arbor-breadcrumbs");
    const rtlColumns = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-columns"),
      styles.indexOf(".arbor-column {")
    );

    expect(rtlColumns).toContain("direction: rtl;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-column");
    expect(styles).toContain("direction: ltr;");
  });

  it("anchors the mirrored editor scene to the right edge even while Arbor preserves viewport width", () => {
    const styles = readSource("styles.css");
    const rtlColumns = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-columns"),
      styles.indexOf(".arbor-column {")
    );

    expect(rtlColumns).toContain("justify-content: flex-start;");
    expect(rtlColumns).toContain("flex-direction: row;");
    expect(rtlColumns).toContain("margin-left: auto;");
  });

  it("snaps the selected card after changing direction instead of animating from stale scroll coordinates", () => {
    const view = readSource("src/view/ArborView.ts");
    const viewport = sourceMethod("src/view/branch/BranchViewportController.ts", "BranchViewportController", "applyPendingFocusAndScroll");

    expect(view).toContain("shouldSnapViewportAfterDirectionChange");
    expect(viewport).toContain("this.scrollCardIntoHorizontalView(scrollCard, viewport, request.preservedSceneWidth, request.snap)");
  });

  it("uses a layout-only refresh rather than rebuilding editor cards for a direction toggle", () => {
    const main = readSource("src/main.ts");
    const view = readSource("src/view/ArborView.ts");

    expect(main).toContain("view.refreshLayoutDirection()");
    expect(view).toContain("async refreshLayoutDirection(): Promise<void>");
  });
});
