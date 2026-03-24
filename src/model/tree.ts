import { DEFAULT_BLOCK_SEPARATOR, ROOT_COLUMN_LABEL } from "../constants";
import {
  BranchBlock,
  BranchBlockId,
  BranchColumnModel,
  BranchTreeMetadata
} from "../types";
import { deepClone, extractSnippet, generateBlockId, nowIso, sortBlocks } from "../utils";

function getChildrenMap(metadata: BranchTreeMetadata): Map<BranchBlockId | null, BranchBlock[]> {
  const grouped = new Map<BranchBlockId | null, BranchBlock[]>();
  for (const block of metadata.blocks) {
    const current = grouped.get(block.parentId) ?? [];
    current.push(block);
    grouped.set(block.parentId, current);
  }

  for (const [parentId, blocks] of grouped) {
    grouped.set(parentId, sortBlocks(blocks));
  }

  return grouped;
}

export function cloneMetadata(metadata: BranchTreeMetadata): BranchTreeMetadata {
  return deepClone(metadata);
}

export function getBlock(metadata: BranchTreeMetadata, blockId: BranchBlockId | null | undefined): BranchBlock | null {
  if (!blockId) {
    return null;
  }

  return metadata.blocks.find((block) => block.id === blockId) ?? null;
}

export function getChildren(metadata: BranchTreeMetadata, parentId: BranchBlockId | null): BranchBlock[] {
  return sortBlocks(metadata.blocks.filter((block) => block.parentId === parentId));
}

export function getParentBlock(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  const target = getBlock(metadata, blockId);
  return target?.parentId ? getBlock(metadata, target.parentId) : null;
}

export function getPreviousSibling(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return null;
  }

  return getChildren(metadata, target.parentId)[target.order - 1] ?? null;
}

export function getNextSibling(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return null;
  }

  return getChildren(metadata, target.parentId)[target.order + 1] ?? null;
}

export function getFirstChildBlock(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  if (!blockId) {
    return getRootBlocks(metadata)[0] ?? null;
  }

  return getChildren(metadata, blockId)[0] ?? null;
}

function getMiddleBlock(blocks: BranchBlock[]): BranchBlock | null {
  if (blocks.length === 0) {
    return null;
  }

  return blocks[Math.floor((blocks.length - 1) / 2)] ?? null;
}

export function getPreferredChildBlock(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  if (!blockId) {
    return getMiddleBlock(getRootBlocks(metadata));
  }

  return getMiddleBlock(getChildren(metadata, blockId));
}

export function getPreferredVisibleBlock(metadata: BranchTreeMetadata, blockId: BranchBlockId | null): BranchBlock | null {
  const anchor = blockId ? getBlock(metadata, blockId) : getPreferredChildBlock(metadata, null);
  if (!anchor) {
    return null;
  }

  return getPreferredChildBlock(metadata, anchor.id) ?? anchor;
}

export function getRootBlocks(metadata: BranchTreeMetadata): BranchBlock[] {
  return getChildren(metadata, null);
}

