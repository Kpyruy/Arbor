import { DEFAULT_BLOCK_SEPARATOR, METADATA_MARKER, VISIBLE_BLOCK_MARKER } from "../constants";
import {
  BlockLocation,
  BranchBlock,
  BranchBlockId,
  BranchTreeMetadata,
  LinearizedBranchDocument,
  ManagedMetadataBlockStyle
} from "../types";
import { hashString, normalizeNewlines } from "../utils";
import { buildLinearOrder } from "../model/tree";

const VISIBLE_BLOCK_MARKER_PATTERN = VISIBLE_BLOCK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VISIBLE_BLOCK_LINE_PATTERN = new RegExp(
  `^<!--\\s*${VISIBLE_BLOCK_MARKER_PATTERN}\\s+id="([^"]+)"\\s+parent="([^"]*)"\\s+order="(\\d+)"\\s*-->$`
);

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

function buildVisibleBlockMarker(block: Pick<BranchBlock, "id" | "parentId" | "order">): string {
  const parentId = block.parentId ?? "";
  return `<!-- ${VISIBLE_BLOCK_MARKER} id="${block.id}" parent="${parentId}" order="${block.order}" -->\n`;
}

function splitChunkContentAndAfter(chunk: string): { content: string; after: string } {
  const trailingNewlines = chunk.match(/\n*$/)?.[0] ?? "";
  return {
    content: trailingNewlines.length > 0 ? chunk.slice(0, chunk.length - trailingNewlines.length) : chunk,
    after: trailingNewlines
  };
}

export function parseVisibleBlockMetadata(body: string): BranchTreeMetadata | null {
  const normalized = normalizeNewlines(body);
  const lines = normalized.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const matches: Array<{
    index: number;
    markerLength: number;
    id: string;
    parentRaw: string;
    order: number;
  }> = [];
  let position = 0;
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
    }

    if (!inFence) {
      const lineBody = line.endsWith("\n") ? line.slice(0, -1) : line;
      const match = lineBody.match(VISIBLE_BLOCK_LINE_PATTERN);
      if (match) {
        const [, id, parentRaw, orderRaw] = match;
        const order = Number(orderRaw);
        if (!Number.isInteger(order) || order < 0) {
          return null;
        }

        matches.push({
          index: position,
          markerLength: line.length,
          id,
          parentRaw,
          order
        });
      }
    }

    position += line.length;
  }

  if (matches.length === 0) {
    return null;
  }

  const firstMatch = matches[0];
  const prefix = normalized.slice(0, firstMatch.index);

  const seenIds = new Set<BranchBlockId>();
  const blocks: BranchTreeMetadata["blocks"] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const { id, parentRaw, order } = match;
    if (seenIds.has(id)) {
      return null;
    }

    const contentStart = start + match.markerLength;
    const nextStart = matches[index + 1]?.index ?? normalized.length;
    const chunk = normalized.slice(contentStart, nextStart);
    const { content, after } = splitChunkContentAndAfter(chunk);
    blocks.push({
      id,
      parentId: parentRaw || null,
      order,
      content,
      after
    });
    seenIds.add(id);
  }

  return normalizeMetadata({
    version: 1,
    prefix,
    blocks
  });
}

export function linearizeTreeLegacy(metadata: BranchTreeMetadata): LinearizedBranchDocument {
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

export function linearizeTree(metadata: BranchTreeMetadata): LinearizedBranchDocument {
  const normalized = normalizeMetadata(metadata);
  const ordered = buildLinearOrder(normalized);
  const parts: string[] = [normalized.prefix];
  const locations = new Map<BranchBlockId, BlockLocation>();
  let cursor = normalized.prefix.length;
  let line = countLines(normalized.prefix);

  for (const block of ordered) {
    const marker = buildVisibleBlockMarker(block);
    parts.push(marker);
    cursor += marker.length;
    line += countLines(marker);

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
