import type { CachedMetadata, HeadingCache } from "obsidian";
import type { BranchTreeMetadata } from "../../types";

interface SourceRange {
  start: number;
  end: number;
}

interface VisibleMarker extends SourceRange {
  id: string;
}

interface CacheLocation {
  line: number;
  ch?: number;
  col?: number;
  offset?: number;
}

const MARKER_LINE = /^<!-- arbor:block:v1 id="([^"]+)" parent="[^"]*" order="\d+" -->$/;

function createSourceIndex(source: string) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  return (position: CacheLocation): number | null => {
    if (!Number.isInteger(position.line) || position.line < 0 || position.line >= lineStarts.length) return null;
    const lineStart = lineStarts[position.line];
    const lineFeed = source.indexOf("\n", lineStart);
    const rawLineEnd = lineFeed === -1 ? source.length : lineFeed;
    const lineEnd = rawLineEnd > lineStart && source[rawLineEnd - 1] === "\r" ? rawLineEnd - 1 : rawLineEnd;

    if (position.offset !== undefined) {
      if (!Number.isInteger(position.offset) || position.offset < lineStart || position.offset > lineEnd) return null;
      return position.offset;
    }

    const column = typeof position.ch === "number" ? position.ch : position.col;
    if (typeof column !== "number" || !Number.isInteger(column) || column < 0 || lineStart + column > lineEnd) return null;
    return lineStart + column;
  };
}

function sourceRange(sourceOffset: (position: CacheLocation) => number | null, position: HeadingCache["position"]): SourceRange | null {
  const start = sourceOffset(position.start);
  const end = sourceOffset(position.end);
  return start === null || end === null || end < start ? null : { start, end };
}

function normalizedContentEnd(source: string, start: number, limit: number, expectedContent: string): number | null {
  const normalizedContent = expectedContent.replace(/\r\n?/g, "\n");
  let sourceIndex = start;
  let contentIndex = 0;

  while (contentIndex < normalizedContent.length && sourceIndex < limit) {
    const expected = normalizedContent[contentIndex];
    const current = source[sourceIndex];

    if (current === "\r") {
      if (expected !== "\n") return null;
      sourceIndex += source[sourceIndex + 1] === "\n" ? 2 : 1;
    } else {
      if (current !== expected) return null;
      sourceIndex += 1;
    }
    contentIndex += 1;
  }

  return contentIndex === normalizedContent.length ? sourceIndex : null;
}

function visibleMarkers(source: string, cache: CachedMetadata, sourceOffset: (position: CacheLocation) => number | null): VisibleMarker[] | null {
  const markers: VisibleMarker[] = [];
  for (const section of cache.sections ?? []) {
    if (section.type !== "html") continue;
    const range = sourceRange(sourceOffset, section.position);
    if (!range) continue;

    const sectionText = source.slice(range.start, range.end);
    const firstLineEnd = sectionText.indexOf("\n");
    const markerText = firstLineEnd < 0 ? sectionText : sectionText.slice(0, firstLineEnd).replace(/\r$/, "");
    const match = markerText.match(MARKER_LINE);
    if (!match || sectionText.slice(markerText.length).includes("arbor:block:v1")) continue;

    // The cached HTML range must start with a complete standalone marker line.
    // This excludes marker-like text nested inside a larger comment or HTML block.
    markers.push({ id: match[1], start: range.start, end: range.start + markerText.length });
  }

  markers.sort((left, right) => left.start - right.start);
  for (let index = 1; index < markers.length; index += 1) {
    if (markers[index - 1].start === markers[index].start || markers[index - 1].id === markers[index].id) return null;
  }
  return markers;
}

export function findHeadingBlock(
  metadata: BranchTreeMetadata,
  cache: CachedMetadata,
  source: string,
  heading: HeadingCache
): string | null {
  const toOffset = createSourceIndex(source);
  const headingRange = sourceRange(toOffset, heading.position);
  const markers = visibleMarkers(source, cache, toOffset);
  if (!headingRange || !markers?.length || !heading.heading) return null;

  const blocks = new Map(metadata.blocks.map((block) => [block.id, block]));
  if (blocks.size !== metadata.blocks.length) return null;

  let candidateIndex = -1;
  for (let index = 0; index < markers.length; index += 1) {
    if (markers[index].start < headingRange.start) candidateIndex = index;
    else break;
  }
  if (candidateIndex < 0) return null;

  const marker = markers[candidateIndex];
  const block = blocks.get(marker.id);
  if (!block) return null;

  let contentStart = source[marker.end] === "\r" && source[marker.end + 1] === "\n"
    ? marker.end + 2
    : source[marker.end] === "\n" ? marker.end + 1 : marker.end;
  const nativeAnchor = `^arbor-${marker.id}`;
  if (source.startsWith(nativeAnchor, contentStart)) {
    const anchorEnd = contentStart + nativeAnchor.length;
    if (source[anchorEnd] === "\r" && source[anchorEnd + 1] === "\n") contentStart = anchorEnd + 2;
    else if (source[anchorEnd] === "\n") contentStart = anchorEnd + 1;
  }
  const nextMarkerStart = markers[candidateIndex + 1]?.start ?? source.length;
  const contentEnd = normalizedContentEnd(source, contentStart, nextMarkerStart, block.content);
  if (contentEnd === null || headingRange.start < contentStart || headingRange.end > contentEnd) return null;

  const cachedHeadingText = source.slice(headingRange.start, headingRange.end);
  if (!cachedHeadingText.includes(heading.heading)) return null;
  return block.id;
}
