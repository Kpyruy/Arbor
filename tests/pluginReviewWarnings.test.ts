import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

describe("Obsidian plugin review compatibility", () => {
  it("uses Obsidian element helpers instead of direct createElement calls", () => {
    for (const path of ["src/fileExplorerBadge.ts", "src/view/ArborView.ts"]) {
      expect(readProjectFile(path)).not.toMatch(/(?:document|ownerDocument)\.createElement(?:NS)?\(/);
    }
  });

  it("does not use Obsidian APIs newer than the declared minimum version", () => {
    const main = readProjectFile("src/main.ts");

    expect(main).toContain("noticeEl: HTMLElement");
    expect(main).not.toContain("messageEl");
  });

  it("registers declarative settings definitions for settings search", () => {
    expect(readProjectFile("src/settings.ts")).toContain("getSettingDefinitions()");
  });

  it("does not use :has selectors in plugin CSS", () => {
    expect(readProjectFile("styles.css")).not.toContain(":has(");
  });

  it("uses CSS variables instead of inline SVG export-link styles", () => {
    const view = readProjectFile("src/view/ArborView.ts");
    const styles = readProjectFile("styles.css");
    const exportStyleStart = view.indexOf("private applyTreeOverviewExportLinkStyle");
    const exportStyleEnd = view.indexOf("private async waitForTreeOverviewExportAssets", exportStyleStart);
    const exportStyle = view.slice(exportStyleStart, exportStyleEnd);

    expect(exportStyle).not.toContain("link.setCssProps");
    expect(exportStyle).toContain('"--arbor-tree-export-link-stroke"');
    expect(styles).toContain(".arbor-tree-overview-export .arbor-overview-link");
  });

  it("avoids unnecessary type assertions in plugin compatibility paths", () => {
    const main = readProjectFile("src/main.ts");
    const cardInteraction = readProjectFile("src/cardInteraction.ts");

    expect(main).not.toContain("payload.settings as unknown as Record<string, unknown>");
    expect(cardInteraction).not.toContain("target as ClosestTarget");
  });
});
