import { describe, expect, it } from "vitest";
import {
  inspectManagedBranchDocumentText,
  resolveLoadingViewTarget,
  shouldRouteMarkdownOpenToLoadingView
} from "../src/opening";
import { buildBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { BranchTreeMetadata } from "../src/types";

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
    const note = buildBranchDocument("", visibleBody, metadata, "multiline");
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
