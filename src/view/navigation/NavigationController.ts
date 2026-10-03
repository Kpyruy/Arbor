import { getBlock, getChildren, getFirstChildBlock, getNextSibling, getParentBlock, getPreferredChildBlock, getPreviousSibling } from "../../model/tree";
import { resolveBranchCardInteraction } from "../../cardInteraction";
import { findRenderedCardLink } from "./CardLinkController";
import { getChildArrowKey, getParentArrowKey } from "../../layoutDirection";
import { resolveNumericChildTarget } from "../../numericNavigation";
import { resolveOverviewArrowTarget } from "../../overviewNavigation";
import type { BranchBlockId } from "../../types";
import type { EditingOrigin, SelectionPort, ViewReadPort } from "../state/viewTypes";

export interface NavigationActions {
  beginEditingBlock(id: BranchBlockId, origin?: EditingOrigin): void;
  createChild(): Promise<void>;
  createSiblingAbove(): Promise<void>;
  createSiblingBelow(): Promise<void>;
  createParentLevelBlock(): Promise<void>;
  createRootBlock(): Promise<void>;
  deleteSelectedBlock(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  openSearchOverlay(): void;
  closeSearchOverlay(): void;
  isSearchOpen(): boolean;
  setKeyboardSelection(id: BranchBlockId): void;
  openBlockMenu(id: BranchBlockId, event: MouseEvent): void;
  tryHandleCardLink(event: MouseEvent, card: HTMLElement): boolean;
}

export class NavigationController {
  private numericNavigationTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private numericNavigationBuffer = "";

  constructor(
    private readonly read: ViewReadPort,
    private readonly selection: SelectionPort,
    private readonly actions: NavigationActions
  ) {}

  selectParentBlock(): void {
    const state = this.read.getState();
    const parent = state && getParentBlock(state.metadata, state.selectedBlockId);
    if (parent) this.selection.selectBlock(parent.id, { focus: true });
  }

  selectPreviousSiblingBlock(): void {
    const state = this.read.getState();
    const sibling = state && getPreviousSibling(state.metadata, state.selectedBlockId);
    if (sibling) this.selection.selectBlock(sibling.id, { focus: true });
  }

  selectNextSiblingBlock(): void {
    const state = this.read.getState();
    const sibling = state && getNextSibling(state.metadata, state.selectedBlockId);
    if (sibling) this.selection.selectBlock(sibling.id, { focus: true });
  }

  selectFirstChildBlock(): void {
    const state = this.read.getState();
    const child = state && getFirstChildBlock(state.metadata, state.selectedBlockId);
    if (child) this.selection.selectBlock(child.id, { focus: true });
  }

  selectPreferredChildBlock(): void {
    const state = this.read.getState();
    const child = state && getPreferredChildBlock(state.metadata, state.selectedBlockId);
    if (child) this.selection.selectBlock(child.id, { focus: true });
  }

  selectFirstSiblingBlock(): void {
    const state = this.read.getState();
    if (!state?.selectedBlockId) return;
    const current = getBlock(state.metadata, state.selectedBlockId);
    const firstSibling = current && getChildren(state.metadata, current.parentId)[0];
    if (firstSibling) this.selection.selectBlock(firstSibling.id, { focus: true });
  }

  selectLastSiblingBlock(): void {
    const state = this.read.getState();
    if (!state?.selectedBlockId) return;
    const current = getBlock(state.metadata, state.selectedBlockId);
    const siblings = current ? getChildren(state.metadata, current.parentId) : [];
    const lastSibling = siblings[siblings.length - 1];
    if (lastSibling) this.selection.selectBlock(lastSibling.id, { focus: true });
  }

