import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

describe("default presentation mode", () => {
  it("defaults to the branch editor and restores the selected startup mode when a note opens", () => {
    expect(readProjectFile("src/settings.ts")).toContain('defaultPresentationMode: "editor"');
    expect(readProjectFile("src/view/ArborView.ts")).toContain("this.presentationMode = this.plugin.settings.defaultPresentationMode;");
  });

  it("places the overview switch in the canvas and relies on one accessible tooltip", () => {
    const source = readProjectFile("src/view/ArborView.ts");

    expect(source).toContain('this.overviewButtonEl = this.bodyEl.createEl("button"');
    expect(source).toContain('attr: { type: "button", "aria-label": "Open tree overview" }');
  });

  it("centres the selected block only when opening the overview", () => {
    const source = readProjectFile("src/view/ArborView.ts");

    expect(source).toContain("private shouldCenterOverviewOnNextRender = false;");
    expect(source).toContain("this.shouldCenterOverviewOnNextRender = true;\n      this.presentationMode = \"overview\";");
    expect(source).toContain("if (this.shouldCenterOverviewOnNextRender) {");
  });

  it("places floating controls opposite the reading direction", () => {
    const styles = readProjectFile("styles.css");
    const topControls = styles.slice(
      styles.indexOf(".arbor-zoom-indicator,"),
      styles.indexOf(".arbor-breadcrumb-connector::before")
    );
    const overviewControls = styles.slice(
      styles.indexOf(".arbor-overview-exit,"),
      styles.indexOf(".arbor-overview-exit svg")
    );
    const baseOverviewControls = overviewControls.slice(0, overviewControls.indexOf(".arbor-view.is-rtl"));
    const rtlTopControls = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-zoom-indicator,"),
      styles.indexOf(".arbor-markdown-button svg,")
    );
    const rtlOverviewControls = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-overview-exit,"),
      styles.indexOf(".arbor-overview-exit svg,")
    );

    expect(topControls).toContain("right: 4px;");
    expect(topControls).toContain("right: 84px;");
    expect(overviewControls).toContain("right: 12px;");
    expect(baseOverviewControls).not.toContain("left: 12px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-zoom-indicator");
    expect(rtlTopControls).toContain("left: 84px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-overview-button");
    expect(rtlOverviewControls).toContain("left: 12px;");
  });

  it("reserves the control edge before laying out breadcrumbs", () => {
    const styles = readProjectFile("styles.css");
    const breadcrumbs = styles.slice(
      styles.indexOf(".arbor-breadcrumbs {"),
      styles.indexOf(".arbor-breadcrumbs button,")
    );
    const rtlBreadcrumbs = styles.slice(
      styles.indexOf(".arbor-view.is-rtl .arbor-breadcrumbs"),
      styles.indexOf(".arbor-breadcrumbs button,")
    );

    expect(breadcrumbs).toContain("margin-right: 168px;");
    expect(rtlBreadcrumbs).toContain("margin-left: 168px;");
    expect(styles).not.toContain("clip-path:");
    expect(styles).not.toContain(".arbor-breadcrumbs::after");
    expect(styles).toContain(".arbor-frame::before");
  });

  it("animates only the newly active breadcrumb", () => {
    const styles = readProjectFile("styles.css");
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
    const view = readProjectFile("src/view/ArborView.ts");
    const selectBlock = view.slice(
      view.indexOf("  selectBlock(blockId:"),
      view.indexOf("  async createRootBlock()")
    );

    expect(selectBlock).toContain("if (selectionChanged) {\n      this.stopHorizontalScrollMotion(false);");
    expect(selectBlock.indexOf("this.stopHorizontalScrollMotion(false);")).toBeLessThan(
      selectBlock.indexOf("this.pendingScrollBlockId = this.state.selectedBlockId;")
    );
  });

  it("reserves the next column layout before synchronizing editor cards", () => {
    const view = readProjectFile("src/view/ArborView.ts");

    expect(view).toContain("this.armSceneWidthForPendingScroll(columns.length)");
    expect(view.indexOf("this.armSceneWidthForPendingScroll(columns.length)")).toBeLessThan(
      view.indexOf("await this.syncColumns(columns, this.viewContext);")
    );
  });

  it("gives the newly selected card an explicit focus-entry animation", () => {
    const view = readProjectFile("src/view/ArborView.ts");
    const styles = readProjectFile("styles.css");

    expect(view).toContain("this.animateSelectedCard(pendingScrollBlockId)");
    expect(view).toContain('card.addClass("is-selection-entering")');
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
    const view = readProjectFile("src/view/ArborView.ts");
    const scrollIntoView = view.slice(
      view.indexOf("  private scrollCardIntoHorizontalView("),
      view.indexOf("  private alignColumnsToActivePath()")
    );

    expect(scrollIntoView).toContain("if (!shouldScrollLeft && !shouldScrollRight)");
    expect(scrollIntoView).not.toContain("shouldCenterSelectedBlock");
  });

  it("lets removed breadcrumbs exit instead of disappearing during parent navigation", () => {
    const view = readProjectFile("src/view/ArborView.ts");
    const styles = readProjectFile("styles.css");

    expect(view).toContain("this.animateRemovedBreadcrumbs(path)");
    expect(view).toContain('cls: "arbor-breadcrumb-exiting"');
    expect(styles).toContain(".arbor-breadcrumb-exit-layer");
    expect(styles).toContain(".arbor-breadcrumb-exiting");
    expect(styles).toContain("@keyframes arbor-breadcrumb-exit");
  });

  it("keeps the selected breadcrumb on its exit animation instead of replaying its enter animation", () => {
    const styles = readProjectFile("styles.css");

    expect(styles).toContain(".arbor-breadcrumb-exiting.is-active {\n  animation: arbor-breadcrumb-exit");
  });

  it("keeps vertical column alignment on its transform layer", () => {
    const styles = readProjectFile("styles.css");
    const cardList = styles.slice(
      styles.indexOf(".arbor-card-list {"),
      styles.indexOf(".arbor-card-list.is-rebinding {")
    );

    expect(cardList).toContain("transform: translate3d(0, var(--arbor-card-list-offset-y, 0px), 0);");
    expect(cardList).not.toContain("top: var(--arbor-card-list-offset-y, 0px);");
  });
});
