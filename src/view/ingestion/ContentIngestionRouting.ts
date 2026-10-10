import { setIcon } from "obsidian";
import type { ArborLayoutDirection, ArborOverviewOrientation, ArborPresentationMode } from "../../types";
import type { EditingSession } from "../state/viewTypes";
import { runAsyncAction } from "../runtime/asyncActions";
import type { ContentIngestionController } from "./ContentIngestionController";
import type { IngestionTarget, NativeDragReader, TransferSnapshot } from "./ingestionTypes";
import { ARBOR_CARD_DRAG_MIME } from "../branch/DragDropController";
import { isImageAttachment } from "../editor/EditorAttachments";

export interface ContentIngestionRoutingPort {
  getRoot(): HTMLElement;
  getMode(): ArborPresentationMode;
  getOrientation(): ArborOverviewOrientation;
  getDirection(): ArborLayoutDirection;
  getSession(): EditingSession | null;
  getNativeDraggable(): unknown;
  isOwnDrag(event: DragEvent): boolean;
  suspendBlurCommit(): () => void;
  reportError(error: unknown): void;
}

function elementFromTarget(target: EventTarget | null): Element | null {
  const node = target as Node | null;
  return node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
}

export class ContentIngestionRouting {
  private highlighted: HTMLElement | null = null;
  private selectionDrag: { editor: HTMLTextAreaElement; session: EditingSession } | null = null;
  private dispose: (() => void) | null = null;
  private options: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;

  constructor(
    private readonly port: ContentIngestionRoutingPort,
    private readonly receiver: ContentIngestionController,
    private readonly native: NativeDragReader
  ) {}

  bind(): void {
    if (this.dispose) return;
    const root = this.port.getRoot();
    const over = (event: DragEvent) => this.dragOver(event);
    const drop = (event: DragEvent) => this.drop(event);
    const paste = (event: ClipboardEvent) => this.paste(event);
    const start = (event: DragEvent) => {
      this.selectionDrag = null;
      const editor = this.editorAt(event.target);
      const session = this.port.getSession();
      if (editor && session && editor.selectionStart !== editor.selectionEnd) this.selectionDrag = { editor, session };
    };
    const end = () => this.clearGesture();
    const leave = (event: DragEvent) => {
      const related = elementFromTarget(event.relatedTarget);
      if (!related || !root.contains(related)) this.clearOptions();
    };
    const outsideDrop = (event: DragEvent) => { if (!root.contains(elementFromTarget(event.target))) this.clearGesture(); };
    const reposition = () => this.positionOptions();
    root.addEventListener("dragover", over, true);
    root.addEventListener("drop", drop, true);
    root.addEventListener("paste", paste, true);
    root.addEventListener("dragstart", start, true);
    root.addEventListener("dragend", end, true);
    root.addEventListener("dragleave", leave, true);
    root.addEventListener("scroll", reposition, true);
    root.ownerDocument.addEventListener("drop", outsideDrop);
    root.ownerDocument.addEventListener("dragend", end);
    root.win.addEventListener("resize", end);
    root.win.addEventListener("blur", end);
    this.dispose = () => {
      root.removeEventListener("dragover", over, true);
      root.removeEventListener("drop", drop, true);
      root.removeEventListener("paste", paste, true);
      root.removeEventListener("dragstart", start, true);
      root.removeEventListener("dragend", end, true);
      root.removeEventListener("dragleave", leave, true);
      root.removeEventListener("scroll", reposition, true);
      root.ownerDocument.removeEventListener("drop", outsideDrop);
      root.ownerDocument.removeEventListener("dragend", end);
      root.win.removeEventListener("resize", end);
      root.win.removeEventListener("blur", end);
    };
  }

  unbind(): void {
    this.dispose?.();
    this.dispose = null;
    this.clearGesture();
  }

  clearGesture(): void {
    this.selectionDrag = null;
    this.clearOptions();
  }

  private cardAt(target: EventTarget | null): HTMLElement | null {
    const mode = this.port.getMode();
    if (mode === "output") return null;
    const element = elementFromTarget(target);
    if (element?.closest(".arbor-drag-preview, .is-staging")) return null;
    const card = element?.closest<HTMLElement>(mode === "overview" ? ".arbor-overview-card[data-block-id]" : ".arbor-card[data-block-id]");
    return card && this.port.getRoot().contains(card) ? card : null;
  }

