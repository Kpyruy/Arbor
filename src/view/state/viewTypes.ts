import type {
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

export type EditingOrigin = "card" | "preview" | "overview";

export interface EditingSession {
  blockId: BranchBlockId;
  originalContent: string;
  value: string;
  autofocus: boolean;
  origin: EditingOrigin;
}

export interface LoadedFileState {
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
  activePathIds: Set<BranchBlockId>;
  selectableChildIds: Set<BranchBlockId>;
  searchQuery: string;
  searchMatchedIds: Set<BranchBlockId>;
  searchRelatedIds: Set<BranchBlockId>;
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
  wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void;
  resizeEditor(editor: HTMLTextAreaElement): void;
}
