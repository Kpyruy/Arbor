export const VIEW_TYPE_ARBOR = "arbor-view";
export const METADATA_MARKER = "arbor:metadata:v1";
export const DEFAULT_BLOCK_SEPARATOR = "\n\n";
export const ROOT_COLUMN_LABEL = "Root";
export const HISTORY_LIMIT = 200;

export const COMMANDS = {
  openView: "open-arbor-view",
  createNote: "create-arbor-note",
  createNoteMarkdown: "create-arbor-note-markdown",
  createDemo: "create-arbor-demo-note",
  newRoot: "new-root-block",
  siblingAbove: "create-sibling-above",
  siblingBelow: "create-sibling-below",
  childRight: "create-child-right",
  parentLevelLeft: "create-parent-level-block-left",
  openBlockMenu: "open-block-actions-menu",
  selectParent: "select-parent-block",
  selectPreviousSibling: "select-previous-sibling-block",
  selectNextSibling: "select-next-sibling-block",
  selectFirstChild: "select-first-child-block",
  selectFirstSibling: "select-first-sibling-block",
  selectLastSibling: "select-last-sibling-block",
  moveUp: "move-block-up",
  moveDown: "move-block-down",
  moveLeft: "move-block-left",
  moveRight: "move-block-right",
  deleteBlock: "delete-block",
  deleteSubtree: "delete-subtree",
  duplicateBlock: "duplicate-block",
  duplicateSubtree: "duplicate-subtree",
  toggleEditMode: "toggle-edit-mode",
  revealInMarkdown: "reveal-current-block-in-linear-markdown",
  rebuildMarkdown: "rebuild-linear-markdown-from-tree",
  rebuildTree: "rebuild-tree-from-metadata",
  undo: "undo-branch-action",
  redo: "redo-branch-action"
} as const;
