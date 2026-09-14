import { updateBlockContent } from "../model/tree";
import { projectOutput } from "../outputProjection";
import { ArborOutputState, BranchBlockId, BranchTreeMetadata } from "../types";
import { normalizeMetadata } from "./serializer";

export interface CleanExportOptions {
  frontmatter: "keep" | "omit";
  excluded: "omit" | "comment";
}

export interface PendingCleanExportEdit {
  blockId: BranchBlockId;
  content: string;
}

function escapeCommentPayload(value: string): string {
  return value.replace(/--/g, "&#45;&#45;");
}

function escapeCommentId(value: string): string {
  return escapeCommentPayload(value.replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
}

export function buildCleanExportDocument(
  frontmatter: string,
  metadata: BranchTreeMetadata,
  outputState: ArborOutputState,
  options: CleanExportOptions,
  pendingEdit?: PendingCleanExportEdit
): string {
  const exportMetadata = pendingEdit
    ? normalizeMetadata(updateBlockContent(metadata, pendingEdit.blockId, pendingEdit.content))
    : metadata;
  const projection = projectOutput(exportMetadata, outputState);
  const blocks = projection.entries.map((entry, index) => {
    if (entry.resolution.included) {
      return entry.block.content + entry.block.after;
    }
    if (options.excluded === "omit") {
      return "";
    }

    const after = entry.block.after || (index < projection.entries.length - 1 ? "\n" : "");
    return [
      `<!-- arbor:excluded id="${escapeCommentId(entry.block.id)}"`,
      escapeCommentPayload(entry.block.content),
      `-->${after}`
    ].join("\n");
  }).join("");
  const body = (projection.prefix + blocks).trimEnd();
  return options.frontmatter === "keep" ? frontmatter + body : body;
}
