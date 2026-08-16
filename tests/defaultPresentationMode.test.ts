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

  it("keeps Arbor floating controls at the tree origin in both directions", () => {
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

    expect(topControls).toContain("left: 4px;");
    expect(topControls).toContain("left: 84px;");
    expect(overviewControls).toContain("left: 12px;");
    expect(baseOverviewControls).not.toContain("right: 12px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-zoom-indicator");
    expect(styles).toContain("right: 84px;");
    expect(styles).toContain(".arbor-view.is-rtl .arbor-overview-button");
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

    expect(breadcrumbs).toContain("padding: 4px 14px 8px 132px;");
    expect(rtlBreadcrumbs).toContain("padding: 4px 132px 8px 14px;");
  });
});
