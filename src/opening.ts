import { parseBranchDocument } from "./storage/document";
import { loadImportedBranchDocument } from "./storage/reconcile";
import { ImportedBranchDocument } from "./types";

export interface ManagedBranchDocumentInspection {
  autoManaged: boolean;
  canOpenInArbor: boolean;
  hasMetadata: boolean;
  hasVisibleMarkers: boolean;
  origin: ImportedBranchDocument["origin"];
}

export interface MarkdownOpenInterceptionInput {
  requestedViewType: string;
  filePath: string | null;
  autoOpenManagedNotes: boolean;
  isMobile: boolean;
  isSuppressed: boolean;
  managedPathHint: boolean;
}

export function canOpenImportedBranchDocumentInArbor(imported: ImportedBranchDocument): boolean {
  return imported.origin === "metadata"
    || (imported.origin === "markers"
      && imported.metadata.blocks.some((block) => block.content.trim().length > 0));
}

export function shouldRouteMarkdownOpenToLoadingView(input: MarkdownOpenInterceptionInput): boolean {
  return (
    input.requestedViewType === "markdown"
    && Boolean(input.filePath)
    && input.autoOpenManagedNotes
    && !input.isMobile
    && !input.isSuppressed
    && input.managedPathHint
  );
}

export function inspectManagedBranchDocumentText(text: string): ManagedBranchDocumentInspection {
  const parsed = parseBranchDocument(text);
  if (parsed.metadata) {
    return {
      autoManaged: true,
      canOpenInArbor: true,
      hasMetadata: true,
      hasVisibleMarkers: true,
      origin: "metadata"
    };
  }

  const imported = loadImportedBranchDocument(text);
  const hasVisibleMarkers = imported.origin === "markers";
  return {
    autoManaged: false,
    canOpenInArbor: canOpenImportedBranchDocumentInArbor(imported),
    hasMetadata: false,
    hasVisibleMarkers,
    origin: imported.origin
  };
}

export function resolveLoadingViewTarget(
  inspection: ManagedBranchDocumentInspection,
  explicitArborOpen: boolean
): "arbor" | "markdown" {
  if (explicitArborOpen) {
    return inspection.canOpenInArbor ? "arbor" : "markdown";
  }

  return inspection.autoManaged ? "arbor" : "markdown";
}
