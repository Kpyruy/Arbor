import type { TFile } from "obsidian";
import type {
  ArborBlockColorResolution,
  ArborOutputProfile,
  ArborOutputResolution,
  ArborOutputState,
  ArborPresentationMode,
  ArborSettings,
  BranchBlock,
  BranchBlockId,
  BranchTreeMetadata,
  ImportedBranchDocument,
  LinearizedBranchDocument
} from "../../types";

export interface BranchOverviewNode {
  id: BranchBlockId;
  parentId: BranchBlockId | null;
  depth: number;
  label: string;
  childCount: number;
  collapsed: boolean;
  isSelected: boolean;
  isOnActivePath: boolean;
  isSelectable: boolean;
  isSearchMatch: boolean;
  isSearchRelated: boolean;
}

export interface BranchSearchResult {
  id: BranchBlockId;
  title: string;
  snippet: string;
  path: string;
}

export type EditingOrigin = "card" | "preview" | "overview";

export interface LoadedFileIdentity {
  readonly file: TFile;
  readonly path: string;
  readonly epoch: number;
}

export interface EditingSession {
  readonly draftId?: string;
  readonly filePath?: string;
  readonly loadedFile?: LoadedFileIdentity;
  recoveryId?: string;
  blockId: BranchBlockId;
  originalContent: string;
  value: string;
  autofocus: boolean;
  origin: EditingOrigin;
}

export interface OverviewEditorSelectionSnapshot {
  session: EditingSession;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  focused: boolean;
}

export interface LoadedFileState {
  diskText: string;
  frontmatter: string;
  metadata: BranchTreeMetadata;
  outputState: ArborOutputState;
  outputRaw: string;
  outputError: string | null;
  selectedBlockId: BranchBlockId | null;
  staleMetadata: BranchTreeMetadata | null;
  origin: ImportedBranchDocument["origin"];
  linearized: LinearizedBranchDocument;
}

export interface LoadingOverlayState {
  title: string;
  description: string;
}

export interface BranchViewContext {
  blockColours: Map<BranchBlockId, ArborBlockColorResolution>;
  activePathIds: Set<BranchBlockId>;
  selectableChildIds: Set<BranchBlockId>;
  searchQuery: string;
  searchMatchedIds: Set<BranchBlockId>;
  searchRelatedIds: Set<BranchBlockId>;
  searchResults: BranchSearchResult[];
  previewVisibleIds: Set<BranchBlockId> | null;
  overviewNodes: BranchOverviewNode[];
  outputProfile: ArborOutputProfile;
  outputResolutions: Map<BranchBlockId, ArborOutputResolution>;
}

export interface SelectionOptions { focus?: boolean; reveal?: boolean }

export interface ViewReadPort {
  getState(): Readonly<LoadedFileState> | null;
  getSettings(): Readonly<ArborSettings>;
  getMode(): ArborPresentationMode;
  getFilePath(): string;
}

export interface SelectionPort {
  selectBlock(id: BranchBlockId | null, options?: SelectionOptions): void;
}

export interface RenderPort { requestRender(): void }

export interface MarkdownPort {
  render(markdown: string, target: HTMLElement, sourcePath: string): Promise<void>;
}

export interface EditorPort {
  getSession(): EditingSession | null;
  beginEditingBlock(id: BranchBlockId, origin?: EditingOrigin): void;
  commitEditIfNeeded(): Promise<void>;
  clearBlurCommitTimer(): void;
  suspendBlurCommit?(): () => void;
  wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void;
  resizeEditor(editor: HTMLTextAreaElement): void;
}
