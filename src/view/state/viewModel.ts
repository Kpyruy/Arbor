import type {
  ArborOutputState,
  ArborSettings,
  BranchBlockId,
  BranchTreeMetadata
} from "../../types";
import {
  buildLinearOrder,
  getActivePath,
  getChildren
} from "../../model/tree";
import { getActiveOutputProfile, resolveOutputStates } from "../../outputProfiles";
import { extractPathLabel } from "../../utils";
import type { BranchViewContext } from "./viewTypes";

export type LabelSettings = Pick<ArborSettings, "breadcrumbLabelPreferredPrefix" | "breadcrumbLabelFallback">;

export function buildPreviewPathLabels(
  metadata: BranchTreeMetadata,
  blockId: BranchBlockId,
  labelSettings: LabelSettings
): string[] {
  return getActivePath(metadata, blockId).map((block) =>
    extractPathLabel(block.content, {
      preferredPrefix: labelSettings.breadcrumbLabelPreferredPrefix,
      fallback: labelSettings.breadcrumbLabelFallback,
      maxWords: 4,
      maxLength: 36
    })
  );
}

export function buildViewContext(
  metadata: BranchTreeMetadata,
  selectedBlockId: BranchBlockId | null,
  outputState: ArborOutputState,
  query: string,
  labelSettings: LabelSettings
): BranchViewContext {
  const activePathIds = new Set(getActivePath(metadata, selectedBlockId).map((item) => item.id));
  const selectableChildIds = new Set(
    selectedBlockId ? getChildren(metadata, selectedBlockId).map((item) => item.id) : []
  );
  const searchQuery = query.trim().toLocaleLowerCase();
  const searchMatchedIds = new Set<BranchBlockId>();
  const searchRelatedIds = new Set<BranchBlockId>();
  const outputProfile = getActiveOutputProfile(outputState);
  const outputResolutions = resolveOutputStates(metadata, outputProfile);

  if (searchQuery.length > 0) {
    for (const block of metadata.blocks) {
      const pathLabel = buildPreviewPathLabels(metadata, block.id, labelSettings).join(" ");
      const haystack = `${block.content}\n${pathLabel}`.toLocaleLowerCase();
      if (!haystack.includes(searchQuery)) {
        continue;
      }

      searchMatchedIds.add(block.id);
      getActivePath(metadata, block.id).forEach((pathBlock) => searchRelatedIds.add(pathBlock.id));
    }
  }

  const previewVisibleIds = searchQuery.length > 0
    ? new Set<BranchBlockId>([...searchMatchedIds, ...searchRelatedIds])
    : null;

  const overviewNodes = buildLinearOrder(metadata).map((block) => {
    const depth = getActivePath(metadata, block.id).length - 1;
    const childCount = getChildren(metadata, block.id).length;
    return {
      id: block.id,
      parentId: block.parentId,
      depth,
      label: extractPathLabel(block.content, {
        preferredPrefix: labelSettings.breadcrumbLabelPreferredPrefix,
        fallback: labelSettings.breadcrumbLabelFallback,
        maxWords: 5,
        maxLength: 52
      }),
      childCount,
      collapsed: Boolean(block.collapsed),
      isSelected: selectedBlockId === block.id,
      isOnActivePath: activePathIds.has(block.id),
      isSelectable: selectableChildIds.has(block.id),
      isSearchMatch: searchMatchedIds.has(block.id),
      isSearchRelated: searchRelatedIds.has(block.id)
    };
  });

  return {
    activePathIds,
    selectableChildIds,
    searchQuery,
    searchMatchedIds,
    searchRelatedIds,
    previewVisibleIds,
    overviewNodes,
    outputProfile,
    outputResolutions
  };
}
