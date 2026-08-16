import {
  ArborOverviewLayout,
  ArborOverviewNode,
  BranchBlockId,
  BranchTreeMetadata
} from "../types";
import { extractPathLabel, extractSnippet, sortBlocks } from "../utils";

interface OverviewLayoutOptions {
  cardWidth: number;
  cardHeight: number;
  cardHeights: ReadonlyMap<BranchBlockId, number>;
  columnGap: number;
  rowGap: number;
  labelLength: number;
  snippetLength: number;
  direction: "ltr" | "rtl";
}

const DEFAULT_OPTIONS: OverviewLayoutOptions = {
  cardWidth: 224,
  cardHeight: 76,
  cardHeights: new Map(),
  columnGap: 104,
  rowGap: 30,
  labelLength: 46,
  snippetLength: 92,
  direction: "ltr"
};

export function buildOverviewLayout(
  metadata: BranchTreeMetadata,
  options: Partial<OverviewLayoutOptions> = {}
): ArborOverviewLayout {
  const config = { ...DEFAULT_OPTIONS, ...options };
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

export function buildOverviewLinkPath(parent: ArborOverviewNode, child: ArborOverviewNode, direction: "ltr" | "rtl" = "ltr"): string {
  const startX = direction === "rtl" ? parent.x : parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = direction === "rtl" ? child.x + child.width : child.x;
  const endY = child.y + child.height / 2;
  const controlOffset = Math.max(36, Math.abs(endX - startX) * 0.5);
  const firstControlX = direction === "rtl" ? startX - controlOffset : startX + controlOffset;
  const secondControlX = direction === "rtl" ? endX + controlOffset : endX - controlOffset;

  return `M ${startX} ${startY} C ${firstControlX} ${startY}, ${secondControlX} ${endY}, ${endX} ${endY}`;
}
