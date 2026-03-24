import { METADATA_MARKER } from "../constants";
import { ParsedBranchDocument, BranchTreeMetadata, ManagedMetadataBlockStyle } from "../types";
import { buildMetadataBlock, parseMetadataBlock } from "./serializer";
import { normalizeNewlines } from "../utils";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const METADATA_MARKER_PATTERN = METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPACT_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}:[A-Za-z0-9+/=\\r\\n_-]+\\s*-->\\s*$`);
const MULTILINE_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}\\s*\\n[\\s\\S]*?\\n-->\\s*$`);

export function parseBranchDocument(text: string): ParsedBranchDocument {
  const normalized = normalizeNewlines(text);
  const frontmatterMatch = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter = frontmatterMatch?.[0] ?? "";
  let remaining = normalized.slice(frontmatter.length);

  let metadataRaw = "";
  const multilineMatch = remaining.match(MULTILINE_PATTERN);
  const compactMatch = remaining.match(COMPACT_PATTERN);
  const metadataMatch = multilineMatch && (!compactMatch || multilineMatch.index! >= compactMatch.index!) ? multilineMatch : compactMatch;
  if (metadataMatch && metadataMatch.index !== undefined) {
    metadataRaw = metadataMatch[0].trimStart();
    remaining = remaining.slice(0, metadataMatch.index);
  }

  const metadata = metadataRaw ? parseMetadataBlock(metadataRaw) : null;

  return {
    frontmatter,
    body: remaining,
    metadata,
    metadataRaw
  };
}

export function buildBranchDocument(
  frontmatter: string,
  body: string,
  metadata: BranchTreeMetadata | null,
  metadataStyle: ManagedMetadataBlockStyle
): string {
  const sections: string[] = [];
  if (frontmatter) {
    sections.push(frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`);
  }

  sections.push(body);

  if (metadata) {
    const metadataBlock = buildMetadataBlock(metadata, metadataStyle);
    sections.push("\n");
    sections.push(metadataBlock);
    sections.push("\n");
  }

  return sections.join("");
}
