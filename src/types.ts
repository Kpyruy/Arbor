export type BranchBlockId = string;

export interface BranchBlock {
  id: BranchBlockId;
  parentId: BranchBlockId | null;
  order: number;
  content: string;
  after: string;
  createdAt?: string;
  updatedAt?: string;
  collapsed?: boolean;
}

export interface BranchTreeMetadata {
  version: 1;
  prefix: string;
  blocks: BranchBlock[];
  lastLinearHash?: string;
  savedAt?: string;
}

export interface ParsedBranchDocument {
  frontmatter: string;
  body: string;
  metadata: BranchTreeMetadata | null;
  metadataRaw: string;
}

export interface ImportedBranchDocument {
  metadata: BranchTreeMetadata;
  origin: "metadata" | "markers" | "legacy" | "imported" | "reconciled";
  staleMetadata: BranchTreeMetadata | null;
  needsVisibleMarkerMigration?: boolean;
}

export interface BlockLocation {
  start: number;
  end: number;
  line: number;
}

export interface LinearizedBranchDocument {
  body: string;
  locations: Map<BranchBlockId, BlockLocation>;
}

export interface BranchColumnModel {
  key: string;
  label: string;
  parentId: BranchBlockId | null;
  blocks: BranchBlock[];
  collapsedBlockId?: BranchBlockId | null;
  collapsedCount?: number;
  collapsedPreviewLabels?: string[];
}

export interface BranchHistoryEntry {
  label: string;
  metadata: BranchTreeMetadata;
  selectedBlockId: BranchBlockId | null;
}

export type ManagedMetadataBlockStyle = "multiline" | "compact";

export type SplitPaneDirection = "vertical" | "horizontal";
export type BreadcrumbLabelFallbackMode = "firstLine" | "snippet" | "none";

export interface ArborSettings {
  splitDirection: SplitPaneDirection;
  cardWidth: number;
  cardMinHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  zoomLevel: number;
  previewSnippetLength: number;
  dragAndDrop: boolean;
  dimNonPathBlocks: boolean;
  enableCtrlWheelZoom: boolean;
  autoOpenManagedNotes: boolean;
  showBreadcrumb: boolean;
  showBreadcrumbFlow: boolean;
  breadcrumbLabelPreferredPrefix: string;
  breadcrumbLabelFallback: BreadcrumbLabelFallbackMode;
  liveLinearPreview: boolean;
  metadataBlockStyle: ManagedMetadataBlockStyle;
}

export interface BranchSelectionRestore {
  requestedEditBlockId?: BranchBlockId | null;
}
