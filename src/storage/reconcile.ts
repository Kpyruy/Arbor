import { diffChars } from "diff";
import { DEFAULT_BLOCK_SEPARATOR } from "../constants";
import { buildLinearOrder, createEmptyTree, getRootBlocks } from "../model/tree";
import { ImportedBranchDocument, BranchBlock, BranchTreeMetadata } from "../types";
import { normalizeNewlines, nowIso } from "../utils";
import { parseBranchDocument } from "./document";
import { applyBodyHash, computeBodyHash, linearizeTree, linearizeTreeLegacy, normalizeMetadata, parseVisibleBlockMetadata } from "./serializer";

function buildImportedBlock(content: string, order: number): BranchBlock {
  const timestamp = nowIso();
  return {
    id: `bw-import-${Date.now().toString(36)}-${order.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    parentId: null,
    order,
    content,
    after: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function extractHeadingSections(body: string): string[] {
  const headings: Array<{ start: number; level: number }> = [];
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let position = 0;
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
    }

    if (!inFence) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+\S/);
      if (headingMatch) {
        headings.push({ start: position, level: headingMatch[1].length });
      }
    }

    position += line.length;
  }

  if (headings.length === 0) {
    return [];
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level));
  const rootHeadings = headings.filter((heading) => heading.level === minLevel);
  if (rootHeadings.length < 2 && rootHeadings[0]?.start === 0) {
    return [];
  }

  const sections: string[] = [];
  const starts = rootHeadings.map((heading) => heading.start);
  if (starts[0] > 0 && body.slice(0, starts[0]).trim().length > 0) {
    sections.push(body.slice(0, starts[0]));
  }

  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? body.length;
    sections.push(body.slice(start, end));
  });

  return sections.filter((section) => section.length > 0);
}

function importBodyToMetadata(body: string): BranchTreeMetadata {
  const tree = createEmptyTree();
  if (body.length === 0) {
    return applyBodyHash(tree);
  }

  const headingSections = extractHeadingSections(body);
  const sections = headingSections.length > 0 ? headingSections : [body];
  tree.blocks = sections.map((content, index) => buildImportedBlock(content, index));

  if (tree.blocks.length > 1) {
    tree.blocks.forEach((block, index) => {
      block.after = index === tree.blocks.length - 1 ? "" : DEFAULT_BLOCK_SEPARATOR;
    });
  }

  if (tree.blocks.length === 1) {
    tree.blocks[0].after = "";
  }

  return applyBodyHash(tree);
}

function splitChunkContentAndAfter(chunk: string): { content: string; after: string } {
  const trailingNewlines = chunk.match(/\n*$/)?.[0] ?? "";
  return {
    content: trailingNewlines.length > 0 ? chunk.slice(0, chunk.length - trailingNewlines.length) : chunk,
    after: trailingNewlines
  };
}

function translateLegacyBoundaryIndex(
  diffParts: ReturnType<typeof diffChars>,
  originalIndex: number
): number {
  let oldPosition = 0;
  let newPosition = 0;

  for (const part of diffParts) {
    const length = part.value.length;
    if (part.added) {
      newPosition += length;
      continue;
    }

    if (part.removed) {
      if (originalIndex <= oldPosition + length) {
        return newPosition;
      }

      oldPosition += length;
      continue;
    }

    if (originalIndex <= oldPosition + length) {
      return newPosition + (originalIndex - oldPosition);
    }

    oldPosition += length;
    newPosition += length;
  }

  return newPosition;
}

function translateLegacyBodyToMetadata(body: string, storedMetadata: BranchTreeMetadata): BranchTreeMetadata {
  const normalizedBody = normalizeNewlines(body);
  const normalizedMetadata = normalizeMetadata(storedMetadata);
  const legacyLinearized = linearizeTreeLegacy(normalizedMetadata);
  const diffParts = diffChars(legacyLinearized.body, normalizedBody);
  const ordered = buildLinearOrder(normalizedMetadata);
  const prefixEnd = translateLegacyBoundaryIndex(diffParts, normalizedMetadata.prefix.length);
  let oldCursor = normalizedMetadata.prefix.length;

  return applyBodyHash({
    ...normalizedMetadata,
    prefix: normalizedBody.slice(0, prefixEnd),
    blocks: ordered.map((block) => {
      const oldChunkStart = oldCursor;
      const oldChunkEnd = oldChunkStart + block.content.length + block.after.length;
      const newChunkStart = translateLegacyBoundaryIndex(diffParts, oldChunkStart);
      const newChunkEnd = translateLegacyBoundaryIndex(diffParts, oldChunkEnd);
      const chunk = normalizedBody.slice(newChunkStart, newChunkEnd);
      const { content, after } = splitChunkContentAndAfter(chunk);
      oldCursor = oldChunkEnd;
      return {
        ...block,
        content,
        after
      };
    })
  });
}

function mergeMarkerMetadataWithStoredExtras(
  markerMetadata: BranchTreeMetadata,
  storedMetadata: BranchTreeMetadata | null
): BranchTreeMetadata {
  if (!storedMetadata) {
    return markerMetadata;
  }

  const storedById = new Map(storedMetadata.blocks.map((block) => [block.id, block]));
  return {
    ...markerMetadata,
    blocks: markerMetadata.blocks.map((block) => {
      const stored = storedById.get(block.id);
      if (!stored) {
        return block;
      }

      return {
        ...block,
        createdAt: stored.createdAt ?? block.createdAt,
        updatedAt: stored.updatedAt ?? block.updatedAt,
        collapsed: stored.collapsed
      };
    })
  };
}

export function loadImportedBranchDocument(text: string): ImportedBranchDocument {
  const parsed = parseBranchDocument(text);
  const visibleMarkerMetadata = parseVisibleBlockMetadata(parsed.body);
  const hasStoredMetadataBlock = parsed.metadataRaw.length > 0;

  if (hasStoredMetadataBlock && visibleMarkerMetadata) {
    const markerMetadata = applyBodyHash(mergeMarkerMetadataWithStoredExtras(visibleMarkerMetadata, parsed.metadata));
    if (parsed.metadata) {
      const linearized = linearizeTree(parsed.metadata);
      if (computeBodyHash(parsed.body) === computeBodyHash(linearized.body)) {
        return {
          metadata: applyBodyHash(parsed.metadata),
          origin: "metadata",
          staleMetadata: null
        };
      }
    }

    return {
      metadata: markerMetadata,
      origin: "markers",
      staleMetadata: parsed.metadata,
      needsVisibleMarkerMigration: false
    };
  }

  if (visibleMarkerMetadata) {
    if (visibleMarkerMetadata.prefix.trim().length > 0) {
      const importedMetadata = importBodyToMetadata(parsed.body);
      return {
        metadata: importedMetadata,
        origin: getRootBlocks(importedMetadata).length > 0 ? "imported" : "metadata",
        staleMetadata: null
      };
    }

    return {
      metadata: applyBodyHash(visibleMarkerMetadata),
      origin: "markers",
      staleMetadata: null,
      needsVisibleMarkerMigration: false
    };
  }

  if (parsed.metadata) {
    return {
      metadata: translateLegacyBodyToMetadata(parsed.body, parsed.metadata),
      origin: "legacy",
      staleMetadata: null,
      needsVisibleMarkerMigration: true
    };
  }

  return {
    metadata: importBodyToMetadata(parsed.body),
    origin: getRootBlocks(importBodyToMetadata(parsed.body)).length > 0 ? "imported" : "metadata",
    staleMetadata: null,
    needsVisibleMarkerMigration: false
  };
}
