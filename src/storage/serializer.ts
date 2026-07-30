import { DEFAULT_BLOCK_SEPARATOR, LEGACY_METADATA_MARKER, STRUCTURE_MARKER, VISIBLE_BLOCK_MARKER } from "../constants";
import {
  BlockLocation,
  BranchBlock,
  BranchBlockId,
  BranchTreeMetadata,
  LinearizedBranchDocument,
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

function parseLegacyMetadataBlock(raw: string): BranchTreeMetadata | null {
  const marker = LEGACY_METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compactMatch = raw.match(new RegExp(`<!--\\s*${marker}:([A-Za-z0-9+/=\\r\\n_-]+)\\s*-->`));
  const multilineMatch = raw.match(new RegExp(`<!--\\s*${marker}\\s*\\n([\\s\\S]*?)\\n-->`));
  const encoded = compactMatch?.[1] ?? multilineMatch?.[1];
  if (!encoded) {
    return null;
  }

  try {
    const json = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
    return normalizeMetadata(JSON.parse(json) as BranchTreeMetadata);
  } catch {
    return null;
  }
}

export function buildStructureBlock(metadata: BranchTreeMetadata): string {
  const structure = {
    "arbor-plugin": "tree",
    version: 2,
    blocks: normalizeMetadata(metadata).blocks.map((block) => ({
      id: block.id,
      parent: block.parentId,
      order: block.order
    }))
  };

  return [`%% ${STRUCTURE_MARKER}`, "```json", JSON.stringify(structure, null, 2), "```", "%%"].join("\n");
}

export function parseStructureBlock(raw: string): BranchTreeMetadata | null {
  const marker = STRUCTURE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp("^%%\\s*" + marker + "\\s*\\n```json\\n([\\s\\S]*?)\\n```\\n%%$"));
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as {
      "arbor-plugin"?: unknown;
      version?: unknown;
      blocks?: unknown;
    };
    if (parsed["arbor-plugin"] !== "tree" || parsed.version !== 2 || !Array.isArray(parsed.blocks)) {
      return null;
    }

    const seen = new Set<string>();
    const blocks: BranchBlock[] = [];
    for (const entry of parsed.blocks) {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const { id, parent, order } = entry as Record<string, unknown>;
      if (typeof id !== "string" || id.length === 0 || seen.has(id) || (parent !== null && typeof parent !== "string") || !Number.isInteger(order) || (order as number) < 0) {
        return null;
      }
      seen.add(id);
      const parentId = typeof parent === "string" ? parent : null;
      const blockOrder = Number(order);
      blocks.push({ id, parentId, order: blockOrder, content: "", after: "" });
    }

    return normalizeMetadata({ version: 1, prefix: "", blocks });
  } catch {
    return null;
  }
}

export function parseStoredMetadataBlock(raw: string): { metadata: BranchTreeMetadata | null; storageFormat: "legacy-v1" | "structure-v2" | null } {
  const normalized = raw.trim();
  const structure = parseStructureBlock(normalized);
  if (structure) {
    return { metadata: structure, storageFormat: "structure-v2" };
  }
  return { metadata: parseLegacyMetadataBlock(normalized), storageFormat: "legacy-v1" };
}

export function computeBodyHash(body: string): string {
  return hashString(normalizeNewlines(body));
}
