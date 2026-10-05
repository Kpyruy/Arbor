import { buildLinearOrder, getActivePath, getBlock, getChildren } from "../../model/tree";
import { buildPreviewPathLabels } from "../state/viewModel";
import { extractSnippet } from "../../utils";
import type { BranchBlock, BranchBlockId } from "../../types";
import type { BranchViewContext, EditingSession, EditorPort, MarkdownPort, SelectionPort, ViewReadPort } from "../state/viewTypes";
import { ViewWorkScope } from "../runtime/ViewWorkScope";

export interface LinearPreviewPort {
  read: ViewReadPort;
  markdown: MarkdownPort;
  editor: EditorPort;
  selection: SelectionPort;
  getBody(): HTMLElement | null;
  getVisibleBlockIds(): ReadonlySet<BranchBlockId>;
  setHoveredBlock(id: BranchBlockId | null): void;
  setCollapsedState(id: BranchBlockId, collapsed: boolean): Promise<void>;
  toggleCollapsedState(id: BranchBlockId): Promise<void>;
  consumeAutofocus(session: EditingSession): void;
  requestRender(): void;
}

export class LinearPreviewController {
  private previewPaneEl: HTMLElement | null = null;
  private previewMiniMapEl: HTMLElement | null = null;
  private previewContentEl: HTMLElement | null = null;
  private renderedPreviewSignature = "";
  private showFullMiniMap = false;
  private readonly work = new ViewWorkScope();
  private renderGeneration = 0;

  constructor(private readonly port: LinearPreviewPort) {}

  invalidate(): void {
    this.renderGeneration += 1;
  }

  getContent(): HTMLElement | null {
    return this.previewContentEl;
  }

  async syncPreview(context: BranchViewContext): Promise<void> {
    this.invalidate();
    const body = this.port.getBody();
    const filePath = this.port.read.getFilePath();
    const state = this.port.read.getState();
    const workToken = this.work.token();
    const renderGeneration = this.renderGeneration;
    if (!body || !filePath || !state) {
      return;
    }

    const shouldShow = this.port.read.getSettings().liveLinearPreview;
    if (!shouldShow) {
      this.detachPreviewDom();
      return;
    }

    this.previewPaneEl?.setCssStyles({ display: "" });
    if (!this.previewPaneEl) {
      this.previewPaneEl = body.createDiv({ cls: "arbor-preview-pane" });
      this.previewPaneEl.createDiv({ cls: "arbor-preview-title", text: "Selected block" });
      this.previewMiniMapEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-minimap" });
      this.previewContentEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-content markdown-rendered" });
    }

    if (this.previewMiniMapEl) {
      this.syncPreviewMiniMap(this.previewMiniMapEl, context);
    }

    const collapseSignature = state.metadata.blocks
      .map((block) => `${block.id}:${block.collapsed ? 1 : 0}`)
      .join("|");
    const previewSignature = [
      state.linearized.body,
      state.selectedBlockId ?? "",
      this.port.editor.getSession()?.blockId ?? "",
      this.port.editor.getSession()?.origin ?? "",
      context.searchQuery,
      collapseSignature
    ].join("\u001f");

    if (this.previewContentEl && this.renderedPreviewSignature !== previewSignature) {
      this.renderedPreviewSignature = "";
      this.previewContentEl.empty();
      const content = this.previewContentEl;
      const isCurrent = () => this.work.isCurrent(workToken) && this.previewContentEl === content
        && this.renderGeneration === renderGeneration
        && this.port.read.getState() === state && this.port.read.getFilePath() === filePath;
      await this.renderPreviewBlocks(content, context, isCurrent);
      if (!isCurrent()) return;
      content.scrollTop = 0;
      this.renderedPreviewSignature = previewSignature;
    }
  }

  hide(): void {
    this.invalidate();
    this.work.reset();
    this.previewPaneEl?.setCssStyles({ display: "none" });
  }

  reset(): void {
    this.work.reset();
    this.detachPreviewDom();
    this.showFullMiniMap = false;
  }

  private detachPreviewDom(): void {
    this.previewPaneEl?.remove();
    this.previewPaneEl = null;
    this.previewMiniMapEl = null;
    this.previewContentEl = null;
    this.renderedPreviewSignature = "";
  }

