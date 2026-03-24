import { DEFAULT_BLOCK_SEPARATOR } from "../constants";
import { createEmptyTree, getRootBlocks } from "../model/tree";
import { ImportedBranchDocument, BranchBlock, BranchTreeMetadata } from "../types";
import { nowIso } from "../utils";
import { parseBranchDocument } from "./document";
import { applyBodyHash, computeBodyHash, linearizeTree } from "./serializer";

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

export function loadImportedBranchDocument(text: string): ImportedBranchDocument {
  const parsed = parseBranchDocument(text);

  if (parsed.metadata) {
    const linearized = linearizeTree(parsed.metadata);
    if (computeBodyHash(parsed.body) === computeBodyHash(linearized.body)) {
      return {
        metadata: applyBodyHash(parsed.metadata),
        origin: "metadata",
        staleMetadata: null
      };
    }

    return {
      metadata: importBodyToMetadata(parsed.body),
      origin: "reconciled",
      staleMetadata: parsed.metadata
    };
  }

  return {
    metadata: importBodyToMetadata(parsed.body),
    origin: getRootBlocks(importBodyToMetadata(parsed.body)).length > 0 ? "imported" : "metadata",
    staleMetadata: null
  };
}
