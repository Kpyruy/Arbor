import { ensureSelectedBlock, getBlock } from "../../model/tree";
import { resolveEditorHeight } from "../../cardViewport";
import { shouldSaveOnEnter } from "../../mobile";
import type { BranchBlock, BranchBlockId } from "../../types";
import type { EditingOrigin, EditingSession, LoadedFileIdentity, LoadedFileState } from "../state/viewTypes";
import { DocumentLoadChangedError } from "../state/DocumentController";
import type { EditorPort } from "../state/viewTypes";
import { DraftRecoveryStore } from "./DraftRecoveryStore";

export interface BlockEditorPort {
  getFilePath?(): string;
  getLoadedFileIdentity?(): LoadedFileIdentity | null;
  recoveryStore?: DraftRecoveryStore;
  onCommitted?(session: EditingSession): void;
  onError?(error: unknown): void;
  getState(): Readonly<LoadedFileState> | null;
  getWindow?(): Window;
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
  private blurCommitTimer: { id: number; win: Window } | null = null;
  private readonly blurCommitSuspensions = new Map<symbol, EditingSession>();
  private readonly pendingCommits = new WeakMap<EditingSession, Promise<void>>();
  private readonly recovery: DraftRecoveryStore;
  private sessionFilePath = "";

  constructor(private readonly port: BlockEditorPort) {
    this.recovery = port.recoveryStore ?? new DraftRecoveryStore();
  }

  getSession(): EditingSession | null {
    return this.session;
  }

  beginEditingBlock(id: BranchBlockId, origin: EditingOrigin = "card"): void {
    if (this.port.getLoadedFileIdentity && !this.port.getLoadedFileIdentity()) return;
    const state = this.port.getState();
    if (!state) return;
    const nextSelectedBlockId = ensureSelectedBlock(state.metadata, id);
    if (this.session?.blockId === nextSelectedBlockId) return;

    if (this.session && this.session.blockId !== nextSelectedBlockId) {
      const pending = this.session;
      const filePath = this.sessionFilePath;
      const loadedFileIdentity = this.port.getLoadedFileIdentity?.() ?? null;
      void this.commitEditingSession(pending).then(() => {
        const currentState = this.port.getState();
        if (!currentState || this.session || !nextSelectedBlockId) return;
        if (!this.isCurrentTarget(pending, filePath)) return;
        if (this.port.getLoadedFileIdentity && this.port.getLoadedFileIdentity() !== loadedFileIdentity) return;
        if (!getBlock(currentState.metadata, nextSelectedBlockId)) return;
        if (!this.session) {
          this.beginEditingBlock(nextSelectedBlockId, origin);
        }
      }).catch(error => this.port.onError?.(error));
      return;
    }

    const block = getBlock(state.metadata, nextSelectedBlockId);
    if (!block) return;

    this.prepareCreatedBlock(block, origin);
    this.port.onBegin(this.session!);
  }

  prepareCreatedBlock(block: BranchBlock, origin: EditingOrigin): void {
    this.retainCurrentDraft();
    this.sessionFilePath = this.port.getFilePath?.() ?? "";
    this.session = {
      draftId: crypto.randomUUID(),
      filePath: this.sessionFilePath || undefined,
      loadedFile: this.port.getLoadedFileIdentity?.() ?? undefined,
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin
    };
  }

  cancelEditingSession(): void {
    this.clearBlurCommitTimer();
    this.retainCurrentDraft();
    const session = this.session;
    this.session = null;
    this.port.onCancel(session);
  }