  private editorAt(target: EventTarget | null): HTMLTextAreaElement | null {
    const editor = elementFromTarget(target)?.closest<HTMLTextAreaElement>("textarea.arbor-editor");
    const card = editor && this.cardAt(editor);
    return card && this.port.getSession()?.blockId === card.dataset.blockId ? editor : null;
  }

  private hasFiles(transfer: DataTransfer): boolean {
    return transfer.files.length > 0 || Array.from(transfer.types).includes("Files")
      || Array.from(transfer.items).some(item => item.kind === "file" || item.type.startsWith("image/"));
  }

  private supports(transfer: DataTransfer, native: unknown, protectedHover = false): boolean {
    if (Array.from(transfer.types).includes(ARBOR_CARD_DRAG_MIME)) return false;
    if (this.hasFiles(transfer)) {
      const files = Array.from(transfer.files);
      if (files.length) return files.every(isImageAttachment);
      // Native OS drags protect File objects until drop. Do not read bytes here.
      return protectedHover && Array.from(transfer.items).every(item => item.kind !== "file" || !item.type || item.type.startsWith("image/"));
    }
    return this.native.canRead(native)
      || Array.from(transfer.types).some(type => ["text/plain", "text/markdown", "text/x-markdown", "text/uri-list"].includes(type));
  }

  private isSelectionDrag(): boolean {
    return Boolean(this.selectionDrag && this.selectionDrag.session === this.port.getSession()
      && this.selectionDrag.editor.isConnected);
  }

