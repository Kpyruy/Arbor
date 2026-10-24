import { setIcon } from "obsidian";
import type { ArborLayoutDirection, ArborOverviewOrientation, ArborPresentationMode } from "../../types";
import type { EditingSession } from "../state/viewTypes";
import { runAsyncAction } from "../runtime/asyncActions";
import type { ContentIngestionController } from "./ContentIngestionController";
import type { IngestionTarget, NativeDragReader, TransferSnapshot } from "./ingestionTypes";
import { ARBOR_CARD_DRAG_MIME } from "../branch/DragDropController";
import { isImageAttachment } from "../editor/EditorAttachments";
import { intersectVisibleRects } from "../chrome/mobileViewportGeometry";
import { fitDropOptions } from "./dropOptionsGeometry";

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
      // Native tablet drags may omit relatedTarget between descendants.
      // A missing target alone is not evidence that the gesture left the view.
      if ((!related || !root.contains(related)) && !this.containsPoint(root, event)) this.clearOptions();
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
    root.addEventListener("arbor:viewport-resize", reposition);
    root.ownerDocument.addEventListener("drop", outsideDrop);
    root.ownerDocument.addEventListener("dragend", end);
    root.win.addEventListener("resize", reposition);
    root.win.addEventListener("blur", end);
    this.dispose = () => {
      root.removeEventListener("dragover", over, true);
      root.removeEventListener("drop", drop, true);
      root.removeEventListener("paste", paste, true);
      root.removeEventListener("dragstart", start, true);
      root.removeEventListener("dragend", end, true);
      root.removeEventListener("dragleave", leave, true);
      root.removeEventListener("scroll", reposition, true);
      root.removeEventListener("arbor:viewport-resize", reposition);
      root.ownerDocument.removeEventListener("drop", outsideDrop);
      root.ownerDocument.removeEventListener("dragend", end);
      root.win.removeEventListener("resize", reposition);
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
    const zone = this.zoneAt(event.target, event);
    const card = this.cardAt(event.target);
    if (!card && !zone) {
      this.highlight(null);
      const target = elementFromTarget(event.target);
      if (this.options && this.anchor?.isConnected && (this.options.contains(target)
        || target?.closest(".arbor-columns-viewport, .arbor-overview-viewport"))) {
        // Keep the native drag alive through the gap without inventing an
        // insertion target for a background drop.
        event.preventDefault();
        event.stopImmediatePropagation();
        transfer.dropEffect = "copy";
      } else this.clearOptions();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    transfer.dropEffect = "copy";
    if (card && !zone) this.showOptions(card);
    this.highlight(zone ?? card);
  }

  private drop(event: DragEvent): void {
    const transfer = event.dataTransfer;
    const zone = this.zoneAt(event.target, event);
    const card = zone ? this.anchor : this.cardAt(event.target);
    const newBlock = zone?.dataset.newBlockKind as IngestionTarget["newBlock"];
    const native = this.port.getNativeDraggable();
    const supported = transfer && !this.port.isOwnDrag(event) && !this.isSelectionDrag()
      && this.port.getMode() !== "output" && this.supports(transfer, native);
    const element = elementFromTarget(event.target);
    const corridorDrop = this.options && !card && (this.options.contains(element)
      || element?.closest(".arbor-columns-viewport, .arbor-overview-viewport"));
    const eligible = supported && card?.isConnected
      && !(this.hasFiles(transfer) && !newBlock && this.editorAt(event.target));
    this.clearGesture();
    if (!eligible || !card || !transfer) {
      // We accepted hover in this corridor: cancel URL/file browser defaults,
      // but never append to the last hovered card or create a guessed block.
      if (supported && corridorDrop) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
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

  private containsPoint(element: HTMLElement, point: Pick<MouseEvent, "clientX" | "clientY">): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)
      && point.clientX >= rect.left && point.clientX < rect.right
      && point.clientY >= rect.top && point.clientY < rect.bottom;
  }

  private zoneAt(target: EventTarget | null, point?: Pick<MouseEvent, "clientX" | "clientY">): HTMLElement | null {
    if (!this.options?.isConnected || this.options.hidden || !this.anchor?.isConnected) return null;
    const zone = elementFromTarget(target)?.closest<HTMLElement>("[data-new-block-kind]");
    if (zone && this.options.contains(zone)
      && (zone.dataset.newBlockKind === "child" || zone.dataset.newBlockKind === "sibling")) return zone;
    // iPad native drags can retain the viewport/card as the event target even
    // when the drag point is over a newly mounted sibling/child zone.
    if (!point) return null;
    return Array.from(this.options.querySelectorAll<HTMLElement>("[data-new-block-kind]"))
      .find(candidate => this.containsPoint(candidate, point)) ?? null;
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
    const pane = viewport.getBoundingClientRect();
    const card = this.anchor.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    const inset = 8;
    const visible = intersectVisibleRects([pane, origin]);
    if (!visible) { this.options.hidden = true; return; }
    const dock = root.querySelector<HTMLElement>(".arbor-touch-dock")?.getBoundingClientRect();
    if (dock && dock.width > 0 && dock.top > visible.top && dock.top < visible.bottom) visible.bottom = dock.top;
    const bounds = { left: visible.left + inset, right: visible.right - inset, top: visible.top + inset, bottom: visible.bottom - inset };
    const width = Math.min(232, Math.max(0, bounds.right - bounds.left));
    this.options.hidden = false;
    this.options.dataset.layout = "stack";
    this.options.setCssProps({ "--arbor-drop-options-width": `${width}px` });
    const stackSize = { width, height: this.options.offsetHeight || 112 };
    this.options.dataset.layout = "row";
    const rowWidth = Math.min(464, Math.max(0, bounds.right - bounds.left));
    this.options.setCssProps({ "--arbor-drop-options-width": `${rowWidth}px` });
    const rowSize = { width: rowWidth, height: this.options.offsetHeight || 64 };
    const height = stackSize.height;
    const minX = bounds.left;
    const maxX = bounds.right - width;
    const minY = bounds.top;
    const maxY = bounds.bottom - height;
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
    const fitted = fitDropOptions({ bounds, preferred: { x, y }, stackSize, rowSize });
    this.options.hidden = !fitted;
    if (!fitted) { this.highlight(null); return; }
    this.options.dataset.layout = fitted.layout;
    this.options.setCssProps({
      "--arbor-drop-options-x": `${fitted.x - origin.left + root.scrollLeft - root.clientLeft}px`,
      "--arbor-drop-options-y": `${fitted.y - origin.top + root.scrollTop - root.clientTop}px`,
      "--arbor-drop-options-width": `${fitted.layout === "stack" ? width : rowWidth}px`
    });
  }

  private highlight(card: HTMLElement | null): void {
    if (this.highlighted === card) return;
    this.highlighted?.classList.remove("is-content-drop-target");
    this.highlighted = card;
    card?.classList.add("is-content-drop-target");
  }
}
