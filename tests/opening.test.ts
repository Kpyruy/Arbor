import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  inspectManagedBranchDocumentText,
  buildMarkdownViewState,
  resolveLoadingViewTarget,
  resolveArborOpenTarget,
  shouldRouteMarkdownOpenToLoadingView
} from "../src/opening";
import { buildBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { BranchTreeMetadata } from "../src/types";

function readProjectFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function sourceMethod(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Could not locate source contract: ${start}`);
  }
  return source.slice(startIndex, endIndex);
}

function metadataFixture(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      {
        id: "root-1",
        parentId: null,
        order: 0,
        content: "# Root\n\nParagraph",
        after: "\n\n"
      },
      {
        id: "child-1",
        parentId: "root-1",
        order: 0,
        content: "Child block",
        after: ""
      }
    ]
  };
}

describe("managed note opening", () => {
  it("opens the current Arbor file in Markdown and keeps Output Preview in the existing leaf", () => {
    const source = readProjectFile("src/view/ArborView.ts");
    const openCurrentFile = sourceMethod(
      source,
      "  private async openCurrentFileInMarkdown(): Promise<void>",
      "  async exportCleanCopy(): Promise<void>"
    );
    const outputPreview = sourceMethod(
      source,
      "  openOutputPreview(): void",
      "  selectBlock(blockId:"
    );
    const outputRender = sourceMethod(
      source,
      "  private async syncOutputPreview(): Promise<void>",
      "  private async syncPreview("
    );

    expect(openCurrentFile).toContain("await this.openFileInMarkdownView(this.file);");
    expect(outputPreview).toContain('this.presentationMode = "output";');
    expect(outputPreview).toContain("this.render();");
    expect(outputPreview).not.toContain("vault.create");
    expect(outputPreview).not.toContain("openFileInMarkdownView");
    expect(outputPreview).not.toContain("createCleanExportCopy");
    expect(outputRender).not.toContain("vault.create");
    expect(outputRender).not.toContain("openFileInMarkdownView");
    expect(outputRender).not.toContain("createCleanExportCopy");
  });

  it("uses the current mobile leaf while preserving the desktop split preference", () => {
    expect(resolveArborOpenTarget(true)).toBe("current");
    expect(resolveArborOpenTarget(true, true)).toBe("current");
    expect(resolveArborOpenTarget(false)).toBe("split");
    expect(resolveArborOpenTarget(false, false)).toBe("current");
  });

  it("auto-opens managed mobile notes but respects an explicit Markdown open", () => {
    const input = {
      requestedViewType: "markdown",
      filePath: "Demo.md",
      autoOpenManagedNotes: true,
      isMobile: true,
      isSuppressed: false,
      managedPathHint: true
    };
    expect(shouldRouteMarkdownOpenToLoadingView(input)).toBe(true);
    expect(shouldRouteMarkdownOpenToLoadingView({ ...input, isSuppressed: true })).toBe(false);
    expect(shouldRouteMarkdownOpenToLoadingView({ ...input, autoOpenManagedNotes: false })).toBe(false);
    expect(shouldRouteMarkdownOpenToLoadingView({ ...input, managedPathHint: false })).toBe(false);
  });

  it("builds a normal Markdown view state for the current file", () => {
    expect(buildMarkdownViewState("Ideas/Branch.md")).toEqual({
      type: "markdown",
      active: true,
      state: { file: "Ideas/Branch.md" }
    });
  });

  it("routes cached managed markdown opens to arbor-loading", () => {
    expect(
      shouldRouteMarkdownOpenToLoadingView({
        requestedViewType: "markdown",
        filePath: "Demo.md",
        autoOpenManagedNotes: true,
        isMobile: false,
        isSuppressed: false,
        managedPathHint: true
      })
    ).toBe(true);
  });

  it("does not route plain markdown opens without a managed hint", () => {
    expect(
      shouldRouteMarkdownOpenToLoadingView({
        requestedViewType: "markdown",
        filePath: "Demo.md",
        autoOpenManagedNotes: true,
        isMobile: false,
        isSuppressed: false,
        managedPathHint: false
      })
    ).toBe(false);
  });

  it("does not route suppressed or non-markdown opens", () => {
    expect(
      shouldRouteMarkdownOpenToLoadingView({
        requestedViewType: "markdown",
        filePath: "Demo.md",
        autoOpenManagedNotes: true,
        isMobile: false,
        isSuppressed: true,
        managedPathHint: true
      })
    ).toBe(false);

    expect(
      shouldRouteMarkdownOpenToLoadingView({
        requestedViewType: "canvas",
        filePath: "Demo.canvas",
        autoOpenManagedNotes: true,
        isMobile: false,
        isSuppressed: false,
        managedPathHint: true
      })
    ).toBe(false);
  });

  it("treats notes with hidden metadata as managed", () => {
    const metadata = metadataFixture();
    const visibleBody = linearizeTree(metadata).body;
    const note = buildBranchDocument("", visibleBody, metadata);
    const inspection = inspectManagedBranchDocumentText(note);

    expect(inspection.autoManaged).toBe(true);
    expect(inspection.canOpenInArbor).toBe(true);
    expect(inspection.hasMetadata).toBe(true);
  });

  it("does not auto-open precise marker-structured notes without hidden metadata", () => {
    const visibleBody = linearizeTree(metadataFixture()).body;
    const inspection = inspectManagedBranchDocumentText(visibleBody);

    expect(inspection.autoManaged).toBe(false);
    expect(inspection.canOpenInArbor).toBe(true);
    expect(inspection.hasVisibleMarkers).toBe(true);
    expect(resolveLoadingViewTarget(inspection, false)).toBe("markdown");
    expect(resolveLoadingViewTarget(inspection, true)).toBe("arbor");
  });

  it("does not treat marker examples as managed", () => {
    const example = [
      "Here is an example marker:",
      "",
      "<!-- arbor:block:v1 id=\"fake\" parent=\"\" order=\"0\" -->",
      "",
      "This should stay a normal markdown note."
    ].join("\n");
    const inspection = inspectManagedBranchDocumentText(example);

    expect(inspection.autoManaged).toBe(false);
    expect(inspection.canOpenInArbor).toBe(false);
    expect(resolveLoadingViewTarget(inspection, false)).toBe("markdown");
    expect(resolveLoadingViewTarget(inspection, true)).toBe("markdown");
  });

  it("does not treat a bare single marker line as an Arbor note", () => {
    const example = "<!-- arbor:block:v1 id=\"fake\" parent=\"\" order=\"0\" -->\n";
    const inspection = inspectManagedBranchDocumentText(example);

    expect(inspection.autoManaged).toBe(false);
    expect(inspection.canOpenInArbor).toBe(false);
    expect(inspection.hasVisibleMarkers).toBe(true);
    expect(resolveLoadingViewTarget(inspection, false)).toBe("markdown");
    expect(resolveLoadingViewTarget(inspection, true)).toBe("markdown");
  });
});