  private async renderPreviewBlocks(container: HTMLElement, context: BranchViewContext, isCurrent: () => boolean): Promise<void> {
    const state = this.port.read.getState();
    if (!state) {
      return;
    }

    const previewItems = this.buildPreviewItems(context);
    const linearOrder = buildLinearOrder(state.metadata);
    const linearIndexById = new Map(linearOrder.map((block, index) => [block.id, index]));
    if (previewItems.length === 0) {
      container.createDiv({
        cls: "arbor-preview-empty",
        text: context.searchQuery.length > 0 ? "No blocks match the current search." : "No preview blocks available."
      });
      return;
    }

    for (const item of previewItems) {
      if (item.type === "summary") {
        const summaryEl = container.createDiv({ cls: "arbor-preview-summary" });
        summaryEl.setCssProps({ "--bw-preview-depth": String(item.depth) });
        summaryEl.createDiv({
          cls: "arbor-preview-summary-title",
          text: `${item.count} hidden block${item.count === 1 ? "" : "s"}`
        });
        if (item.labels.length > 0) {
          const labelsEl = summaryEl.createDiv({ cls: "arbor-preview-summary-labels" });
          item.labels.forEach((label) => labelsEl.createSpan({ cls: "arbor-preview-chip", text: label }));
        }
        const actionButton = summaryEl.createEl("button", {
          cls: "arbor-preview-action is-primary",
          text: "Expand branch",
          attr: { type: "button" }
        });
        actionButton.addEventListener("click", () => void this.port.setCollapsedState(item.ownerId, false));
        continue;
      }

      const { block, depth } = item;
      const previewBlockEl = container.createDiv({ cls: "arbor-preview-block" });
      previewBlockEl.dataset.blockId = block.id;
      previewBlockEl.setCssProps({ "--bw-preview-depth": String(depth) });
      previewBlockEl.toggleClass("is-active", state.selectedBlockId === block.id);
      previewBlockEl.toggleClass("is-on-path", context.activePathIds.has(block.id));
      previewBlockEl.toggleClass("is-direct-child", block.parentId === state.selectedBlockId);
      previewBlockEl.toggleClass("is-editing", this.port.editor.getSession()?.blockId === block.id && this.port.editor.getSession()?.origin === "preview");
      previewBlockEl.toggleClass("is-search-match", context.searchMatchedIds.has(block.id));
      previewBlockEl.toggleClass("is-search-related", context.searchQuery.length > 0 && context.searchRelatedIds.has(block.id));
      previewBlockEl.addEventListener("mouseenter", () => this.port.setHoveredBlock(block.id));
      previewBlockEl.addEventListener("mouseleave", () => this.port.setHoveredBlock(null));
      previewBlockEl.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) {
          return;
        }
        this.port.selection.selectBlock(block.id, { focus: true });
      });
      previewBlockEl.addEventListener("dblclick", () => {
        this.port.editor.beginEditingBlock(block.id, "preview");
      });

      const headerEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-header" });
      const linearIndex = (linearIndexById.get(block.id) ?? 0) + 1;
      headerEl.createDiv({
        cls: "arbor-preview-index",
        text: `Block ${String(linearIndex).padStart(2, "0")}`
      });
      const pathLabels = buildPreviewPathLabels(
        state.metadata,
        block.id,
        this.port.read.getSettings()
      );
      const actionsEl = headerEl.createDiv({ cls: "arbor-preview-actions" });
      const selectButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action",
        text: "Select",
        attr: { type: "button" }
      });
      selectButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.port.selection.selectBlock(block.id, { focus: true });
      });
      const editButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action is-primary",
        text: this.port.editor.getSession()?.blockId === block.id ? "Editing" : "Edit",
        attr: {
          type: "button",
          "aria-label": `Edit ${pathLabels[pathLabels.length - 1] ?? "block"}`
        }
      });
      editButton.toggleAttribute("disabled", this.port.editor.getSession()?.blockId === block.id);
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.port.editor.beginEditingBlock(block.id, "preview");
      });
      const childCount = getChildren(state.metadata, block.id).length;
      if (childCount > 0) {
        const collapseButton = actionsEl.createEl("button", {
          cls: "arbor-preview-action",
          text: block.collapsed ? "Expand" : "Collapse",
          attr: { type: "button" }
        });
        collapseButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.port.toggleCollapsedState(block.id);
        });
      }

      if (this.port.editor.getSession()?.blockId === block.id && this.port.editor.getSession()?.origin === "preview") {
        const editor = previewBlockEl.createEl("textarea", { cls: "arbor-editor arbor-preview-editor" });
        this.port.editor.wireEditorElement(editor, block, "preview");
        if (editor.value !== this.port.editor.getSession()?.value) {
          editor.value = this.port.editor.getSession()?.value ?? "";
        }
        this.port.editor.resizeEditor(editor);
        if (this.port.editor.getSession()?.autofocus) {
          const session = this.port.editor.getSession();
          if (!session) continue;
          this.work.timeout(() => {
            if (this.port.editor.getSession() !== session || !editor.isConnected) return;
            editor.focus();
            editor.setSelectionRange(editor.value.length, editor.value.length);
            this.port.editor.resizeEditor(editor);
            this.port.consumeAutofocus(session);
          }, 0, editor.win);
        }
      } else {
        const bodyEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-body markdown-rendered" });
        await this.port.markdown.render(block.content, bodyEl, this.port.read.getFilePath());
        if (!isCurrent()) return;
        if (bodyEl.innerText.trim().length === 0) {
          bodyEl.setText(extractSnippet(block.content, this.port.read.getSettings().previewSnippetLength));
        }
      }

      const boundaryText = childCount > 0
        ? "Children continue in branches"
        : "Selected block preview";
      previewBlockEl.createDiv({
        cls: "arbor-preview-boundary",
        text: boundaryText
      });
    }
  }

  private buildPreviewItems(context: BranchViewContext): Array<
    | { type: "block"; block: BranchBlock; depth: number }
    | { type: "summary"; ownerId: BranchBlockId; depth: number; count: number; labels: string[] }
  > {
    const state = this.port.read.getState();
    if (!state?.selectedBlockId) {
      return [];
    }
    const selectedBlock = getBlock(state.metadata, state.selectedBlockId);
    if (!selectedBlock) {
      return [];
    }
    if (context.searchQuery.length > 0 && !context.searchMatchedIds.has(selectedBlock.id) && !context.searchRelatedIds.has(selectedBlock.id)) {
      return [];
    }
    const depth = getActivePath(state.metadata, selectedBlock.id).length - 1;
    return [{ type: "block", block: selectedBlock, depth }];
  }

  private syncPreviewMiniMap(container: HTMLElement, context: BranchViewContext): void {
    const state = this.port.read.getState();
    if (!state) {
      return;
    }
    container.empty();
    const headerEl = container.createDiv({ cls: "arbor-preview-minimap-header" });
    headerEl.createSpan({ text: "Path" });
    const metaEl = headerEl.createSpan({
      cls: "arbor-preview-minimap-meta",
      text: ""
    });
    const toggleButton = headerEl.createEl("button", {
      cls: "arbor-preview-minimap-toggle",
      text: this.showFullMiniMap ? "Visible only" : "Show all",
      attr: { type: "button" }
    });
    toggleButton.addEventListener("click", () => {
      this.showFullMiniMap = !this.showFullMiniMap;
      this.port.requestRender();
    });
    const pathEl = container.createDiv({ cls: "arbor-preview-minimap-path" });
    buildPreviewPathLabels(state.metadata, state.selectedBlockId ?? "", this.port.read.getSettings()).forEach((label, index, labels) => {
      pathEl.createSpan({
        cls: `arbor-preview-chip${index === labels.length - 1 ? " is-current" : ""}`,
        text: label
      });
      if (index < labels.length - 1) {
        pathEl.createSpan({ cls: "arbor-preview-chip-separator", text: "→" });
      }
    });
    const listEl = container.createDiv({ cls: "arbor-preview-minimap-list" });
    const visibleNodeIds = new Set<BranchBlockId>([...context.activePathIds]);
    this.port.getVisibleBlockIds().forEach((id) => visibleNodeIds.add(id));
    const minimapNodes = context.searchQuery.length > 0
      ? context.overviewNodes.filter((node) => node.isSearchMatch || node.isSearchRelated || visibleNodeIds.has(node.id))
      : this.showFullMiniMap
        ? context.overviewNodes
        : context.overviewNodes.filter((node) => visibleNodeIds.has(node.id));
    metaEl.setText(`${minimapNodes.length} / ${context.overviewNodes.length} blocks`);
    minimapNodes.forEach((node) => {
      const rowEl = listEl.createEl("button", {
        cls: "arbor-preview-minimap-node",
        text: node.label,
        attr: { type: "button" }
      });
      rowEl.dataset.blockId = node.id;
      rowEl.setCssProps({ "--bw-preview-depth": String(node.depth) });
      rowEl.toggleClass("is-active", node.isSelected);
      rowEl.toggleClass("is-on-path", node.isOnActivePath);
      rowEl.toggleClass("is-selectable", node.isSelectable);
      rowEl.toggleClass("is-search-match", node.isSearchMatch);
      rowEl.toggleClass("is-search-related", node.isSearchRelated);
      rowEl.toggleClass("is-collapsed", node.collapsed);
      rowEl.addEventListener("click", () => this.port.selection.selectBlock(node.id, { focus: true }));
      rowEl.addEventListener("mouseenter", () => this.port.setHoveredBlock(node.id));
      rowEl.addEventListener("mouseleave", () => this.port.setHoveredBlock(null));
      if (node.childCount > 0) {
        const countEl = rowEl.createSpan({ cls: "arbor-preview-minimap-count" });
        countEl.setText(`${node.childCount}`);
      }
    });
  }
}
