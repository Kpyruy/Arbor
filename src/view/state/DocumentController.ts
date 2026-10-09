import type { TFile } from "obsidian";
import { BranchHistory } from "../../history";
import { cloneMetadata, createEmptyTree, ensureSelectedBlock, getBlock, updateBlockContent } from "../../model/tree";
import { createDefaultOutputState, FULL_OUTPUT_PROFILE_ID, getActiveOutputProfile, reconcileProfilesAfterTreeChange } from "../../outputProfiles";
import { buildBranchDocument, parseBranchDocument, updateStoredOverviewOrientation } from "../../storage/document";
import { normalizeOverviewOrientation } from "../../overviewOrientation";
import { loadImportedBranchDocument } from "../../storage/reconcile";
import { linearizeTree, normalizeMetadata } from "../../storage/serializer";
import type { ArborOutputProfile, ArborOutputState, BranchHistoryEntry, BranchTreeMetadata, BranchTreeMutationResult, ImportedBranchDocument, ArborOverviewOrientation } from "../../types";
import { deepClone } from "../../utils";
import type { EditingSession, LoadedFileIdentity, LoadedFileState } from "./viewTypes";

export interface DocumentPort {
  getFile(): TFile | null;
  cachedRead(file: TFile): Promise<string>;
  process(file: TFile, transform: (text: string) => string): Promise<string>;
  markOwnWrite(path: string): void;
  rememberManagedNote(path: string): void;
  commitEditIfNeeded(): Promise<void>;
  clearEditingSession(): void;
  beforeOverviewEditSave(): void;
  onMutationPrepared(autofocusSelection: boolean): void;
  onSelectionRestored(): void;
  onEditedBlockSaved(session: EditingSession): void;
  onProfileActivated(): void;
  requestRender(): void;
  notify(message: string): void;
  reportError(message: string, error: unknown): void;
}

export class DocumentConflictError extends Error {
  constructor(readonly filePath: string) {
    super(`The note "${filePath}" changed on disk. Reload it before saving; your draft is retained.`);
    this.name = "DocumentConflictError";
  }
}

export class DocumentLoadChangedError extends Error {
  constructor() {
    super("The Arbor note was closed or reloaded before the save completed.");
    this.name = "DocumentLoadChangedError";
  }
}