export function getDescendantIds(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchBlockId[] {
  const childMap = getChildrenMap(metadata);
  const collected: BranchBlockId[] = [];
  const queue = [...(childMap.get(blockId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    collected.push(current.id);
    queue.unshift(...(childMap.get(current.id) ?? []));
  }

  return collected;
}

export function isDescendant(metadata: BranchTreeMetadata, blockId: BranchBlockId, maybeDescendantId: BranchBlockId | null): boolean {
  let current = getBlock(metadata, maybeDescendantId);
  while (current) {
    if (current.parentId === blockId) {
      return true;
    }
    current = getBlock(metadata, current.parentId);
  }
  return false;
}

export function reindexSiblingOrders(metadata: BranchTreeMetadata, parentId: BranchBlockId | null): void {
  const siblings = getChildren(metadata, parentId);
  siblings.forEach((block, index) => {
    block.order = index;
  });
}

export function reindexAll(metadata: BranchTreeMetadata): BranchTreeMetadata {
  const groupedParentIds = new Set<BranchBlockId | null>(metadata.blocks.map((block) => block.parentId));
  groupedParentIds.add(null);

  for (const parentId of groupedParentIds) {
    reindexSiblingOrders(metadata, parentId);
  }

  return metadata;
}

export function getActivePath(metadata: BranchTreeMetadata, selectedBlockId: BranchBlockId | null): BranchBlock[] {
  const path: BranchBlock[] = [];
  let current = getBlock(metadata, selectedBlockId);
  while (current) {
    path.unshift(current);
    current = getBlock(metadata, current.parentId);
  }
  return path;
}

export function buildColumnModels(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId | null,
  snippetLength: number
): BranchColumnModel[] {
  const columns: BranchColumnModel[] = [
    {
      key: "root",
      label: ROOT_COLUMN_LABEL,
      parentId: null,
      blocks: getRootBlocks(metadata)
    }
  ];

  const activePath = getActivePath(metadata, selectedBlockId);
  activePath.forEach((block, depth) => {
    const childBlocks = getChildren(metadata, block.id);
    const hasDeeperSelectedChild = depth < activePath.length - 1;
    if (block.collapsed && childBlocks.length > 0 && !hasDeeperSelectedChild) {
      columns.push({
        key: `depth-${depth + 1}`,
        label: extractSnippet(block.content, Math.min(snippetLength, 48)),
        parentId: block.id,
        blocks: [],
        collapsedBlockId: block.id,
        collapsedCount: childBlocks.length,
        collapsedPreviewLabels: childBlocks
          .slice(0, 3)
          .map((child) => extractSnippet(child.content, Math.min(snippetLength, 42)))
      });
      return;
    }

    columns.push({
      key: `depth-${depth + 1}`,
      label: extractSnippet(block.content, Math.min(snippetLength, 48)),
      parentId: block.id,
      blocks: childBlocks
    });
  });

  return columns;
}

export function setBlockCollapsed(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId,
  collapsed: boolean
): BranchTreeMetadata {
  const next = cloneMetadata(metadata);
  const target = getBlock(next, blockId);
  if (!target) {
    return next;
  }

  target.collapsed = collapsed;
  target.updatedAt = nowIso();
  return next;
}

export function toggleBlockCollapsed(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchTreeMetadata {
  const target = getBlock(metadata, blockId);
  return setBlockCollapsed(metadata, blockId, !target?.collapsed);
}

export function buildLinearOrder(metadata: BranchTreeMetadata): BranchBlock[] {
  const childMap = getChildrenMap(metadata);
  const ordered: BranchBlock[] = [];

  const visit = (parentId: BranchBlockId | null) => {
    for (const block of childMap.get(parentId) ?? []) {
      ordered.push(block);
      visit(block.id);
    }
  };

  visit(null);
  return ordered;
}

function insertAt<T>(items: T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

function blockFactory(parentId: BranchBlockId | null, order: number, content = "", after = DEFAULT_BLOCK_SEPARATOR): BranchBlock {
  const timestamp = nowIso();
  return {
    id: generateBlockId(),
    parentId,
    order,
    content,
    after,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createEmptyTree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [],
    savedAt: nowIso()
  };
}

export function ensureSelectedBlock(metadata: BranchTreeMetadata, selectedBlockId: BranchBlockId | null): BranchBlockId | null {
  if (selectedBlockId && getBlock(metadata, selectedBlockId)) {
    return selectedBlockId;
  }

  return getPreferredChildBlock(metadata, null)?.id ?? null;
}

export function addRootBlock(metadata: BranchTreeMetadata): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId } {
  const next = cloneMetadata(metadata);
  const root = blockFactory(null, getRootBlocks(next).length);
  next.blocks.push(root);
  reindexSiblingOrders(next, null);
  return { metadata: next, selectedBlockId: root.id };
}

export function addSibling(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId | null,
  position: "above" | "below"
): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId } {
  if (!selectedBlockId) {
    return addRootBlock(metadata);
  }

  const selected = getBlock(metadata, selectedBlockId);
  if (!selected) {
    return addRootBlock(metadata);
  }

  const next = cloneMetadata(metadata);
  const anchor = getBlock(next, selectedBlockId)!;
  const siblings = getChildren(next, anchor.parentId);
  const anchorIndex = siblings.findIndex((block) => block.id === anchor.id);
  const insertIndex = anchorIndex + (position === "below" ? 1 : 0);
  const created = blockFactory(anchor.parentId, insertIndex);
  next.blocks.push(created);
  const reordered = insertAt(
    siblings.filter((block) => block.id !== created.id),
    insertIndex,
    created
  );
  reordered.forEach((block, index) => {
    block.order = index;
  });
  return { metadata: next, selectedBlockId: created.id };
}

export function addChild(metadata: BranchTreeMetadata, selectedBlockId: BranchBlockId | null): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId } {
  if (!selectedBlockId) {
    return addRootBlock(metadata);
  }

  const selected = getBlock(metadata, selectedBlockId);
  if (!selected) {
    return addRootBlock(metadata);
  }

  const next = cloneMetadata(metadata);
  const created = blockFactory(selectedBlockId, getChildren(next, selectedBlockId).length);
  next.blocks.push(created);
  reindexSiblingOrders(next, selectedBlockId);
  return { metadata: next, selectedBlockId: created.id };
}

export function updateBlockContent(metadata: BranchTreeMetadata, blockId: BranchBlockId, content: string): BranchTreeMetadata {
  const next = cloneMetadata(metadata);
  const target = getBlock(next, blockId);
  if (!target) {
    return next;
  }

  target.content = content;
  target.updatedAt = nowIso();
  return next;
}

export function moveBlockToParentAtIndex(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId,
  newParentId: BranchBlockId | null,
  rawIndex: number
): BranchTreeMetadata {
  const source = getBlock(metadata, blockId);
  if (!source) {
    return metadata;
  }

  if (newParentId === blockId || isDescendant(metadata, blockId, newParentId)) {
    return metadata;
  }

  const next = cloneMetadata(metadata);
  const moving = getBlock(next, blockId)!;
  const oldParentId = moving.parentId;
  const oldSiblings = getChildren(next, oldParentId).filter((block) => block.id !== moving.id);
  oldSiblings.forEach((block, index) => {
    block.order = index;
  });

  const targetSiblings = getChildren(next, newParentId).filter((block) => block.id !== moving.id);
  let insertIndex = rawIndex;

  if (oldParentId === newParentId) {
    const sourceIndex = getChildren(metadata, oldParentId).findIndex((block) => block.id === blockId);
    if (sourceIndex >= 0 && sourceIndex < insertIndex) {
      insertIndex -= 1;
    }
  }

  insertIndex = Math.max(0, Math.min(insertIndex, targetSiblings.length));

  moving.parentId = newParentId;
  const reordered = insertAt(targetSiblings, insertIndex, moving);
  reordered.forEach((block, index) => {
    block.order = index;
  });
  reindexSiblingOrders(next, oldParentId);
  reindexSiblingOrders(next, newParentId);
  return next;
}

export function moveBlockUp(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchTreeMetadata {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return metadata;
  }
  return moveBlockToParentAtIndex(metadata, blockId, target.parentId, target.order - 1);
}

export function moveBlockDown(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchTreeMetadata {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return metadata;
  }
  return moveBlockToParentAtIndex(metadata, blockId, target.parentId, target.order + 2);
}

export function moveBlockLeft(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchTreeMetadata {
  const target = getBlock(metadata, blockId);
  if (!target?.parentId) {
    return metadata;
  }
  const parent = getBlock(metadata, target.parentId);
  if (!parent) {
    return metadata;
  }
  return moveBlockToParentAtIndex(metadata, blockId, parent.parentId, parent.order + 1);
}

export function moveBlockRight(metadata: BranchTreeMetadata, blockId: BranchBlockId): BranchTreeMetadata {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return metadata;
  }
  const siblings = getChildren(metadata, target.parentId);
  const previousSibling = siblings[target.order - 1];
  if (!previousSibling) {
    return metadata;
  }

  return moveBlockToParentAtIndex(metadata, blockId, previousSibling.id, getChildren(metadata, previousSibling.id).length);
}

export function deleteBlockAndLiftChildren(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId
): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId | null } {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }

  const next = cloneMetadata(metadata);
  const block = getBlock(next, blockId)!;
  const parentId = block.parentId;
  const siblings = getChildren(next, parentId).filter((item) => item.id !== blockId);
  const children = getChildren(next, blockId);

  children.forEach((child) => {
    child.parentId = parentId;
  });

  const merged = [...siblings.slice(0, block.order), ...children, ...siblings.slice(block.order)];
  merged.forEach((item, index) => {
    item.order = index;
  });

  next.blocks = next.blocks.filter((candidate) => candidate.id !== blockId);
  reindexSiblingOrders(next, parentId);

  const selectedBlockId = merged[Math.min(block.order, merged.length - 1)]?.id ?? ensureSelectedBlock(next, null);
  return { metadata: next, selectedBlockId };
}

