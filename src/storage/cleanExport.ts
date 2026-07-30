import { updateBlockContent } from "../model/tree";
import { BranchBlockId, BranchTreeMetadata } from "../types";
import { linearizeTreeLegacy, normalizeMetadata } from "./serializer";

export type CleanExportMode = "keep-yaml" | "text-only";

export interface PendingCleanExportEdit {
  blockId: BranchBlockId;
  content: string;
}

export function buildCleanExportDocument(
  frontmatter: string,
  metadata: BranchTreeMetadata,
  mode: CleanExportMode,
  pendingEdit?: PendingCleanExportEdit
): string {
  const exportMetadata = pendingEdit
    ? normalizeMetadata(updateBlockContent(metadata, pendingEdit.blockId, pendingEdit.content))
    : metadata;
  const body = linearizeTreeLegacy(exportMetadata).body;
  return mode === "keep-yaml" ? frontmatter + body : body;
}
