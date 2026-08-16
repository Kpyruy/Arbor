import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isArborManagedText } from "../src/fileExplorerBadgeRecognition";

const badgeSource = readFileSync(fileURLToPath(new URL("../src/fileExplorerBadge.ts", import.meta.url)), "utf8");
const stylesSource = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("Arbor File Explorer badge recognition", () => {
  it("recognizes legacy hidden Arbor metadata", () => {
    expect(isArborManagedText("# Legacy\n<!-- arbor:metadata:v1\neyJ2ZXJzaW9uIjoxfQ==\n-->" )).toBe(true);
  });

  it("recognizes current structured Arbor metadata", () => {
    expect(isArborManagedText("# Current\n%% arbor:structure\n```json\n{\"arbor-plugin\":\"tree\",\"version\":2,\"blocks\":[]}\n```\n%%" )).toBe(true);
  });

  it("recognizes current structured Arbor metadata with CRLF line endings", () => {
    expect(isArborManagedText("# Current\r\n%% arbor:structure\r\n```json\r\n{\"arbor-plugin\":\"tree\",\"version\":2,\"blocks\":[]}\r\n```\r\n%%" )).toBe(true);
  });

  it("rejects invalid or foreign structured metadata", () => {
    expect(isArborManagedText("%% arbor:structure\n```json\n{}\n```\n%%")).toBe(false);
    expect(isArborManagedText("%% arbor:structure\n```json\n{\"arbor-plugin\":\"tree\",\"version\":3,\"blocks\":[]}\n```\n%%")).toBe(false);
  });

  it("does not recognize a plain Markdown note", () => {
    expect(isArborManagedText("# Plain note")).toBe(false);
  });

  it("keeps the Arbor badge outside the inline rename field", () => {
    expect(badgeSource).toContain('attributeFilter: ["data-path", "class"]');
    expect(badgeSource).toContain('const inner = content?.parentElement;');
    expect(badgeSource).toContain('inner.createSpan({ cls: "nav-file-tag arbor-file-badge", text: "ARBOR" })');
    expect(badgeSource).not.toContain('content.createSpan({ cls: "arbor-file-badge", text: "ARBOR" })');
    expect(badgeSource).not.toContain('inner?.hasClass("tree-item-inner")');
    expect(badgeSource).not.toContain("this.isInlineRenameActive(title, content)");
  });

  it("uses Obsidian's native file-tag layout instead of constraining the file name", () => {
    expect(stylesSource).not.toContain(".nav-file-title.has-arbor-file-badge");
    expect(stylesSource).not.toContain("width: calc(100% - 52px);");
  });
});