export class DocumentWriteError extends Error {
  constructor(readonly filePath: string, readonly cause: unknown) {
    super(`Could not write the note "${filePath}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DocumentWriteError";
  }
}

type WriteLifetime = LoadedFileIdentity;

export function buildLoadedFileState(
  parsed: ReturnType<typeof parseBranchDocument>,
  loaded: ImportedBranchDocument,
  preferredSelectedBlockId: string | null,
  diskText: string
): LoadedFileState {
  return {
    diskText,
    frontmatter: parsed.frontmatter,
    metadata: loaded.metadata,
    outputState: loaded.outputState,
    outputRaw: loaded.outputRaw,
    outputError: loaded.outputError,
    selectedBlockId: ensureSelectedBlock(loaded.metadata, preferredSelectedBlockId),
    staleMetadata: loaded.staleMetadata,
    origin: loaded.origin,
    linearized: linearizeTree(loaded.metadata)
  };
}

export class DocumentController {
  private readonly history = new BranchHistory();
  private state: LoadedFileState | null = null;
  private pendingWrites = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private loadEpoch = 0;
  private loadedFile: LoadedFileIdentity | null = null;

  constructor(private readonly port: DocumentPort) {}

  getState(): Readonly<LoadedFileState> | null { return this.state; }

  replaceLoadedState(state: LoadedFileState, file = this.port.getFile()): void {
    this.loadEpoch += 1;
    this.state = state;
    this.loadedFile = file ? { file, path: file.path, epoch: this.loadEpoch } : null;
  }

  getLoadedFileIdentity(): LoadedFileIdentity | null {
    const loaded = this.loadedFile;
    return this.state && loaded && loaded.epoch === this.loadEpoch && this.port.getFile() === loaded.file
      && loaded.file.path === loaded.path ? loaded : null;
  }

  setSelection(id: string | null): void {
    if (this.state) this.state.selectedBlockId = id;
  }

  reset(): void {
    this.loadEpoch += 1;
    this.state = null;
    this.loadedFile = null;
    this.history.clear();
  }

  clearHistory(): void { this.history.clear(); }
  invalidateLoad(): void { this.loadEpoch += 1; this.loadedFile = null; }
  isWriting(): boolean { return this.pendingWrites > 0; }

  acceptOverviewOrientation(value: ArborOverviewOrientation | null): void {
    if (!this.state) return;
    if (value) this.state.metadata.overviewOrientation = value;
    else delete this.state.metadata.overviewOrientation;
  }

  private orientationOnlyChange(baseline: string, text: string): boolean {
    const before = parseBranchDocument(baseline).metadata;
    const after = parseBranchDocument(text).metadata;
    if (!before || !after) return false;
    const previous = normalizeOverviewOrientation(before.overviewOrientation);
    const next = normalizeOverviewOrientation(after.overviewOrientation);
    return previous !== next && updateStoredOverviewOrientation(baseline, next, before) === text;
  }

  syncOrientationOnlyChange(text: string): boolean {
    const state = this.state;
    if (!state) return false;
    if (state.diskText !== text && !this.orientationOnlyChange(state.diskText, text)) return false;
    this.acceptOverviewOrientation(normalizeOverviewOrientation(parseBranchDocument(text).metadata?.overviewOrientation));
    state.diskText = text;
    return true;
  }

  private lifetime(): WriteLifetime | null {
    if (!this.state) return null;
    const loaded = this.getLoadedFileIdentity();
    if (!loaded) throw new DocumentLoadChangedError();
    return loaded;
  }

  private isCurrentLifetime(lifetime: WriteLifetime): boolean {
    return this.getLoadedFileIdentity() === lifetime;
  }

  private assertLifetime(lifetime: WriteLifetime): void {
    if (!this.isCurrentLifetime(lifetime)) {
      throw new DocumentLoadChangedError();
    }
  }

  private enqueue<Result>(lifetime: WriteLifetime, reason: string, operation: () => Promise<Result>): Promise<Result> {
    this.pendingWrites += 1;
    const write = this.writes.then(async () => {
      this.assertLifetime(lifetime);
      return operation();
    }).catch((error: unknown) => {
      this.port.reportError(`[Arbor] Failed to persist state after ${reason}`, error);
      this.port.notify(error instanceof DocumentConflictError || error instanceof DocumentLoadChangedError ? error.message : `Arbor could not save the note after "${reason}".`);
      throw error;
    }).finally(() => { this.pendingWrites -= 1; });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private async afterEditor<Result>(reason: string, operation: (lifetime: WriteLifetime) => Promise<Result>, fallback: Result): Promise<Result> {
    const lifetime = this.lifetime();
    if (!lifetime) return fallback;
    await this.port.commitEditIfNeeded();
    this.assertLifetime(lifetime);
    return this.enqueue(lifetime, reason, () => operation(lifetime));
  }

  private async processWrite(lifetime: WriteLifetime, transform: (text: string) => string): Promise<string> {
    let transformFailed = false;
    let transformError: unknown;
    let persisted: string;
    try {
      persisted = await this.port.process(lifetime.file, text => {
        try {
          return transform(text);
        } catch (error) {
          transformFailed = true;
          transformError = error;
          throw error;
        }
      });
    } catch (error) {
      if ((transformFailed && error === transformError) || error instanceof DocumentConflictError || error instanceof DocumentLoadChangedError) throw error;
      throw new DocumentWriteError(lifetime.path, error);
    }
    this.port.markOwnWrite(lifetime.path);
    return persisted;
  }

  private async writeCandidate(lifetime: WriteLifetime, candidate: LoadedFileState): Promise<boolean> {
    this.assertLifetime(lifetime);
    const baseline = this.state!.diskText;
    candidate.metadata = normalizeMetadata(candidate.metadata);
    candidate.linearized = linearizeTree(candidate.metadata);
    const persisted = await this.processWrite(lifetime, text => {
      this.assertLifetime(lifetime);
      if (text !== baseline && !this.orientationOnlyChange(baseline, text)) throw new DocumentConflictError(lifetime.path);
      const orientation = normalizeOverviewOrientation(parseBranchDocument(text).metadata?.overviewOrientation);
      if (orientation) candidate.metadata.overviewOrientation = orientation;
      else delete candidate.metadata.overviewOrientation;
      return buildBranchDocument(candidate.frontmatter, candidate.linearized.body, candidate.metadata,
        candidate.outputState, candidate.outputError ? candidate.outputRaw : undefined);
    });
    this.port.rememberManagedNote(lifetime.path);
    if (!this.isCurrentLifetime(lifetime)) return false;
    candidate.diskText = persisted;
    candidate.outputRaw = parseBranchDocument(persisted).outputRaw;
    candidate.origin = "metadata";
    candidate.staleMetadata = null;
    this.state = candidate;
    return true;
  }

  async saveOverviewOrientation(value: ArborOverviewOrientation | null): Promise<void> {
    const lifetime = this.lifetime();
    if (!lifetime) throw new Error("No Arbor note is loaded");
    if (value !== null && !normalizeOverviewOrientation(value)) throw new Error("Invalid Tree Overview orientation");
    await this.enqueue(lifetime, "Change Tree Overview orientation", async () => {
      const candidate = deepClone(this.state!);
      const baseline = candidate.diskText;
      const persisted = await this.processWrite(lifetime, text => {
        this.assertLifetime(lifetime);
        if (text !== baseline && !this.orientationOnlyChange(baseline, text)) throw new DocumentConflictError(lifetime.path);
        return updateStoredOverviewOrientation(text, value, candidate.metadata);
      });
      if (!this.isCurrentLifetime(lifetime)) return;
      candidate.diskText = persisted;
      if (value) candidate.metadata.overviewOrientation = value;
      else delete candidate.metadata.overviewOrientation;
      this.state = candidate;
    });
  }

  async readLoadedFileState(file: TFile, preferredSelectedBlockId: string | null): Promise<{
    state: LoadedFileState; loaded: ImportedBranchDocument; parsed: ReturnType<typeof parseBranchDocument>;
  }> {
    const text = await this.port.cachedRead(file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    return { state: buildLoadedFileState(parsed, loaded, preferredSelectedBlockId, text), loaded, parsed };
  }

  async persistState(reason: string): Promise<void> {
    const lifetime = this.lifetime();
    if (!lifetime) return;
    await this.enqueue(lifetime, reason, async () => { await this.writeCandidate(lifetime, deepClone(this.state!)); });
  }

  async applyMutation(label: string, mutate: (metadata: BranchTreeMetadata) => BranchTreeMutationResult, autofocusSelection = false): Promise<void> {
    await this.afterEditor(label, async lifetime => {
      const before = this.currentHistorySnapshot(label);
      const candidate = deepClone(this.state!);
      const result = mutate(cloneMetadata(candidate.metadata));
      candidate.metadata = normalizeMetadata(result.metadata);
      candidate.outputState = reconcileProfilesAfterTreeChange(before.metadata, candidate.metadata, candidate.outputState, result.duplicateMap);
      candidate.selectedBlockId = ensureSelectedBlock(candidate.metadata, result.selectedBlockId);
      if (!await this.writeCandidate(lifetime, candidate)) return;
      this.history.push(label, before.metadata, before.outputState, before.selectedBlockId);
      this.port.onMutationPrepared(autofocusSelection);
      this.port.requestRender();
    }, undefined);
  }

  async commitEditedBlock(session: EditingSession): Promise<void> {
    const lifetime = this.lifetime();
    if (!lifetime) throw new DocumentLoadChangedError();
    const saved = { ...session };
    if ((saved.filePath !== undefined && saved.filePath !== lifetime.path)
      || (saved.loadedFile && saved.loadedFile !== lifetime)) throw new DocumentLoadChangedError();
    await this.enqueue(lifetime, "Edit block", async () => {
      const before = this.currentHistorySnapshot("Edit block");
      const candidate = deepClone(this.state!);
      const block = getBlock(candidate.metadata, saved.blockId);
      if (!block || block.content !== saved.originalContent) throw new DocumentConflictError(lifetime.path);
      candidate.metadata = updateBlockContent(candidate.metadata, saved.blockId, saved.value);
      candidate.selectedBlockId = saved.blockId;
      if (saved.origin === "overview") this.port.beforeOverviewEditSave();
      if (!await this.writeCandidate(lifetime, candidate)) return;
      this.history.push("Edit block", before.metadata, before.outputState, before.selectedBlockId);
      this.port.onEditedBlockSaved(saved);
      this.port.requestRender();
    });
  }

  async applyActiveOutputProfile(next: ArborOutputState): Promise<ArborOutputState> {
    return this.writeOutput("Switch output profile", next, false, true);
  }

  async applyOutputProfileMutation(label: string, next: ArborOutputState): Promise<ArborOutputState> {
    return this.writeOutput(label, next, true, false);
  }

  private async writeOutput(label: string, next: ArborOutputState, recordHistory: boolean, activate: boolean): Promise<ArborOutputState> {
    if (!this.state || this.state.outputError) return deepClone(this.state?.outputState ?? createDefaultOutputState());
    const output = deepClone(next);
    return this.afterEditor(label, async lifetime => {
      if (this.state!.outputError) return deepClone(this.state!.outputState);
      const before = this.currentHistorySnapshot(label);
      const candidate = deepClone(this.state!);
      candidate.outputState = output;
      if (!await this.writeCandidate(lifetime, candidate)) return deepClone(candidate.outputState);
      if (recordHistory) this.history.push(label, before.metadata, before.outputState, before.selectedBlockId);
      if (activate) this.port.onProfileActivated();
      else this.port.onMutationPrepared(false);
      this.port.requestRender();
      return deepClone(candidate.outputState);
    }, createDefaultOutputState());
  }

  async resetInvalidOutputProfiles(): Promise<ArborOutputState> {
    if (!this.state?.outputError) return deepClone(this.state?.outputState ?? createDefaultOutputState());
    return this.afterEditor("Reset output profiles", async lifetime => {
      const candidate = deepClone(this.state!);
      candidate.outputState = createDefaultOutputState();
      candidate.outputRaw = "";
      candidate.outputError = null;
      if (!await this.writeCandidate(lifetime, candidate)) return deepClone(candidate.outputState);
      this.port.requestRender();
      return deepClone(candidate.outputState);
    }, createDefaultOutputState());
  }

  async applyOutputMutation(label: string, mutate: (profile: ArborOutputProfile) => ArborOutputProfile): Promise<void> {
    if (!this.state || this.state.outputError) return;
    await this.afterEditor(label, async lifetime => {
      if (this.state!.outputError) return;
      const before = this.currentHistorySnapshot(label);
      const candidate = deepClone(this.state!);
      const active = getActiveOutputProfile(candidate.outputState);
      if (active.id === FULL_OUTPUT_PROFILE_ID) return;
      const updated = mutate(deepClone(active));
      candidate.outputState.profiles = candidate.outputState.profiles.map(profile => profile.id === active.id ? updated : profile);
      if (!await this.writeCandidate(lifetime, candidate)) return;
      this.history.push(label, before.metadata, before.outputState, before.selectedBlockId);
      this.port.onMutationPrepared(false);
      this.port.requestRender();
    }, undefined);
  }

  async undo(): Promise<void> { await this.applyHistory("undo"); }
  async redo(): Promise<void> { await this.applyHistory("redo"); }

  private async applyHistory(direction: "undo" | "redo"): Promise<void> {
    if (!this.state || (direction === "undo" ? !this.history.canUndo() : !this.history.canRedo())) return;
    const label = direction === "undo" ? "Undo" : "Redo";
    await this.afterEditor(label, async lifetime => {
      const snapshot = direction === "undo" ? this.history.peekUndo() : this.history.peekRedo();
      if (!snapshot) return;
      const current = this.currentHistorySnapshot("Current state");
      const candidate = deepClone(this.state!);
      candidate.metadata = cloneMetadata(snapshot.metadata);
      candidate.outputState = deepClone(snapshot.outputState);
      candidate.selectedBlockId = ensureSelectedBlock(candidate.metadata, snapshot.selectedBlockId);
      if (!await this.writeCandidate(lifetime, candidate)) return;
      this.history[direction](current);
      this.port.clearEditingSession();
      this.port.onSelectionRestored();
      this.port.requestRender();
    }, undefined);
  }

  async rebuildTreeFromMetadata(): Promise<void> {
    const file = this.port.getFile();
    if (!file || !this.state) {
      return;
    }

    await this.port.commitEditIfNeeded();

    const text = await this.port.cachedRead(this.port.getFile()!);
    const parsed = parseBranchDocument(text);
    if (!parsed.metadata && !this.state.staleMetadata) {
      this.port.notify("No stored metadata was found in this note.");
      return;
    }

    const restored = cloneMetadata(parsed.metadata ?? this.state.staleMetadata ?? createEmptyTree());
    const beforeMetadata = cloneMetadata(this.state.metadata);
    this.history.push(
      "Rebuild tree from metadata",
      this.state.metadata,
      this.state.outputState,
      this.state.selectedBlockId
    );
    this.state.metadata = restored;
    this.state.outputState = reconcileProfilesAfterTreeChange(
      beforeMetadata,
      restored,
      this.state.outputState
    );
    this.state.selectedBlockId = ensureSelectedBlock(restored, this.state.selectedBlockId);
    this.state.linearized = linearizeTree(restored);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.port.clearEditingSession();
    this.port.onSelectionRestored();
    await this.persistState("Rebuild tree from metadata");
    this.port.requestRender();
  }

  private currentHistorySnapshot(label: string): BranchHistoryEntry {
    return {
      label,
      metadata: cloneMetadata(this.state?.metadata ?? createEmptyTree()),
      outputState: deepClone(this.state?.outputState ?? createDefaultOutputState()),
      selectedBlockId: this.state?.selectedBlockId ?? null
    };
  }

}