  commitEditingSession(session: EditingSession | null = this.session): Promise<void> {
    if (!session) return Promise.resolve();
    const pending = this.pendingCommits.get(session);
    if (pending) return pending;
    if (this.session !== session) return Promise.resolve();
    this.clearBlurCommitTimer();
    const filePath = this.sessionFilePath;
    const saved = { ...session };
    const hasRecovery = Boolean(saved.recoveryId) || this.recovery.getAll(filePath, session.blockId).some(draft => draft.draftId === session.draftId);
    const write = (async () => {
      try {
        if (!this.port.getState() || !this.isCurrentTarget(saved, filePath)) throw new DocumentLoadChangedError();
        if (saved.value === saved.originalContent && !hasRecovery) await this.port.onUnchanged(saved);
        else await this.port.saveEdit(saved);
        session.originalContent = saved.value;
        if (session.value === saved.value) {
          this.recovery.remove(session.recoveryId ?? session.draftId!);
          if (this.session === session) {
            this.session = null;
            if (this.isCurrentTarget(saved, filePath)) this.port.onCommitted?.(session);
          }
        } else {
          this.retainSession(session, filePath);
          if (this.session === session && this.isCurrentTarget(saved, filePath)) this.port.onCommitted?.(session);
        }
      } catch (error) {
        this.retainSession(session, filePath);
        throw error;
      }
    })();
    this.pendingCommits.set(session, write);
    void write.then(() => this.pendingCommits.delete(session), () => this.pendingCommits.delete(session));
    return write;
  }

  private isCurrentTarget(session: EditingSession, filePath: string): boolean {
    if (this.port.getFilePath && this.port.getFilePath() !== filePath) return false;
    return !this.port.getLoadedFileIdentity || Boolean(session.loadedFile && this.port.getLoadedFileIdentity() === session.loadedFile);
  }

  private retainSession(session: EditingSession, filePath: string): void {
    if (!filePath) return;
    const draftId = session.recoveryId ?? session.draftId!;
    if (session.value === session.originalContent && !this.recovery.getAll(filePath, session.blockId).some(draft => draft.draftId === draftId)) return;
    this.recovery.retain({
      draftId, filePath,
      blockId: session.blockId, originalContent: session.originalContent, value: session.value
    });
  }

  retainCurrentDraft(): void {
    if (this.session) this.retainSession(this.session, this.sessionFilePath);
  }

  restoreDraft(draftId: string, blockId: BranchBlockId, origin: EditingOrigin = "card"): boolean {
    if (this.port.getLoadedFileIdentity && !this.port.getLoadedFileIdentity()) return false;
    if (this.session && (this.session.value !== this.session.originalContent || this.pendingCommits.has(this.session))) return false;
    const state = this.port.getState();
    const block = state && getBlock(state.metadata, blockId);
    const draft = this.recovery.getAll(this.port.getFilePath?.() ?? "", blockId).find(candidate => candidate.draftId === draftId);
    if (!block || !draft) return false;
    this.prepareCreatedBlock(block, origin);
    this.session!.value = draft.value;
    this.session!.recoveryId = draftId;
    this.port.onBegin(this.session!);
    return true;
  }

  async commitEditIfNeeded(): Promise<void> {
    while (this.session && this.port.getState()) await this.commitEditingSession(this.session);
  }

  scheduleEditingSessionCommit(session: EditingSession): void {
    this.clearBlurCommitTimer();
    if ([...this.blurCommitSuspensions.values()].includes(session)) return;
    const win = this.port.getWindow?.() ?? window;
    const id = win.setTimeout(() => {
      if (this.session !== session) return;
      void this.commitEditingSession(session).catch(error => this.port.onError?.(error));
    }, 80);
    this.blurCommitTimer = { id, win };
  }

  clearBlurCommitTimer(): void {
    if (this.blurCommitTimer !== null) {
      this.blurCommitTimer.win.clearTimeout(this.blurCommitTimer.id);
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
    this.retainCurrentDraft();
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
        void this.commitEditingSession().catch(error => this.port.onError?.(error));
      }
    });
    editor.addEventListener("paste", (event) => {
      event.stopPropagation();
      void this.port.paste(event, editor).catch(error => this.port.onError?.(error));
    });
    editor.addEventListener("drop", (event) => {
      event.stopPropagation();
      void this.port.drop(event, editor).catch(error => this.port.onError?.(error));
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
