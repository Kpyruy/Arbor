import { describe, expect, it } from "vitest";
import { readSource, sourceClass, sourceMethod } from "./helpers/viewSource";

describe("view shell extraction", () => {
  it("keeps the shell nodes and persistent mode controls inside the shell owner", () => {
    const shell = sourceClass("src/view/chrome/ViewShell.ts", "ViewShell");
    const source = readSource("src/view/chrome/ViewShell.ts");

    expect(source).toContain("export interface ShellElements");
    expect(source).toContain("modeControlsEl: HTMLElement | null");
    expect(shell).toContain("const modeControlsEl = bodyEl.createDiv({ cls: \"arbor-mode-controls\" })");
    expect(shell).toContain("const controlsHost = this.usesTouchControls() ? this.elements.frameEl : this.elements.bodyEl");
  });

  it("keeps breadcrumb exit geometry with the breadcrumb owner", () => {
    const breadcrumbs = sourceClass("src/view/chrome/BreadcrumbsController.ts", "BreadcrumbsController");

    expect(breadcrumbs).toContain("exitLayerEl.empty();");
    expect(breadcrumbs).toContain("window.matchMedia(\"(prefers-reduced-motion: reduce)\").matches");
    expect(breadcrumbs).toContain("left: `${buttonRect.left - frameRect.left}px`");
  });

  it("exports real shell mode-switch and click validation for Obsidian runtime", () => {
    const host = readSource("tests/host/arborViewChecks.ts");

    expect(host).toContain("checkViewShellHost");
    expect(host).toContain("fixture.setMode(mode)");
    expect(host).toContain("fixture.getMode() === mode");
    expect(host).toContain("shell.showMode(mode)");
    expect(host).toContain("ownerDocument.elementFromPoint");
    expect(host).toContain("profileButton.click()");
    expect(host).toContain("overviewButton.click()");
    expect(host).toContain("getOverviewToggleCount");
  });

  it("keeps the baseline resize order: editors, viewport geometry, then selection reveal", () => {
    const resize = sourceMethod("src/view/chrome/ViewShell.ts", "ViewShell", "handleMobileResize");
    const editors = resize.indexOf("this.port.resizeEditors()");
    const measure = resize.indexOf("const rect = this.contentEl.getBoundingClientRect()");
    const height = resize.indexOf('"--arbor-mobile-height"');
    const reveal = resize.indexOf("this.port.onResizeDuringEdit()");

    for (const anchor of [editors, measure, height, reveal]) {
      expect(anchor).toBeGreaterThanOrEqual(0);
    }
    expect(measure).toBeGreaterThan(editors);
    expect(height).toBeGreaterThan(measure);
    expect(reveal).toBeGreaterThan(height);
  });

  it("keeps output profile modal cloning on the established clone helpers", () => {
    const menus = sourceClass("src/view/chrome/ViewMenus.ts", "ViewMenus");

    expect(menus).toContain("deepClone(state.outputState)");
    expect(menus).toContain("cloneMetadata(state.metadata)");
    expect(menus).not.toContain("structuredClone(state.outputState)");
  });

  it("keeps the baseline tree navigation helpers for touch dock availability", () => {
    const source = readSource("src/view/chrome/ViewShell.ts");
    const touchDock = sourceClass("src/view/chrome/ViewShell.ts", "ViewShell");

    expect(source).toContain("getPreferredChildBlock");
    expect(source).toContain("getPreviousSibling");
    expect(source).toContain("getNextSibling");
    expect(touchDock).toContain("!getParentBlock(tree, id)");
    expect(touchDock).toContain("!getPreviousSibling(tree, id)");
    expect(touchDock).toContain("!getNextSibling(tree, id)");
    expect(touchDock).toContain("!getPreferredChildBlock(tree, id)");
  });
});
