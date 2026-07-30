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
});
