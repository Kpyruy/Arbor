import {
  ArborOverviewLayout,
  ArborOverviewNode,
  ArborLayoutDirection,
  ArborOverviewOrientation,
  BranchBlockId,
  BranchTreeMetadata
} from "../types";
import { extractPathLabel, extractSnippet, sortBlocks } from "../utils";
import { normalizeOverviewOrientation } from "../overviewOrientation";

export interface OverviewLayoutOptions {
  cardWidth: number;
  cardHeight: number;
  cardHeights: ReadonlyMap<BranchBlockId, number>;
  columnGap: number;
  rowGap: number;
  labelLength: number;
  snippetLength: number;
  direction: ArborLayoutDirection;
  orientation: ArborOverviewOrientation;
}

const DEFAULT_OPTIONS: OverviewLayoutOptions = {
  cardWidth: 224,
  cardHeight: 76,
  cardHeights: new Map(),
  columnGap: 104,
  rowGap: 30,
  labelLength: 46,
  snippetLength: 92,
  direction: "ltr",
  orientation: "horizontal"
};

export function buildOverviewLayout(
  metadata: BranchTreeMetadata,
  options: Partial<OverviewLayoutOptions> = {}
): ArborOverviewLayout {
  const config = { ...DEFAULT_OPTIONS, ...options };
  config.orientation = normalizeOverviewOrientation(config.orientation) ?? "horizontal";
  return config.orientation === "horizontal"
    ? buildHorizontalOverviewLayout(metadata, config)
    : buildVerticalOverviewLayout(metadata, config);
}

function buildHorizontalOverviewLayout(metadata: BranchTreeMetadata, config: OverviewLayoutOptions): ArborOverviewLayout {
  const rowHeight = Math.max(
    config.cardHeight,
    ...Array.from(config.cardHeights.values(), (height) => Math.max(config.cardHeight, height))
  );
  const nodes: ArborOverviewNode[] = [];
  const nodesById = new Map<BranchBlockId, ArborOverviewNode>();
  const links: ArborOverviewLayout["links"] = [];
  const childrenByParent = new Map<BranchBlockId | null, BranchTreeMetadata["blocks"]>();
  metadata.blocks.forEach((block) => {
    const siblings = childrenByParent.get(block.parentId) ?? [];
    siblings.push(block);
    childrenByParent.set(block.parentId, siblings);
  });
  childrenByParent.forEach((siblings, parentId) => {
    childrenByParent.set(parentId, sortBlocks(siblings));
  });
  const childrenFor = (parentId: BranchBlockId | null) => childrenByParent.get(parentId) ?? [];
  let nextRow = 0;

  const visit = (parentId: BranchBlockId | null, depth: number): void => {
    childrenFor(parentId).forEach((block) => {
      const node: ArborOverviewNode = {
        id: block.id,
        parentId: block.parentId,
        depth,
        order: block.order,
        x: depth * (config.cardWidth + config.columnGap),
        y: 0,
        width: config.cardWidth,
        height: Math.max(config.cardHeight, config.cardHeights.get(block.id) ?? config.cardHeight),
        label: extractPathLabel(block.content, {
          preferredPrefix: "#",
          fallback: "firstLine",
          maxWords: 6,
          maxLength: config.labelLength
        }),
        snippet: extractSnippet(block.content, config.snippetLength),
        childCount: childrenFor(block.id).length
      };
      nodes.push(node);
      nodesById.set(node.id, node);
      if (block.parentId) {
        links.push({ parentId: block.parentId, childId: block.id });
      }
      visit(block.id, depth + 1);
      const children = childrenFor(block.id)
        .map((child) => nodesById.get(child.id))
        .filter((child): child is ArborOverviewNode => Boolean(child));
      if (children.length === 0) {
        const row = nextRow;
        nextRow += 1;
        node.y = row * (rowHeight + config.rowGap) + (rowHeight - node.height) / 2;
        return;
      }
      const firstChild = children[0];
      const lastChild = children[children.length - 1];
      const firstCenter = firstChild.y + firstChild.height / 2;
      const lastCenter = lastChild.y + lastChild.height / 2;
      node.y = (firstCenter + lastCenter) / 2 - node.height / 2;
    });
  };

  visit(null, 0);

  const width = Math.max(config.cardWidth, ...nodes.map((node) => node.x + node.width));
  if (config.direction === "rtl") {
    nodes.forEach((node) => {
      node.x = width - node.x - node.width;
    });
  }

  return {
    nodes,
    links,
    width,
    height: Math.max(config.cardHeight, ...nodes.map((node) => node.y + node.height))
  };
}

