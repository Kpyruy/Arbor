import type { ArborPresentationMode } from "../../types";
import type { EditingSession } from "../state/viewTypes";
import { runAsyncAction } from "../runtime/asyncActions";
import type { ContentIngestionController } from "./ContentIngestionController";
import type { NativeDragReader, TransferSnapshot } from "./ingestionTypes";
import { ARBOR_CARD_DRAG_MIME } from "../branch/DragDropController";

export interface ContentIngestionRoutingPort {
  getRoot(): HTMLElement;
  getMode(): ArborPresentationMode;
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
      if (!related || !this.highlighted?.contains(related)) this.highlight(null);
    };
    root.addEventListener("dragover", over, true);
    root.addEventListener("drop", drop, true);
    root.addEventListener("paste", paste, true);
    root.addEventListener("dragstart", start, true);
    root.addEventListener("dragend", end, true);
    root.addEventListener("dragleave", leave, true);
    this.dispose = () => {
      root.removeEventListener("dragover", over, true);
      root.removeEventListener("drop", drop, true);
      root.removeEventListener("paste", paste, true);
      root.removeEventListener("dragstart", start, true);
      root.removeEventListener("dragend", end, true);
      root.removeEventListener("dragleave", leave, true);
    };
  }

  unbind(): void {
    this.dispose?.();
    this.dispose = null;
    this.clearGesture();
  }

  clearGesture(): void {
    this.selectionDrag = null;
    this.highlight(null);
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

  private supports(transfer: DataTransfer, native: unknown): boolean {
    return !Array.from(transfer.types).includes(ARBOR_CARD_DRAG_MIME) && !this.hasFiles(transfer) && (this.native.canRead(native)
      || Array.from(transfer.types).some(type => ["text/plain", "text/markdown", "text/x-markdown", "text/uri-list"].includes(type)));
  }

  private isSelectionDrag(): boolean {
    return Boolean(this.selectionDrag && this.selectionDrag.session === this.port.getSession()
      && this.selectionDrag.editor.isConnected);
  }

  private dragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer || this.port.isOwnDrag(event) || this.isSelectionDrag()) { this.highlight(null); return; }
    const card = this.cardAt(event.target);
    if (!card || !this.supports(transfer, this.port.getNativeDraggable())) { this.highlight(null); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    transfer.dropEffect = "copy";
    this.highlight(card);
  }

  private drop(event: DragEvent): void {
    this.highlight(null);
    const transfer = event.dataTransfer;
    if (!transfer || this.port.isOwnDrag(event) || this.isSelectionDrag()) return;
    const card = this.cardAt(event.target);
    const native = this.port.getNativeDraggable();
    if (!card || !this.supports(transfer, native)) return;
    this.receive(event, card.dataset.blockId!, transfer, native);
  }

  private paste(event: ClipboardEvent): void {
    const transfer = event.clipboardData;
    const editor = this.editorAt(event.target);
    const card = editor && this.cardAt(editor);
    if (!transfer || !card || !this.supports(transfer, null)) return;
    this.receive(event, card.dataset.blockId!, transfer);
  }

  private receive(event: Event, blockId: string, transfer: DataTransfer, native?: unknown): void {
    const snapshot: TransferSnapshot = {
      types: Array.from(transfer.types),
      markdown: transfer.getData("text/markdown") || transfer.getData("text/x-markdown"),
      plain: transfer.getData("text/plain"), uriList: transfer.getData("text/uri-list"),
      hasFiles: this.hasFiles(transfer), ownArborDrag: false
    };
    const resume = this.port.suspendBlurCommit();
    event.preventDefault();
    event.stopImmediatePropagation();
    runAsyncAction(this.receiver.drop(event, blockId, snapshot, native).finally(resume), error => this.port.reportError(error));
  }

  private highlight(card: HTMLElement | null): void {
    if (this.highlighted === card) return;
    this.highlighted?.classList.remove("is-content-drop-target");
    this.highlighted = card;
    card?.classList.add("is-content-drop-target");
  }
}