export function deleteSubtree(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId
): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId | null } {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }

  const descendantIds = new Set([blockId, ...getDescendantIds(metadata, blockId)]);
  const next = cloneMetadata(metadata);
  const previousSiblings = getChildren(next, target.parentId).filter((block) => !descendantIds.has(block.id));
  next.blocks = next.blocks.filter((block) => !descendantIds.has(block.id));
  previousSiblings.forEach((block, index) => {
    block.order = index;
  });
  const selectedBlockId = previousSiblings[target.order]?.id ?? previousSiblings[target.order - 1]?.id ?? ensureSelectedBlock(next, target.parentId);
  return { metadata: next, selectedBlockId };
}

export function duplicateBlock(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId
): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId | null } {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }

  const next = cloneMetadata(metadata);
  const original = getBlock(next, blockId)!;
  const duplicate = {
    ...deepClone(original),
    id: generateBlockId(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  next.blocks.push(duplicate);
  const siblings = getChildren(next, original.parentId).filter((block) => block.id !== duplicate.id);
  const inserted = insertAt(siblings, original.order + 1, duplicate);
  inserted.forEach((block, index) => {
    block.order = index;
  });
  return { metadata: next, selectedBlockId: duplicate.id };
}

export function duplicateSubtree(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId
): { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId | null } {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }

  const next = cloneMetadata(metadata);
  const original = getBlock(next, blockId)!;
  const descendantIds = [blockId, ...getDescendantIds(next, blockId)];
  const originals = descendantIds
    .map((id) => getBlock(next, id))
    .filter((block): block is BranchBlock => Boolean(block));

  const idMap = new Map<BranchBlockId, BranchBlockId>();
  const timestamp = nowIso();

  for (const block of originals) {
    idMap.set(block.id, generateBlockId());
  }

  const duplicates = originals.map((block) => ({
    ...deepClone(block),
    id: idMap.get(block.id)!,
    parentId: block.parentId && idMap.has(block.parentId) ? idMap.get(block.parentId)! : block.parentId,
    createdAt: timestamp,
    updatedAt: timestamp
  }));

  const rootDuplicate = duplicates.find((block) => block.id === idMap.get(blockId))!;
  next.blocks.push(...duplicates);
  const rootSiblings = getChildren(next, original.parentId).filter((block) => block.id !== rootDuplicate.id);
  const insertedRoots = insertAt(rootSiblings, original.order + 1, rootDuplicate);
  insertedRoots.forEach((block, index) => {
    block.order = index;
  });

  for (const block of duplicates) {
    if (block.id !== rootDuplicate.id) {
      reindexSiblingOrders(next, block.parentId);
    }
  }

  return { metadata: next, selectedBlockId: rootDuplicate.id };
}
