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
  columnGap: number;
  rowGap: number;
  labelLength: number;
  snippetLength: number;
}

const DEFAULT_OPTIONS: OverviewLayoutOptions = {
  cardWidth: 224,
  cardHeight: 76,
  columnGap: 104,
  rowGap: 30,
  labelLength: 46,
  snippetLength: 92
};

export function buildOverviewLayout(
  metadata: BranchTreeMetadata,
  options: Partial<OverviewLayoutOptions> = {}
): ArborOverviewLayout {
  const config = { ...DEFAULT_OPTIONS, ...options };
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
        height: config.cardHeight,
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
      const row = children.length === 0
        ? nextRow++
        : (children[0].y + children[children.length - 1].y) / (2 * (config.cardHeight + config.rowGap));
      node.y = row * (config.cardHeight + config.rowGap);
    });
  };

  visit(null, 0);

  return {
    nodes,
    links,
    width: Math.max(config.cardWidth, ...nodes.map((node) => node.x + node.width)),
    height: Math.max(config.cardHeight, ...nodes.map((node) => node.y + node.height))
  };
}

export function buildOverviewLinkPath(parent: ArborOverviewNode, child: ArborOverviewNode): string {
  const startX = parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = child.x;
  const endY = child.y + child.height / 2;
  const controlOffset = Math.max(36, (endX - startX) * 0.5);
  const firstControlX = startX + controlOffset;
  const secondControlX = endX - controlOffset;

  return `M ${startX} ${startY} C ${firstControlX} ${startY}, ${secondControlX} ${endY}, ${endX} ${endY}`;
}
