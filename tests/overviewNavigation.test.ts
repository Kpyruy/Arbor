import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveOverviewArrowTarget } from "../src/overviewNavigation";
import { BranchTreeMetadata } from "../src/types";

const tree: BranchTreeMetadata = {
  version: 1,
  prefix: "",
  blocks: [
    { id: "root", parentId: null, order: 0, content: "Root", after: "" },
    { id: "first", parentId: "root", order: 0, content: "First", after: "" },
    { id: "second", parentId: "root", order: 1, content: "Second", after: "" },
    { id: "leaf", parentId: "first", order: 0, content: "Leaf", after: "" }
  ]
};

describe("overview arrow navigation", () => {
  it("moves to the parent, first child, and neighbouring siblings", () => {
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowLeft")).toBe("root");
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowRight")).toBe("leaf");
    expect(resolveOverviewArrowTarget(tree, "second", "ArrowUp")).toBe("first");
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowDown")).toBe("second");
  });

  it("does not leave the tree at an edge", () => {
    expect(resolveOverviewArrowTarget(tree, "root", "ArrowLeft")).toBeNull();
    expect(resolveOverviewArrowTarget(tree, "leaf", "ArrowRight")).toBeNull();
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowUp")).toBeNull();
  });

  it("mirrors parent and child keys in RTL", () => {
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowRight", "rtl")).toBe("root");
    expect(resolveOverviewArrowTarget(tree, "first", "ArrowLeft", "rtl")).toBe("leaf");
  });

  it("reuses numeric child navigation inside the overview keyboard handler", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain("this.tryHandleNumericChildNavigation(event, this.state.selectedBlockId)");
  });

  it("reuses Ctrl/Cmd arrow creation inside the overview keyboard handler", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain("(event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)");
  });

  it("keeps the overview camera in place during keyboard navigation", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const numericStart = source.indexOf("private tryHandleNumericChildNavigation");
    const numericEnd = source.indexOf("private clearNumericNavigation", numericStart);
    const numericNavigation = source.slice(numericStart, numericEnd);

    expect(handler).not.toContain("this.shouldCenterOverviewOnNextRender = true;");
    expect(numericNavigation).not.toContain("this.presentationMode === \"overview\"");
  });

  it("updates selection without rebuilding the overview and smoothly reveals an off-screen card", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const selectStart = source.indexOf("selectBlock(blockId:");
    const selectEnd = source.indexOf("async createRootBlock", selectStart);
    const selectBlock = source.slice(selectStart, selectEnd);
    const followStart = source.indexOf("private revealOverviewSelectedCard");
    const followEnd = source.indexOf("private clearOverviewZoomFrame", followStart);
    const revealSelectedCard = source.slice(followStart, followEnd);

    expect(selectBlock).toContain('this.presentationMode === "overview"');
    expect(selectBlock).toContain("this.syncOverviewSelection(selectionChanged && options?.reveal !== false)");
    expect(revealSelectedCard).toContain('behavior: "smooth"');
    expect(revealSelectedCard).toContain("const isOutsideViewport");
  });

  it("uses the regular block menu when right-clicking an overview card", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const overviewStart = source.indexOf("private async syncTreeOverview");
    const overviewEnd = source.indexOf("private applyOverviewLayout", overviewStart);
    const overview = source.slice(overviewStart, overviewEnd);

    expect(overview).toContain('card.addEventListener("contextmenu"');
    expect(overview).toContain("this.buildBlockMenu(node.id).showAtMouseEvent(event)");
  });

  it("opens overview editing from Enter and double-click without moving the camera", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const overviewStart = source.indexOf("private async syncTreeOverview");
    const overviewEnd = source.indexOf("private applyOverviewLayout", overviewStart);
    const overview = source.slice(overviewStart, overviewEnd);
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const editStart = source.indexOf("private beginEditingBlock");
    const editEnd = source.indexOf("selectParentBlock", editStart);
    const beginEditing = source.slice(editStart, editEnd);
    const commitStart = source.indexOf("private async commitEditingSession");
    const commitEnd = source.indexOf("private scheduleEditingSessionCommit", commitStart);
    const commitEditing = source.slice(commitStart, commitEnd);
    const cancelStart = source.indexOf("private cancelEditingSession");
    const cancelEnd = source.indexOf("private async commitEditingSession", cancelStart);
    const cancelEditing = source.slice(cancelStart, cancelEnd);

    expect(overview).toContain('this.selectBlock(node.id, { focus: false, reveal: false })');
    expect(overview).toContain('this.beginEditingBlock(node.id, "overview")');
    expect(overview).not.toContain('card.addEventListener("keydown"');
    expect(handler).toContain('event.key === "Enter"');
    expect(handler).toContain('this.beginEditingBlock(this.state.selectedBlockId, "overview")');
    expect(beginEditing).toContain('origin === "overview"');
    expect(beginEditing).toContain("this.preserveOverviewViewportPosition()");
    expect(beginEditing).toContain("this.openOverviewEditorInPlace(block)");
    expect(commitEditing).toContain("this.restoreOverviewCardContentInPlace(session.blockId)");
    expect(cancelEditing).toContain("this.restoreOverviewCardContentInPlace(session.blockId)");
    expect(source).toContain("private restoreOverviewViewportPosition");
  });

  it("restores overview keyboard focus after deleting a block", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const handlerStart = source.indexOf("private handleOverviewKeyDown");
    const handlerEnd = source.indexOf("private syncOverviewZoom", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const mutationStart = source.indexOf("private async applyMutation");
    const mutationEnd = source.indexOf("private currentHistorySnapshot", mutationStart);
    const mutation = source.slice(mutationStart, mutationEnd);

    expect(handler).toContain("void this.deleteSelectedBlock()");
    expect(mutation).toContain("this.shouldRestoreOverviewKeyboardFocusAfterMutation =");
    expect(source).toContain("private restoreOverviewKeyboardFocusAfterMutation");
    expect(source).toContain("this.overviewViewportEl?.focus({ preventScroll: true })");
  });

  it("keeps the current overview visible while a structural update is rendered", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/view/ArborView.ts", import.meta.url)), "utf8");
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const overviewStart = source.indexOf("private async syncTreeOverview");
    const overviewEnd = source.indexOf("private applyOverviewLayout", overviewStart);
    const overview = source.slice(overviewStart, overviewEnd);

    expect(overview).toContain("const previousSurface = this.overviewSurfaceEl;");
    expect(overview).toContain('cls: "arbor-overview-surface is-staging"');
    expect(overview).toContain("previousSurface.remove();");
    expect(overview).toContain("this.overviewSurfaceEl = surface;");
    expect(overview).not.toContain("surface.empty();");
    const stagingStyles = styles.slice(
      styles.indexOf(".arbor-overview-surface.is-staging"),
      styles.indexOf(".arbor-overview-links")
    );
    expect(stagingStyles).toContain("opacity: 0;");
    expect(stagingStyles).not.toContain("visibility: hidden;");
  });
});