function buildVerticalOverviewLayout(metadata: BranchTreeMetadata, config: OverviewLayoutOptions): ArborOverviewLayout {
  const nodes: ArborOverviewNode[] = [];
  const nodesById = new Map<BranchBlockId, ArborOverviewNode>();
  const links: ArborOverviewLayout["links"] = [];
  const childrenByParent = new Map<BranchBlockId | null, BranchTreeMetadata["blocks"]>();
  metadata.blocks.forEach((block) => {
    const siblings = childrenByParent.get(block.parentId) ?? [];
    siblings.push(block);
    childrenByParent.set(block.parentId, siblings);
  });
  childrenByParent.forEach((siblings, parentId) => {
    childrenByParent.set(parentId, sortBlocks(siblings));
  });
  const childrenFor = (parentId: BranchBlockId | null) => childrenByParent.get(parentId) ?? [];
  const rowHeights: number[] = [];
  const visit = (parentId: BranchBlockId | null, depth: number): void => {
    childrenFor(parentId).forEach((block) => {
      const measuredHeight = config.cardHeights.get(block.id);
      const height = measuredHeight !== undefined && Number.isFinite(measuredHeight)
        ? Math.max(config.cardHeight, measuredHeight) : config.cardHeight;
      const node: ArborOverviewNode = {
        id: block.id,
        parentId: block.parentId,
        depth,
        order: block.order,
        x: 0,
        y: 0,
        width: config.cardWidth,
        height,
        label: extractPathLabel(block.content, {
          preferredPrefix: "#",
          fallback: "firstLine",
          maxWords: 6,
          maxLength: config.labelLength
        }),
        snippet: extractSnippet(block.content, config.snippetLength),
        childCount: childrenFor(block.id).length
      };
      nodes.push(node);
      nodesById.set(node.id, node);
      rowHeights[depth] = Math.max(rowHeights[depth] ?? config.cardHeight, height);
      if (block.parentId) links.push({ parentId: block.parentId, childId: block.id });
      visit(block.id, depth + 1);
    });
  };
  visit(null, 0);

  const rowY: number[] = [];
  rowHeights.forEach((_height, depth) => {
    rowY[depth] = depth === 0 ? 0 : rowY[depth - 1] + rowHeights[depth - 1] + config.columnGap;
  });
  const widths = new Map<BranchBlockId, number>();
  const measure = (id: BranchBlockId): number => {
    const children = childrenFor(id);
    const width = Math.max(config.cardWidth,
      children.reduce((sum, child) => sum + measure(child.id), 0) + Math.max(0, children.length - 1) * config.rowGap);
    widths.set(id, width);
    return width;
  };
  const place = (id: BranchBlockId, left: number): void => {
    const node = nodesById.get(id)!;
    const children = childrenFor(id);
    let nextLeft = left;
    children.forEach((child) => {
      place(child.id, nextLeft);
      nextLeft += widths.get(child.id)! + config.rowGap;
    });
    const first = children.length ? nodesById.get(children[0].id)! : null;
    const last = children.length ? nodesById.get(children[children.length - 1].id)! : null;
    node.x = first && last
      ? (first.x + first.width / 2 + last.x + last.width / 2) / 2 - node.width / 2
      : left + (widths.get(id)! - node.width) / 2;
    node.y = rowY[node.depth];
  };
  const roots = childrenFor(null);
  roots.forEach((root) => measure(root.id));
  let nextLeft = 0;
  roots.forEach((root) => {
    place(root.id, nextLeft);
    nextLeft += widths.get(root.id)! + config.rowGap;
  });
  const width = Math.max(config.cardWidth, ...nodes.map((node) => node.x + node.width));
  const height = Math.max(config.cardHeight, ...nodes.map((node) => node.y + node.height));
  nodes.forEach((node) => {
    if (config.orientation === "vertical-bottom-up") node.y = height - node.y - node.height;
    if (config.direction === "rtl") node.x = width - node.x - node.width;
  });
  return { nodes, links, width, height };
}

export function buildOverviewLinkPath(
  parent: ArborOverviewNode,
  child: ArborOverviewNode,
  direction: ArborLayoutDirection = "ltr",
  orientation: ArborOverviewOrientation = "horizontal"
): string {
  if (orientation !== "horizontal") {
    const bottomUp = orientation === "vertical-bottom-up";
    const startX = parent.x + parent.width / 2;
    const startY = bottomUp ? parent.y : parent.y + parent.height;
    const endX = child.x + child.width / 2;
    const endY = bottomUp ? child.y + child.height : child.y;
    const controlOffset = Math.max(36, Math.abs(endY - startY) * 0.5);
    const sign = bottomUp ? -1 : 1;
    return `M ${startX} ${startY} C ${startX} ${startY + sign * controlOffset}, ${endX} ${endY - sign * controlOffset}, ${endX} ${endY}`;
  }
  const startX = direction === "rtl" ? parent.x : parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = direction === "rtl" ? child.x + child.width : child.x;
  const endY = child.y + child.height / 2;
  const controlOffset = Math.max(36, Math.abs(endX - startX) * 0.5);
  const firstControlX = direction === "rtl" ? startX - controlOffset : startX + controlOffset;
  const secondControlX = direction === "rtl" ? endX + controlOffset : endX - controlOffset;

  return `M ${startX} ${startY} C ${firstControlX} ${startY}, ${secondControlX} ${endY}, ${endX} ${endY}`;
}
