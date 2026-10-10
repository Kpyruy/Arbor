import { runAsyncAction } from "../runtime/asyncActions";
import { canStartCardDrag } from "../../cardViewport";
import { moveBlockToParentAtIndex } from "../../model/tree";
import { findRenderedCardLink } from "../navigation/CardLinkController";
import type { BranchBlockId, BranchColumnModel, BranchTreeMetadata, BranchTreeMutationResult } from "../../types";
import type { SelectionOptions, ViewReadPort } from "../state/viewTypes";
import { generateBlockId } from "../../utils";

export const ARBOR_CARD_DRAG_MIME = "application/x-arbor-card-move";
let dragSequence = 0;

export interface DragState {
  draggedBlockId: BranchBlockId;
  targetParentId: BranchBlockId | null;
  targetIndex: number;
  columnKey: string;
}

export interface DragDropPort {
  read: ViewReadPort;
  getDocument(): Document;
  getRoot(): HTMLElement;
  getStage(): HTMLElement | null;
  getColumn(key: string): BranchColumnModel | null;
  usesTouchControls(): boolean;
  isEditing(id: BranchBlockId): boolean;
  selectBlock(id: BranchBlockId | null, options?: SelectionOptions): void;
  move(label: string, mutate: (tree: BranchTreeMetadata) => BranchTreeMutationResult): Promise<void>;
  requestRender(): void;
  onError?(error: unknown): void;
}

export class DragDropController {
  private dragState: DragState | null = null;
  private dragSession: string | null = null;
  private dragPreviewEl: HTMLElement | null = null;
  private dragPreviewPoint: { x: number; y: number } | null = null;
  private dragPreviewOffset = { x: 0, y: 0 };
  private dragPreviewFrame: number | null = null;
  private transparentDragImageEl: HTMLCanvasElement | null = null;
  private lastCardPointerPosition: { blockId: BranchBlockId; clientX: number; clientY: number } | null = null;
  private readonly documentDragOverHandler = (event: DragEvent) => this.handleDocumentDragOver(event);

  constructor(private readonly port: DragDropPort) {}

  getDragState(): Readonly<DragState> | null {
    return this.dragState;
  }

  reset(): void {
    this.dragState = null;
    this.dragSession = null;
    this.cleanupDragPreview();
  }

