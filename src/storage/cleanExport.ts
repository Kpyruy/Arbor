import { BranchTreeMetadata } from "../types";
import { linearizeTreeLegacy } from "./serializer";

export type CleanExportMode = "keep-yaml" | "text-only";

export function buildCleanExportDocument(
  frontmatter: string,
  metadata: BranchTreeMetadata,
  mode: CleanExportMode
): string {
  const body = linearizeTreeLegacy(metadata).body;
  return mode === "keep-yaml" ? frontmatter + body : body;
}
