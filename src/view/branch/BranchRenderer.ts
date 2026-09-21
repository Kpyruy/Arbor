import { Menu } from "obsidian";
import { canDragCard, hasVerticalOverflow, resolveColumnWheelNavigation } from "../../cardViewport";
import { getChildArrowIcon, getHorizontalWheelDelta } from "../../layoutDirection";
import { resolveColumnWheelTarget } from "../../columnWheelNavigation";
import { extractSnippet, hashString } from "../../utils";
import { getOutputCardPresentation, syncOutputCardPresentation } from "../output/outputPresentation";
import { ViewWorkScope } from "../runtime/ViewWorkScope";
import type { BranchBlock, BranchBlockId, BranchColumnModel } from "../../types";
import type { DragState } from "./DragDropController";
import type { BranchViewContext, EditorPort, MarkdownPort, SelectionOptions, ViewReadPort } from "../state/viewTypes";

export interface CardEvents {
  click(event: MouseEvent): void;
  doubleClick(event: MouseEvent): void;
  contextMenu(event: MouseEvent): void;
  keyDown(event: KeyboardEvent): void;
  pointer(blockId: BranchBlockId, x: number, y: number): void;
  hover(blockId: BranchBlockId | null): void;
  dragStart(event: DragEvent): void;
  dragEnd(): void;
  dragOver(event: DragEvent): void;
  drop(event: DragEvent): void;
  columnDragOver(event: DragEvent): void;
  columnDrop(column: BranchColumnModel): Promise<void>;
}

export interface BranchRendererPort {
  read: ViewReadPort;
  editor: EditorPort;
  markdown: MarkdownPort;
  events: CardEvents;
  getColumnsRoot(): HTMLElement | null;
  getContext(): BranchViewContext | null;
  getDragState(): Readonly<DragState> | null;
  usesTouchControls(): boolean;
  selectBlock(id: BranchBlockId | null, options?: SelectionOptions): void;
  consumeAutofocus(session: NonNullable<ReturnType<EditorPort["getSession"]>>): void;
  scheduleColumnAlignment(): void;
  createRootBlock(): Promise<void>;
  createChild(): Promise<void>;
  setCollapsedState(id: BranchBlockId, collapsed: boolean): Promise<void>;
}

export interface BranchWheelActions {
  previous(): void;
  next(): void;
  selectBlock(id: BranchBlockId | null, options?: SelectionOptions): void;
  updateZoomLevel(value: number): void;
}

export function routeBranchViewportWheel(
  event: WheelEvent,
  viewport: HTMLElement,
  renderer: Pick<BranchRenderer, "getColumnAtPointerX">,
  read: ViewReadPort,
  actions: BranchWheelActions,
  compact: boolean
): void {
  if (compact) {
    return;
  }
  const settings = read.getSettings();
  if ((event.ctrlKey || event.metaKey) && settings.enableCtrlWheelZoom) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    actions.updateZoomLevel(settings.zoomLevel * factor);
    return;
  }

  const hoveredColumn = renderer.getColumnAtPointerX(event.clientX);
  const wheelNavigation = resolveColumnWheelNavigation(
    event.deltaX,
    event.deltaY,
    event.ctrlKey,
    event.metaKey,
    hoveredColumn !== null
  );
  if (wheelNavigation) {
    event.preventDefault();
    const state = read.getState();
    const columnTarget = state && hoveredColumn
      ? resolveColumnWheelTarget(state.metadata, state.selectedBlockId, hoveredColumn)
      : null;
    if (columnTarget) {
      actions.selectBlock(columnTarget, { focus: true });
      return;
    }
    if (wheelNavigation === "previous") {
      actions.previous();
    } else {
      actions.next();
    }
    return;
  }

  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey || event.metaKey) {
    return;
  }

  if (viewport.scrollWidth <= viewport.clientWidth) {
    return;
  }

  event.preventDefault();
  viewport.scrollBy({
    left: getHorizontalWheelDelta(event.deltaY, settings.layoutDirection),
    behavior: "auto"
  });
}

export class BranchRenderer {
  private readonly columnElementMap = new Map<string, HTMLElement>();
  private readonly currentColumnMap = new Map<string, BranchColumnModel>();
  private readonly work = new ViewWorkScope();
  private rootEmptyEl: HTMLElement | null = null;

  constructor(private readonly port: BranchRendererPort) {}

  invalidate(): void {
    this.work.reset();
  }

