import { describe, expect, it } from "vitest";
import {
  resolveOverviewArrowTarget,
  resolveOverviewCardSelectionState,
  startOverviewSelectionAnimation
} from "../src/overviewNavigation";
import { BranchTreeMetadata } from "../src/types";
import { fixtureTree } from "./helpers/arborFixtures";
import { readSource, sourceMethod } from "./helpers/viewSource";

const tree: BranchTreeMetadata = fixtureTree();

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

  it("animates only the newly selected overview card", () => {
    const activePathIds = new Set(["root", "second"]);

    expect(resolveOverviewCardSelectionState("second", "second", activePathIds, true)).toEqual({
      active: true,
      onPath: false,
      animate: true
    });
    expect(resolveOverviewCardSelectionState("root", "second", activePathIds, true)).toEqual({
      active: false,
      onPath: true,
      animate: false
    });
    expect(resolveOverviewCardSelectionState("first", "second", activePathIds, true)).toEqual({
      active: false,
      onPath: false,
      animate: false
    });
    expect(resolveOverviewCardSelectionState("second", "second", activePathIds, false).animate).toBe(false);
  });

  it("keeps overview selection animation local without flashing every border", () => {
    const source = readSource("src/view/overview/TreeOverviewController.ts");
    const styles = readSource("styles.css");
    const cardStart = styles.indexOf(".arbor-overview-card {\n  position: absolute;");
    const cardStyles = styles.slice(cardStart, styles.indexOf("}", cardStart) + 1);

    expect(cardStyles).not.toContain("border-color 140ms ease");
    expect(cardStyles).not.toContain("background-color 140ms ease");
    expect(cardStyles).toContain("box-shadow 140ms ease");
    expect(source).toContain("startOverviewSelectionAnimation(");
    expect(styles).not.toContain(".arbor-overview-card.is-selection-entering");
    expect(styles).not.toContain("@keyframes arbor-overview-card-focus-enter");
  });

  it("cancels stale motion before rapidly animating the current card", () => {
    let previousCancelCount = 0;
    let currentCancelCount = 0;
    let animateCount = 0;
    let receivedFrames: Keyframe[] = [];
    let receivedOptions: KeyframeAnimationOptions | undefined;
    const previous = {
      cancel: () => { previousCancelCount += 1; }
    } as Animation;
    const current = {
      cancel: () => { currentCancelCount += 1; }
    } as Animation;
    const card = {
      animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
        animateCount += 1;
        receivedFrames = frames;
        receivedOptions = options;
        return current;
      }
    } as unknown as HTMLElement;

    expect(startOverviewSelectionAnimation(card, previous, false)).toBe(current);
    expect(previousCancelCount).toBe(1);
    expect(animateCount).toBe(1);
    expect(receivedOptions).toMatchObject({ duration: 240, fill: "none" });
    expect(receivedFrames).toHaveLength(3);
    expect(receivedFrames.map((frame) => frame.transform)).toEqual([
      "translate3d(0, 2px, 0) scale(0.992)",
      "translate3d(0, -1px, 0) scale(1.004)",
      "translate3d(0, 0, 0) scale(1)"
    ]);
    expect(receivedFrames.every((frame) => !("backgroundColor" in frame) && !("borderColor" in frame))).toBe(true);

    expect(startOverviewSelectionAnimation(card, current, true)).toBeNull();
    expect(currentCancelCount).toBe(1);
    expect(animateCount).toBe(1);
  });

  it("uses dashed borders for every directly or inherited excluded card", () => {
    const styles = readSource("styles.css");
    const exclusionsStart = styles.indexOf(".arbor-card.is-output-excluded-direct,");
    const exclusionStyles = styles.slice(exclusionsStart, styles.indexOf("}", exclusionsStart) + 1);

    expect(exclusionStyles).toContain(".arbor-card.is-output-excluded-inherited");
    expect(exclusionStyles).toContain(".arbor-overview-card.is-output-excluded-direct");
    expect(exclusionStyles).toContain(".arbor-overview-card.is-output-excluded-inherited");
    expect(exclusionStyles).toContain("border-style: dashed;");
  });

  it("reuses numeric child navigation inside the overview keyboard handler", () => {
    const handler = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleOverviewKeyDown");

    expect(handler).toContain("this.tryHandleNumericChildNavigation(event, state.selectedBlockId)");
  });

  it("reuses Ctrl/Cmd arrow creation inside the overview keyboard handler", () => {
    const handler = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleOverviewKeyDown");

    expect(handler).toContain("(event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)");
  });

  it("keeps the overview camera in place during keyboard navigation", () => {
    const handler = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleOverviewKeyDown");
    const numericNavigation = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "tryHandleNumericChildNavigation");

    expect(handler).not.toContain("this.shouldCenterOverviewOnNextRender = true;");
    expect(numericNavigation).not.toContain("this.presentationMode === \"overview\"");
  });

  it("updates selection without rebuilding the overview and smoothly reveals an off-screen card", () => {
    const selectBlock = sourceMethod("src/view/ArborView.ts", "ArborView", "selectBlock");
    const selection = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncOverviewSelection");
    const revealSelectedCard = sourceMethod("src/view/overview/OverviewViewportController.ts", "OverviewViewportController", "revealOverviewSelectedCard");

    expect(selectBlock).toContain('this.presentationMode === "overview"');
    expect(selectBlock).toContain("this.overview.syncOverviewSelection((selectionChanged || options?.reveal === true) && options?.reveal !== false)");
    expect(selection).not.toContain("markdown.render");
    expect(revealSelectedCard).toContain('behavior: "smooth"');
    expect(revealSelectedCard).toContain("viewport.scrollTo");
  });

  it("uses the regular block menu when right-clicking an overview card", () => {
    const overview = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncTreeOverview");

    expect(overview).toContain('card.addEventListener("contextmenu"');
    expect(overview).toContain("this.port.openBlockMenu(node.id, event)");
  });

  it("opens overview editing from Enter and double-click without moving the camera", () => {
    const source = readSource("src/view/ArborView.ts");
    const overview = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncTreeOverview");
    const handler = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleOverviewKeyDown");
    const beginEditing = sourceMethod("src/view/ArborView.ts", "ArborView", "onEditorBegin");
    const commitEditing = sourceMethod("src/view/ArborView.ts", "ArborView", "onEditorUnchanged");
    const cancelEditing = sourceMethod("src/view/ArborView.ts", "ArborView", "onEditorCancel");
    const inPlaceEditor = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "openOverviewEditorInPlace");

    expect(overview).toContain('this.port.selection.selectBlock(node.id, { focus: false, reveal: false })');
    expect(overview).toContain('this.port.editor.beginEditingBlock(node.id, "overview")');
    expect(overview).not.toContain('card.addEventListener("keydown"');
    expect(handler).toContain('event.key === "Enter"');
    expect(handler).toContain('this.actions.beginEditingBlock(state.selectedBlockId, "overview")');
    expect(beginEditing).toContain('session.origin === "overview"');
    expect(beginEditing).toContain("this.preserveOverviewViewportPosition()");
    expect(beginEditing).toContain("this.overview.openOverviewEditorInPlace(block)");
    expect(inPlaceEditor).toContain("this.port.revealSelected(card)");
    expect(commitEditing).toContain("this.overview.restoreOverviewCardContentInPlace(session.blockId)");
    expect(cancelEditing).toContain("this.overview.restoreOverviewCardContentInPlace(session.blockId)");
    expect(source).toContain("private restoreOverviewViewportPosition");
  });

  it("restores overview keyboard focus after deleting a block", () => {
    const source = readSource("src/view/ArborView.ts");
    const handler = sourceMethod("src/view/navigation/NavigationController.ts", "NavigationController", "handleOverviewKeyDown");
    const wrapper = sourceMethod("src/view/ArborView.ts", "ArborView", "applyMutation");
    const mutation = sourceMethod("src/view/ArborView.ts", "ArborView", "prepareDocumentMutation");
    const documentMutation = sourceMethod("src/view/state/DocumentController.ts", "DocumentController", "applyMutation");

    expect(handler).toContain("this.handleDeleteShortcut(event)");
    expect(wrapper).toContain("this.documentController.applyMutation(label, mutate, autofocusSelection)");
    expect(documentMutation).toContain("this.port.onMutationPrepared(autofocusSelection)");
    expect(mutation).toContain("this.overview.requestKeyboardFocusAfterMutation(");
    expect(mutation).toContain("this.presentationMode === \"overview\"");
    expect(source).toContain("clearPendingFocus: () => { this.pendingFocusBlockId = null; }");
    expect(readSource("src/view/overview/TreeOverviewController.ts")).toContain("this.overviewViewportEl?.focus({ preventScroll: true })");
  });

  it("keeps the current overview visible while a structural update is rendered", () => {
    const styles = readSource("styles.css");
    const overview = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncTreeOverview");

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
