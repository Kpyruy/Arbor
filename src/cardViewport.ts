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

export function clampCardCenter(preferredCenter: number, cardHeight: number, viewportTop: number, viewportHeight: number): number {
  const halfHeight = Math.min(cardHeight / 2, Math.max(0, viewportHeight / 2 - CARD_VIEWPORT_EDGE_PADDING_PX));
  const minimum = viewportTop + CARD_VIEWPORT_EDGE_PADDING_PX + halfHeight;
  const maximum = viewportTop + viewportHeight - CARD_VIEWPORT_EDGE_PADDING_PX - halfHeight;
  return Math.max(minimum, Math.min(preferredCenter, maximum));
}