  async syncColumns(columns: BranchColumnModel[], context: BranchViewContext): Promise<void> {
    this.invalidate();
    const root = this.port.getColumnsRoot();
    const workToken = this.work.token();
    const state = this.port.read.getState();
    const filePath = this.port.read.getFilePath();
    const isCurrent = () => this.work.isCurrent(workToken) && this.port.getColumnsRoot() === root
      && context === this.port.getContext() && state === this.port.read.getState()
      && filePath === this.port.read.getFilePath();
    this.currentColumnMap.clear();
    columns.forEach((column) => this.currentColumnMap.set(column.key, column));
    if (!root) {
      return;
    }
    if (columns.length === 1 && columns[0].blocks.length === 0) {
      this.columnElementMap.forEach((columnEl) => columnEl.remove());
      this.columnElementMap.clear();
      root.empty();
      this.rootEmptyEl = root.createDiv({ cls: "arbor-root-empty" });
      this.rootEmptyEl.createEl("p", { text: "This note has no branch blocks yet." });
      const button = this.rootEmptyEl.createEl("button", { text: "Create root block" });
      button.addEventListener("click", () => void this.port.createRootBlock());
      return;
    }
    this.rootEmptyEl?.remove();
    this.rootEmptyEl = null;

    const desiredKeys = new Set(columns.map((column) => column.key));
    for (const [key, columnEl] of this.columnElementMap) {
      if (!desiredKeys.has(key)) {
        columnEl.remove();
        this.columnElementMap.delete(key);
      }
    }
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const columnEl = this.ensureColumnElement(column.key);
      columnEl.dataset.columnKey = column.key;
      columnEl.dataset.parentId = column.parentId ?? "";
      columnEl.dataset.columnDepth = String(index);

      const siblingAtIndex = root.children[index] ?? null;
      if (siblingAtIndex !== columnEl) {
        root.insertBefore(columnEl, siblingAtIndex);
      }
      await this.syncColumn(columnEl, column, context, isCurrent);
      if (!isCurrent()) return;
    }
  }
  getColumn(key: string): BranchColumnModel | null {
    return this.currentColumnMap.get(key) ?? null;
  }

  getColumnAtPointerX(clientX: number): BranchColumnModel | null {
    for (const [columnKey, columnEl] of this.columnElementMap) {
      const bounds = columnEl.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right) {
        return this.currentColumnMap.get(columnKey) ?? null;
      }
    }
    return null;
  }

  forEachCard(callback: (card: HTMLElement) => void): void {
    this.port.getColumnsRoot()?.querySelectorAll<HTMLElement>(".arbor-card").forEach(callback);
  }

  getVisibleBlockIds(): Set<BranchBlockId> {
    const ids = new Set<BranchBlockId>();
    this.currentColumnMap.forEach((column) => column.blocks.forEach((block) => ids.add(block.id)));
    return ids;
  }

  reset(): void {
    this.work.reset();
    this.columnElementMap.forEach((element) => element.remove());
    this.columnElementMap.clear();
    this.currentColumnMap.clear();
    this.rootEmptyEl?.remove();
    this.rootEmptyEl = null;
  }

  private ensureColumnElement(columnKey: string): HTMLElement {
    const existing = this.columnElementMap.get(columnKey);
    if (existing) {
      return existing;
    }

    const root = this.port.getColumnsRoot();
    if (!root) {
      throw new Error("Branch columns root is unavailable");
    }
    const columnEl = root.createDiv({ cls: "arbor-column" });
    columnEl.dataset.columnKey = columnKey;
    const cardsEl = columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.addEventListener("dragover", (event) => this.port.events.columnDragOver(event));
    cardsEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const column = this.getColumn(cardsEl.dataset.columnKey ?? "");
      if (column) {
        void this.port.events.columnDrop(column);
      }
    });
    this.columnElementMap.set(columnKey, columnEl);
    return columnEl;
  }

  private async syncColumn(columnEl: HTMLElement, column: BranchColumnModel, context: BranchViewContext, isCurrent: () => boolean): Promise<void> {
    const cardsEl = columnEl.querySelector<HTMLElement>(".arbor-card-list") ?? columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.dataset.columnKey = column.key;
    const nextParentId = column.parentId ?? "";
    const parentChanged = (cardsEl.dataset.parentId ?? "") !== nextParentId;
    cardsEl.dataset.parentId = nextParentId;
    if (parentChanged) {
      cardsEl.addClass("is-rebinding");
      cardsEl.setCssProps({ "--arbor-card-list-offset-y": "0px" });
    }
    if (column.collapsedBlockId) {
      cardsEl.empty();
      const summary = cardsEl.createDiv({ cls: "arbor-column-summary" });
      summary.dataset.nodeKey = `collapsed-${column.key}`;
      summary.createDiv({
        cls: "arbor-column-summary-title",
        text: `${column.collapsedCount ?? 0} hidden block${(column.collapsedCount ?? 0) === 1 ? "" : "s"}`
      });
      if ((column.collapsedPreviewLabels?.length ?? 0) > 0) {
        const labelsEl = summary.createDiv({ cls: "arbor-column-summary-labels" });
        column.collapsedPreviewLabels?.forEach((label) => {
          labelsEl.createSpan({ cls: "arbor-column-summary-chip", text: label });
        });
      }
      const expandButton = summary.createEl("button", {
        cls: "arbor-column-summary-action",
        text: "Expand branch",
        attr: { type: "button" }
      });
      expandButton.addEventListener("click", () => void this.port.setCollapsedState(column.collapsedBlockId!, false));
      return;
    }

    if (column.blocks.length === 0) {
      cardsEl.empty();
      const empty = cardsEl.createDiv({ cls: "arbor-column-empty" });
      empty.dataset.nodeKey = `empty-${column.key}`;
      empty.setText(column.parentId ? "No child blocks yet." : "No root blocks yet.");
      empty.toggleClass("is-selectable-context", column.parentId === this.port.read.getState()?.selectedBlockId);
      if (column.parentId) {
        empty.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.port.selectBlock(column.parentId);
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle("Create child block").setIcon(getChildArrowIcon(this.port.read.getSettings().layoutDirection)).onClick(() => void this.port.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }

    const existingChildren = new Map<string, HTMLElement>();
    Array.from(cardsEl.children).forEach((child) => {
      if (child.instanceOf(HTMLElement) && child.dataset.nodeKey) {
        existingChildren.set(child.dataset.nodeKey, child);
      }
    });

    const desiredNodes: HTMLElement[] = [];
    for (let index = 0; index < column.blocks.length; index += 1) {
      if (this.port.getDragState() && this.port.getDragState()?.columnKey === column.key && this.port.getDragState()?.targetIndex === index) {
        desiredNodes.push(this.ensureIndicatorNode(cardsEl, existingChildren, `indicator-${column.key}-${index}`));
      }

      const block = column.blocks[index];
      const card = this.ensureCardNode(cardsEl, existingChildren, block.id);
      await this.syncCardNode(card, block, column, index, context, isCurrent);
      if (!isCurrent()) return;
      desiredNodes.push(card);
    }

    if (this.port.getDragState() && this.port.getDragState()?.columnKey === column.key && this.port.getDragState()?.targetIndex === column.blocks.length) {
      desiredNodes.push(this.ensureIndicatorNode(cardsEl, existingChildren, `indicator-${column.key}-${column.blocks.length}`));
    }

    desiredNodes.forEach((node, index) => {
      const siblingAtIndex = cardsEl.children[index] ?? null;
      if (siblingAtIndex !== node) {
        cardsEl.insertBefore(node, siblingAtIndex);
      }
    });

    const desiredNodeKeys = new Set(desiredNodes.map((node) => node.dataset.nodeKey!));
    existingChildren.forEach((node, key) => {
      if (!desiredNodeKeys.has(key)) {
        node.remove();
      }
    });
  }

  private ensureIndicatorNode(cardsEl: HTMLElement, existingChildren: Map<string, HTMLElement>, key: string): HTMLElement {
    const existing = existingChildren.get(key);
    if (existing) {
      existing.className = "arbor-drop-indicator";
      existing.dataset.nodeKey = key;
      return existing;
    }

    const indicator = cardsEl.createDiv({ cls: "arbor-drop-indicator" });
    indicator.dataset.nodeKey = key;
    return indicator;
  }

  private ensureCardNode(cardsEl: HTMLElement, existingChildren: Map<string, HTMLElement>, blockId: BranchBlockId): HTMLElement {
    const key = `card-${blockId}`;
    const existing = existingChildren.get(key);
    if (existing) {
      existing.dataset.nodeKey = key;
      return existing;
    }

    const card = cardsEl.createDiv({ cls: "arbor-card" });
    card.tabIndex = 0;
    card.dataset.nodeKey = key;
    card.addEventListener("pointerdown", (event) => this.port.events.pointer(blockId, event.clientX, event.clientY));
    card.addEventListener("mousedown", (event) => this.port.events.pointer(blockId, event.clientX, event.clientY));
    card.addEventListener("click", (event) => this.port.events.click(event));
    card.addEventListener("dblclick", (event) => this.port.events.doubleClick(event));
    card.addEventListener("contextmenu", (event) => this.port.events.contextMenu(event));
    card.addEventListener("keydown", (event) => this.port.events.keyDown(event));
    card.addEventListener("mouseenter", () => this.port.events.hover(blockId));
    card.addEventListener("mouseleave", () => this.port.events.hover(null));
    card.addEventListener("dragstart", (event) => this.port.events.dragStart(event));
    card.addEventListener("dragend", () => this.port.events.dragEnd());
    card.addEventListener("dragover", (event) => this.port.events.dragOver(event));
    card.addEventListener("drop", (event) => this.port.events.drop(event));
    return card;
  }

  private async syncCardNode(
    card: HTMLElement,
    block: BranchBlock,
    column: BranchColumnModel,
    index: number,
    context: BranchViewContext,
    isCurrent: () => boolean
  ): Promise<void> {
    card.dataset.blockId = block.id;
    card.dataset.columnKey = column.key;
    card.dataset.blockIndex = String(index);
    card.dataset.parentId = block.parentId ?? "";
    const editingSession = this.port.editor.getSession();
    const isEditingCard = editingSession?.blockId === block.id && editingSession.origin === "card";
    card.draggable = canDragCard(this.port.read.getSettings().dragAndDrop && !this.port.usesTouchControls(), isEditingCard);
    card.removeClass(
      "is-active",
      "is-on-path",
      "is-selectable",
      "is-muted",
      "is-drag-source",
      "is-editing",
      "is-search-match",
      "is-search-related",
      "is-search-muted"
    );

    if (this.port.read.getState()?.selectedBlockId === block.id) {
      card.addClass("is-active");
    } else if (context.activePathIds.has(block.id)) {
      card.addClass("is-on-path");
    } else if (context.selectableChildIds.has(block.id)) {
      card.addClass("is-selectable");
    } else if (context.activePathIds.size > 0) {
      card.addClass("is-muted");
    }

    if (this.port.getDragState()?.draggedBlockId === block.id) {
      card.addClass("is-drag-source");
    }

    if (context.searchQuery.length > 0) {
      if (context.searchMatchedIds.has(block.id)) {
        card.addClass("is-search-match");
      } else if (context.searchRelatedIds.has(block.id)) {
        card.addClass("is-search-related");
      } else {
        card.addClass("is-search-muted");
      }
    }

    if (isEditingCard) {
      card.addClass("is-editing");
      this.syncEditorNode(card, block);
      this.syncOutputCardPresentation(card, block.id, context);
      return;
    }

    await this.syncCardContentNode(card, block, isCurrent);
    if (!isCurrent()) {
      return;
    }
    this.syncOutputCardPresentation(card, block.id, context);
  }

  private syncEditorNode(card: HTMLElement, block: BranchBlock): void {
    let editor = card.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
    if (!editor) {
      card.empty();
      editor = card.createEl("textarea", { cls: "arbor-editor" });
    }

    this.port.editor.wireEditorElement(editor, block, "card");

    if (editor.value !== this.port.editor.getSession()!.value) {
      editor.value = this.port.editor.getSession()!.value;
    }
    this.port.editor.resizeEditor(editor);
    card.dataset.renderMode = "editing";

    if (this.port.editor.getSession()?.autofocus && this.port.editor.getSession()?.origin === "card") {
      const editorEl = editor;
      const session = this.port.editor.getSession();
      if (!session) return;
      this.work.frame(window, () => {
        if (this.port.editor.getSession() !== session || !editorEl.isConnected) return;
        editorEl.focus({ preventScroll: true });
        editorEl.setSelectionRange(editorEl.value.length, editorEl.value.length);
        this.port.editor.resizeEditor(editorEl);
        this.port.consumeAutofocus(session);
      });
    }
  }

  private async syncCardContentNode(card: HTMLElement, block: BranchBlock, isCurrent: () => boolean): Promise<void> {
    const renderSignature = hashString(block.content);
    let content = card.querySelector<HTMLElement>(".arbor-card-content");
    const needsRender = !content || card.dataset.renderSignature !== renderSignature || card.dataset.renderMode === "editing";

    if (needsRender) {
      delete card.dataset.renderSignature;
      card.empty();
      content = card.createDiv({ cls: "arbor-card-content markdown-rendered" });
      await this.port.markdown.render(block.content, content, this.port.read.getFilePath());
      if (!isCurrent()) return;
      if (content.innerText.trim().length === 0) {
        content.setText(extractSnippet(block.content, this.port.read.getSettings().previewSnippetLength));
      }
      content.querySelectorAll("img").forEach((image) => {
        image.addEventListener("load", () => {
          if (card.isConnected && this.port.getColumnsRoot()?.contains(card)) this.port.scheduleColumnAlignment();
        }, { once: true });
      });
      card.dataset.renderSignature = renderSignature;
    }

    if (content) {
      const isCompactPreview = !card.hasClass("is-active") && !card.hasClass("is-editing");
      card.toggleClass(
        "has-truncated-content",
        isCompactPreview && hasVerticalOverflow(content.scrollHeight, content.clientHeight)
      );
    }
    card.dataset.renderMode = "content";
  }

  private syncOutputCardPresentation(card: HTMLElement, id: BranchBlockId, context: BranchViewContext): void {
    const state = this.port.read.getState();
    syncOutputCardPresentation(
      card,
      state ? getOutputCardPresentation(state.metadata, state.outputState, id, context.outputProfile, context.outputResolutions) : null
    );
  }
}
