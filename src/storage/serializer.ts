import { DEFAULT_BLOCK_SEPARATOR, METADATA_MARKER } from "../constants";
import {
  BlockLocation,
  BranchBlockId,
  BranchTreeMetadata,
  LinearizedBranchDocument,
  ManagedMetadataBlockStyle
} from "../types";
import { hashString, normalizeNewlines } from "../utils";
import { buildLinearOrder } from "../model/tree";

export function normalizeMetadata(metadata: BranchTreeMetadata): BranchTreeMetadata {
  return {
    ...metadata,
    version: 1,
    prefix: metadata.prefix ?? "",
    blocks: metadata.blocks.map((block) => ({
      ...block,
      after: block.after ?? DEFAULT_BLOCK_SEPARATOR
    }))
  };
}

function countLines(input: string): number {
  return input.split("\n").length - 1;
}

export function linearizeTree(metadata: BranchTreeMetadata): LinearizedBranchDocument {
  const normalized = normalizeMetadata(metadata);
  const ordered = buildLinearOrder(normalized);
  const parts: string[] = [normalized.prefix];
  const locations = new Map<BranchBlockId, BlockLocation>();
  let cursor = normalized.prefix.length;
  let line = countLines(normalized.prefix);

  for (const block of ordered) {
    parts.push(block.content);
    const start = cursor;
    const end = cursor + block.content.length;
    locations.set(block.id, { start, end, line });
    cursor = end;
    line += countLines(block.content);
    parts.push(block.after);
    cursor += block.after.length;
    line += countLines(block.after);
  }

  return {
    body: parts.join(""),
    locations
  };
}

export function encodeMetadata(metadata: BranchTreeMetadata): string {
  const payload = JSON.stringify(normalizeMetadata(metadata));
  return Buffer.from(payload, "utf8").toString("base64");
}

export function decodeMetadata(encoded: string): BranchTreeMetadata | null {
  try {
    const json = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
    return normalizeMetadata(JSON.parse(json) as BranchTreeMetadata);
  } catch {
    return null;
  }
}

export function buildMetadataBlock(metadata: BranchTreeMetadata, style: ManagedMetadataBlockStyle): string {
  const encoded = encodeMetadata(metadata);
  if (style === "compact") {
    return `<!-- ${METADATA_MARKER}:${encoded} -->`;
  }

  return `<!-- ${METADATA_MARKER}\n${encoded}\n-->`;
}

export function parseMetadataBlock(raw: string): BranchTreeMetadata | null {
  const compactMatch = raw.match(new RegExp(`<!--\\s*${METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([A-Za-z0-9+/=\\r\\n_-]+)\\s*-->`));
  if (compactMatch?.[1]) {
    return decodeMetadata(compactMatch[1]);
  }

  const multilineMatch = raw.match(new RegExp(`<!--\\s*${METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)\\n-->`));
  if (multilineMatch?.[1]) {
    return decodeMetadata(multilineMatch[1]);
  }

  return null;
}

export function computeBodyHash(body: string): string {
  return hashString(normalizeNewlines(body));
}

export function applyBodyHash(metadata: BranchTreeMetadata): BranchTreeMetadata {
  const linearized = linearizeTree(metadata);
  return {
    ...normalizeMetadata(metadata),
    lastLinearHash: computeBodyHash(linearized.body),
    savedAt: new Date().toISOString()
  };
}