  handleColumnDragOver(event: DragEvent): void {
    if (!this.port.read.getSettings().dragAndDrop || !this.isOwnDrag(event)) {
      return;
    }

    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const cardsEl = event.currentTarget as HTMLElement;
    const column = this.port.getColumn(cardsEl.dataset.columnKey ?? "");
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || column.blocks.length > 0) {
      return;
    }

    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: column.indexOffset ?? 0,
      columnKey: column.key
    });
  }

  handleViewportDragOver(event: DragEvent): void {
    if (!this.port.read.getSettings().dragAndDrop || !this.dragPreviewEl) {
      return;
    }

    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  handleCardDragStart(event: DragEvent): void {
    const card = event.currentTarget as HTMLElement;
    if ((event.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
    const source = event.target as Node | null;
    const sourceElement = source?.nodeType === 1 ? source as Element : source?.parentElement;
    if (sourceElement?.closest(".arbor-card-content img, .arbor-card-content .internal-embed")) return;
    if (findRenderedCardLink(event.target, card)) return;
    const blockId = card.dataset.blockId;
    if (!canStartCardDrag(this.port.read.getSettings().dragAndDrop, this.port.isEditing(blockId ?? "") ? blockId ?? null : null, blockId)) {
      event.preventDefault();
      return;
    }

    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.port.getColumn(columnKey);
    if (!blockId || !column || blockIndex < 0) {
      return;
    }

    this.dragSession = `${generateBlockId()}-drag-${++dragSequence}`;
    event.dataTransfer?.setData(ARBOR_CARD_DRAG_MIME, this.dragSession);
    event.dataTransfer?.setData("text/plain", blockId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(this.getTransparentDragImage(), 0, 0);
    }

    this.dragState = {
      draggedBlockId: blockId,
      targetParentId: column.parentId,
      targetIndex: blockIndex + (column.indexOffset ?? 0),
      columnKey
    };
    card.addClass("is-drag-source");
    this.startDragPreview(card, blockId, event);
  }

  handleCardDragOver(event: DragEvent): void {
    if (!this.port.read.getSettings().dragAndDrop || !this.isOwnDrag(event)) {
      return;
    }

    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const card = event.currentTarget as HTMLElement;
    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.port.getColumn(columnKey);
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || blockIndex < 0) {
      return;
    }

    const rect = card.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: (before ? blockIndex : blockIndex + 1) + (column.indexOffset ?? 0),
      columnKey
    });
  }

  handleCardDrop(event: DragEvent): void {
    if (!this.port.read.getSettings().dragAndDrop || !this.isOwnDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const column = this.port.getColumn((event.currentTarget as HTMLElement).dataset.columnKey ?? "");
    if (column) {
      runAsyncAction(this.applyDrop(column, event), error => this.port.onError?.(error));
    }
  }

  handleCardDragEnd(): void {
    this.dragState = null;
    this.dragSession = null;
    this.cleanupDragPreview();
    this.port.requestRender();
  }

  async applyDrop(_column: BranchColumnModel, event?: DragEvent): Promise<void> {
    if (!this.port.read.getSettings().dragAndDrop || event && !this.isOwnDrag(event)
      || !this.dragState || !this.port.read.getState()) {
      return;
    }

    event?.preventDefault();

    const { draggedBlockId, targetIndex, targetParentId } = this.dragState;
    this.dragState = null;
    this.dragSession = null;
    this.cleanupDragPreview();
    await this.port.move("Move block", (metadata) => ({
      metadata: moveBlockToParentAtIndex(metadata, draggedBlockId, targetParentId, targetIndex),
      selectedBlockId: draggedBlockId
    }));
  }

  rememberCardPointerPosition(blockId: BranchBlockId, clientX: number, clientY: number): void {
    this.lastCardPointerPosition = { blockId, clientX, clientY };
  }

  private readDraggedBlockId(event: DragEvent): BranchBlockId | null {
    return this.isOwnDrag(event) ? this.dragState!.draggedBlockId : null;
  }

  isOwnDrag(event: DragEvent): boolean {
    if (!this.dragSession || !this.dragState || !event.dataTransfer) return false;
    const value = event.dataTransfer.getData(ARBOR_CARD_DRAG_MIME);
    return value === this.dragSession || event.type === "dragover" && !value
      && Array.from(event.dataTransfer.types).includes(ARBOR_CARD_DRAG_MIME);
  }

  private getTransparentDragImage(): HTMLCanvasElement {
    if (!this.transparentDragImageEl) {
      const canvas = this.port.getRoot().createEl("canvas");
      canvas.remove();
      canvas.width = 1;
      canvas.height = 1;
      this.transparentDragImageEl = canvas;
    }

    return this.transparentDragImageEl;
  }

  private startDragPreview(card: HTMLElement, blockId: BranchBlockId, event: DragEvent): void {
    this.cleanupDragPreview();

    const stage = this.port.getStage();
    if (!stage) {
      return;
    }

    const preview = card.cloneNode(true) as HTMLElement;
    preview.removeAttribute("tabindex");
    preview.draggable = false;
    preview.classList.remove("is-drag-source", "is-hover-linked", "is-hover-linked-path");
    preview.classList.add("arbor-drag-preview");
    preview.dataset.blockId = blockId;
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll<HTMLElement>("[tabindex]").forEach((element) => element.removeAttribute("tabindex"));
    preview.setCssProps({ "--arbor-drag-preview-width": `${card.offsetWidth}px` });

    const rect = card.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const initialLeft = rect.left - stageRect.left;
    const initialTop = rect.top - stageRect.top;
    preview.setCssProps({
      "--arbor-drag-preview-x": `${Math.round(initialLeft)}px`,
      "--arbor-drag-preview-y": `${Math.round(initialTop)}px`
    });

    const rememberedPointer =
      this.lastCardPointerPosition?.blockId === blockId
        ? this.lastCardPointerPosition
        : null;
    const pointerX = rememberedPointer?.clientX ?? event.clientX;
    const pointerY = rememberedPointer?.clientY ?? event.clientY;
    const hasPointer = Number.isFinite(pointerX) && Number.isFinite(pointerY) && (pointerX !== 0 || pointerY !== 0);

    this.dragPreviewOffset = hasPointer
      ? {
          x: Math.max(0, Math.min(pointerX - rect.left, rect.width)),
          y: Math.max(0, Math.min(pointerY - rect.top, rect.height))
        }
      : {
          x: Math.min(rect.width * 0.34, 72),
          y: Math.min(rect.height * 0.28, 56)
        };
    this.dragPreviewPoint = hasPointer ? { x: pointerX, y: pointerY } : null;
    this.dragPreviewEl = preview;
    stage.addClass("is-dragging");
    stage.appendChild(preview);
    this.port.getDocument().addEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewPoint) {
      this.scheduleDragPreviewPosition();
    }
  }

  private handleDocumentDragOver(event: DragEvent): void {
    if (!this.dragPreviewEl) {
      return;
    }

    this.updateDragPreviewPointer(event);
  }

  private updateDragPreviewPointer(event: Pick<DragEvent, "clientX" | "clientY">): void {
    if (!this.dragPreviewEl) {
      return;
    }

    this.dragPreviewPoint = { x: event.clientX, y: event.clientY };
    this.scheduleDragPreviewPosition();
  }

  private scheduleDragPreviewPosition(): void {
    if (this.dragPreviewFrame !== null) {
      return;
    }

    this.dragPreviewFrame = window.requestAnimationFrame(() => {
      this.dragPreviewFrame = null;
      this.syncDragPreviewPosition();
    });
  }

  private syncDragPreviewPosition(): void {
    const stage = this.port.getStage();
    if (!this.dragPreviewEl || !stage || !this.dragPreviewPoint) {
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const left = this.dragPreviewPoint.x - stageRect.left - this.dragPreviewOffset.x;
    const top = this.dragPreviewPoint.y - stageRect.top - this.dragPreviewOffset.y;
    this.dragPreviewEl.setCssProps({
      "--arbor-drag-preview-x": `${Math.round(left)}px`,
      "--arbor-drag-preview-y": `${Math.round(top)}px`
    });
  }

  private cleanupDragPreview(): void {
    this.port.getDocument().removeEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewFrame !== null) {
      window.cancelAnimationFrame(this.dragPreviewFrame);
      this.dragPreviewFrame = null;
    }

    this.dragPreviewEl?.remove();
    this.dragPreviewEl = null;
    this.dragPreviewPoint = null;
    this.dragPreviewOffset = { x: 0, y: 0 };
    this.lastCardPointerPosition = null;
    this.port.getStage()?.removeClass("is-dragging");
    this.port.getRoot().querySelectorAll(".arbor-card.is-drag-source").forEach((element) => {
      element.classList.remove("is-drag-source");
    });
  }

  private updateDragState(nextDragState: DragState): void {
    const current = this.dragState;
    if (
      current?.draggedBlockId === nextDragState.draggedBlockId &&
      current?.targetParentId === nextDragState.targetParentId &&
      current?.targetIndex === nextDragState.targetIndex &&
      current?.columnKey === nextDragState.columnKey
    ) {
      return;
    }

    this.dragState = nextDragState;
    this.port.requestRender();
  }
}
