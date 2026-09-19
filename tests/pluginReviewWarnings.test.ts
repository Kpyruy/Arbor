import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { readSource, sourceMethod } from "./helpers/viewSource";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function viewSourcePaths(relativeDirectory = "src/view"): string[] {
  return readdirSync(join(projectRoot, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return viewSourcePaths(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function staticStyleAssignments(path: string): string[] {
  const source = ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true);
  const assignments: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isPropertyAccessExpression(node.left.expression) &&
      node.left.expression.name.text === "style"
    ) {
      assignments.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return assignments;
}

describe("Obsidian plugin review compatibility", () => {
  it("uses Obsidian element helpers instead of direct createElement calls", () => {
    const paths = [
      "src/fileExplorerBadge.ts",
      "src/main.ts",
      "src/view/OutputProfilesModal.ts",
      ...viewSourcePaths()
    ];

    for (const path of paths) {
      expect(readSource(path)).not.toMatch(/(?:document|ownerDocument)\.createElement(?:NS)?\(/);
      expect(staticStyleAssignments(path)).toEqual([]);
    }
  });

  it("keeps extracted modal and overview DOM owners present", () => {
    expect(readSource("src/view/modals/ArborConfirmModal.ts")).toContain("export class ArborConfirmModal");
    expect(readSource("src/view/modals/CleanExportModal.ts")).toContain("export class CleanExportModal");
    expect(readSource("src/view/modals/TreeOverviewExportModal.ts")).toContain("export class TreeOverviewExportModal");
    expect(readSource("src/view/overview/overviewDom.ts")).toContain("export function renderOverviewLinks(");
  });

  it("does not use Obsidian APIs newer than the declared minimum version", () => {
    const main = readSource("src/main.ts");

    expect(main).toContain("noticeEl: HTMLElement");
    expect(main).not.toContain("messageEl");
  });

  it("registers declarative settings definitions for settings search", () => {
    expect(readSource("src/settings.ts")).toContain("getSettingDefinitions()");
  });

  it("does not use :has selectors in plugin CSS", () => {
    expect(readSource("styles.css")).not.toContain(":has(");
  });

  it("uses CSS variables instead of inline SVG export-link styles", () => {
    const styles = readSource("styles.css");
    const exportStyle = sourceMethod("src/view/ArborView.ts", "ArborView", "applyTreeOverviewExportLinkStyle");

    expect(exportStyle).not.toContain("link.setCssProps");
    expect(exportStyle).toContain('"--arbor-tree-export-link-stroke"');
    expect(styles).toContain(".arbor-tree-overview-export .arbor-overview-link");
  });

  it("avoids unnecessary type assertions in plugin compatibility paths", () => {
    const main = readSource("src/main.ts");
    const cardInteraction = readSource("src/cardInteraction.ts");

    expect(main).not.toContain("payload.settings as unknown as Record<string, unknown>");
    expect(cardInteraction).not.toContain("target as ClosestTarget");
  });
});
