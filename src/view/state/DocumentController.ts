import type { TFile } from "obsidian";
import { BranchHistory } from "../../history";
import {
  cloneMetadata,
  createEmptyTree,
  ensureSelectedBlock,
  updateBlockContent
} from "../../model/tree";
import {
  createDefaultOutputState,
  FULL_OUTPUT_PROFILE_ID,
  getActiveOutputProfile,
  reconcileProfilesAfterTreeChange
} from "../../outputProfiles";
import { buildBranchDocument, parseBranchDocument } from "../../storage/document";
import { loadImportedBranchDocument } from "../../storage/reconcile";
import { linearizeTree, normalizeMetadata } from "../../storage/serializer";
import type {
  ArborOutputProfile,
  ArborOutputState,
  BranchHistoryEntry,
  BranchTreeMetadata,
  BranchTreeMutationResult,
  ImportedBranchDocument
} from "../../types";
import { deepClone } from "../../utils";
import type { EditingSession, LoadedFileState } from "./viewTypes";

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

export function buildLoadedFileState(
  parsed: ReturnType<typeof parseBranchDocument>,
  loaded: ImportedBranchDocument,
  preferredSelectedBlockId: string | null
): LoadedFileState {
  const selectedBlockId = ensureSelectedBlock(loaded.metadata, preferredSelectedBlockId);
  return {
    frontmatter: parsed.frontmatter,
    metadata: loaded.metadata,
    outputState: loaded.outputState,
    outputRaw: loaded.outputRaw,
    outputError: loaded.outputError,
    selectedBlockId,
    staleMetadata: loaded.staleMetadata,
    origin: loaded.origin,
    linearized: linearizeTree(loaded.metadata)
  };
}

export class DocumentController {
  private readonly history = new BranchHistory();
  private state: LoadedFileState | null = null;
  private isPersisting = false;

  constructor(private readonly port: DocumentPort) {}

  getState(): Readonly<LoadedFileState> | null {
    return this.state;
  }

  replaceLoadedState(state: LoadedFileState): void {
    this.state = state;
  }

  setSelection(id: string | null): void {
    if (!this.state) return;
    this.state.selectedBlockId = id;
  }

  reset(): void {
    this.state = null;
    this.history.clear();
  }

  clearHistory(): void {
    this.history.clear();
  }

  isWriting(): boolean {
    return this.isPersisting;
  }