  tryHandleNumericChildNavigation(event: KeyboardEvent, blockId: BranchBlockId): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey || !/^\d$/.test(event.key) || !this.read.getState()) return false;
    event.preventDefault();
    this.numericNavigationBuffer += event.key;
    if (this.numericNavigationTimer !== null) globalThis.clearTimeout(this.numericNavigationTimer);
    this.numericNavigationTimer = globalThis.setTimeout(() => {
      const value = Number(this.numericNavigationBuffer);
      this.clearNumericNavigation();
      const state = this.read.getState();
      const block = state && getBlock(state.metadata, blockId);
      if (!state || !block) return;
      const target = resolveNumericChildTarget(blockId, block.parentId, getChildren(state.metadata, blockId), value);
      if (target) this.selection.selectBlock(target, { focus: true });
    }, 250);
    return true;
  }

  clearNumericNavigation(): void {
    if (this.numericNavigationTimer !== null) {
      globalThis.clearTimeout(this.numericNavigationTimer);
      this.numericNavigationTimer = null;
    }
    this.numericNavigationBuffer = "";
  }

  handleCardClick(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    if (this.actions.tryHandleCardLink(event, card)) return;
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (!blockId) return;
    const interaction = resolveBranchCardInteraction({
      target: event.target,
      isActive: this.read.getState()?.selectedBlockId === blockId,
      clickCount: 1
    });
    if (interaction.preserveDefault) return;
    event.preventDefault();
    if (interaction.edit) {
      this.actions.beginEditingBlock(blockId);
      return;
    }
    if (interaction.select) this.selection.selectBlock(blockId, { focus: true });
  }

  handleCardAuxClick(event: MouseEvent): void {
    this.actions.tryHandleCardLink(event, event.currentTarget as HTMLElement);
  }

  handleCardDoubleClick(event: MouseEvent): void {
    if (findRenderedCardLink(event.target, event.currentTarget as HTMLElement)) return;
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    const interaction = resolveBranchCardInteraction({
      target: event.target,
      isActive: this.read.getState()?.selectedBlockId === blockId,
      clickCount: 2
    });
    if (blockId && interaction.edit) this.actions.beginEditingBlock(blockId);
  }

  handleCardContextMenu(event: MouseEvent): void {
    if (findRenderedCardLink(event.target, event.currentTarget as HTMLElement)) return;
    event.preventDefault();
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (!blockId) return;
    this.selection.selectBlock(blockId);
    this.actions.openBlockMenu(blockId, event);
  }

  handleCardKeyDown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest?.("a")) return;
    event.stopPropagation();
    if (this.handleSearchShortcut(event) || this.handleHistoryShortcut(event) || event.altKey) return;
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (!blockId) return;
    if (this.read.getState()?.selectedBlockId !== blockId) this.actions.setKeyboardSelection(blockId);
    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) return;
    if (this.tryHandleNumericChildNavigation(event, blockId)) return;
    if (this.handleEditorArrow(event)) return;
    if (this.handleDeleteShortcut(event)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.actions.beginEditingBlock(blockId);
    }
  }

  handleViewportKeyDown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest?.("a")) return;
    if (this.handleSearchShortcut(event) || this.handleHistoryShortcut(event) || event.altKey) return;
    if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
    const selectedBlockId = this.read.getState()?.selectedBlockId;
    if (!selectedBlockId) return;
    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) return;
    if (this.tryHandleNumericChildNavigation(event, selectedBlockId)) return;
    if (this.handleEditorArrow(event)) return;
    if (this.handleDeleteShortcut(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.actions.beginEditingBlock(selectedBlockId);
    }
  }

  handleOverviewKeyDown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest?.("a")) return;
    const state = this.read.getState();
    if (!state?.selectedBlockId) return;
    if ((event.target as HTMLElement | null)?.closest("textarea, input, [contenteditable='true']")) return;
    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) return;
    if (this.tryHandleNumericChildNavigation(event, state.selectedBlockId)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.actions.beginEditingBlock(state.selectedBlockId, "overview");
      return;
    }
    if (this.handleDeleteShortcut(event)) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const targetId = resolveOverviewArrowTarget(state.metadata, state.selectedBlockId, event.key, this.read.getSettings().layoutDirection);
    if (targetId) this.selection.selectBlock(targetId);
  }

  handleSearchShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.code !== "KeyF") return false;
    event.preventDefault();
    event.stopPropagation();
    this.actions.openSearchOverlay();
    return true;
  }

  handleHistoryShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== "KeyZ") return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) void this.actions.redo();
    else void this.actions.undo();
    return true;
  }

  private handleDirectionalCreateShortcut(event: KeyboardEvent): boolean {
    const state = this.read.getState();
    if (!state?.selectedBlockId) return false;
    const direction = this.read.getSettings().layoutDirection;
    if (event.key === getChildArrowKey(direction)) {
      event.preventDefault();
      void this.actions.createChild();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      void this.actions.createSiblingAbove();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void this.actions.createSiblingBelow();
      return true;
    }
    if (event.key !== getParentArrowKey(direction) || !getParentBlock(state.metadata, state.selectedBlockId)) return false;
    event.preventDefault();
    void this.actions.createParentLevelBlock();
    return true;
  }

  private handleEditorArrow(event: KeyboardEvent): boolean {
    const direction = this.read.getSettings().layoutDirection;
    if (event.key === "ArrowUp") this.selectPreviousSiblingBlock();
    else if (event.key === "ArrowDown") this.selectNextSiblingBlock();
    else if (event.key === getParentArrowKey(direction)) this.selectParentBlock();
    else if (event.key === getChildArrowKey(direction)) this.selectPreferredChildBlock();
    else if (event.key === "Home") this.selectFirstSiblingBlock();
    else if (event.key === "End") this.selectLastSiblingBlock();
    else return false;
    event.preventDefault();
    return true;
  }

  private handleDeleteShortcut(event: KeyboardEvent): boolean {
    if (!["Backspace", "Delete"].includes(event.key) || event.shiftKey || event.metaKey || event.ctrlKey) return false;
    event.preventDefault();
    void this.actions.deleteSelectedBlock();
    return true;
  }
}
