import { DEFAULT_BLOCK_SEPARATOR } from "../constants";
import { buildLinearOrder } from "../model/tree";
import type { BranchTreeMetadata } from "../types";
import { buildVisibleBlockMarker, linearizeTree, normalizeMetadata } from "./serializer";
import { fingerprintBody } from "./storageFingerprint";

export interface SourceRange {
  id: string;
  markerStart: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

export interface StorageSourceMap {
  version: 1;
  algorithm: "sha256";
  encoding: "utf-16le";
  offsets: "utf-16";
  fingerprint: string;
  descriptorChecksum: string;
  prefixEnd: number;
  ranges: SourceRange[];
}

export class StorageAmbiguityError extends Error {
  constructor() {
    super("Arbor cannot safely read this note: its card boundaries are ambiguous and its storage evidence is missing or invalid. No content was saved. Keep your draft and repair the Markdown boundaries before reloading.");
    this.name = "StorageAmbiguityError";
  }
}

export function buildSourceMap(body: string, metadata: BranchTreeMetadata): StorageSourceMap | undefined {
  const normalized = normalizeMetadata(metadata);
  const linearized = linearizeTree(normalized);
  if (linearized.body !== body) return undefined;
  const prefixEnd = normalized.prefix.length;
  const ranges = buildLinearOrder(normalized).map(block => {
    const location = linearized.locations.get(block.id)!;
    return {
      id: block.id,
      markerStart: location.start - buildVisibleBlockMarker(block).length,
      contentStart: location.start,
      contentEnd: location.end,
      end: location.end + block.after.length
    };
  });
  return {
    version: 1,
    algorithm: "sha256",
    encoding: "utf-16le",
    offsets: "utf-16",
    fingerprint: fingerprintBody(body),
    descriptorChecksum: fingerprintBody(JSON.stringify({ prefixEnd, ranges })),
    prefixEnd,
    ranges
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readSourceMap(body: string, metadata: BranchTreeMetadata, value: unknown): BranchTreeMetadata | null {
  const map = objectValue(value);
  if (!map || map.version !== 1 || map.algorithm !== "sha256" || map.encoding !== "utf-16le" || map.offsets !== "utf-16"
    || typeof map.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(map.fingerprint)
    || typeof map.descriptorChecksum !== "string" || !/^[a-f0-9]{64}$/.test(map.descriptorChecksum)
    || map.fingerprint !== fingerprintBody(body) || !Array.isArray(map.ranges)
    || !Number.isSafeInteger(map.prefixEnd) || (map.prefixEnd as number) < 0 || (map.prefixEnd as number) > body.length) return null;
  const canonicalRanges = map.ranges.map(value => {
    const range = objectValue(value);
    return range ? {
      id: range.id,
      markerStart: range.markerStart,
      contentStart: range.contentStart,
      contentEnd: range.contentEnd,
      end: range.end
    } : null;
  });
  if (canonicalRanges.some(range => range === null)
    || map.descriptorChecksum !== fingerprintBody(JSON.stringify({ prefixEnd: map.prefixEnd, ranges: canonicalRanges }))) return null;
  const ordered = buildLinearOrder(metadata);
  if (map.ranges.length !== metadata.blocks.length || ordered.length !== metadata.blocks.length) return null;
  const recovered = new Map<string, { content: string; after: string }>();
  let cursor = map.prefixEnd as number;
  for (let index = 0; index < ordered.length; index++) {
    const block = ordered[index];
    const range = objectValue(map.ranges[index]);
    if (!range || range.id !== block.id || recovered.has(block.id)) return null;
    const offsets = [range.markerStart, range.contentStart, range.contentEnd, range.end];
    if (offsets.some(offset => !Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > body.length)) return null;
    const [markerStart, contentStart, contentEnd, end] = offsets as number[];
    if (markerStart < cursor || contentStart < markerStart || contentEnd < contentStart || end < contentEnd) return null;
    const separator = cursor > 0 && body[cursor - 1] !== "\n" ? DEFAULT_BLOCK_SEPARATOR : "";
    if (body.slice(cursor, markerStart) !== separator || body.slice(markerStart, contentStart) !== buildVisibleBlockMarker(block)) return null;
    recovered.set(block.id, { content: body.slice(contentStart, contentEnd), after: body.slice(contentEnd, end) });
    cursor = end;
  }
  if (cursor !== body.length) return null;
  return normalizeMetadata({
    ...metadata,
    prefix: body.slice(0, map.prefixEnd as number),
    blocks: metadata.blocks.map(block => ({ ...block, ...recovered.get(block.id)! }))
  });
}
