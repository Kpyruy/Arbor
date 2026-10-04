import { ensureSelectedBlock, getBlock } from "../../model/tree";
import { resolveEditorHeight } from "../../cardViewport";
import { shouldSaveOnEnter } from "../../mobile";
import type { BranchBlock, BranchBlockId } from "../../types";
import type { EditingOrigin, EditingSession, LoadedFileState } from "../state/viewTypes";
import type { EditorPort } from "../state/viewTypes";

export interface BlockEditorPort {
  getState(): Readonly<LoadedFileState> | null;
  usesTouchControls(): boolean;
  getViewportHeight(): number;
  onBegin(session: EditingSession): void;
  onCancel(session: EditingSession | null): void;
  onUnchanged(session: EditingSession): Promise<void>;
  saveEdit(session: EditingSession): Promise<void>;
  onInput(): void;
  handleSearchShortcut(event: KeyboardEvent): boolean;
  paste(event: ClipboardEvent, textarea: HTMLTextAreaElement): Promise<void>;
  drop(event: DragEvent, textarea: HTMLTextAreaElement): Promise<void>;
}

export class BlockEditorController implements EditorPort {
  private session: EditingSession | null = null;
  private blurCommitTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly blurCommitSuspensions = new Map<symbol, EditingSession>();

  constructor(private readonly port: BlockEditorPort) {}

  getSession(): EditingSession | null {
    return this.session;
  }

  beginEditingBlock(id: BranchBlockId, origin: EditingOrigin = "card"): void {
    const state = this.port.getState();
    if (!state) return;
    const nextSelectedBlockId = ensureSelectedBlock(state.metadata, id);

    if (this.session && this.session.blockId !== nextSelectedBlockId) {
      const pending = this.session;
      void this.commitEditingSession(pending).then(() => {
        const currentState = this.port.getState();
        if (currentState && nextSelectedBlockId) {
          this.beginEditingBlock(nextSelectedBlockId, origin);
        }
      });
      return;
    }

    const block = getBlock(state.metadata, nextSelectedBlockId);
    if (!block) return;

    this.prepareCreatedBlock(block, origin);
    this.port.onBegin(this.session!);
  }

  prepareCreatedBlock(block: BranchBlock, origin: EditingOrigin): void {
    this.session = {
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin
    };
  }

  cancelEditingSession(): void {
    this.clearBlurCommitTimer();
    const session = this.session;
    this.session = null;
    this.port.onCancel(session);
  }

  async commitEditingSession(session: EditingSession | null = this.session): Promise<void> {
    if (!this.port.getState() || !session || this.session !== session) return;

    this.clearBlurCommitTimer();
    this.session = null;
    if (session.value === session.originalContent) {
      await this.port.onUnchanged(session);
      return;
    }
    await this.port.saveEdit(session);
  }

  async commitEditIfNeeded(): Promise<void> {
    await this.commitEditingSession();
  }

  scheduleEditingSessionCommit(session: EditingSession): void {
    this.clearBlurCommitTimer();
    if ([...this.blurCommitSuspensions.values()].includes(session)) return;
    this.blurCommitTimer = globalThis.setTimeout(() => {
      if (this.session !== session) return;
      void this.commitEditingSession(session);
    }, 80);
  }

  clearBlurCommitTimer(): void {
    if (this.blurCommitTimer !== null) {
      globalThis.clearTimeout(this.blurCommitTimer);
      this.blurCommitTimer = null;
    }
  }

  suspendBlurCommit(): () => void {
    this.clearBlurCommitTimer();
    const token = Symbol();
    if (this.session) this.blurCommitSuspensions.set(token, this.session);
    return () => { this.blurCommitSuspensions.delete(token); };
  }

  reset(): void {
    this.clearBlurCommitTimer();
    this.blurCommitSuspensions.clear();
    this.session = null;
  }

  consumeAutofocus(session: EditingSession): void {
    if (this.session === session) this.session.autofocus = false;
  }

  wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void {
    if (editor.dataset.arborBound === "true") {
      editor.dataset.editorOrigin = origin;
      return;
    }

    editor.dataset.arborBound = "true";
    editor.dataset.editorOrigin = origin;
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((eventName) => {
      editor.addEventListener(eventName, (event) => event.stopPropagation());
    });
    editor.addEventListener("input", () => {
      if (this.session?.blockId !== block.id) return;
      this.clearBlurCommitTimer();
      this.session.value = editor.value;
      this.resizeEditor(editor);
      this.port.onInput();
    });
    editor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.port.handleSearchShortcut(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEditingSession();
      } else if (shouldSaveOnEnter(event, this.port.usesTouchControls())) {
        event.preventDefault();
        void this.commitEditingSession();
      }
    });
    editor.addEventListener("paste", (event) => {
      event.stopPropagation();
      void this.port.paste(event, editor);
    });
    editor.addEventListener("drop", (event) => {
      event.stopPropagation();
      void this.port.drop(event, editor);
    });
    editor.addEventListener("dragover", (event) => {
      event.stopPropagation();
      if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith("image/"))) event.preventDefault();
    });
    editor.addEventListener("focus", (event) => {
      event.stopPropagation();
      this.clearBlurCommitTimer();
    });
    editor.addEventListener("blur", (event) => {
      event.stopPropagation();
      if (this.port.usesTouchControls()) return;
      const session = this.session;
      if (!session || session.blockId !== block.id || session.origin !== editor.dataset.editorOrigin) return;
      this.scheduleEditingSessionCommit(session);
    });
  }

  resizeEditor(textarea: HTMLTextAreaElement): void {
    textarea.setCssProps({ "--arbor-editor-height": "0px" });
    const card = textarea.closest<HTMLElement>(".arbor-card");
    const viewportHeight = this.port.getViewportHeight();
    const cardChromeHeight = card ? Math.max(0, card.offsetHeight - textarea.offsetHeight) : 0;
    const height = this.port.usesTouchControls()
      ? Math.max(80, Math.min(textarea.scrollHeight, viewportHeight - cardChromeHeight - 32))
      : resolveEditorHeight(textarea.scrollHeight, viewportHeight, cardChromeHeight);
    textarea.setCssProps({ "--arbor-editor-height": `${height}px` });
  }
}
