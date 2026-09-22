import { describe, expect, it } from "vitest";

import { cloneMetadata, updateBlockContent } from "../src/model/tree";
import { projectOutput } from "../src/outputProjection";
import { fixtureLoaded } from "./helpers/arborFixtures";
import { readSource, sourceClass, sourceMethod } from "./helpers/viewSource";

describe("view preview controllers", () => {
  it("projects an editor draft through a clone without changing fixture metadata", () => {
    const state = fixtureLoaded();
    const metadata = state.metadata;
    const before = structuredClone(metadata);

    const projected = projectOutput(
      updateBlockContent(cloneMetadata(metadata), "leaf", "Draft leaf"),
      state.outputState
    );

    expect(projected.included.find((entry) => entry.block.id === "leaf")?.block.content).toBe("Draft leaf");
    expect(metadata).toEqual(before);
  });

  it("gives each preview surface its own controller and lifecycle", () => {
    const output = sourceClass("src/view/preview/OutputPreviewController.ts", "OutputPreviewController");
    const linear = sourceClass("src/view/preview/LinearPreviewController.ts", "LinearPreviewController");
    const search = sourceClass("src/view/chrome/SearchController.ts", "SearchController");

    expect(output).toContain("private outputRenderVersion = 0;");
    expect(output).toContain("renderVersion !== this.outputRenderVersion");
    expect(output).toContain("this.port.exportCleanCopy()");
    expect(output).not.toContain("vault.");
    expect(linear).toContain("private showFullMiniMap = false;");
    expect(readSource("src/view/preview/LinearPreviewController.ts")).toContain("type: \"summary\"");
    expect(linear).toContain("consumeAutofocus(session)");
    expect(linear).toContain('setCssStyles({ display: "none" })');
    expect(search).toContain("getQuery(): string");
    expect(search).toContain("openSearchOverlay(): void");
    expect(search).toContain("closeSearchOverlay(): void");
    const searchSource = readSource("src/view/chrome/SearchController.ts");
    expect(searchSource).toContain("getContext(): BranchViewContext | null");
    expect(searchSource).toContain("selectBlock(id: BranchBlockId, options?: SelectionOptions): void");
    expect(searchSource).toContain("handleSearchShortcut(event: KeyboardEvent): boolean");
    expect(search).toContain("context.searchResults");
  });

  it("keeps output rendering and search state out of the facade", () => {
    const facade = sourceClass("src/view/ArborView.ts", "ArborView");

    expect(facade).toContain("private readonly output: OutputPreviewController;");
    expect(facade).toContain("private readonly preview: LinearPreviewController;");
    expect(facade).toContain("private readonly search: SearchController;");
    expect(sourceMethod("src/view/ArborView.ts", "ArborView", "render")).toContain("this.output.invalidate();");
    expect(facade).not.toContain("private async syncOutputPreview");
    expect(facade).not.toContain("private async syncPreview");
    expect(facade).not.toContain("private syncSearchOverlay");
  });

  it("exports real-controller host sequences for DOM runtime validation", () => {
    const host = readSource("tests/host/arborViewChecks.ts");

    expect(host).toContain("checkSearchControllerContextHost");
    expect(host).toContain("checkLinearPreviewControllerHost");
    expect(host).toContain("checkOutputPreviewControllerHost");
  });
});