  private dragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer || this.port.isOwnDrag(event) || this.isSelectionDrag()
      || this.port.getMode() === "output" || !this.supports(transfer, this.port.getNativeDraggable(), true)) {
      this.clearOptions(); return;
    }
    const zone = this.zoneAt(event.target);
    const card = this.cardAt(event.target);
    if (!card && !zone) {
      this.highlight(null);
      if (!this.options?.contains(elementFromTarget(event.target))
        && !elementFromTarget(event.target)?.closest(".arbor-columns-viewport, .arbor-overview-viewport")) this.clearOptions();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    transfer.dropEffect = "copy";
    if (card) this.showOptions(card);
    this.highlight(zone ?? card);
  }

  private drop(event: DragEvent): void {
    const transfer = event.dataTransfer;
    const zone = this.zoneAt(event.target);
    const card = zone ? this.anchor : this.cardAt(event.target);
    const newBlock = zone?.dataset.newBlockKind as IngestionTarget["newBlock"];
    const native = this.port.getNativeDraggable();
    const eligible = transfer && !this.port.isOwnDrag(event) && !this.isSelectionDrag()
      && this.port.getMode() !== "output" && card?.isConnected && this.supports(transfer, native)
      && !(this.hasFiles(transfer) && !newBlock && this.editorAt(event.target));
    this.clearGesture();
    if (!eligible || !card || !transfer) return;
    this.receive(event, card.dataset.blockId!, transfer, native, newBlock);
  }

  private paste(event: ClipboardEvent): void {
    const transfer = event.clipboardData;
    const editor = this.editorAt(event.target);
    const card = editor && this.cardAt(editor);
    if (!transfer || !card || this.hasFiles(transfer) || !this.supports(transfer, null)) return;
    this.receive(event, card.dataset.blockId!, transfer);
  }

  private receive(event: Event, blockId: string, transfer: DataTransfer, native?: unknown, newBlock?: IngestionTarget["newBlock"]): void {
    const snapshot: TransferSnapshot = {
      types: Array.from(transfer.types),
      markdown: transfer.getData("text/markdown") || transfer.getData("text/x-markdown"),
      plain: transfer.getData("text/plain"), uriList: transfer.getData("text/uri-list"),
      hasFiles: this.hasFiles(transfer), ownArborDrag: false,
      imageFiles: Array.from(transfer.files)
    };
    const resume = this.port.suspendBlurCommit();
    event.preventDefault();
    event.stopImmediatePropagation();
    runAsyncAction(this.receiver.drop(event, blockId, snapshot, native, newBlock).finally(resume), error => this.port.reportError(error));
  }

  private clearOptions(): void {
    this.highlight(null);
    this.options?.remove();
    this.options = null;
    this.anchor = null;
  }

  private zoneAt(target: EventTarget | null): HTMLElement | null {
    const zone = elementFromTarget(target)?.closest<HTMLElement>("[data-new-block-kind]");
    return zone && this.options?.contains(zone) && this.anchor?.isConnected
      && (zone.dataset.newBlockKind === "child" || zone.dataset.newBlockKind === "sibling") ? zone : null;
  }

  private showOptions(card: HTMLElement): void {
    if (this.anchor === card && this.options) return;
    this.clearOptions();
    this.anchor = card;
    const orientation = this.port.getOrientation();
    const direction = this.port.getDirection();
    const horizontal = orientation === "horizontal";
    this.options = this.port.getRoot().createDiv({ cls: "arbor-content-drop-options", attr: { role: "group", "aria-label": "Create a block from incoming content" } });
    this.options.dataset.orientation = orientation;
    this.options.dataset.direction = direction;
    const sideIcon = direction === "rtl" ? "arrow-left" : "arrow-right";
    const childIcon = horizontal ? sideIcon : orientation === "vertical-bottom-up" ? "arrow-up" : "arrow-down";
    for (const [kind, title, detail, icon] of [
      ["sibling", "New block beside", "Same level", horizontal ? "arrow-down" : sideIcon],
      ["child", "New child block", "Inside this branch", childIcon]
    ]) {
      const zone = this.options.createDiv({ cls: "arbor-content-drop-zone" });
      zone.dataset.newBlockKind = kind;
      const symbol = zone.createSpan({ cls: "arbor-content-drop-icon" });
      setIcon(symbol, icon);
      const label = zone.createDiv({ cls: "arbor-content-drop-label" });
      label.createSpan({ cls: "arbor-content-drop-title", text: title });
      label.createSpan({ cls: "arbor-content-drop-detail", text: detail });
      setIcon(zone.createSpan({ cls: "arbor-content-drop-plus" }), "plus");
    }
    this.positionOptions();
  }

  private positionOptions(): void {
    if (!this.options || !this.anchor) return;
    if (!this.anchor.isConnected) { this.clearOptions(); return; }
    const root = this.port.getRoot();
    const viewport = this.anchor.closest<HTMLElement>(".arbor-columns-viewport, .arbor-overview-viewport");
    if (!viewport) { this.clearOptions(); return; }
    const bounds = viewport.getBoundingClientRect();
    const card = this.anchor.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    const width = Math.min(232, Math.max(0, bounds.width - 16));
    const height = this.options.offsetHeight || 112;
    const inset = 8;
    const minX = Math.max(bounds.left, origin.left) + inset;
    const maxX = Math.max(minX, Math.min(bounds.right, origin.right) - width - inset);
    const minY = Math.max(bounds.top, origin.top) + inset;
    const maxY = Math.max(minY, Math.min(bounds.bottom, origin.bottom) - height - inset);
    const horizontal = this.port.getOrientation() === "horizontal";
    let x = horizontal && this.port.getDirection() === "rtl" ? card.left - width - inset : horizontal ? card.right + inset : card.left;
    let y = horizontal ? card.top : this.port.getOrientation() === "vertical-bottom-up" ? card.top - height - inset : card.bottom + inset;
    // Fall back below/above the card when its branch edge has no room.
    if (horizontal && (x < minX || x > maxX)) {
      x = card.left;
      y = card.bottom + height + inset <= bounds.bottom ? card.bottom + inset : card.top - height - inset;
    }
    if (!horizontal && (y < minY || y > maxY)) {
      const below = card.bottom + inset;
      const above = card.top - height - inset;
      if (below >= minY && below <= maxY) y = below;
      else if (above >= minY && above <= maxY) y = above;
    }
    this.options.setCssProps({
      "--arbor-drop-options-x": `${Math.min(maxX, Math.max(minX, x)) - origin.left + root.scrollLeft - root.clientLeft}px`,
      "--arbor-drop-options-y": `${Math.min(maxY, Math.max(minY, y)) - origin.top + root.scrollTop - root.clientTop}px`,
      "--arbor-drop-options-width": `${width}px`
    });
  }

  private highlight(card: HTMLElement | null): void {
    if (this.highlighted === card) return;
    this.highlighted?.classList.remove("is-content-drop-target");
    this.highlighted = card;
    card?.classList.add("is-content-drop-target");
  }
}
