import { LEGACY_METADATA_MARKER, OUTPUT_MARKER, STRUCTURE_MARKER } from "../constants";
import { createDefaultOutputState } from "../outputProfiles";
import { ArborOutputState, ParsedBranchDocument, BranchTreeMetadata } from "../types";
import { buildOutputBlock, isDefaultOutputState, parseOutputBlock } from "./outputProfiles";
import { buildStructureBlock, parseStoredMetadataBlock } from "./serializer";
import { normalizeNewlines } from "../utils";
import { normalizeOverviewOrientation } from "../overviewOrientation";
import type { ArborOverviewOrientation } from "../types";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const METADATA_MARKER_PATTERN = LEGACY_METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STRUCTURE_MARKER_PATTERN = STRUCTURE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OUTPUT_MARKER_PATTERN = OUTPUT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPACT_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}:[A-Za-z0-9+/=\\r\\n_-]+\\s*-->\\s*$`);
const MULTILINE_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}\\s*\\n[\\s\\S]*?\\n-->\\s*$`);
const OUTPUT_BLOCK_PATTERN = new RegExp(`\\r?\\n?(%%\\s*${OUTPUT_MARKER_PATTERN}\\s*\\r?\\n\`\`\`json\\r?\\n[\\s\\S]*?\\r?\\n\`\`\`\\r?\\n%%)\\s*$`);
const STRUCTURE_BLOCK_PATTERN = new RegExp(`\\r?\\n?%%\\s*${STRUCTURE_MARKER_PATTERN}\\s*\\r?\\n\`\`\`json\\r?\\n[\\s\\S]*?\\r?\\n\`\`\`\\r?\\n%%\\s*$`);

export function parseBranchDocument(text: string): ParsedBranchDocument {
  const rawStructureMatch = text.match(STRUCTURE_BLOCK_PATTERN);
  const rawWithoutStructure = rawStructureMatch?.index !== undefined
    ? text.slice(0, rawStructureMatch.index)
    : text;
  const rawOutputMatch = rawWithoutStructure.match(OUTPUT_BLOCK_PATTERN);
  const preservedOutputRaw = rawOutputMatch?.[1] ?? "";

  const normalized = normalizeNewlines(text);
  const frontmatterMatch = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter = frontmatterMatch?.[0] ?? "";
  let remaining = normalized.slice(frontmatter.length);

  let metadataRaw = "";
  const structureMatch = remaining.match(STRUCTURE_BLOCK_PATTERN);
  if (structureMatch?.index !== undefined) {
    metadataRaw = structureMatch[0].trimStart();
    remaining = remaining.slice(0, structureMatch.index);
  }

  let outputRaw = preservedOutputRaw;
  const outputMatch = remaining.match(OUTPUT_BLOCK_PATTERN);
  if (outputMatch?.index !== undefined) {
    outputRaw ||= outputMatch[1];
    remaining = remaining.slice(0, outputMatch.index);
  }

  if (!metadataRaw) {
    const multilineMatch = remaining.match(MULTILINE_PATTERN);
    const compactMatch = remaining.match(COMPACT_PATTERN);
    const legacyMatch = multilineMatch && (!compactMatch || multilineMatch.index! >= compactMatch.index!) ? multilineMatch : compactMatch;
    if (legacyMatch?.index !== undefined) {
      metadataRaw = legacyMatch[0].trimStart();
      remaining = remaining.slice(0, legacyMatch.index);
    }
  }

  const stored = metadataRaw ? parseStoredMetadataBlock(metadataRaw) : { metadata: null, storageFormat: null };
  const parsedOutput = outputRaw ? parseOutputBlock(outputRaw) : null;

  return {
    frontmatter,
    body: remaining,
    metadata: stored.metadata,
    metadataRaw,
    storageFormat: stored.storageFormat,
    outputState: parsedOutput?.ok ? parsedOutput.state : createDefaultOutputState(),
    outputRaw,
    outputError: parsedOutput && !parsedOutput.ok ? parsedOutput.error : null
  };
}

export function buildBranchDocument(
  frontmatter: string,
  body: string,
  metadata: BranchTreeMetadata | null,
  outputState?: ArborOutputState,
  preservedInvalidOutputRaw?: string
): string {
  const sections: string[] = [];
  if (frontmatter) {
    sections.push(frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}\n`);
  }

  sections.push(body);

  const outputBlock = preservedInvalidOutputRaw
    || (outputState && !isDefaultOutputState(outputState) ? buildOutputBlock(outputState) : "");
  if (outputBlock) {
    sections.push("\n");
    sections.push(outputBlock);
    sections.push("\n");
  }

  if (metadata) {
    const metadataBlock = buildStructureBlock(metadata);
    sections.push("\n");
    sections.push(metadataBlock);
    sections.push("\n");
  }

  return sections.join("");
}

/** A view preference must not rewrite Markdown or a preserved output footer. */
export function updateStoredOverviewOrientation(text: string, value: ArborOverviewOrientation | null, fallback: BranchTreeMetadata): string {
  const orientation = normalizeOverviewOrientation(value);
  if (value !== null && !orientation) throw new Error("Invalid Tree Overview orientation");
  const parsed = parseBranchDocument(text);
  if (parsed.metadataRaw && !parsed.metadata) throw new Error("Cannot update malformed Arbor metadata");
  const match = text.match(STRUCTURE_BLOCK_PATTERN);
  if (match?.index !== undefined) {
    const payload = match[0].match(/```json\r?\n([\s\S]*?)\r?\n```/);
    if (!payload || !parsed.metadata) throw new Error("Cannot update Arbor structure");
    const structure = JSON.parse(payload[1]) as Record<string, unknown>;
    if (orientation) structure.overviewOrientation = orientation;
    else delete structure.overviewOrientation;
    const newline = match[0].includes("\r\n") ? "\r\n" : "\n";
    const footer = match[0].replace(payload[1], () => JSON.stringify(structure, null, 2).replace(/\n/g, newline));
    return text.slice(0, match.index) + footer + text.slice(match.index + match[0].length);
  }
  const metadata = { ...(parsed.metadata ?? fallback) };
  if (orientation) metadata.overviewOrientation = orientation;
  else delete metadata.overviewOrientation;
  const footer = buildStructureBlock(metadata);
  const legacy = text.match(MULTILINE_PATTERN) ?? text.match(COMPACT_PATTERN);
  if (legacy?.index !== undefined) return text.slice(0, legacy.index) + "\n" + footer + "\n";
  return text + (text.endsWith("\n") ? "\n" : "\n\n") + footer + "\n";
}
