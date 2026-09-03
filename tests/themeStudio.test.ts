import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

describe("Theme Studio preview", () => {
  it("keeps section headings concise instead of adding explanatory copy", () => {
    const studio = readProjectFile("src/themeStudio.ts");

    expect(studio).not.toContain("Follows the active Obsidian theme");
    expect(studio).not.toContain("Ready-made Arbor palettes");
    expect(studio).not.toContain("Your saved palettes");
    expect(studio).not.toContain("Preview themes here, then apply one or edit your own without changing the workspace in the background.");
  });

  it("draws a branching path from the root preview node to both child cards", () => {
    const studio = readProjectFile("src/themeStudio.ts");
    const styles = readProjectFile("styles.css");
    const previewStart = studio.indexOf("private renderPreview()");
    const previewEnd = studio.indexOf("private renderEditor", previewStart);
    const preview = studio.slice(previewStart, previewEnd);

    expect(preview).toContain('tree.createDiv({ cls: "arbor-theme-studio-preview-connector" })');
    expect(styles).toContain(".arbor-theme-studio-preview-connector::after");
    expect(styles).toContain(".arbor-theme-studio-preview-branches .arbor-theme-studio-preview-node::before");
  });

  it("puts Apply and Edit ahead of duplication and marks deletion as dangerous", () => {
    const studio = readProjectFile("src/themeStudio.ts");
    const styles = readProjectFile("styles.css");
    const menuStart = studio.indexOf("private openThemeMenu");
    const menuEnd = studio.indexOf("private renderPreview", menuStart);
    const menu = studio.slice(menuStart, menuEnd);

    expect(menu.indexOf('setTitle("Apply theme")')).toBeLessThan(menu.indexOf('setTitle("Edit theme")'));
    expect(menu.indexOf('setTitle("Edit theme")')).toBeLessThan(menu.indexOf('setTitle("Duplicate theme")'));
    expect(menu).toContain('setTitle("Delete theme")\n          .setIcon("trash-2")\n          .setWarning(true)');
    expect(menu).toContain("this.styleThemeMenu(menu, theme.palette.accent)");
    expect(styles).toContain(".arbor-theme-studio-menu-apply");
    expect(styles).toContain(".arbor-theme-studio-menu-danger");
  });
});
