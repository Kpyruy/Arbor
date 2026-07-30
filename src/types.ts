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
}

export type ArborStorageFormat = "legacy-v1" | "structure-v2" | null;

export interface ParsedBranchDocument {
  frontmatter: string;
  body: string;
  metadata: BranchTreeMetadata | null;
  metadataRaw: string;
  storageFormat: ArborStorageFormat;
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
}

export interface BranchSelectionRestore {
  requestedEditBlockId?: BranchBlockId | null;
}