  async readLoadedFileState(
    file: TFile,
    preferredSelectedBlockId: string | null
  ): Promise<{
    state: LoadedFileState;
    loaded: ImportedBranchDocument;
    parsed: ReturnType<typeof parseBranchDocument>;
  }> {
    const text = await this.port.cachedRead(file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    return {
      state: buildLoadedFileState(parsed, loaded, preferredSelectedBlockId),
      loaded,
      parsed
    };
  }

  async persistState(reason: string): Promise<void> {
    const file = this.port.getFile();
    if (!file || !this.state) {
      return;
    }

    const metadata = normalizeMetadata(this.state.metadata);
    this.state.metadata = metadata;
    this.state.linearized = linearizeTree(metadata);
    const document = buildBranchDocument(
      this.state.frontmatter,
      this.state.linearized.body,
      metadata,
      this.state.outputState,
      this.state.outputError ? this.state.outputRaw : undefined
    );

    this.isPersisting = true;
    try {
      this.port.markOwnWrite(file.path);
      await this.port.process(file, () => document);
      this.port.rememberManagedNote(this.port.getFile()!.path);
      this.state.origin = "metadata";
      this.state.staleMetadata = null;
    } catch (error) {
      this.port.reportError(`[Arbor] Failed to persist state after ${reason}`, error);
      this.port.notify(`Arbor could not save the note after "${reason}".`);
    } finally {
      this.isPersisting = false;
    }
  }

  async applyMutation(
    label: string,
    mutate: (metadata: BranchTreeMetadata) => BranchTreeMutationResult,
    autofocusSelection = false
  ): Promise<void> {
    if (!this.state) {
      return;
    }

    await this.port.commitEditIfNeeded();

    const beforeMetadata = cloneMetadata(this.state.metadata);
    this.history.push(label, beforeMetadata, this.state.outputState, this.state.selectedBlockId);
    const result = mutate(cloneMetadata(beforeMetadata));
    this.state.metadata = normalizeMetadata(result.metadata);
    this.state.outputState = reconcileProfilesAfterTreeChange(
      beforeMetadata,
      this.state.metadata,
      this.state.outputState,
      result.duplicateMap
    );
    this.state.selectedBlockId = ensureSelectedBlock(this.state.metadata, result.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.port.onMutationPrepared(autofocusSelection);

    await this.persistState(label);
    this.port.requestRender();
  }

  async commitEditedBlock(session: EditingSession): Promise<void> {
    if (!this.state) return;
    if (session.origin === "overview") this.port.beforeOverviewEditSave();
    this.history.push("Edit block", this.state.metadata, this.state.outputState, this.state.selectedBlockId);
    this.state.metadata = normalizeMetadata(updateBlockContent(this.state.metadata, session.blockId, session.value));
    this.state.selectedBlockId = session.blockId;
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.port.onEditedBlockSaved(session);
    await this.persistState("Edit block");
    this.port.requestRender();
  }

  async applyActiveOutputProfile(next: ArborOutputState): Promise<ArborOutputState> {
    if (!this.state || this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.port.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.state.outputState = deepClone(next);
    this.port.onProfileActivated();
    this.port.requestRender();
    await this.persistState("Switch output profile");
    return deepClone(this.state.outputState);
  }

  async applyOutputProfileMutation(label: string, next: ArborOutputState): Promise<ArborOutputState> {
    if (!this.state || this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.port.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.history.push(label, this.state.metadata, this.state.outputState, this.state.selectedBlockId);
    this.state.outputState = deepClone(next);
    this.port.onMutationPrepared(false);
    await this.persistState(label);
    this.port.requestRender();
    return deepClone(this.state.outputState);
  }

  async resetInvalidOutputProfiles(): Promise<ArborOutputState> {
    if (!this.state || !this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.port.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.state.outputState = createDefaultOutputState();
    this.state.outputRaw = "";
    this.state.outputError = null;
    await this.persistState("Reset output profiles");
    this.port.requestRender();
    return deepClone(this.state.outputState);
  }

  async applyOutputMutation(
    label: string,
    mutate: (profile: ArborOutputProfile) => ArborOutputProfile
  ): Promise<void> {
    if (!this.state || this.state.outputError) {
      return;
    }

    await this.port.commitEditIfNeeded();
    if (!this.state || this.state.outputError) {
      return;
    }

    const activeProfile = getActiveOutputProfile(this.state.outputState);
    if (activeProfile.id === FULL_OUTPUT_PROFILE_ID) {
      return;
    }

    const selectedBlockId = this.state.selectedBlockId;
    this.history.push(label, this.state.metadata, this.state.outputState, selectedBlockId);
    const updatedProfile = mutate(activeProfile);
    this.state.outputState = deepClone({
      ...this.state.outputState,
      profiles: this.state.outputState.profiles.map((profile) =>
        profile.id === activeProfile.id ? updatedProfile : profile
      )
    });
    this.port.onMutationPrepared(false);
    await this.persistState(label);
    this.port.requestRender();
  }

  async undo(): Promise<void> {
    if (!this.state || !this.history.canUndo()) {
      return;
    }

    await this.port.commitEditIfNeeded();

    const previous = this.history.undo(this.currentHistorySnapshot("Current state"));
    if (!previous) {
      return;
    }

    this.restoreHistoryState(previous);
    await this.persistState("Undo");
    this.port.requestRender();
  }

  async redo(): Promise<void> {
    if (!this.state || !this.history.canRedo()) {
      return;
    }

    await this.port.commitEditIfNeeded();

    const next = this.history.redo(this.currentHistorySnapshot("Current state"));
    if (!next) {
      return;
    }

    this.restoreHistoryState(next);
    await this.persistState("Redo");
    this.port.requestRender();
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

  private restoreHistoryState(snapshot: BranchHistoryEntry): void {
    this.state!.metadata = cloneMetadata(snapshot.metadata);
    this.state!.outputState = snapshot.outputState;
    this.state!.selectedBlockId = ensureSelectedBlock(snapshot.metadata, snapshot.selectedBlockId);
    this.state!.linearized = linearizeTree(this.state!.metadata);
    this.port.clearEditingSession();
    this.port.onSelectionRestored();
  }
}
