import { LEGACY_METADATA_MARKER, STRUCTURE_MARKER } from "../constants";
import { ParsedBranchDocument, BranchTreeMetadata } from "../types";
import { buildStructureBlock, parseStoredMetadataBlock } from "./serializer";
import { normalizeNewlines } from "../utils";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const METADATA_MARKER_PATTERN = LEGACY_METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STRUCTURE_MARKER_PATTERN = STRUCTURE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPACT_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}:[A-Za-z0-9+/=\\r\\n_-]+\\s*-->\\s*$`);
const MULTILINE_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}\\s*\\n[\\s\\S]*?\\n-->\\s*$`);

export function parseBranchDocument(text: string): ParsedBranchDocument {
  const normalized = normalizeNewlines(text);
  const frontmatterMatch = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter = frontmatterMatch?.[0] ?? "";
  let remaining = normalized.slice(frontmatter.length);

  let metadataRaw = "";
  const structureMatch = remaining.match(new RegExp("\\n?%%\\s*" + STRUCTURE_MARKER_PATTERN + "\\s*\\n```json\\n[\\s\\S]*?\\n```\\n%%\\s*$"));
  const multilineMatch = remaining.match(MULTILINE_PATTERN);
  const compactMatch = remaining.match(COMPACT_PATTERN);
  const legacyMatch = multilineMatch && (!compactMatch || multilineMatch.index! >= compactMatch.index!) ? multilineMatch : compactMatch;
  const metadataMatch = structureMatch ?? legacyMatch;
  if (metadataMatch && metadataMatch.index !== undefined) {
    metadataRaw = metadataMatch[0].trimStart();
    remaining = remaining.slice(0, metadataMatch.index);
  }

  const stored = metadataRaw ? parseStoredMetadataBlock(metadataRaw) : { metadata: null, storageFormat: null };

  return {
    frontmatter,
    body: remaining,
    metadata: stored.metadata,
    metadataRaw,
    storageFormat: stored.storageFormat
  };
}

export function buildBranchDocument(
  frontmatter: string,
  body: string,
  metadata: BranchTreeMetadata | null
): string {
  const sections: string[] = [];
  if (frontmatter) {
    sections.push(frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`);
  }

  sections.push(body);

  if (metadata) {
    const metadataBlock = buildStructureBlock(metadata);
    sections.push("\n");
    sections.push(metadataBlock);
    sections.push("\n");
  }

  return sections.join("");
}
