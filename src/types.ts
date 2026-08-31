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

export type ArborPresentationMode = "editor" | "overview";
export type ArborLayoutDirection = "ltr" | "rtl";
export type ArborThemeMode = "automatic" | "custom";

export interface ArborCustomTheme {
  canvas: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
}

export interface ArborOverviewNode {
  id: BranchBlockId;
  parentId: BranchBlockId | null;
  depth: number;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  snippet: string;
  childCount: number;
}

export interface ArborOverviewLink {
  parentId: BranchBlockId;
  childId: BranchBlockId;
}

export interface ArborOverviewLayout {
  nodes: ArborOverviewNode[];
  links: ArborOverviewLink[];
  width: number;
  height: number;
}

export type SplitPaneDirection = "vertical" | "horizontal";
export type BreadcrumbLabelFallbackMode = "firstLine" | "snippet" | "none";

export interface ArborSettings {
  layoutDirection: ArborLayoutDirection;
  themeMode: ArborThemeMode;
  customTheme: ArborCustomTheme;
  defaultPresentationMode: ArborPresentationMode;
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
