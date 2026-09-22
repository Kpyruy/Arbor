import { describe, expect, it } from "vitest";
import { readSource, sourceClass, sourceMethod } from "./helpers/viewSource";

describe("default presentation mode", () => {
  it("defaults to the branch editor and restores the selected startup mode when a note opens", () => {
    expect(readSource("src/settings.ts")).toContain('defaultPresentationMode: "editor"');
    expect(readSource("src/view/ArborView.ts")).toContain("this.presentationMode = this.plugin.settings.defaultPresentationMode;");
  });

  it("keeps Output Preview inside the Arbor leaf and never writes while opening, refreshing or closing", () => {
    const types = readSource("src/types.ts");
    const openOutputPreview = sourceMethod("src/view/ArborView.ts", "ArborView", "openOutputPreview");
    const closeOutputPreview = sourceMethod("src/view/ArborView.ts", "ArborView", "closeOutputPreview");
    const refresh = sourceMethod("src/view/ArborView.ts", "ArborView", "refreshView");
    const outputRender = sourceMethod("src/view/preview/OutputPreviewController.ts", "OutputPreviewController", "syncOutputPreview");

    expect(types).toContain('export type ArborPresentationMode = "editor" | "overview" | "output";');
    expect(openOutputPreview).toContain('this.presentationMode = "output";');
    expect(openOutputPreview).toContain("this.render();");
    expect(openOutputPreview).not.toContain("commitEditIfNeeded");
    expect(openOutputPreview).not.toContain("persistState");
    expect(closeOutputPreview).toContain('this.presentationMode = "editor";');
    expect(closeOutputPreview).toContain("this.render();");
    expect(closeOutputPreview).not.toContain("commitEditIfNeeded");
    expect(closeOutputPreview).not.toContain("persistState");
    expect(openOutputPreview).not.toContain("vault.create");
    expect(openOutputPreview).not.toContain("vault.modify");
    expect(closeOutputPreview).not.toContain("vault.create");
    expect(closeOutputPreview).not.toContain("vault.modify");
    expect(refresh).not.toContain("persistState");
    expect(outputRender).toContain("projectOutput(metadata, state.outputState)");
    expect(outputRender).toContain("renderVersion !== this.outputRenderVersion");
    expect(outputRender).toContain("this.port.markdown.render");
    expect(outputRender).not.toContain("vault.create");
    expect(outputRender).not.toContain("vault.modify");
    expect(outputRender).not.toContain("persistState");
  });

  it("keeps the header row reserved while Output Preview hides breadcrumbs", () => {
    const styles = readSource("styles.css");
    const renderNow = sourceMethod("src/view/ArborView.ts", "ArborView", "renderNow");
    const breadcrumbs = sourceMethod("src/view/chrome/BreadcrumbsController.ts", "BreadcrumbsController", "syncBreadcrumbs");
    const reservedBreadcrumbStart = styles.indexOf(".arbor-breadcrumbs.is-reserved-hidden");
    const reservedBreadcrumbStyles = styles.slice(
      reservedBreadcrumbStart,
      styles.indexOf("}", reservedBreadcrumbStart) + 1
    );

    expect(renderNow).not.toContain('this.breadcrumbsEl?.setCssStyles({ display: "none" });');
    expect(breadcrumbs).toContain('breadcrumbs.toggleClass("is-reserved-hidden", hideBreadcrumbContent);');
    expect(breadcrumbs).toContain('breadcrumbs.setAttr("aria-hidden", hideBreadcrumbContent ? "true" : "false");');
    expect(reservedBreadcrumbStart).toBeGreaterThanOrEqual(0);
    expect(reservedBreadcrumbStyles).toContain("min-height: 40px;");
    expect(reservedBreadcrumbStyles).toContain("visibility: hidden;");
    expect(reservedBreadcrumbStyles).toContain("pointer-events: none;");
  });

  it("keeps one persistent profile and mode control layer outside presentation stages", () => {
    const source = readSource("src/view/chrome/ViewShell.ts");
    const touchDock = sourceMethod("src/view/chrome/ViewShell.ts", "ViewShell", "syncTouchDock");
    const placementStart = touchDock.indexOf("const controlsHost");
    const placementEnd = touchDock.indexOf('if (this.port.read.getMode() === "output"');
    expect(placementStart).toBeGreaterThanOrEqual(0);
    expect(placementEnd).toBeGreaterThan(placementStart);
    const controlPlacement = touchDock.slice(placementStart, placementEnd);

    expect(source).toContain('const modeControlsEl = bodyEl.createDiv({ cls: "arbor-mode-controls" });');
    expect(source).toContain("const outputProfileButtonEl = createOutputProfileButton(modeControlsEl, state.outputState);");
    expect(source).toContain('const overviewButtonEl = modeControlsEl.createEl("button"');
    expect(source).not.toMatch(/appendChild\((?:this\.elements\.)?overviewButtonEl\)/);
    expect(source).not.toMatch(/appendChild\((?:this\.elements\.)?outputProfileButtonEl\)/);
    expect(source).not.toContain('cls: "arbor-overview-exit"');
    expect(touchDock).toContain("const controlsHost = this.usesTouchControls() ? this.elements.frameEl : this.elements.bodyEl;");
    expect(touchDock).toContain("if (modeControlsEl && modeControlsEl.parentElement !== controlsHost)");
    expect(controlPlacement).not.toContain("getMode()");
    expect(source).toContain("syncOverviewModeButton(): void");
    expect(source).toContain('button.setAttr("aria-label", isOverview ? "Return to branch editor" : "Open tree overview");');
    expect(source).toContain('setIcon(button, isOverview ? "git-fork" : "map");');
  });

  it("places Output preview immediately above clean export in the view menu", () => {
    const menu = sourceMethod("src/view/chrome/ViewMenus.ts", "ViewMenus", "openViewMenu");
    const outputPreviewIndex = menu.indexOf('setTitle("Output preview")');
    const cleanExportIndex = menu.indexOf('setTitle("Export clean copy…")');

    expect(outputPreviewIndex).toBeGreaterThanOrEqual(0);
    expect(cleanExportIndex).toBeGreaterThan(outputPreviewIndex);
  });

  it("groups Tree Overview export format and quality into stable columns", () => {
    const modal = sourceClass("src/view/modals/TreeOverviewExportModal.ts", "TreeOverviewExportModal");

    expect(modal).toContain('const formatGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });');
    expect(modal).toContain('const qualityGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });');
    expect(modal).toContain('this.addFormatChoice(formatGroup, "png", "PNG image")');
    expect(modal).toContain('this.addQualityChoice(qualityGroup, "ultra", "Ultra — 4×")');
  });

  it("refreshes the same Output Preview when the active profile changes", () => {
    const wrapper = sourceMethod("src/view/ArborView.ts", "ArborView", "applyActiveOutputProfile");
    const switchProfile = sourceMethod("src/view/state/DocumentController.ts", "DocumentController", "applyActiveOutputProfile");

    expect(wrapper).toContain("this.documentController.applyActiveOutputProfile(next)");
    expect(switchProfile).toContain('await this.persistState("Switch output profile")');
    expect(switchProfile).toContain("this.port.requestRender();");
    expect(switchProfile).not.toContain("this.presentationMode =");
  });

  it("places the overview switch in the canvas and relies on one accessible tooltip", () => {
    const source = readSource("src/view/chrome/ViewShell.ts");

    expect(source).toContain('const overviewButtonEl = modeControlsEl.createEl("button"');
    expect(source).toContain('attr: { type: "button", "aria-label": "Open tree overview" }');
  });

  it("centres the selected block only when opening the overview", () => {
    const source = readSource("src/view/ArborView.ts");

    const overview = readSource("src/view/overview/TreeOverviewController.ts");

    expect(overview).toContain("private shouldCenterOverviewOnNextRender = false;");
    expect(source).toContain("this.overview.requestCenterOnNextRender();\n      this.presentationMode = \"overview\";");
    expect(overview).toContain("if (this.shouldCenterOverviewOnNextRender) {");
  });

  it("places floating controls opposite the reading direction", () => {
    const styles = readSource("styles.css");
    const topControls = styles.slice(
      styles.indexOf(".arbor-zoom-indicator,"),
      styles.indexOf(".arbor-breadcrumb-connector::before")
    );
    const modeControls = styles.slice(
      styles.indexOf(".arbor-mode-controls {"),
      styles.indexOf(".arbor-overview-button,")
    );
    const rtlTopControls = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-zoom-indicator,"),
      styles.indexOf(".arbor-markdown-button svg,")
    );
    const rtlModeControls = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-mode-controls"),
      styles.indexOf(".arbor-overview-button svg")
    );

    expect(topControls).toContain("right: 4px;");
    expect(topControls).toContain("right: 124px;");
    expect(topControls).toContain("right: 84px;");
    expect(modeControls).toContain("top: 12px;");
    expect(modeControls).toContain("right: 12px;");
    expect(modeControls).toContain("z-index: 6;");
    expect(modeControls).toContain("flex-direction: row;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-zoom-indicator");
    expect(rtlTopControls).toContain("left: 124px;");
    expect(rtlTopControls).toContain("left: 84px;");
    expect(rtlModeControls).toContain("left: 12px;");
    expect(rtlModeControls).toContain("flex-direction: row-reverse;");
    expect(styles).not.toContain(".arbor-overview-exit");
  });

  it("opens Theme studio from a dedicated toolbar button", () => {
    const source = readSource("src/view/chrome/ViewShell.ts");

    expect(source).toContain('cls: "arbor-theme-button"');
    expect(source).toContain('"aria-label": "Open theme studio"');
    expect(source).toContain("this.port.toolbar.openThemeStudio()");
  });

  it("reserves the control edge before laying out breadcrumbs", () => {
    const styles = readSource("styles.css");
    const breadcrumbs = styles.slice(
      styles.indexOf(".arbor-breadcrumbs {"),
      styles.indexOf(".arbor-breadcrumbs button,")
    );
    const rtlBreadcrumbs = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-breadcrumbs"),
      styles.indexOf(".arbor-breadcrumbs button,")
    );
    const columnsViewport = styles.slice(
      styles.indexOf(".arbor-columns-viewport {"),
      styles.indexOf(".arbor-columns-viewport:focus")
    );

    expect(breadcrumbs).toContain("margin-right: 208px;");
    expect(breadcrumbs).toContain("overflow-y: hidden;");
    expect(rtlBreadcrumbs).toContain("margin-left: 208px;");
    expect(columnsViewport).toContain("overflow-y: hidden;");
    expect(styles).not.toContain("clip-path:");
    expect(styles).not.toContain(".arbor-breadcrumbs::after");
    expect(styles).toContain(".arbor-frame::before {\n  content: \"\";\n  position: absolute;\n  z-index: 1;\n  top: 0;\n  right: 196px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-frame::before {\n  right: auto;\n  left: 196px;");
  });

  it("animates only the newly active breadcrumb", () => {
    const styles = readSource("styles.css");
    const breadcrumbButton = styles.slice(
      styles.indexOf(".arbor-breadcrumbs button,"),
      styles.indexOf(".arbor-breadcrumb-exiting {")
    );
    const activeBreadcrumb = styles.slice(
      styles.indexOf(".arbor-breadcrumbs button.is-active"),
      styles.indexOf(".arbor-breadcrumb-connector {")
    );
    const connector = styles.slice(
      styles.indexOf(".arbor-breadcrumb-connector {"),
      styles.indexOf(".arbor-breadcrumb-connector::before")
    );

    expect(breadcrumbButton).not.toContain("animation:");
    expect(connector).not.toContain("animation:");
    expect(activeBreadcrumb).toContain("animation: arbor-breadcrumb-enter");
    expect(activeBreadcrumb).not.toContain("animation-delay:");
  });

  it("cancels an in-flight editor scroll before arrow navigation renders the next selection", () => {
    const selectBlock = sourceMethod("src/view/ArborView.ts", "ArborView", "selectBlock");

    expect(selectBlock).toContain("if (selectionChanged || options?.reveal === true) {\n      this.stopHorizontalScrollMotion(false);");
    expect(selectBlock.indexOf("this.stopHorizontalScrollMotion(false);")).toBeLessThan(
      selectBlock.indexOf("this.pendingScrollBlockId = this.state.selectedBlockId;")
    );
  });

  it("reserves the next column layout before synchronizing editor cards", () => {
    const view = readSource("src/view/ArborView.ts");

    expect(view).toContain("this.armSceneWidthForPendingScroll(columns.length)");
    expect(view.indexOf("this.armSceneWidthForPendingScroll(columns.length)")).toBeLessThan(
      view.indexOf("await this.branchRenderer.syncColumns(columns, this.viewContext);")
    );
  });

  it("gives the newly selected card an explicit focus-entry animation", () => {
    const pendingFocus = sourceMethod("src/view/branch/BranchViewportController.ts", "BranchViewportController", "applyPendingFocusAndScroll");
    const viewport = sourceMethod("src/view/branch/BranchViewportController.ts", "BranchViewportController", "animateSelectedCard");
    const styles = readSource("styles.css");

    expect(pendingFocus).toContain("this.animateSelectedCard(request.scrollBlockId)");
    expect(viewport).toContain('card.classList.add("is-selection-entering")');
    expect(styles).toContain(".arbor-card.is-selection-entering");
    expect(styles).toContain("animation: arbor-card-focus-enter");
    expect(styles).toContain("@keyframes arbor-card-focus-enter");
    const focusAnimation = styles.slice(
      styles.indexOf("@keyframes arbor-card-focus-enter"),
      styles.indexOf("@media (prefers-reduced-motion: reduce)")
    );
    expect(focusAnimation).not.toContain("filter:");
  });

  it("keeps an already visible child card still during arrow navigation", () => {
    const scrollIntoView = sourceMethod("src/view/branch/BranchViewportController.ts", "BranchViewportController", "scrollCardIntoHorizontalView");

    expect(scrollIntoView).toContain("if (!shouldScrollLeft && !shouldScrollRight)");
    expect(scrollIntoView).not.toContain("shouldCenterSelectedBlock");
  });

  it("lets removed breadcrumbs exit instead of disappearing during parent navigation", () => {
    const view = readSource("src/view/chrome/BreadcrumbsController.ts");
    const styles = readSource("styles.css");

    expect(view).toContain("this.animateRemovedBreadcrumbs(path)");
    expect(view).toContain('cls: "arbor-breadcrumb-exiting"');
    expect(styles).toContain(".arbor-breadcrumb-exit-layer");
    expect(styles).toContain(".arbor-breadcrumb-exiting");
    expect(styles).toContain("@keyframes arbor-breadcrumb-exit");
  });

  it("keeps the selected breadcrumb on its exit animation instead of replaying its enter animation", () => {
    const styles = readSource("styles.css");

    expect(styles).toContain(".arbor-breadcrumb-exiting.is-active {\n  animation: arbor-breadcrumb-exit");
  });

  it("keeps vertical column alignment on its transform layer", () => {
    const styles = readSource("styles.css");
    const cardList = styles.slice(
      styles.indexOf(".arbor-card-list {"),
      styles.indexOf(".arbor-card-list.is-rebinding {")
    );

    expect(cardList).toContain("transform: translate3d(0, var(--arbor-card-list-offset-y, 0px), 0);");
    expect(cardList).not.toContain("top: var(--arbor-card-list-offset-y, 0px);");
  });
});
