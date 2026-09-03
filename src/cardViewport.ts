export const CARD_PREVIEW_MAX_HEIGHT_PX = 260;
export const CARD_VIEWPORT_EDGE_PADDING_PX = 24;

const MIN_EDITOR_HEIGHT_PX = 180;

export function canDragCard(dragAndDropEnabled: boolean, isEditing: boolean): boolean {
  return dragAndDropEnabled && !isEditing;
}

export function canStartCardDrag(
  dragAndDropEnabled: boolean,
  editingBlockId: string | null,
  blockId: string | null | undefined
): boolean {
  return dragAndDropEnabled && Boolean(blockId) && editingBlockId !== blockId;
}

export function resolveEditorHeight(scrollHeight: number, viewportHeight: number, cardChromeHeight: number): number {
  const available = Math.max(
    MIN_EDITOR_HEIGHT_PX,
    viewportHeight - CARD_VIEWPORT_EDGE_PADDING_PX * 2 - cardChromeHeight
  );
  return Math.max(MIN_EDITOR_HEIGHT_PX, Math.min(scrollHeight, available));
}

export function hasVerticalOverflow(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight;
}

export function resolveColumnWheelNavigation(
  deltaX: number,
  deltaY: number,
  ctrlKey: boolean,
  metaKey: boolean,
  isPointerOverColumn: boolean
): "previous" | "next" | null {
  if (!isPointerOverColumn || ctrlKey || metaKey || Math.abs(deltaY) <= Math.abs(deltaX)) {
    return null;
  }
  return deltaY < 0 ? "previous" : "next";
}

export function clampCardCenter(preferredCenter: number, cardHeight: number, viewportTop: number, viewportHeight: number): number {
  const halfHeight = Math.min(cardHeight / 2, Math.max(0, viewportHeight / 2 - CARD_VIEWPORT_EDGE_PADDING_PX));
  const minimum = viewportTop + CARD_VIEWPORT_EDGE_PADDING_PX + halfHeight;
  const maximum = viewportTop + viewportHeight - CARD_VIEWPORT_EDGE_PADDING_PX - halfHeight;
  return Math.max(minimum, Math.min(preferredCenter, maximum));
}

export function reserveSceneWidthForColumns(
  currentSceneWidth: number,
  viewportWidth: number,
  existingColumnCount: number,
  nextColumnCount: number,
  columnWidth: number,
  columnGap: number,
  zoom: number
): number {
  const safeExistingCount = Math.max(0, existingColumnCount);
  const safeNextCount = Math.max(0, nextColumnCount);
  const widthForColumnCount = (count: number): number =>
    count * columnWidth + Math.max(0, count - 1) * columnGap;
  const pendingWidth = Math.max(0, widthForColumnCount(safeNextCount) - widthForColumnCount(safeExistingCount)) * zoom;

  return Math.max(currentSceneWidth, viewportWidth, currentSceneWidth + pendingWidth);
}
