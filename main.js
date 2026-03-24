"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ArborPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/constants.ts
var VIEW_TYPE_ARBOR = "arbor-view";
var METADATA_MARKER = "arbor:metadata:v1";
var DEFAULT_BLOCK_SEPARATOR = "\n\n";
var ROOT_COLUMN_LABEL = "Root";
var HISTORY_LIMIT = 200;
var COMMANDS = {
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
};

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  splitDirection: "vertical",
  cardWidth: 300,
  cardMinHeight: 120,
  horizontalSpacing: 20,
  verticalSpacing: 12,
  zoomLevel: 1,
  previewSnippetLength: 220,
  dragAndDrop: true,
  dimNonPathBlocks: false,
  enableCtrlWheelZoom: true,
  autoOpenManagedNotes: true,
  showBreadcrumb: true,
  showBreadcrumbFlow: true,
  breadcrumbLabelPreferredPrefix: "#",
  breadcrumbLabelFallback: "firstLine",
  liveLinearPreview: false,
  metadataBlockStyle: "multiline"
};
var ArborSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Arbor" });
    new import_obsidian.Setting(containerEl).setName("Split direction").setDesc("Where the Arbor view opens relative to the current note.").addDropdown(
      (dropdown) => dropdown.addOption("vertical", "Vertical split").addOption("horizontal", "Horizontal split").setValue(this.plugin.settings.splitDirection).onChange(async (value) => {
        this.plugin.settings.splitDirection = value;
        await this.plugin.saveSettings();
      })
    );
    this.addNumericSetting(containerEl, "Card width", "Card width in pixels.", "cardWidth", 220, 520, 10);
    this.addNumericSetting(containerEl, "Card minimum height", "Minimum card height in pixels.", "cardMinHeight", 80, 300, 10);
    this.addNumericSetting(containerEl, "Horizontal spacing", "Space between columns in pixels.", "horizontalSpacing", 8, 48, 2);
    this.addNumericSetting(containerEl, "Vertical spacing", "Space between cards in pixels.", "verticalSpacing", 4, 32, 2);
    this.addNumericSetting(containerEl, "Default zoom", "Default scene zoom level.", "zoomLevel", 70, 160, 5, "%");
    this.addNumericSetting(containerEl, "Preview snippet length", "Maximum characters to show in card preview.", "previewSnippetLength", 80, 600, 10);
    new import_obsidian.Setting(containerEl).setName("Drag and drop").setDesc("Enable drag-and-drop reordering across columns.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.dragAndDrop).onChange(async (value) => {
        this.plugin.settings.dragAndDrop = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Ctrl+wheel zoom").setDesc("Zoom the branching scene with Ctrl/Cmd + mouse wheel.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableCtrlWheelZoom).onChange(async (value) => {
        this.plugin.settings.enableCtrlWheelZoom = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-open managed notes").setDesc("Open notes with Arbor metadata directly in the Arbor view when you open them normally.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoOpenManagedNotes).onChange(async (value) => {
        this.plugin.settings.autoOpenManagedNotes = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show breadcrumb path").setDesc("Show the active block path as a breadcrumb strip.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showBreadcrumb).onChange(async (value) => {
        this.plugin.settings.showBreadcrumb = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show breadcrumb flow").setDesc("Show subtle connectors between breadcrumb items.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showBreadcrumbFlow).onChange(async (value) => {
        this.plugin.settings.showBreadcrumbFlow = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Preferred breadcrumb line prefix").setDesc("Use the first non-empty line that starts with this prefix for breadcrumb labels. Leave blank to skip prefix matching.").addText(
      (text) => text.setPlaceholder("#").setValue(this.plugin.settings.breadcrumbLabelPreferredPrefix).onChange(async (value) => {
        this.plugin.settings.breadcrumbLabelPreferredPrefix = value.trim();
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Breadcrumb fallback").setDesc("What to use when no preferred-prefix line exists.").addDropdown(
      (dropdown) => dropdown.addOption("firstLine", "First non-empty line").addOption("snippet", "Clean snippet").addOption("none", "No fallback").setValue(this.plugin.settings.breadcrumbLabelFallback).onChange(async (value) => {
        this.plugin.settings.breadcrumbLabelFallback = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Selected Block panel").setDesc("Show the focused selected-block panel alongside the branching editor.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.liveLinearPreview).onChange(async (value) => {
        this.plugin.settings.liveLinearPreview = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Managed metadata block style").setDesc("How hidden in-note tree metadata is stored.").addDropdown(
      (dropdown) => dropdown.addOption("multiline", "Multiline HTML comment").addOption("compact", "Compact single-line HTML comment").setValue(this.plugin.settings.metadataBlockStyle).onChange(async (value) => {
        this.plugin.settings.metadataBlockStyle = value;
        await this.plugin.saveSettings();
      })
    );
  }
  addNumericSetting(containerEl, name, description, key, min, max, step, format = "px") {
    new import_obsidian.Setting(containerEl).setName(name).setDesc(description).addSlider(
      (slider) => slider.setLimits(min, max, step).setDynamicTooltip().setValue(key === "zoomLevel" ? Math.round(this.plugin.settings[key] * 100) : this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = key === "zoomLevel" ? value / 100 : value;
        await this.plugin.saveSettings();
        this.plugin.refreshAllBranchViews();
      })
    );
  }
};

// src/utils.ts
function generateBlockId() {
  return `bw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function normalizeNewlines(input) {
  return input.replace(/\r\n/g, "\n");
}
function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function sortBlocks(blocks) {
  return [...blocks].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}
function extractSnippet(markdown, length) {
  const stripped = markdown.replace(/```[\s\S]*?```/g, "[code]").replace(/`([^`]+)`/g, "$1").replace(/!\[\[([^\]]+)\]\]/g, "[embed: $1]").replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[image: $1]").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/^>\s*\[![^\]]+\]\s*/gm, "").replace(/^>\s?/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/\s+/g, " ").trim();
  if (!stripped) {
    return "Empty block";
  }
  return stripped.length > length ? `${stripped.slice(0, Math.max(0, length - 3)).trimEnd()}...` : stripped;
}
function normalizeLabelLine(line) {
  return line.replace(/^\s*(?:>\s*)+/, "").replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+[.)-]?\s+/, "").trim();
}
function stripRepeatedPrefix(line, prefix) {
  if (!prefix) {
    return line.trim();
  }
  let value = line.trimStart();
  while (value.startsWith(prefix)) {
    value = value.slice(prefix.length).trimStart();
  }
  return value.trim();
}
function trimPathLabel(label, maxWords, maxLength) {
  const words = label.split(/\s+/).filter(Boolean).slice(0, maxWords);
  if (words.length === 0) {
    return "Empty block";
  }
  const compact = words.join(" ");
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...` : compact;
}
function extractPathLabel(markdown, options = {}) {
  const maxWords = options.maxWords ?? 4;
  const maxLength = options.maxLength ?? 36;
  const preferredPrefix = options.preferredPrefix ?? "#";
  const fallback = options.fallback ?? "firstLine";
  const lines = markdown.split(/\r?\n/).map((line) => normalizeLabelLine(line)).filter((line) => line.length > 0);
  if (preferredPrefix) {
    const matchedLine = lines.find((line) => line.startsWith(preferredPrefix));
    if (matchedLine) {
      return trimPathLabel(stripRepeatedPrefix(matchedLine, preferredPrefix), maxWords, maxLength);
    }
  }
  if (fallback === "firstLine") {
    const firstLine = lines[0];
    if (firstLine) {
      return trimPathLabel(stripRepeatedPrefix(firstLine, preferredPrefix), maxWords, maxLength);
    }
  }
  if (fallback === "snippet") {
    const snippet = extractSnippet(markdown, Math.max(maxLength * 2, 48));
    return trimPathLabel(snippet, maxWords, maxLength);
  }
  return "Empty block";
}

// src/model/tree.ts
function getChildrenMap(metadata) {
  const grouped = /* @__PURE__ */ new Map();
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
function cloneMetadata(metadata) {
  return deepClone(metadata);
}
function getBlock(metadata, blockId) {
  if (!blockId) {
    return null;
  }
  return metadata.blocks.find((block) => block.id === blockId) ?? null;
}
function getChildren(metadata, parentId) {
  return sortBlocks(metadata.blocks.filter((block) => block.parentId === parentId));
}
function getParentBlock(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  return target?.parentId ? getBlock(metadata, target.parentId) : null;
}
function getPreviousSibling(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return null;
  }
  return getChildren(metadata, target.parentId)[target.order - 1] ?? null;
}
function getNextSibling(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return null;
  }
  return getChildren(metadata, target.parentId)[target.order + 1] ?? null;
}
function getFirstChildBlock(metadata, blockId) {
  if (!blockId) {
    return getRootBlocks(metadata)[0] ?? null;
  }
  return getChildren(metadata, blockId)[0] ?? null;
}
function getMiddleBlock(blocks) {
  if (blocks.length === 0) {
    return null;
  }
  return blocks[Math.floor((blocks.length - 1) / 2)] ?? null;
}
function getPreferredChildBlock(metadata, blockId) {
  if (!blockId) {
    return getMiddleBlock(getRootBlocks(metadata));
  }
  return getMiddleBlock(getChildren(metadata, blockId));
}
function getRootBlocks(metadata) {
  return getChildren(metadata, null);
}
function getDescendantIds(metadata, blockId) {
  const childMap = getChildrenMap(metadata);
  const collected = [];
  const queue = [...childMap.get(blockId) ?? []];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    collected.push(current.id);
    queue.unshift(...childMap.get(current.id) ?? []);
  }
  return collected;
}
function isDescendant(metadata, blockId, maybeDescendantId) {
  let current = getBlock(metadata, maybeDescendantId);
  while (current) {
    if (current.parentId === blockId) {
      return true;
    }
    current = getBlock(metadata, current.parentId);
  }
  return false;
}
function reindexSiblingOrders(metadata, parentId) {
  const siblings = getChildren(metadata, parentId);
  siblings.forEach((block, index) => {
    block.order = index;
  });
}
function getActivePath(metadata, selectedBlockId) {
  const path = [];
  let current = getBlock(metadata, selectedBlockId);
  while (current) {
    path.unshift(current);
    current = getBlock(metadata, current.parentId);
  }
  return path;
}
function buildColumnModels(metadata, selectedBlockId, snippetLength) {
  const columns = [
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
        collapsedPreviewLabels: childBlocks.slice(0, 3).map((child) => extractSnippet(child.content, Math.min(snippetLength, 42)))
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
function setBlockCollapsed(metadata, blockId, collapsed) {
  const next = cloneMetadata(metadata);
  const target = getBlock(next, blockId);
  if (!target) {
    return next;
  }
  target.collapsed = collapsed;
  target.updatedAt = nowIso();
  return next;
}
function toggleBlockCollapsed(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  return setBlockCollapsed(metadata, blockId, !target?.collapsed);
}
function buildLinearOrder(metadata) {
  const childMap = getChildrenMap(metadata);
  const ordered = [];
  const visit = (parentId) => {
    for (const block of childMap.get(parentId) ?? []) {
      ordered.push(block);
      visit(block.id);
    }
  };
  visit(null);
  return ordered;
}
function insertAt(items, index, item) {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}
function blockFactory(parentId, order, content = "", after = DEFAULT_BLOCK_SEPARATOR) {
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
function createEmptyTree() {
  return {
    version: 1,
    prefix: "",
    blocks: [],
    savedAt: nowIso()
  };
}
function ensureSelectedBlock(metadata, selectedBlockId) {
  if (selectedBlockId && getBlock(metadata, selectedBlockId)) {
    return selectedBlockId;
  }
  return getPreferredChildBlock(metadata, null)?.id ?? null;
}
function addRootBlock(metadata) {
  const next = cloneMetadata(metadata);
  const root = blockFactory(null, getRootBlocks(next).length);
  next.blocks.push(root);
  reindexSiblingOrders(next, null);
  return { metadata: next, selectedBlockId: root.id };
}
function addSibling(metadata, selectedBlockId, position) {
  if (!selectedBlockId) {
    return addRootBlock(metadata);
  }
  const selected = getBlock(metadata, selectedBlockId);
  if (!selected) {
    return addRootBlock(metadata);
  }
  const next = cloneMetadata(metadata);
  const anchor = getBlock(next, selectedBlockId);
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
function addChild(metadata, selectedBlockId) {
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
function updateBlockContent(metadata, blockId, content) {
  const next = cloneMetadata(metadata);
  const target = getBlock(next, blockId);
  if (!target) {
    return next;
  }
  target.content = content;
  target.updatedAt = nowIso();
  return next;
}
function moveBlockToParentAtIndex(metadata, blockId, newParentId, rawIndex) {
  const source = getBlock(metadata, blockId);
  if (!source) {
    return metadata;
  }
  if (newParentId === blockId || isDescendant(metadata, blockId, newParentId)) {
    return metadata;
  }
  const next = cloneMetadata(metadata);
  const moving = getBlock(next, blockId);
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
function moveBlockUp(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return metadata;
  }
  return moveBlockToParentAtIndex(metadata, blockId, target.parentId, target.order - 1);
}
function moveBlockDown(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return metadata;
  }
  return moveBlockToParentAtIndex(metadata, blockId, target.parentId, target.order + 2);
}
function moveBlockLeft(metadata, blockId) {
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
function moveBlockRight(metadata, blockId) {
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
function deleteBlockAndLiftChildren(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }
  const next = cloneMetadata(metadata);
  const block = getBlock(next, blockId);
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
function deleteSubtree(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }
  const descendantIds = /* @__PURE__ */ new Set([blockId, ...getDescendantIds(metadata, blockId)]);
  const next = cloneMetadata(metadata);
  const previousSiblings = getChildren(next, target.parentId).filter((block) => !descendantIds.has(block.id));
  next.blocks = next.blocks.filter((block) => !descendantIds.has(block.id));
  previousSiblings.forEach((block, index) => {
    block.order = index;
  });
  const selectedBlockId = previousSiblings[target.order]?.id ?? previousSiblings[target.order - 1]?.id ?? ensureSelectedBlock(next, target.parentId);
  return { metadata: next, selectedBlockId };
}
function duplicateBlock(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }
  const next = cloneMetadata(metadata);
  const original = getBlock(next, blockId);
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
function duplicateSubtree(metadata, blockId) {
  const target = getBlock(metadata, blockId);
  if (!target) {
    return { metadata, selectedBlockId: ensureSelectedBlock(metadata, null) };
  }
  const next = cloneMetadata(metadata);
  const original = getBlock(next, blockId);
  const descendantIds = [blockId, ...getDescendantIds(next, blockId)];
  const originals = descendantIds.map((id) => getBlock(next, id)).filter((block) => Boolean(block));
  const idMap = /* @__PURE__ */ new Map();
  const timestamp = nowIso();
  for (const block of originals) {
    idMap.set(block.id, generateBlockId());
  }
  const duplicates = originals.map((block) => ({
    ...deepClone(block),
    id: idMap.get(block.id),
    parentId: block.parentId && idMap.has(block.parentId) ? idMap.get(block.parentId) : block.parentId,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
  const rootDuplicate = duplicates.find((block) => block.id === idMap.get(blockId));
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

// src/storage/serializer.ts
function normalizeMetadata(metadata) {
  return {
    ...metadata,
    version: 1,
    prefix: metadata.prefix ?? "",
    blocks: metadata.blocks.map((block) => ({
      ...block,
      after: block.after ?? DEFAULT_BLOCK_SEPARATOR
    }))
  };
}
function countLines(input) {
  return input.split("\n").length - 1;
}
function linearizeTree(metadata) {
  const normalized = normalizeMetadata(metadata);
  const ordered = buildLinearOrder(normalized);
  const parts = [normalized.prefix];
  const locations = /* @__PURE__ */ new Map();
  let cursor = normalized.prefix.length;
  let line = countLines(normalized.prefix);
  for (const block of ordered) {
    parts.push(block.content);
    const start = cursor;
    const end = cursor + block.content.length;
    locations.set(block.id, { start, end, line });
    cursor = end;
    line += countLines(block.content);
    parts.push(block.after);
    cursor += block.after.length;
    line += countLines(block.after);
  }
  return {
    body: parts.join(""),
    locations
  };
}
function encodeMetadata(metadata) {
  const payload = JSON.stringify(normalizeMetadata(metadata));
  return Buffer.from(payload, "utf8").toString("base64");
}
function decodeMetadata(encoded) {
  try {
    const json = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
    return normalizeMetadata(JSON.parse(json));
  } catch {
    return null;
  }
}
function buildMetadataBlock(metadata, style) {
  const encoded = encodeMetadata(metadata);
  if (style === "compact") {
    return `<!-- ${METADATA_MARKER}:${encoded} -->`;
  }
  return `<!-- ${METADATA_MARKER}
${encoded}
-->`;
}
function parseMetadataBlock(raw) {
  const compactMatch = raw.match(new RegExp(`<!--\\s*${METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([A-Za-z0-9+/=\\r\\n_-]+)\\s*-->`));
  if (compactMatch?.[1]) {
    return decodeMetadata(compactMatch[1]);
  }
  const multilineMatch = raw.match(new RegExp(`<!--\\s*${METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)\\n-->`));
  if (multilineMatch?.[1]) {
    return decodeMetadata(multilineMatch[1]);
  }
  return null;
}
function computeBodyHash(body) {
  return hashString(normalizeNewlines(body));
}
function applyBodyHash(metadata) {
  const linearized = linearizeTree(metadata);
  return {
    ...normalizeMetadata(metadata),
    lastLinearHash: computeBodyHash(linearized.body),
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/storage/document.ts
var FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
var METADATA_MARKER_PATTERN = METADATA_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var COMPACT_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}:[A-Za-z0-9+/=\\r\\n_-]+\\s*-->\\s*$`);
var MULTILINE_PATTERN = new RegExp(`\\n?<!--\\s*${METADATA_MARKER_PATTERN}\\s*\\n[\\s\\S]*?\\n-->\\s*$`);
function parseBranchDocument(text) {
  const normalized = normalizeNewlines(text);
  const frontmatterMatch = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter = frontmatterMatch?.[0] ?? "";
  let remaining = normalized.slice(frontmatter.length);
  let metadataRaw = "";
  const multilineMatch = remaining.match(MULTILINE_PATTERN);
  const compactMatch = remaining.match(COMPACT_PATTERN);
  const metadataMatch = multilineMatch && (!compactMatch || multilineMatch.index >= compactMatch.index) ? multilineMatch : compactMatch;
  if (metadataMatch && metadataMatch.index !== void 0) {
    metadataRaw = metadataMatch[0].trimStart();
    remaining = remaining.slice(0, metadataMatch.index);
  }
  const metadata = metadataRaw ? parseMetadataBlock(metadataRaw) : null;
  return {
    frontmatter,
    body: remaining,
    metadata,
    metadataRaw
  };
}
function buildBranchDocument(frontmatter, body, metadata, metadataStyle) {
  const sections = [];
  if (frontmatter) {
    sections.push(frontmatter.endsWith("\n") ? frontmatter : `${frontmatter}
`);
  }
  sections.push(body);
  if (metadata) {
    const metadataBlock = buildMetadataBlock(metadata, metadataStyle);
    sections.push("\n");
    sections.push(metadataBlock);
    sections.push("\n");
  }
  return sections.join("");
}

// src/view/ArborView.ts
var import_obsidian2 = require("obsidian");

// src/history.ts
var BranchHistory = class {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }
  push(label, metadata, selectedBlockId) {
    this.undoStack.push({
      label,
      metadata: cloneMetadata(metadata),
      selectedBlockId
    });
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }
  undo(current) {
    const previous = this.undoStack.pop() ?? null;
    if (!previous) {
      return null;
    }
    this.redoStack.push({
      label: current.label,
      metadata: cloneMetadata(current.metadata),
      selectedBlockId: current.selectedBlockId
    });
    return previous;
  }
  redo(current) {
    const next = this.redoStack.pop() ?? null;
    if (!next) {
      return null;
    }
    this.undoStack.push({
      label: current.label,
      metadata: cloneMetadata(current.metadata),
      selectedBlockId: current.selectedBlockId
    });
    return next;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
};

// src/storage/reconcile.ts
function buildImportedBlock(content, order) {
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
function extractHeadingSections(body) {
  const headings = [];
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
  const sections = [];
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
function importBodyToMetadata(body) {
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
function loadImportedBranchDocument(text) {
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

// src/view/ArborView.ts
var ArborConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, titleText, bodyText, confirmText) {
    super(app);
    this.titleText = titleText;
    this.bodyText = bodyText;
    this.confirmText = confirmText;
    this.resolved = false;
    this.resolver = () => void 0;
  }
  waitForChoice() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("arbor-confirm-modal");
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.bodyText });
    const actionsEl = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new import_obsidian2.ButtonComponent(actionsEl).setButtonText("Cancel").onClick(() => this.finish(false));
    new import_obsidian2.ButtonComponent(actionsEl).setButtonText(this.confirmText).setWarning().setCta().onClick(() => this.finish(true));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolver(false);
    }
  }
  finish(value) {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver(value);
    this.close();
  }
};
var ArborView = class extends import_obsidian2.FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
    this.history = new BranchHistory();
    this.state = null;
    this.editingSession = null;
    this.dragState = null;
    this.renderFrame = null;
    this.layoutFrame = null;
    this.blurCommitTimer = null;
    this.isPersisting = false;
    this.pendingFocusBlockId = null;
    this.pendingScrollBlockId = null;
    this.lastViewportScroll = { left: 0, top: 0 };
    this.frameEl = null;
    this.breadcrumbsEl = null;
    this.zoomIndicatorEl = null;
    this.viewMenuButtonEl = null;
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
    this.bannerEl = null;
    this.bodyEl = null;
    this.columnsStageEl = null;
    this.columnsViewportEl = null;
    this.columnsEl = null;
    this.previewPaneEl = null;
    this.previewMiniMapEl = null;
    this.previewContentEl = null;
    this.rootEmptyEl = null;
    this.renderedPreviewSignature = "";
    this.previewSearchQuery = "";
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.columnElementMap = /* @__PURE__ */ new Map();
    this.currentColumnMap = /* @__PURE__ */ new Map();
    this.pendingFocusFrame = null;
    this.horizontalScrollFrame = null;
    this.breadcrumbScrollFrame = null;
    this.zoomPersistTimer = null;
    this.zoomIndicatorTimer = null;
    this.dragPreviewEl = null;
    this.dragPreviewPoint = null;
    this.dragPreviewOffset = { x: 0, y: 0 };
    this.dragPreviewFrame = null;
    this.transparentDragImageEl = null;
    this.lastCardPointerPosition = null;
    this.viewportPanState = null;
    this.documentDragOverHandler = (event) => this.handleDocumentDragOver(event);
    this.allowNoFile = false;
  }
  getViewType() {
    return VIEW_TYPE_ARBOR;
  }
  getDisplayText() {
    return this.file ? `Arbor: ${this.file.basename}` : "Arbor";
  }
  getIcon() {
    return "git-fork";
  }
  async onLoadFile(file) {
    const text = await this.app.vault.cachedRead(file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    const selectedBlockId = ensureSelectedBlock(loaded.metadata, this.state?.selectedBlockId ?? null);
    this.state = {
      frontmatter: parsed.frontmatter,
      metadata: loaded.metadata,
      selectedBlockId,
      staleMetadata: loaded.staleMetadata,
      origin: loaded.origin,
      linearized: linearizeTree(loaded.metadata)
    };
    this.plugin.rememberManagedNote(file.path);
    if (loaded.origin === "reconciled") {
      new import_obsidian2.Notice("Arbor rebuilt the tree from the visible markdown body to avoid losing plain-editor changes.");
    }
    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.previewSearchQuery = "";
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.pendingFocusBlockId = selectedBlockId;
    this.pendingScrollBlockId = selectedBlockId;
    this.render();
  }
  async onUnloadFile() {
    await this.commitEditIfNeeded();
    this.resetViewState();
  }
  clear() {
    this.clearBlurCommitTimer();
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    this.clearBreadcrumbScrollFrame();
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.state = null;
    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.teardownShell();
  }
  async onClose() {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    this.clearBreadcrumbScrollFrame();
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    await this.commitEditIfNeeded();
    return super.onClose();
  }
  async handleFileModified(file) {
    if (!this.file || file.path !== this.file.path) {
      return;
    }
    if (this.plugin.consumeOwnWrite(file.path) || this.isPersisting) {
      return;
    }
    if (this.editingSession) {
      new import_obsidian2.Notice("The note changed on disk while a block was being edited. Finish or cancel the card edit before reloading.");
      return;
    }
    await this.onLoadFile(file);
  }
  async refreshView() {
    if (!this.file) {
      return;
    }
    const text = await this.app.vault.cachedRead(this.file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    this.state = {
      frontmatter: parsed.frontmatter,
      metadata: loaded.metadata,
      selectedBlockId: ensureSelectedBlock(loaded.metadata, this.state?.selectedBlockId ?? null),
      staleMetadata: loaded.staleMetadata,
      origin: loaded.origin,
      linearized: linearizeTree(loaded.metadata)
    };
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    this.render();
  }
  selectBlock(blockId, options) {
    if (!this.state) {
      return;
    }
    const nextSelectedBlockId = ensureSelectedBlock(this.state.metadata, blockId);
    if (this.editingSession && this.editingSession.blockId !== nextSelectedBlockId) {
      const pendingSession = this.editingSession;
      void this.commitEditingSession(pendingSession).then(() => {
        if (this.state) {
          this.selectBlock(nextSelectedBlockId, options);
        }
      });
      return;
    }
    const selectionChanged = this.state.selectedBlockId !== nextSelectedBlockId;
    this.state.selectedBlockId = nextSelectedBlockId;
    if (options?.focus) {
      this.pendingFocusBlockId = this.state.selectedBlockId;
    }
    if (selectionChanged) {
      this.pendingScrollBlockId = this.state.selectedBlockId;
    }
    if (!selectionChanged && !options?.focus) {
      return;
    }
    if (!selectionChanged && options?.focus && this.state.selectedBlockId) {
      const card = this.contentEl.querySelector(`.arbor-card[data-block-id="${this.state.selectedBlockId}"]`);
      card?.focus({ preventScroll: true });
      return;
    }
    this.render();
  }
  async createRootBlock() {
    await this.applyMutation("Create root block", (metadata) => addRootBlock(metadata), true);
  }
  async createSiblingAbove() {
    await this.applyMutation("Create sibling above", (metadata) => addSibling(metadata, this.state?.selectedBlockId ?? null, "above"), true);
  }
  async createSiblingBelow() {
    await this.applyMutation("Create sibling below", (metadata) => addSibling(metadata, this.state?.selectedBlockId ?? null, "below"), true);
  }
  async createChild() {
    await this.applyMutation("Create child", (metadata) => addChild(metadata, this.state?.selectedBlockId ?? null), true);
  }
  async createParentLevelBlock() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
    if (!parent) {
      return;
    }
    await this.applyMutation("Create parent-level block", (metadata) => addSibling(metadata, parent.id, "below"), true);
  }
  async moveSelectedUp() {
    await this.applyMutation("Move block up", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockUp(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }
  async moveSelectedDown() {
    await this.applyMutation("Move block down", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockDown(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }
  async moveSelectedLeft() {
    await this.applyMutation("Move block left", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockLeft(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }
  async moveSelectedRight() {
    await this.applyMutation("Move block right", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockRight(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }
  async deleteSelectedBlock() {
    await this.applyMutation("Delete block", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? deleteBlockAndLiftChildren(metadata, selectedBlockId) : { metadata, selectedBlockId };
    });
  }
  async deleteSelectedSubtree() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    const selectedBlock = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!selectedBlock) {
      return;
    }
    const descendantCount = getDescendantIds(this.state.metadata, selectedBlock.id).length;
    const totalBlocks = descendantCount + 1;
    const blockLabel = extractPathLabel(
      selectedBlock.content,
      {
        preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
        fallback: this.plugin.settings.breadcrumbLabelFallback
      }
    ) || "this block";
    const confirmed = await new ArborConfirmModal(
      this.app,
      "Delete subtree?",
      `Delete "${blockLabel}" and ${totalBlocks - 1} descendant ${descendantCount === 1 ? "block" : "blocks"}?`,
      "Delete subtree"
    ).waitForChoice();
    if (!confirmed) {
      return;
    }
    await this.applyMutation("Delete subtree", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? deleteSubtree(metadata, selectedBlockId) : { metadata, selectedBlockId };
    });
  }
  async duplicateSelectedBlock() {
    await this.applyMutation("Duplicate block", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? duplicateBlock(metadata, selectedBlockId) : { metadata, selectedBlockId };
    }, true);
  }
  async duplicateSelectedSubtree() {
    await this.applyMutation("Duplicate subtree", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? duplicateSubtree(metadata, selectedBlockId) : { metadata, selectedBlockId };
    }, true);
  }
  toggleEditMode() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    if (this.editingSession?.blockId === this.state.selectedBlockId) {
      void this.commitEditingSession();
      return;
    }
    const block = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!block) {
      return;
    }
    this.editingSession = {
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin: "card"
    };
    this.render();
  }
  async toggleCollapsedState(blockId) {
    await this.applyMutation("Toggle branch collapse", (metadata) => ({
      metadata: toggleBlockCollapsed(metadata, blockId),
      selectedBlockId: blockId
    }));
  }
  async setCollapsedState(blockId, collapsed) {
    await this.applyMutation(collapsed ? "Collapse branch" : "Expand branch", (metadata) => ({
      metadata: setBlockCollapsed(metadata, blockId, collapsed),
      selectedBlockId: blockId
    }));
  }
  beginEditingBlock(blockId, origin = "card") {
    if (!this.state) {
      return;
    }
    const nextSelectedBlockId = ensureSelectedBlock(this.state.metadata, blockId);
    if (this.editingSession && this.editingSession.blockId !== nextSelectedBlockId) {
      const pendingSession = this.editingSession;
      void this.commitEditingSession(pendingSession).then(() => {
        if (this.state && nextSelectedBlockId) {
          this.beginEditingBlock(nextSelectedBlockId);
        }
      });
      return;
    }
    const block = getBlock(this.state.metadata, nextSelectedBlockId);
    if (!block) {
      return;
    }
    if (this.state.selectedBlockId !== nextSelectedBlockId) {
      this.pendingScrollBlockId = nextSelectedBlockId;
    }
    this.stopHorizontalScrollMotion();
    this.state.selectedBlockId = nextSelectedBlockId;
    this.pendingFocusBlockId = nextSelectedBlockId;
    this.editingSession = {
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin
    };
    this.render();
  }
  selectParentBlock() {
    if (!this.state) {
      return;
    }
    const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
    if (parent) {
      this.selectBlock(parent.id, { focus: true });
    }
  }
  selectPreviousSiblingBlock() {
    if (!this.state) {
      return;
    }
    const sibling = getPreviousSibling(this.state.metadata, this.state.selectedBlockId);
    if (sibling) {
      this.selectBlock(sibling.id, { focus: true });
    }
  }
  selectNextSiblingBlock() {
    if (!this.state) {
      return;
    }
    const sibling = getNextSibling(this.state.metadata, this.state.selectedBlockId);
    if (sibling) {
      this.selectBlock(sibling.id, { focus: true });
    }
  }
  selectFirstChildBlock() {
    if (!this.state) {
      return;
    }
    const child = getFirstChildBlock(this.state.metadata, this.state.selectedBlockId);
    if (child) {
      this.selectBlock(child.id, { focus: true });
    }
  }
  selectPreferredChildBlock() {
    if (!this.state) {
      return;
    }
    const child = getPreferredChildBlock(this.state.metadata, this.state.selectedBlockId);
    if (child) {
      this.selectBlock(child.id, { focus: true });
    }
  }
  selectFirstSiblingBlock() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    const current = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!current) {
      return;
    }
    const firstSibling = getChildren(this.state.metadata, current.parentId)[0];
    if (firstSibling) {
      this.selectBlock(firstSibling.id, { focus: true });
    }
  }
  selectLastSiblingBlock() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    const current = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!current) {
      return;
    }
    const siblings = getChildren(this.state.metadata, current.parentId);
    const lastSibling = siblings[siblings.length - 1];
    if (lastSibling) {
      this.selectBlock(lastSibling.id, { focus: true });
    }
  }
  openActiveBlockMenu() {
    if (!this.state?.selectedBlockId) {
      return;
    }
    const activeCard = this.contentEl.querySelector(`.arbor-card.is-active`);
    const menu = this.buildBlockMenu(this.state.selectedBlockId);
    if (activeCard) {
      const rect = activeCard.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 12, y: rect.top + 20 }, activeCard.ownerDocument);
      return;
    }
    menu.showAtPosition({ x: 160, y: 160 }, this.contentEl.ownerDocument);
  }
  async revealCurrentBlockInMarkdown() {
    if (!this.file || !this.state?.selectedBlockId) {
      return;
    }
    await this.commitEditIfNeeded();
    const location = this.state.linearized.locations.get(this.state.selectedBlockId);
    if (!location) {
      return;
    }
    const existingLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view;
      return view.file?.path === this.file?.path;
    }) ?? this.app.workspace.getLeaf(false);
    this.plugin.suppressAutoOpenOnce(this.file.path);
    await existingLeaf.openFile(this.file);
    const markdownView = existingLeaf.view;
    if (markdownView.editor) {
      markdownView.editor.setCursor({ line: location.line, ch: 0 });
      markdownView.editor.focus();
    }
    this.app.workspace.setActiveLeaf(existingLeaf, true, true);
  }
  async rebuildLinearMarkdownFromTree() {
    await this.commitEditIfNeeded();
    await this.persistState("Rebuild linear markdown from tree");
  }
  async rebuildTreeFromMetadata() {
    if (!this.file || !this.state) {
      return;
    }
    await this.commitEditIfNeeded();
    const text = await this.app.vault.cachedRead(this.file);
    const parsed = parseBranchDocument(text);
    if (!parsed.metadata && !this.state.staleMetadata) {
      new import_obsidian2.Notice("No stored Arbor metadata was found in this note.");
      return;
    }
    const restored = cloneMetadata(parsed.metadata ?? this.state.staleMetadata ?? createEmptyTree());
    this.history.push("Rebuild tree from metadata", this.state.metadata, this.state.selectedBlockId);
    this.state.metadata = restored;
    this.state.selectedBlockId = ensureSelectedBlock(restored, this.state.selectedBlockId);
    this.state.linearized = linearizeTree(restored);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Rebuild tree from metadata");
    this.render();
  }
  async undo() {
    if (!this.state || !this.history.canUndo()) {
      return;
    }
    await this.commitEditIfNeeded();
    const previous = this.history.undo(this.currentHistorySnapshot("Current state"));
    if (!previous) {
      return;
    }
    this.state.metadata = cloneMetadata(previous.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(previous.metadata, previous.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Undo");
    this.render();
  }
  async redo() {
    if (!this.state || !this.history.canRedo()) {
      return;
    }
    await this.commitEditIfNeeded();
    const next = this.history.redo(this.currentHistorySnapshot("Current state"));
    if (!next) {
      return;
    }
    this.state.metadata = cloneMetadata(next.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(next.metadata, next.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Redo");
    this.render();
  }
  render() {
    if (this.renderFrame !== null) {
      window.cancelAnimationFrame(this.renderFrame);
    }
    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = null;
      void this.renderNow();
    });
  }
  async renderNow() {
    const { contentEl } = this;
    contentEl.addClass("arbor-view");
    this.applyCssVars(contentEl);
    this.applyViewClasses(contentEl);
    if (!this.file || !this.state) {
      this.viewContext = null;
      this.teardownShell();
      contentEl.createDiv({ cls: "arbor-empty", text: "Open a markdown note to use Arbor." });
      return;
    }
    this.ensureShell();
    this.syncViewportEdgeFades();
    this.syncBreadcrumbs();
    this.viewContext = this.buildViewContext();
    this.syncSearchOverlay(this.viewContext);
    this.syncBanner();
    const preservedSceneWidth = this.armSceneWidthForPendingScroll();
    const columns = buildColumnModels(this.state.metadata, this.state.selectedBlockId, this.plugin.settings.previewSnippetLength);
    this.currentColumnMap.clear();
    columns.forEach((column) => this.currentColumnMap.set(column.key, column));
    await this.syncColumns(columns, this.viewContext);
    await this.syncPreview(this.viewContext);
    this.applyPendingFocusAndScroll(preservedSceneWidth);
    this.syncHoverLinkedState();
  }
  ensureShell() {
    if (this.frameEl && this.columnsStageEl && this.columnsViewportEl && this.columnsEl && this.bodyEl && this.breadcrumbsEl && this.bannerEl) {
      return;
    }
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("arbor-view");
    this.applyViewClasses(contentEl);
    this.frameEl = contentEl.createDiv({ cls: "arbor-frame" });
    this.breadcrumbsEl = this.frameEl.createDiv({ cls: "arbor-breadcrumbs" });
    this.zoomIndicatorEl = this.frameEl.createEl("button", {
      cls: "arbor-zoom-indicator",
      attr: {
        type: "button",
        "aria-label": "Reset Arbor zoom to 100%"
      }
    });
    this.zoomIndicatorEl.addEventListener("click", () => this.updateZoomLevel(1));
    this.zoomIndicatorEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.viewMenuButtonEl = this.frameEl.createEl("button", {
      cls: "arbor-view-menu-button",
      attr: {
        type: "button",
        "aria-label": "Open Arbor view menu"
      }
    });
    (0, import_obsidian2.setIcon)(this.viewMenuButtonEl, "sliders-horizontal");
    this.viewMenuButtonEl.addEventListener("click", (event) => this.openViewMenu(event));
    this.viewMenuButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.bannerEl = this.frameEl.createDiv({ cls: "arbor-banner" });
    this.bodyEl = this.frameEl.createDiv({ cls: "arbor-body" });
    this.columnsStageEl = this.bodyEl.createDiv({ cls: "arbor-columns-stage" });
    this.columnsViewportEl = this.columnsStageEl.createDiv({ cls: "arbor-columns-viewport" });
    this.columnsViewportEl.tabIndex = 0;
    this.columnsViewportEl.scrollLeft = this.lastViewportScroll.left;
    this.columnsViewportEl.scrollTop = this.lastViewportScroll.top;
    this.columnsViewportEl.addEventListener("scroll", () => {
      this.lastViewportScroll = {
        left: this.columnsViewportEl?.scrollLeft ?? 0,
        top: this.columnsViewportEl?.scrollTop ?? 0
      };
      this.syncViewportEdgeFades();
    }, { passive: true });
    this.columnsViewportEl.addEventListener("dragover", (event) => this.handleViewportDragOver(event));
    this.columnsViewportEl.addEventListener("wheel", (event) => this.handleViewportWheel(event, this.columnsViewportEl), { passive: false });
    this.columnsViewportEl.addEventListener("keydown", (event) => this.handleViewportKeyDown(event));
    this.columnsViewportEl.addEventListener("pointerdown", (event) => this.handleViewportPointerDown(event, this.columnsViewportEl));
    this.columnsViewportEl.addEventListener("pointermove", (event) => this.handleViewportPointerMove(event, this.columnsViewportEl));
    this.columnsViewportEl.addEventListener("pointerup", (event) => this.handleViewportPointerUp(event, this.columnsViewportEl));
    this.columnsViewportEl.addEventListener("pointercancel", (event) => this.handleViewportPointerUp(event, this.columnsViewportEl));
    this.columnsViewportEl.addEventListener("lostpointercapture", (event) => this.handleViewportPointerCaptureLost(event, this.columnsViewportEl));
    this.columnsEl = this.columnsViewportEl.createDiv({ cls: "arbor-columns" });
    const viewportFadesEl = this.columnsStageEl.createDiv({ cls: "arbor-viewport-fades" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-top" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-right" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-bottom" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-left" });
    this.syncZoomIndicator();
  }
  teardownShell() {
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.contentEl.empty();
    this.frameEl = null;
    this.breadcrumbsEl = null;
    this.zoomIndicatorEl = null;
    this.viewMenuButtonEl = null;
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
    this.bannerEl = null;
    this.bodyEl = null;
    this.columnsStageEl = null;
    this.columnsViewportEl = null;
    this.columnsEl = null;
    this.previewPaneEl = null;
    this.previewMiniMapEl = null;
    this.previewContentEl = null;
    this.rootEmptyEl = null;
    this.renderedPreviewSignature = "";
    this.columnElementMap.clear();
    this.currentColumnMap.clear();
  }
  syncBreadcrumbs() {
    if (!this.breadcrumbsEl || !this.state) {
      return;
    }
    this.breadcrumbsEl.style.display = this.plugin.settings.showBreadcrumb ? "" : "none";
    if (!this.plugin.settings.showBreadcrumb) {
      return;
    }
    this.breadcrumbsEl.empty();
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (path.length === 0) {
      this.breadcrumbsEl.createSpan({ cls: "arbor-breadcrumb-empty", text: this.file?.basename ?? "Arbor" });
      return;
    }
    this.renderBreadcrumbItems(this.breadcrumbsEl, path);
    this.syncBreadcrumbScroll();
  }
  getBreadcrumbLabel(markdown) {
    return extractPathLabel(markdown, {
      preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
      fallback: this.plugin.settings.breadcrumbLabelFallback,
      maxWords: 4,
      maxLength: 34
    });
  }
  renderBreadcrumbItems(container, path) {
    path.forEach((block, index) => {
      const button = container.createEl("button", {
        cls: index === path.length - 1 ? "is-active" : "",
        text: this.getBreadcrumbLabel(block.content)
      });
      button.style.setProperty("--bw-crumb-index", String(index));
      button.addEventListener("click", () => this.selectBlock(block.id, { focus: true }));
      if (this.plugin.settings.showBreadcrumbFlow && index < path.length - 1) {
        const connector = container.createSpan({ cls: "arbor-breadcrumb-connector" });
        connector.style.setProperty("--bw-crumb-index", String(index + 0.45));
      }
    });
  }
  syncBreadcrumbScroll() {
    if (!this.breadcrumbsEl) {
      return;
    }
    this.clearBreadcrumbScrollFrame();
    this.breadcrumbScrollFrame = window.requestAnimationFrame(() => {
      this.breadcrumbScrollFrame = null;
      const breadcrumbsEl = this.breadcrumbsEl;
      if (!breadcrumbsEl || breadcrumbsEl.scrollWidth <= breadcrumbsEl.clientWidth + 1) {
        return;
      }
      const activeButton = breadcrumbsEl.querySelector("button.is-active") ?? breadcrumbsEl.querySelector("button:last-of-type");
      if (!activeButton) {
        return;
      }
      const breadcrumbsRect = breadcrumbsEl.getBoundingClientRect();
      const activeRect = activeButton.getBoundingClientRect();
      const rightInset = (this.zoomIndicatorEl?.offsetWidth ?? 0) + (this.viewMenuButtonEl?.offsetWidth ?? 0) + 32;
      const leftInset = 28;
      const isFullyVisible = activeRect.left >= breadcrumbsRect.left + leftInset && activeRect.right <= breadcrumbsRect.right - rightInset;
      if (isFullyVisible) {
        return;
      }
      const maxScrollLeft = Math.max(0, breadcrumbsEl.scrollWidth - breadcrumbsEl.clientWidth);
      const activeCenter = breadcrumbsEl.scrollLeft + (activeRect.left - breadcrumbsRect.left) + activeRect.width / 2;
      const targetLeft = Math.max(
        0,
        Math.min(
          activeCenter - (breadcrumbsEl.clientWidth - rightInset - leftInset) / 2 - leftInset,
          maxScrollLeft
        )
      );
      breadcrumbsEl.scrollTo({
        left: targetLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }
  syncBanner() {
    if (!this.bannerEl || !this.state) {
      return;
    }
    const showBanner = this.state.origin === "reconciled";
    this.bannerEl.style.display = showBanner ? "" : "none";
    if (showBanner) {
      this.bannerEl.empty();
      this.bannerEl.createSpan({
        text: "This note changed in plain markdown mode. The branch tree was rebuilt from the visible note body."
      });
    }
  }
  buildViewContext() {
    const metadata = this.state.metadata;
    const selectedBlockId = this.state.selectedBlockId;
    const activePathIds = new Set(getActivePath(metadata, selectedBlockId).map((item) => item.id));
    const selectableChildIds = new Set(
      selectedBlockId ? getChildren(metadata, selectedBlockId).map((item) => item.id) : []
    );
    const searchQuery = this.previewSearchQuery.trim().toLocaleLowerCase();
    const searchMatchedIds = /* @__PURE__ */ new Set();
    const searchRelatedIds = /* @__PURE__ */ new Set();
    if (searchQuery.length > 0) {
      for (const block of metadata.blocks) {
        const pathLabel = this.buildPreviewPathLabels(block.id).join(" ");
        const haystack = `${block.content}
${pathLabel}`.toLocaleLowerCase();
        if (!haystack.includes(searchQuery)) {
          continue;
        }
        searchMatchedIds.add(block.id);
        getActivePath(metadata, block.id).forEach((pathBlock) => searchRelatedIds.add(pathBlock.id));
      }
    }
    const previewVisibleIds = searchQuery.length > 0 ? /* @__PURE__ */ new Set([...searchMatchedIds, ...searchRelatedIds]) : null;
    const overviewNodes = buildLinearOrder(metadata).map((block) => {
      const depth = getActivePath(metadata, block.id).length - 1;
      const childCount = getChildren(metadata, block.id).length;
      return {
        id: block.id,
        parentId: block.parentId,
        depth,
        label: extractPathLabel(block.content, {
          preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
          fallback: this.plugin.settings.breadcrumbLabelFallback,
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
      overviewNodes
    };
  }
  syncSearchOverlay(context) {
    if (!this.frameEl) {
      return;
    }
    if (!this.isSearchOpen) {
      this.searchOverlayEl?.remove();
      this.searchOverlayEl = null;
      this.searchDialogEl = null;
      this.searchInputEl = null;
      this.searchMetaEl = null;
      this.searchClearEl = null;
      return;
    }
    if (!this.searchOverlayEl) {
      this.searchOverlayEl = this.frameEl.createDiv({ cls: "arbor-search-overlay" });
      this.searchOverlayEl.addEventListener("mousedown", (event) => {
        if (event.target === this.searchOverlayEl) {
          this.closeSearchOverlay();
        }
      });
      this.searchDialogEl = this.searchOverlayEl.createDiv({ cls: "arbor-search-dialog" });
      this.searchInputEl = this.searchDialogEl.createEl("input", {
        cls: "arbor-search-input",
        attr: {
          type: "search",
          placeholder: "Search blocks and path"
        }
      });
      this.searchInputEl.addEventListener("input", () => {
        this.previewSearchQuery = this.searchInputEl?.value ?? "";
        this.render();
      });
      this.searchInputEl.addEventListener("keydown", (event) => {
        if (this.handleSearchShortcut(event)) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeSearchOverlay();
          return;
        }
        if (event.key === "Enter" && this.viewContext) {
          const firstMatch = this.viewContext.overviewNodes.find((node) => node.isSearchMatch);
          if (firstMatch) {
            event.preventDefault();
            this.selectBlock(firstMatch.id, { focus: true });
          }
        }
      });
      const footerEl = this.searchDialogEl.createDiv({ cls: "arbor-search-footer" });
      this.searchMetaEl = footerEl.createDiv({ cls: "arbor-search-meta", text: "Search blocks and path" });
      this.searchClearEl = footerEl.createEl("button", {
        cls: "arbor-search-clear",
        text: "Clear",
        attr: {
          type: "button",
          "aria-label": "Clear Arbor search"
        }
      });
      this.searchClearEl.addEventListener("click", () => {
        this.previewSearchQuery = "";
        this.render();
        this.searchInputEl?.focus();
      });
    }
    if (this.searchInputEl && this.searchInputEl.value !== this.previewSearchQuery) {
      this.searchInputEl.value = this.previewSearchQuery;
    }
    if (this.searchMetaEl && this.searchClearEl) {
      const matchCount = context.searchMatchedIds.size;
      this.searchMetaEl.setText(
        context.searchQuery.length > 0 ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "Search blocks and path"
      );
      this.searchClearEl.toggleClass("is-visible", context.searchQuery.length > 0);
      this.searchClearEl.toggleAttribute("disabled", context.searchQuery.length === 0);
    }
    if (this.shouldFocusSearchInput) {
      this.shouldFocusSearchInput = false;
      window.requestAnimationFrame(() => {
        this.searchInputEl?.focus();
        this.searchInputEl?.select();
      });
    }
  }
  async syncColumns(columns, context) {
    if (!this.columnsEl) {
      return;
    }
    if (columns.length === 1 && columns[0].blocks.length === 0) {
      this.columnElementMap.forEach((columnEl) => columnEl.remove());
      this.columnElementMap.clear();
      this.columnsEl.empty();
      this.rootEmptyEl = this.columnsEl.createDiv({ cls: "arbor-root-empty" });
      this.rootEmptyEl.createEl("p", { text: "This note has no branch blocks yet." });
      const button = this.rootEmptyEl.createEl("button", { text: "Create root block" });
      button.addEventListener("click", () => void this.createRootBlock());
      return;
    }
    this.rootEmptyEl?.remove();
    this.rootEmptyEl = null;
    const desiredKeys = new Set(columns.map((column) => column.key));
    for (const [key, columnEl] of this.columnElementMap) {
      if (!desiredKeys.has(key)) {
        columnEl.remove();
        this.columnElementMap.delete(key);
      }
    }
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const columnEl = this.ensureColumnElement(column.key);
      columnEl.dataset.columnKey = column.key;
      columnEl.dataset.parentId = column.parentId ?? "";
      const siblingAtIndex = this.columnsEl.children[index] ?? null;
      if (siblingAtIndex !== columnEl) {
        this.columnsEl.insertBefore(columnEl, siblingAtIndex);
      }
      await this.syncColumn(columnEl, column, context);
    }
  }
  ensureColumnElement(columnKey) {
    const existing = this.columnElementMap.get(columnKey);
    if (existing) {
      return existing;
    }
    const columnEl = this.columnsEl.createDiv({ cls: "arbor-column" });
    columnEl.dataset.columnKey = columnKey;
    const cardsEl = columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.addEventListener("dragover", (event) => this.handleColumnDragOver(event));
    cardsEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const column = this.currentColumnMap.get(cardsEl.dataset.columnKey ?? "");
      if (column) {
        void this.applyDrop(column);
      }
    });
    this.columnElementMap.set(columnKey, columnEl);
    return columnEl;
  }
  async syncColumn(columnEl, column, context) {
    const cardsEl = columnEl.querySelector(".arbor-card-list") ?? columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.dataset.columnKey = column.key;
    const nextParentId = column.parentId ?? "";
    const parentChanged = (cardsEl.dataset.parentId ?? "") !== nextParentId;
    cardsEl.dataset.parentId = nextParentId;
    if (parentChanged) {
      cardsEl.addClass("is-rebinding");
      cardsEl.style.transform = "";
    }
    if (column.collapsedBlockId) {
      cardsEl.empty();
      const summary = cardsEl.createDiv({ cls: "arbor-column-summary" });
      summary.dataset.nodeKey = `collapsed-${column.key}`;
      summary.createDiv({
        cls: "arbor-column-summary-title",
        text: `${column.collapsedCount ?? 0} hidden block${(column.collapsedCount ?? 0) === 1 ? "" : "s"}`
      });
      if ((column.collapsedPreviewLabels?.length ?? 0) > 0) {
        const labelsEl = summary.createDiv({ cls: "arbor-column-summary-labels" });
        column.collapsedPreviewLabels?.forEach((label) => {
          labelsEl.createSpan({ cls: "arbor-column-summary-chip", text: label });
        });
      }
      const expandButton = summary.createEl("button", {
        cls: "arbor-column-summary-action",
        text: "Expand branch",
        attr: { type: "button" }
      });
      expandButton.addEventListener("click", () => void this.setCollapsedState(column.collapsedBlockId, false));
      return;
    }
    if (column.blocks.length === 0) {
      cardsEl.empty();
      const empty = cardsEl.createDiv({ cls: "arbor-column-empty" });
      empty.dataset.nodeKey = `empty-${column.key}`;
      empty.setText(column.parentId ? "No child blocks yet." : "No root blocks yet.");
      empty.toggleClass("is-selectable-context", column.parentId === this.state?.selectedBlockId);
      if (column.parentId) {
        empty.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.selectBlock(column.parentId);
          const menu = new import_obsidian2.Menu();
          menu.addItem(
            (item) => item.setTitle("Create child block").setIcon("arrow-right").onClick(() => void this.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }
    const existingChildren = /* @__PURE__ */ new Map();
    Array.from(cardsEl.children).forEach((child) => {
      if (child instanceof HTMLElement && child.dataset.nodeKey) {
        existingChildren.set(child.dataset.nodeKey, child);
      }
    });
    const desiredNodes = [];
    for (let index = 0; index < column.blocks.length; index += 1) {
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index) {
        desiredNodes.push(this.ensureIndicatorNode(existingChildren, `indicator-${column.key}-${index}`));
      }
      const block = column.blocks[index];
      const card = this.ensureCardNode(existingChildren, block.id);
      await this.syncCardNode(card, block, column, index, context);
      desiredNodes.push(card);
    }
    if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === column.blocks.length) {
      desiredNodes.push(this.ensureIndicatorNode(existingChildren, `indicator-${column.key}-${column.blocks.length}`));
    }
    desiredNodes.forEach((node, index) => {
      const siblingAtIndex = cardsEl.children[index] ?? null;
      if (siblingAtIndex !== node) {
        cardsEl.insertBefore(node, siblingAtIndex);
      }
    });
    const desiredNodeKeys = new Set(desiredNodes.map((node) => node.dataset.nodeKey));
    existingChildren.forEach((node, key) => {
      if (!desiredNodeKeys.has(key)) {
        node.remove();
      }
    });
  }
  ensureIndicatorNode(existingChildren, key) {
    const existing = existingChildren.get(key);
    if (existing) {
      existing.className = "arbor-drop-indicator";
      existing.dataset.nodeKey = key;
      return existing;
    }
    const indicator = createDiv({ cls: "arbor-drop-indicator" });
    indicator.dataset.nodeKey = key;
    return indicator;
  }
  ensureCardNode(existingChildren, blockId) {
    const key = `card-${blockId}`;
    const existing = existingChildren.get(key);
    if (existing) {
      existing.dataset.nodeKey = key;
      return existing;
    }
    const card = createDiv({ cls: "arbor-card" });
    card.tabIndex = 0;
    card.dataset.nodeKey = key;
    card.addEventListener("pointerdown", (event) => this.rememberCardPointerPosition(blockId, event.clientX, event.clientY));
    card.addEventListener("mousedown", (event) => this.rememberCardPointerPosition(blockId, event.clientX, event.clientY));
    card.addEventListener("click", (event) => this.handleCardClick(event));
    card.addEventListener("dblclick", (event) => this.handleCardDoubleClick(event));
    card.addEventListener("contextmenu", (event) => this.handleCardContextMenu(event));
    card.addEventListener("keydown", (event) => this.handleCardKeyDown(event));
    card.addEventListener("mouseenter", () => this.setHoveredBlock(blockId));
    card.addEventListener("mouseleave", () => this.setHoveredBlock(null));
    card.addEventListener("dragstart", (event) => this.handleCardDragStart(event));
    card.addEventListener("dragend", () => this.handleCardDragEnd());
    card.addEventListener("dragover", (event) => this.handleCardDragOver(event));
    card.addEventListener("drop", (event) => this.handleCardDrop(event));
    return card;
  }
  async syncCardNode(card, block, column, index, context) {
    card.dataset.blockId = block.id;
    card.dataset.columnKey = column.key;
    card.dataset.blockIndex = String(index);
    card.dataset.parentId = block.parentId ?? "";
    card.draggable = this.plugin.settings.dragAndDrop;
    card.removeClass(
      "is-active",
      "is-on-path",
      "is-selectable",
      "is-muted",
      "is-drag-source",
      "is-editing",
      "is-search-match",
      "is-search-related",
      "is-search-muted"
    );
    if (this.state?.selectedBlockId === block.id) {
      card.addClass("is-active");
    } else if (context.activePathIds.has(block.id)) {
      card.addClass("is-on-path");
    } else if (context.selectableChildIds.has(block.id)) {
      card.addClass("is-selectable");
    } else if (context.activePathIds.size > 0) {
      card.addClass("is-muted");
    }
    if (this.dragState?.draggedBlockId === block.id) {
      card.addClass("is-drag-source");
    }
    if (context.searchQuery.length > 0) {
      if (context.searchMatchedIds.has(block.id)) {
        card.addClass("is-search-match");
      } else if (context.searchRelatedIds.has(block.id)) {
        card.addClass("is-search-related");
      } else {
        card.addClass("is-search-muted");
      }
    }
    if (this.editingSession?.blockId === block.id && this.editingSession.origin === "card") {
      card.addClass("is-editing");
      await this.syncEditorNode(card, block);
      return;
    }
    await this.syncCardContentNode(card, block);
  }
  wireEditorElement(editor, block, origin) {
    if (editor.dataset.arborBound === "true") {
      editor.dataset.editorOrigin = origin;
      return;
    }
    editor.dataset.arborBound = "true";
    editor.dataset.editorOrigin = origin;
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((eventName) => {
      editor.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });
    editor.addEventListener("input", () => {
      if (this.editingSession?.blockId === block.id) {
        this.clearBlurCommitTimer();
        this.editingSession.value = editor.value;
        this.resizeEditor(editor);
        this.scheduleColumnAlignment();
      }
    });
    editor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.handleSearchShortcut(event)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEditingSession();
      } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.commitEditingSession();
      }
    });
    editor.addEventListener("paste", (event) => {
      event.stopPropagation();
      void this.handleEditorPaste(event, editor);
    });
    editor.addEventListener("drop", (event) => {
      event.stopPropagation();
      void this.handleEditorDrop(event, editor);
    });
    editor.addEventListener("dragover", (event) => {
      event.stopPropagation();
      if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
      }
    });
    editor.addEventListener("focus", (event) => {
      event.stopPropagation();
      this.clearBlurCommitTimer();
    });
    editor.addEventListener("blur", (event) => {
      event.stopPropagation();
      const session = this.editingSession;
      if (!session || session.blockId !== block.id || session.origin !== editor.dataset.editorOrigin) {
        return;
      }
      this.scheduleEditingSessionCommit(session);
    });
  }
  async syncEditorNode(card, block) {
    let editor = card.querySelector("textarea.arbor-editor");
    if (!editor) {
      card.empty();
      editor = card.createEl("textarea", { cls: "arbor-editor" });
    }
    this.wireEditorElement(editor, block, "card");
    if (editor.value !== this.editingSession.value) {
      editor.value = this.editingSession.value;
    }
    this.resizeEditor(editor);
    card.dataset.renderMode = "editing";
    if (this.editingSession?.autofocus && this.editingSession.origin === "card") {
      window.setTimeout(() => {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
        this.resizeEditor(editor);
        if (this.editingSession) {
          this.editingSession.autofocus = false;
        }
      }, 0);
    }
  }
  async syncCardContentNode(card, block) {
    const renderSignature = hashString(block.content);
    let content = card.querySelector(".arbor-card-content");
    const needsRender = !content || card.dataset.renderSignature !== renderSignature || card.dataset.renderMode === "editing";
    if (needsRender) {
      card.empty();
      content = card.createDiv({ cls: "arbor-card-content markdown-rendered" });
      await import_obsidian2.MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
      if (content.innerText.trim().length === 0) {
        content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
      }
      content.querySelectorAll("img").forEach((image) => {
        image.addEventListener("load", () => this.scheduleColumnAlignment(), { once: true });
      });
      card.dataset.renderSignature = renderSignature;
    }
    card.dataset.renderMode = "content";
  }
  async syncPreview(context) {
    if (!this.bodyEl || !this.file || !this.state) {
      return;
    }
    const shouldShow = this.plugin.settings.liveLinearPreview;
    if (!shouldShow) {
      this.previewPaneEl?.remove();
      this.previewPaneEl = null;
      this.previewMiniMapEl = null;
      this.previewContentEl = null;
      this.renderedPreviewSignature = "";
      return;
    }
    if (!this.previewPaneEl) {
      this.previewPaneEl = this.bodyEl.createDiv({ cls: "arbor-preview-pane" });
      this.previewPaneEl.createEl("div", { cls: "arbor-preview-title", text: "Selected Block" });
      this.previewMiniMapEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-minimap" });
      this.previewContentEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-content markdown-rendered" });
    }
    if (this.previewMiniMapEl) {
      this.syncPreviewMiniMap(this.previewMiniMapEl, context);
    }
    const collapseSignature = this.state.metadata.blocks.map((block) => `${block.id}:${block.collapsed ? 1 : 0}`).join("|");
    const previewSignature = [
      this.state.linearized.body,
      this.state.selectedBlockId ?? "",
      this.editingSession?.blockId ?? "",
      this.editingSession?.origin ?? "",
      context.searchQuery,
      collapseSignature
    ].join("");
    if (this.previewContentEl && this.renderedPreviewSignature !== previewSignature) {
      this.previewContentEl.empty();
      await this.renderPreviewBlocks(this.previewContentEl, context);
      this.previewContentEl.scrollTop = 0;
      this.renderedPreviewSignature = previewSignature;
    }
  }
  async renderPreviewBlocks(container, context) {
    if (!this.state || !this.file) {
      return;
    }
    const previewItems = this.buildPreviewItems(context);
    const linearOrder = buildLinearOrder(this.state.metadata);
    const linearIndexById = new Map(linearOrder.map((block, index) => [block.id, index]));
    if (previewItems.length === 0) {
      container.createDiv({
        cls: "arbor-preview-empty",
        text: context.searchQuery.length > 0 ? "No blocks match the current search." : "No preview blocks available."
      });
      return;
    }
    for (const [index, item] of previewItems.entries()) {
      if (item.type === "summary") {
        const summaryEl = container.createDiv({ cls: "arbor-preview-summary" });
        summaryEl.style.setProperty("--bw-preview-depth", String(item.depth));
        summaryEl.createDiv({
          cls: "arbor-preview-summary-title",
          text: `${item.count} hidden block${item.count === 1 ? "" : "s"}`
        });
        if (item.labels.length > 0) {
          const labelsEl = summaryEl.createDiv({ cls: "arbor-preview-summary-labels" });
          item.labels.forEach((label) => labelsEl.createSpan({ cls: "arbor-preview-chip", text: label }));
        }
        const actionButton = summaryEl.createEl("button", {
          cls: "arbor-preview-action is-primary",
          text: "Expand branch",
          attr: { type: "button" }
        });
        actionButton.addEventListener("click", () => void this.setCollapsedState(item.ownerId, false));
        continue;
      }
      const { block, depth } = item;
      const previewBlockEl = container.createDiv({ cls: "arbor-preview-block" });
      previewBlockEl.dataset.blockId = block.id;
      previewBlockEl.style.setProperty("--bw-preview-depth", String(depth));
      previewBlockEl.toggleClass("is-active", this.state.selectedBlockId === block.id);
      previewBlockEl.toggleClass("is-on-path", context.activePathIds.has(block.id));
      previewBlockEl.toggleClass("is-direct-child", block.parentId === this.state.selectedBlockId);
      previewBlockEl.toggleClass("is-editing", this.editingSession?.blockId === block.id && this.editingSession.origin === "preview");
      previewBlockEl.toggleClass("is-search-match", context.searchMatchedIds.has(block.id));
      previewBlockEl.toggleClass("is-search-related", context.searchQuery.length > 0 && context.searchRelatedIds.has(block.id));
      previewBlockEl.addEventListener("mouseenter", () => this.setHoveredBlock(block.id));
      previewBlockEl.addEventListener("mouseleave", () => this.setHoveredBlock(null));
      previewBlockEl.addEventListener("click", (event) => {
        if (event.target?.closest("button")) {
          return;
        }
        this.selectBlock(block.id, { focus: true });
      });
      previewBlockEl.addEventListener("dblclick", () => {
        this.beginEditingBlock(block.id, "preview");
      });
      const headerEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-header" });
      const linearIndex = (linearIndexById.get(block.id) ?? 0) + 1;
      headerEl.createEl("div", {
        cls: "arbor-preview-index",
        text: `Block ${String(linearIndex).padStart(2, "0")}`
      });
      const pathLabels = this.buildPreviewPathLabels(block.id);
      const actionsEl = headerEl.createDiv({ cls: "arbor-preview-actions" });
      const selectButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action",
        text: "Select",
        attr: { type: "button" }
      });
      selectButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.selectBlock(block.id, { focus: true });
      });
      const editButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action is-primary",
        text: this.editingSession?.blockId === block.id ? "Editing" : "Edit",
        attr: {
          type: "button",
          "aria-label": `Edit ${pathLabels[pathLabels.length - 1] ?? "block"}`
        }
      });
      editButton.toggleAttribute("disabled", this.editingSession?.blockId === block.id);
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.beginEditingBlock(block.id, "preview");
      });
      const childCount = getChildren(this.state.metadata, block.id).length;
      if (childCount > 0) {
        const collapseButton = actionsEl.createEl("button", {
          cls: "arbor-preview-action",
          text: block.collapsed ? "Expand" : "Collapse",
          attr: { type: "button" }
        });
        collapseButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.toggleCollapsedState(block.id);
        });
      }
      if (this.editingSession?.blockId === block.id && this.editingSession.origin === "preview") {
        const editor = previewBlockEl.createEl("textarea", { cls: "arbor-editor arbor-preview-editor" });
        this.wireEditorElement(editor, block, "preview");
        if (editor.value !== this.editingSession.value) {
          editor.value = this.editingSession.value;
        }
        this.resizeEditor(editor);
        if (this.editingSession.autofocus) {
          window.setTimeout(() => {
            editor.focus();
            editor.setSelectionRange(editor.value.length, editor.value.length);
            this.resizeEditor(editor);
            if (this.editingSession) {
              this.editingSession.autofocus = false;
            }
          }, 0);
        }
      } else {
        const bodyEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-body markdown-rendered" });
        await import_obsidian2.MarkdownRenderer.render(this.app, block.content, bodyEl, this.file.path, this);
        if (bodyEl.innerText.trim().length === 0) {
          bodyEl.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
        }
      }
      const boundaryText = childCount > 0 ? "Children continue in branches" : "Selected block preview";
      previewBlockEl.createDiv({
        cls: "arbor-preview-boundary",
        text: boundaryText
      });
    }
  }
  buildPreviewItems(context) {
    if (!this.state?.selectedBlockId) {
      return [];
    }
    const selectedBlock = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!selectedBlock) {
      return [];
    }
    if (context.searchQuery.length > 0 && !context.searchMatchedIds.has(selectedBlock.id) && !context.searchRelatedIds.has(selectedBlock.id)) {
      return [];
    }
    const depth = getActivePath(this.state.metadata, selectedBlock.id).length - 1;
    return [{ type: "block", block: selectedBlock, depth }];
  }
  syncPreviewMiniMap(container, context) {
    if (!this.state) {
      return;
    }
    container.empty();
    const headerEl = container.createDiv({ cls: "arbor-preview-minimap-header" });
    headerEl.createSpan({ text: "Path" });
    const metaEl = headerEl.createSpan({
      cls: "arbor-preview-minimap-meta",
      text: ""
    });
    const toggleButton = headerEl.createEl("button", {
      cls: "arbor-preview-minimap-toggle",
      text: this.showFullMiniMap ? "Visible only" : "Show all",
      attr: { type: "button" }
    });
    toggleButton.addEventListener("click", () => {
      this.showFullMiniMap = !this.showFullMiniMap;
      this.render();
    });
    const pathEl = container.createDiv({ cls: "arbor-preview-minimap-path" });
    this.buildPreviewPathLabels(this.state.selectedBlockId ?? "").forEach((label, index, labels) => {
      pathEl.createSpan({
        cls: `arbor-preview-chip${index === labels.length - 1 ? " is-current" : ""}`,
        text: label
      });
      if (index < labels.length - 1) {
        pathEl.createSpan({ cls: "arbor-preview-chip-separator", text: "\u2192" });
      }
    });
    const listEl = container.createDiv({ cls: "arbor-preview-minimap-list" });
    const visibleNodeIds = /* @__PURE__ */ new Set([...context.activePathIds]);
    this.currentColumnMap.forEach((column) => {
      column.blocks.forEach((block) => visibleNodeIds.add(block.id));
    });
    const minimapNodes = context.searchQuery.length > 0 ? context.overviewNodes.filter((node) => node.isSearchMatch || node.isSearchRelated || visibleNodeIds.has(node.id)) : this.showFullMiniMap ? context.overviewNodes : context.overviewNodes.filter((node) => visibleNodeIds.has(node.id));
    metaEl.setText(`${minimapNodes.length} / ${context.overviewNodes.length} blocks`);
    minimapNodes.forEach((node) => {
      const rowEl = listEl.createEl("button", {
        cls: "arbor-preview-minimap-node",
        text: node.label,
        attr: { type: "button" }
      });
      rowEl.dataset.blockId = node.id;
      rowEl.style.setProperty("--bw-preview-depth", String(node.depth));
      rowEl.toggleClass("is-active", node.isSelected);
      rowEl.toggleClass("is-on-path", node.isOnActivePath);
      rowEl.toggleClass("is-selectable", node.isSelectable);
      rowEl.toggleClass("is-search-match", node.isSearchMatch);
      rowEl.toggleClass("is-search-related", node.isSearchRelated);
      rowEl.toggleClass("is-collapsed", node.collapsed);
      rowEl.addEventListener("click", () => this.selectBlock(node.id, { focus: true }));
      rowEl.addEventListener("mouseenter", () => this.setHoveredBlock(node.id));
      rowEl.addEventListener("mouseleave", () => this.setHoveredBlock(null));
      if (node.childCount > 0) {
        const countEl = rowEl.createSpan({ cls: "arbor-preview-minimap-count" });
        countEl.setText(`${node.childCount}`);
      }
    });
  }
  buildPreviewPathLabels(blockId) {
    if (!this.state) {
      return [];
    }
    return getActivePath(this.state.metadata, blockId).map(
      (block) => extractPathLabel(block.content, {
        preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
        fallback: this.plugin.settings.breadcrumbLabelFallback,
        maxWords: 4,
        maxLength: 36
      })
    );
  }
  setHoveredBlock(blockId) {
    if (this.hoveredBlockId === blockId) {
      return;
    }
    this.hoveredBlockId = blockId;
    this.syncHoverLinkedState();
  }
  openSearchOverlay() {
    if (this.isSearchOpen) {
      this.searchInputEl?.focus();
      this.searchInputEl?.select();
      return;
    }
    this.isSearchOpen = true;
    this.shouldFocusSearchInput = true;
    this.render();
  }
  closeSearchOverlay() {
    this.isSearchOpen = false;
    this.shouldFocusSearchInput = false;
    this.previewSearchQuery = "";
    this.render();
  }
  handleSearchShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return false;
    }
    if (event.code !== "KeyF") {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openSearchOverlay();
    return true;
  }
  handleHistoryShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== "KeyZ") {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      void this.redo();
    } else {
      void this.undo();
    }
    return true;
  }
  openViewMenu(event) {
    event?.preventDefault();
    event?.stopPropagation();
    const menu = new import_obsidian2.Menu();
    this.addViewToggleMenuItem(menu, "Selected block panel", this.plugin.settings.liveLinearPreview, async () => {
      await this.updateViewSetting("liveLinearPreview", !this.plugin.settings.liveLinearPreview);
    });
    this.addViewToggleMenuItem(menu, "Breadcrumb path", this.plugin.settings.showBreadcrumb, async () => {
      await this.updateViewSetting("showBreadcrumb", !this.plugin.settings.showBreadcrumb);
    });
    this.addViewToggleMenuItem(menu, "Breadcrumb flow", this.plugin.settings.showBreadcrumbFlow, async () => {
      await this.updateViewSetting("showBreadcrumbFlow", !this.plugin.settings.showBreadcrumbFlow);
    });
    this.addViewToggleMenuItem(menu, "Ctrl/Cmd + wheel zoom", this.plugin.settings.enableCtrlWheelZoom, async () => {
      await this.updateViewSetting("enableCtrlWheelZoom", !this.plugin.settings.enableCtrlWheelZoom, false);
    });
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("Reset zoom to 100%").setIcon("maximize").onClick(() => this.updateZoomLevel(1))
    );
    menu.addItem(
      (item) => item.setTitle("Open Arbor settings").setIcon("settings-2").onClick(() => this.openArborSettings())
    );
    const anchor = this.viewMenuButtonEl;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 8, y: rect.bottom + 6 }, anchor.ownerDocument);
      return;
    }
    menu.showAtPosition({ x: 220, y: 120 }, this.contentEl.ownerDocument);
  }
  addViewToggleMenuItem(menu, title, enabled, callback) {
    menu.addItem(
      (item) => item.setTitle(title).setIcon(enabled ? "check" : "circle").onClick(() => void callback())
    );
  }
  async updateViewSetting(key, value, refreshAll = true) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    if (refreshAll) {
      this.plugin.refreshAllBranchViews();
      return;
    }
    this.render();
  }
  openArborSettings() {
    const settingManager = this.app.setting;
    if (!settingManager?.open) {
      new import_obsidian2.Notice("Obsidian settings are not available right now.");
      return;
    }
    settingManager.open();
    settingManager.openTabById?.(this.plugin.manifest.id);
  }
  syncHoverLinkedState() {
    if (!this.state || !this.contentEl) {
      return;
    }
    const hoveredPathIds = new Set(getActivePath(this.state.metadata, this.hoveredBlockId).map((block) => block.id));
    const hoveredSelectableIds = new Set(
      this.hoveredBlockId ? getChildren(this.state.metadata, this.hoveredBlockId).map((block) => block.id) : []
    );
    this.contentEl.querySelectorAll("[data-block-id]").forEach((element) => {
      const blockId = element.dataset.blockId;
      if (!blockId) {
        return;
      }
      element.toggleClass("is-hover-linked", this.hoveredBlockId === blockId);
      element.toggleClass(
        "is-hover-linked-path",
        this.hoveredBlockId !== null && this.hoveredBlockId !== blockId && (hoveredPathIds.has(blockId) || hoveredSelectableIds.has(blockId))
      );
    });
  }
  applyPendingFocusAndScroll(preservedSceneWidth = 0) {
    const pendingFocusBlockId = this.pendingFocusBlockId;
    const pendingScrollBlockId = this.pendingScrollBlockId;
    this.pendingFocusBlockId = null;
    this.pendingScrollBlockId = null;
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
    }
    this.pendingFocusFrame = window.requestAnimationFrame(() => {
      this.pendingFocusFrame = null;
      const columnsEl = this.columnsEl;
      const columnsViewportEl = this.columnsViewportEl;
      if (!columnsEl || !columnsViewportEl) {
        return;
      }
      this.alignColumnsToActivePath();
      this.syncViewportEdgeFades();
      const activeCard = columnsEl.querySelector(".arbor-card.is-active");
      if (pendingFocusBlockId) {
        let focusHandled = false;
        if (this.editingSession?.blockId === pendingFocusBlockId && this.editingSession.origin === "preview") {
          const previewEditor = this.previewContentEl?.querySelector(
            `.arbor-preview-block[data-block-id="${pendingFocusBlockId}"] textarea.arbor-editor`
          );
          if (previewEditor) {
            previewEditor.focus({ preventScroll: true });
            if (this.editingSession.autofocus) {
              previewEditor.setSelectionRange(previewEditor.value.length, previewEditor.value.length);
              this.editingSession.autofocus = false;
            }
            focusHandled = true;
          }
        }
        const focusCard = !focusHandled ? columnsEl.querySelector(`.arbor-card[data-block-id="${pendingFocusBlockId}"]`) : null;
        if (focusCard) {
          const editor = focusCard.querySelector("textarea.arbor-editor");
          if (editor && this.editingSession?.blockId === pendingFocusBlockId && this.editingSession.origin === "card") {
            editor.focus({ preventScroll: true });
            if (this.editingSession.autofocus) {
              editor.setSelectionRange(editor.value.length, editor.value.length);
              this.editingSession.autofocus = false;
            }
          } else {
            focusCard.focus({ preventScroll: true });
          }
        } else if (!focusHandled) {
          columnsViewportEl.focus({ preventScroll: true });
        }
      }
      if (pendingScrollBlockId) {
        const scrollCard = columnsEl.querySelector(`.arbor-card[data-block-id="${pendingScrollBlockId}"]`) ?? activeCard;
        if (scrollCard) {
          this.scrollCardIntoHorizontalView(scrollCard, columnsViewportEl, preservedSceneWidth);
        }
      } else {
        this.releasePreservedSceneWidth();
      }
    });
  }
  handleColumnDragOver(event) {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }
    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const cardsEl = event.currentTarget;
    const column = this.currentColumnMap.get(cardsEl.dataset.columnKey ?? "");
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || column.blocks.length > 0) {
      return;
    }
    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: 0,
      columnKey: column.key
    });
  }
  handleViewportDragOver(event) {
    if (!this.plugin.settings.dragAndDrop || !this.dragPreviewEl) {
      return;
    }
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }
  handleCardClick(event) {
    event.preventDefault();
    const card = event.currentTarget;
    const blockId = card.dataset.blockId;
    if (!blockId) {
      return;
    }
    const isActive = this.state?.selectedBlockId === blockId;
    if (isActive && this.editingSession?.blockId !== blockId) {
      this.beginEditingBlock(blockId);
      return;
    }
    this.selectBlock(blockId, { focus: true });
  }
  handleCardDoubleClick(event) {
    const blockId = event.currentTarget.dataset.blockId;
    if (blockId) {
      this.beginEditingBlock(blockId);
    }
  }
  handleCardContextMenu(event) {
    event.preventDefault();
    const blockId = event.currentTarget.dataset.blockId;
    if (!blockId) {
      return;
    }
    this.selectBlock(blockId);
    this.buildBlockMenu(blockId).showAtMouseEvent(event);
  }
  handleCardKeyDown(event) {
    event.stopPropagation();
    if (this.handleSearchShortcut(event)) {
      return;
    }
    if (this.handleHistoryShortcut(event)) {
      return;
    }
    if (event.altKey) {
      return;
    }
    const blockId = event.currentTarget.dataset.blockId;
    if (!blockId) {
      return;
    }
    if (this.state?.selectedBlockId !== blockId) {
      this.state.selectedBlockId = blockId;
    }
    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectPreviousSiblingBlock();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectNextSiblingBlock();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.selectParentBlock();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.selectPreferredChildBlock();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.selectFirstSiblingBlock();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      this.selectLastSiblingBlock();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void this.deleteSelectedBlock();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.beginEditingBlock(blockId);
    }
  }
  handleViewportKeyDown(event) {
    if (this.handleSearchShortcut(event)) {
      return;
    }
    if (this.handleHistoryShortcut(event)) {
      return;
    }
    if (event.altKey) {
      return;
    }
    const target = event.target;
    if (target?.closest("input, textarea")) {
      return;
    }
    if (!this.state?.selectedBlockId) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectPreviousSiblingBlock();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectNextSiblingBlock();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.selectParentBlock();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.selectPreferredChildBlock();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.selectFirstSiblingBlock();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      this.selectLastSiblingBlock();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void this.deleteSelectedBlock();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.beginEditingBlock(this.state.selectedBlockId);
    }
  }
  handleCardDragStart(event) {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }
    const card = event.currentTarget;
    const blockId = card.dataset.blockId;
    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.currentColumnMap.get(columnKey);
    if (!blockId || !column || blockIndex < 0) {
      return;
    }
    event.dataTransfer?.setData("text/plain", blockId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(this.getTransparentDragImage(), 0, 0);
    }
    this.dragState = {
      draggedBlockId: blockId,
      targetParentId: column.parentId,
      targetIndex: blockIndex,
      columnKey
    };
    card.addClass("is-drag-source");
    this.startDragPreview(card, blockId, event);
  }
  handleCardDragOver(event) {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }
    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const card = event.currentTarget;
    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.currentColumnMap.get(columnKey);
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || blockIndex < 0) {
      return;
    }
    const rect = card.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: before ? blockIndex : blockIndex + 1,
      columnKey
    });
  }
  handleCardDrop(event) {
    event.preventDefault();
    const column = this.currentColumnMap.get(event.currentTarget.dataset.columnKey ?? "");
    if (column) {
      void this.applyDrop(column);
    }
  }
  handleCardDragEnd() {
    this.dragState = null;
    this.cleanupDragPreview();
    this.render();
  }
  renderBreadcrumb(container) {
    if (!this.state) {
      return;
    }
    const strip = container.createDiv({ cls: "arbor-breadcrumbs" });
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (path.length === 0) {
      strip.createSpan({ cls: "arbor-breadcrumb-empty", text: this.file?.basename ?? "Arbor" });
      return;
    }
    this.renderBreadcrumbItems(strip, path);
  }
  async renderColumn(container, column) {
    const columnEl = container.createDiv({ cls: "arbor-column" });
    columnEl.dataset.columnKey = column.key;
    columnEl.dataset.parentId = column.parentId ?? "";
    const cardsEl = columnEl.createDiv({ cls: "arbor-card-list" });
    if (this.plugin.settings.dragAndDrop) {
      cardsEl.addEventListener("dragover", (event) => this.handleColumnDragOver(event));
      cardsEl.addEventListener("drop", (event) => {
        event.preventDefault();
        void this.applyDrop(column);
      });
    }
    if (column.blocks.length === 0) {
      const empty = cardsEl.createDiv({ cls: "arbor-column-empty" });
      empty.setText(column.parentId ? "No child blocks yet." : "No root blocks yet.");
      empty.toggleClass("is-selectable-context", column.parentId === this.state?.selectedBlockId);
      if (column.parentId) {
        empty.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.state.selectedBlockId = column.parentId;
          const menu = new import_obsidian2.Menu();
          menu.addItem(
            (item) => item.setTitle("Create child block").setIcon("arrow-right").onClick(() => void this.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }
    column.blocks.forEach((block, index) => {
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index) {
        cardsEl.createDiv({ cls: "arbor-drop-indicator" });
      }
    });
    for (let index = 0; index < column.blocks.length; index += 1) {
      await this.renderCard(cardsEl, column.blocks[index], column, index);
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index + 1) {
        cardsEl.createDiv({ cls: "arbor-drop-indicator" });
      }
    }
  }
  async renderCard(container, block, column, index) {
    const card = container.createDiv({ cls: "arbor-card" });
    card.tabIndex = 0;
    card.dataset.blockId = block.id;
    card.dataset.columnKey = column.key;
    card.dataset.blockIndex = String(index);
    card.dataset.parentId = block.parentId ?? "";
    const activePathIds = new Set(getActivePath(this.state.metadata, this.state.selectedBlockId).map((item) => item.id));
    const selectableChildIds = new Set(
      this.state?.selectedBlockId ? getChildren(this.state.metadata, this.state.selectedBlockId).map((item) => item.id) : []
    );
    if (this.state?.selectedBlockId === block.id) {
      card.addClass("is-active");
    } else if (activePathIds.has(block.id)) {
      card.addClass("is-on-path");
    } else if (selectableChildIds.has(block.id)) {
      card.addClass("is-selectable");
    } else if (activePathIds.size > 0) {
      card.addClass("is-muted");
    }
    if (this.dragState?.draggedBlockId === block.id) {
      card.addClass("is-drag-source");
    }
    card.addEventListener("click", () => {
      const isActive = this.state?.selectedBlockId === block.id;
      if (isActive && this.editingSession?.blockId !== block.id) {
        this.beginEditingBlock(block.id);
        return;
      }
      this.selectBlock(block.id, { focus: true });
    });
    card.addEventListener("dblclick", () => {
      this.beginEditingBlock(block.id);
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (this.state) {
        this.state.selectedBlockId = block.id;
      }
      this.buildBlockMenu(block.id).showAtMouseEvent(event);
    });
    card.addEventListener("keydown", (event) => {
      if (this.handleHistoryShortcut(event)) {
        return;
      }
      if (event.altKey) {
        return;
      }
      if (this.state?.selectedBlockId !== block.id) {
        this.state.selectedBlockId = block.id;
      }
      if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectPreviousSiblingBlock();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectNextSiblingBlock();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.selectParentBlock();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.selectPreferredChildBlock();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        this.selectFirstSiblingBlock();
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        this.selectLastSiblingBlock();
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void this.deleteSelectedBlock();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        this.beginEditingBlock(block.id);
      }
    });
    if (this.plugin.settings.dragAndDrop) {
      card.draggable = true;
      card.addEventListener("dragstart", (event) => this.handleCardDragStart(event));
      card.addEventListener("dragend", () => this.handleCardDragEnd());
      card.addEventListener("dragover", (event) => this.handleCardDragOver(event));
      card.addEventListener("drop", (event) => this.handleCardDrop(event));
    }
    const isEditing = this.editingSession?.blockId === block.id;
    if (isEditing && this.editingSession) {
      card.addClass("is-editing");
      const editor = card.createEl("textarea", { cls: "arbor-editor" });
      editor.value = this.editingSession.value;
      this.resizeEditor(editor);
      ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((eventName) => {
        editor.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });
      editor.addEventListener("input", () => {
        if (this.editingSession?.blockId === block.id) {
          this.editingSession.value = editor.value;
          this.resizeEditor(editor);
        }
      });
      editor.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          this.cancelEditingSession();
        } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          void this.commitEditingSession();
        }
      });
      editor.addEventListener("paste", (event) => {
        event.stopPropagation();
        void this.handleEditorPaste(event, editor);
      });
      editor.addEventListener("drop", (event) => {
        event.stopPropagation();
        void this.handleEditorDrop(event, editor);
      });
      editor.addEventListener("dragover", (event) => {
        event.stopPropagation();
        if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith("image/"))) {
          event.preventDefault();
        }
      });
      editor.addEventListener("focus", (event) => {
        event.stopPropagation();
      });
      if (this.editingSession.autofocus) {
        window.setTimeout(() => {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
          this.resizeEditor(editor);
          if (this.editingSession) {
            this.editingSession.autofocus = false;
          }
        }, 0);
      }
      return;
    }
    const content = card.createDiv({ cls: "arbor-card-content markdown-rendered" });
    await import_obsidian2.MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
    if (content.innerText.trim().length === 0) {
      content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
    }
    content.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", () => this.scheduleColumnAlignment(), { once: true });
    });
  }
  async applyDrop(column) {
    if (!this.dragState || !this.state) {
      return;
    }
    const { draggedBlockId, targetIndex, targetParentId } = this.dragState;
    this.dragState = null;
    this.cleanupDragPreview();
    await this.applyMutation("Move block", (metadata) => ({
      metadata: moveBlockToParentAtIndex(metadata, draggedBlockId, targetParentId, targetIndex),
      selectedBlockId: draggedBlockId
    }));
  }
  readDraggedBlockId(event) {
    return event.dataTransfer?.getData("text/plain") || this.dragState?.draggedBlockId || null;
  }
  getTransparentDragImage() {
    if (!this.transparentDragImageEl) {
      const canvas = this.contentEl.ownerDocument.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      this.transparentDragImageEl = canvas;
    }
    return this.transparentDragImageEl;
  }
  startDragPreview(card, blockId, event) {
    this.cleanupDragPreview();
    if (!this.columnsStageEl) {
      return;
    }
    const preview = card.cloneNode(true);
    preview.removeAttribute("tabindex");
    preview.draggable = false;
    preview.classList.remove("is-drag-source", "is-hover-linked", "is-hover-linked-path");
    preview.classList.add("arbor-drag-preview");
    preview.dataset.blockId = blockId;
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll("[tabindex]").forEach((element) => element.removeAttribute("tabindex"));
    preview.style.width = `${card.offsetWidth}px`;
    const rect = card.getBoundingClientRect();
    const stageRect = this.columnsStageEl.getBoundingClientRect();
    const initialLeft = rect.left - stageRect.left;
    const initialTop = rect.top - stageRect.top;
    preview.style.transform = `translate3d(${Math.round(initialLeft)}px, ${Math.round(initialTop)}px, 0)`;
    const rememberedPointer = this.lastCardPointerPosition?.blockId === blockId ? this.lastCardPointerPosition : null;
    const pointerX = rememberedPointer?.clientX ?? event.clientX;
    const pointerY = rememberedPointer?.clientY ?? event.clientY;
    const hasPointer = Number.isFinite(pointerX) && Number.isFinite(pointerY) && (pointerX !== 0 || pointerY !== 0);
    this.dragPreviewOffset = hasPointer ? {
      x: Math.max(0, Math.min(pointerX - rect.left, rect.width)),
      y: Math.max(0, Math.min(pointerY - rect.top, rect.height))
    } : {
      x: Math.min(rect.width * 0.34, 72),
      y: Math.min(rect.height * 0.28, 56)
    };
    this.dragPreviewPoint = hasPointer ? { x: pointerX, y: pointerY } : null;
    this.dragPreviewEl = preview;
    this.columnsStageEl.addClass("is-dragging");
    this.columnsStageEl.appendChild(preview);
    this.contentEl.ownerDocument.addEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewPoint) {
      this.scheduleDragPreviewPosition();
    }
  }
  handleDocumentDragOver(event) {
    if (!this.dragPreviewEl) {
      return;
    }
    this.updateDragPreviewPointer(event);
  }
  updateDragPreviewPointer(event) {
    if (!this.dragPreviewEl) {
      return;
    }
    this.dragPreviewPoint = { x: event.clientX, y: event.clientY };
    this.scheduleDragPreviewPosition();
  }
  scheduleDragPreviewPosition() {
    if (this.dragPreviewFrame !== null) {
      return;
    }
    this.dragPreviewFrame = window.requestAnimationFrame(() => {
      this.dragPreviewFrame = null;
      this.syncDragPreviewPosition();
    });
  }
  syncDragPreviewPosition() {
    if (!this.dragPreviewEl || !this.columnsStageEl || !this.dragPreviewPoint) {
      return;
    }
    const stageRect = this.columnsStageEl.getBoundingClientRect();
    const left = this.dragPreviewPoint.x - stageRect.left - this.dragPreviewOffset.x;
    const top = this.dragPreviewPoint.y - stageRect.top - this.dragPreviewOffset.y;
    this.dragPreviewEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
  cleanupDragPreview() {
    this.contentEl.ownerDocument.removeEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewFrame !== null) {
      window.cancelAnimationFrame(this.dragPreviewFrame);
      this.dragPreviewFrame = null;
    }
    this.dragPreviewEl?.remove();
    this.dragPreviewEl = null;
    this.dragPreviewPoint = null;
    this.dragPreviewOffset = { x: 0, y: 0 };
    this.lastCardPointerPosition = null;
    this.columnsStageEl?.removeClass("is-dragging");
    this.contentEl.querySelectorAll(".arbor-card.is-drag-source").forEach((element) => {
      element.classList.remove("is-drag-source");
    });
  }
  rememberCardPointerPosition(blockId, clientX, clientY) {
    this.lastCardPointerPosition = { blockId, clientX, clientY };
  }
  async applyMutation(label, mutate, autofocusSelection = false) {
    if (!this.state) {
      return;
    }
    await this.commitEditIfNeeded();
    this.history.push(label, this.state.metadata, this.state.selectedBlockId);
    const result = mutate(cloneMetadata(this.state.metadata));
    this.state.metadata = applyBodyHash(result.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(this.state.metadata, result.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    if (autofocusSelection && this.state.selectedBlockId) {
      const block = getBlock(this.state.metadata, this.state.selectedBlockId);
      if (block) {
        this.editingSession = {
          blockId: block.id,
          originalContent: block.content,
          value: block.content,
          autofocus: true,
          origin: "card"
        };
      }
    }
    await this.persistState(label);
    this.render();
  }
  currentHistorySnapshot(label) {
    return {
      label,
      metadata: cloneMetadata(this.state?.metadata ?? createEmptyTree()),
      selectedBlockId: this.state?.selectedBlockId ?? null
    };
  }
  async commitEditIfNeeded() {
    if (this.editingSession) {
      await this.commitEditingSession();
    }
  }
  cancelEditingSession() {
    this.clearBlurCommitTimer();
    this.pendingFocusBlockId = this.state?.selectedBlockId ?? null;
    this.editingSession = null;
    this.render();
  }
  async commitEditingSession(session = this.editingSession) {
    if (!this.state || !session || this.editingSession !== session) {
      return;
    }
    this.clearBlurCommitTimer();
    const { blockId, value } = session;
    if (value === session.originalContent) {
      this.pendingFocusBlockId = blockId;
      this.editingSession = null;
      this.render();
      return;
    }
    this.history.push("Edit block", this.state.metadata, this.state.selectedBlockId);
    this.state.metadata = applyBodyHash(updateBlockContent(this.state.metadata, blockId, value));
    this.state.selectedBlockId = blockId;
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingFocusBlockId = blockId;
    this.editingSession = null;
    await this.persistState("Edit block");
    this.render();
  }
  scheduleEditingSessionCommit(session) {
    this.clearBlurCommitTimer();
    this.blurCommitTimer = window.setTimeout(() => {
      if (this.editingSession !== session) {
        return;
      }
      void this.commitEditingSession(session);
    }, 80);
  }
  clearBlurCommitTimer() {
    if (this.blurCommitTimer !== null) {
      window.clearTimeout(this.blurCommitTimer);
      this.blurCommitTimer = null;
    }
  }
  resetViewState() {
    this.clearBlurCommitTimer();
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.state = null;
    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.teardownShell();
  }
  async persistState(reason) {
    if (!this.file || !this.state) {
      return;
    }
    const metadata = applyBodyHash(this.state.metadata);
    this.state.metadata = metadata;
    this.state.linearized = linearizeTree(metadata);
    const document = buildBranchDocument(
      this.state.frontmatter,
      this.state.linearized.body,
      metadata,
      this.plugin.settings.metadataBlockStyle
    );
    this.isPersisting = true;
    try {
      this.plugin.markOwnWrite(this.file.path);
      await this.app.vault.modify(this.file, document);
      this.plugin.rememberManagedNote(this.file.path);
    } catch (error) {
      console.error(`[Arbor] Failed to persist state after ${reason}`, error);
      new import_obsidian2.Notice(`Arbor could not save the note after "${reason}".`);
    } finally {
      this.isPersisting = false;
    }
  }
  applyCssVars(root) {
    root.style.setProperty("--bw-card-width", `${this.plugin.settings.cardWidth}px`);
    root.style.setProperty("--bw-card-min-height", `${this.plugin.settings.cardMinHeight}px`);
    root.style.setProperty("--bw-column-gap", `${this.plugin.settings.horizontalSpacing}px`);
    root.style.setProperty("--bw-card-gap", `${this.plugin.settings.verticalSpacing}px`);
    root.style.setProperty("--bw-zoom", `${this.plugin.settings.zoomLevel}`);
    root.style.setProperty("--bw-content-zoom", `${this.plugin.settings.zoomLevel}`);
    this.syncZoomIndicator();
  }
  applyViewClasses(root) {
    root.classList.add("is-context-dim-mode");
  }
  buildBlockMenu(blockId) {
    const menu = new import_obsidian2.Menu();
    const canCreateLeft = this.state ? Boolean(getParentBlock(this.state.metadata, blockId)) : false;
    const childCount = this.state ? getChildren(this.state.metadata, blockId).length : 0;
    const block = this.state ? getBlock(this.state.metadata, blockId) : null;
    menu.addItem(
      (item) => item.setTitle("Continue to the right").setIcon("arrow-right").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createChild()))
    );
    if (canCreateLeft) {
      menu.addItem(
        (item) => item.setTitle("Create block to the left").setIcon("arrow-left").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createParentLevelBlock()))
      );
    }
    menu.addItem(
      (item) => item.setTitle("Create sibling above").setIcon("arrow-up").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createSiblingAbove()))
    ).addItem(
      (item) => item.setTitle("Create sibling below").setIcon("arrow-down").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createSiblingBelow()))
    ).addSeparator().addItem(
      (item) => item.setTitle("Select parent").setIcon("corner-up-left").onClick(() => this.runWithSelectedBlock(blockId, () => {
        this.selectParentBlock();
        return Promise.resolve();
      }))
    ).addItem(
      (item) => item.setTitle("Select previous sibling").setIcon("chevron-up").onClick(() => this.runWithSelectedBlock(blockId, () => {
        this.selectPreviousSiblingBlock();
        return Promise.resolve();
      }))
    ).addItem(
      (item) => item.setTitle("Select next sibling").setIcon("chevron-down").onClick(() => this.runWithSelectedBlock(blockId, () => {
        this.selectNextSiblingBlock();
        return Promise.resolve();
      }))
    ).addItem(
      (item) => item.setTitle("Select first child").setIcon("chevron-right").onClick(() => this.runWithSelectedBlock(blockId, () => {
        this.selectFirstChildBlock();
        return Promise.resolve();
      }))
    );
    if (childCount > 0 && block) {
      menu.addItem(
        (item) => item.setTitle(block.collapsed ? "Expand branch" : "Collapse branch").setIcon(block.collapsed ? "chevrons-down-up" : "chevrons-up-down").onClick(() => void this.runWithSelectedBlock(blockId, () => this.toggleCollapsedState(blockId)))
      );
    }
    menu.addSeparator().addItem(
      (item) => item.setTitle("Duplicate subtree").setIcon("copy-plus").onClick(() => void this.runWithSelectedBlock(blockId, () => this.duplicateSelectedSubtree()))
    ).addItem(
      (item) => item.setTitle("Reveal in markdown").setIcon("file-text").onClick(() => void this.runWithSelectedBlock(blockId, () => this.revealCurrentBlockInMarkdown()))
    ).addSeparator().addItem(
      (item) => item.setTitle("Delete block").setIcon("trash").setWarning(true).onClick(() => void this.runWithSelectedBlock(blockId, () => this.deleteSelectedBlock()))
    ).addItem(
      (item) => item.setTitle("Delete subtree").setIcon("trash-2").setWarning(true).onClick(() => void this.runWithSelectedBlock(blockId, () => this.deleteSelectedSubtree()))
    );
    this.applyDangerMenuItemStyles(menu);
    return menu;
  }
  applyDangerMenuItemStyles(menu) {
    const menuWithDom = menu;
    window.requestAnimationFrame(() => {
      const menuEl = menuWithDom.dom;
      if (!menuEl) {
        return;
      }
      menuEl.querySelectorAll(".menu-item-title").forEach((titleEl) => {
        const text = titleEl.textContent?.trim();
        if (text === "Delete block" || text === "Delete subtree") {
          titleEl.closest(".menu-item")?.addClass("arbor-menu-danger");
        }
      });
    });
  }
  async runWithSelectedBlock(blockId, callback) {
    this.selectBlock(blockId);
    await callback();
  }
  updateDragState(nextDragState) {
    const current = this.dragState;
    if (current?.draggedBlockId === nextDragState.draggedBlockId && current?.targetParentId === nextDragState.targetParentId && current?.targetIndex === nextDragState.targetIndex && current?.columnKey === nextDragState.columnKey) {
      return;
    }
    this.dragState = nextDragState;
    this.render();
  }
  scheduleColumnAlignment() {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
    }
    this.layoutFrame = window.requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.alignColumnsToActivePath();
    });
  }
  resizeEditor(textarea) {
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 180)}px`;
  }
  handleViewportWheel(event, viewport) {
    if ((event.ctrlKey || event.metaKey) && this.plugin.settings.enableCtrlWheelZoom) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
      this.updateZoomLevel(this.plugin.settings.zoomLevel * factor);
      return;
    }
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey || event.metaKey) {
      return;
    }
    if (viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }
    event.preventDefault();
    viewport.scrollBy({
      left: event.deltaY,
      behavior: "auto"
    });
  }
  syncViewportEdgeFades() {
    const stage = this.columnsStageEl;
    const viewport = this.columnsViewportEl;
    if (!stage || !viewport) {
      return;
    }
    const canScrollHorizontally = viewport.scrollWidth - viewport.clientWidth > 1;
    const hasHiddenLeft = canScrollHorizontally && viewport.scrollLeft > 2;
    const hasHiddenRight = canScrollHorizontally && viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2;
    stage.classList.toggle("has-hidden-left", hasHiddenLeft);
    stage.classList.toggle("has-hidden-right", hasHiddenRight);
  }
  updateZoomLevel(nextZoomLevel) {
    const clamped = Math.max(0.7, Math.min(1.6, Number(nextZoomLevel.toFixed(3))));
    if (Math.abs(clamped - this.plugin.settings.zoomLevel) < 1e-3) {
      return;
    }
    this.plugin.settings.zoomLevel = clamped;
    this.applyCssVars(this.contentEl);
    this.scheduleColumnAlignment();
    this.scheduleZoomPersist();
    this.flashZoomIndicator();
    window.requestAnimationFrame(() => {
      this.alignColumnsToActivePath();
      const viewport = this.columnsViewportEl;
      const activeCard = this.columnsEl?.querySelector(".arbor-card.is-active");
      if (viewport && activeCard) {
        this.scrollCardIntoHorizontalView(activeCard, viewport);
      }
    });
  }
  scheduleZoomPersist() {
    this.clearZoomPersistTimer();
    this.zoomPersistTimer = window.setTimeout(() => {
      this.zoomPersistTimer = null;
      void this.plugin.saveSettings();
    }, 180);
  }
  clearZoomPersistTimer() {
    if (this.zoomPersistTimer !== null) {
      window.clearTimeout(this.zoomPersistTimer);
      this.zoomPersistTimer = null;
    }
  }
  syncZoomIndicator() {
    if (!this.zoomIndicatorEl) {
      return;
    }
    const zoomPercent = Math.round(this.plugin.settings.zoomLevel * 100);
    this.zoomIndicatorEl.textContent = `${zoomPercent}%`;
    const isDefaultZoom = Math.abs(this.plugin.settings.zoomLevel - 1) < 1e-3;
    this.zoomIndicatorEl.classList.toggle("is-default", isDefaultZoom);
    this.zoomIndicatorEl.title = isDefaultZoom ? "Zoom 100%. Ctrl/Cmd + wheel to zoom." : "Click to reset zoom to 100%. Ctrl/Cmd + wheel to zoom.";
  }
  flashZoomIndicator() {
    if (!this.zoomIndicatorEl) {
      return;
    }
    this.zoomIndicatorEl.addClass("is-visible");
    this.clearZoomIndicatorTimer();
    this.zoomIndicatorTimer = window.setTimeout(() => {
      this.zoomIndicatorTimer = null;
      this.zoomIndicatorEl?.removeClass("is-visible");
    }, 1100);
  }
  clearZoomIndicatorTimer() {
    if (this.zoomIndicatorTimer !== null) {
      window.clearTimeout(this.zoomIndicatorTimer);
      this.zoomIndicatorTimer = null;
    }
  }
  handleViewportPointerDown(event, viewport) {
    if (event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }
    const target = event.target;
    if (target?.closest(
      ".arbor-card, textarea, button, a, input, select"
    )) {
      return;
    }
    this.viewportPanState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      dragging: false
    };
    viewport.setPointerCapture(event.pointerId);
  }
  handleDirectionalCreateShortcut(event) {
    if (!this.state?.selectedBlockId) {
      return false;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      void this.createChild();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      void this.createSiblingAbove();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void this.createSiblingBelow();
      return true;
    }
    if (event.key === "ArrowLeft") {
      const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
      if (!parent) {
        return false;
      }
      event.preventDefault();
      void this.createParentLevelBlock();
      return true;
    }
    return false;
  }
  handleViewportPointerMove(event, viewport) {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - this.viewportPanState.startClientX;
    if (!this.viewportPanState.dragging) {
      if (Math.abs(deltaX) < 4) {
        return;
      }
      this.viewportPanState.dragging = true;
      viewport.classList.add("is-panning");
    }
    viewport.scrollLeft = this.viewportPanState.startScrollLeft - deltaX;
    event.preventDefault();
  }
  handleViewportPointerUp(event, viewport) {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }
    this.cleanupViewportPan(viewport, event.pointerId);
  }
  handleViewportPointerCaptureLost(event, viewport) {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }
    this.cleanupViewportPan(viewport, event.pointerId, false);
  }
  cleanupViewportPan(viewport = this.columnsViewportEl, pointerId, releaseCapture = true) {
    const activePointerId = pointerId ?? this.viewportPanState?.pointerId;
    this.viewportPanState = null;
    viewport?.classList.remove("is-panning");
    if (!releaseCapture || !viewport || activePointerId === void 0) {
      return;
    }
    if (viewport.hasPointerCapture(activePointerId)) {
      viewport.releasePointerCapture(activePointerId);
    }
  }
  armSceneWidthForPendingScroll() {
    if (!this.pendingScrollBlockId || !this.columnsEl || !this.columnsViewportEl) {
      return 0;
    }
    const preservedSceneWidth = Math.max(this.columnsEl.scrollWidth, this.columnsViewportEl.clientWidth);
    this.columnsEl.style.minWidth = `${preservedSceneWidth}px`;
    return preservedSceneWidth;
  }
  releasePreservedSceneWidth() {
    if (this.columnsEl) {
      this.columnsEl.style.minWidth = "";
    }
  }
  stopHorizontalScrollMotion(releasePreservedWidth = true) {
    if (this.horizontalScrollFrame !== null) {
      window.cancelAnimationFrame(this.horizontalScrollFrame);
      this.horizontalScrollFrame = null;
    }
    if (releasePreservedWidth) {
      this.releasePreservedSceneWidth();
    }
  }
  clearBreadcrumbScrollFrame() {
    if (this.breadcrumbScrollFrame !== null) {
      window.cancelAnimationFrame(this.breadcrumbScrollFrame);
      this.breadcrumbScrollFrame = null;
    }
  }
  animateViewportScrollTo(viewport, targetLeft) {
    this.stopHorizontalScrollMotion(false);
    const startLeft = viewport.scrollLeft;
    const distance = targetLeft - startLeft;
    if (Math.abs(distance) < 1) {
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }
    const duration = Math.max(180, Math.min(320, 170 + Math.abs(distance) * 0.18));
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      viewport.scrollLeft = startLeft + distance * eased;
      if (progress < 1) {
        this.horizontalScrollFrame = window.requestAnimationFrame(tick);
        return;
      }
      this.horizontalScrollFrame = null;
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
    };
    this.horizontalScrollFrame = window.requestAnimationFrame(tick);
  }
  scrollCardIntoHorizontalView(card, viewport, preservedSceneWidth = 0) {
    const viewportRect = viewport.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const blockId = card.dataset.blockId ?? null;
    const activeBlock = this.state ? getBlock(this.state.metadata, this.state.selectedBlockId) : null;
    const shouldCenterSelectedBlock = Boolean(blockId) && this.state?.selectedBlockId === blockId && Boolean(activeBlock?.parentId);
    const safePadding = Math.min(96, viewport.clientWidth * 0.18);
    const shouldScrollLeft = cardRect.left < viewportRect.left + safePadding;
    const shouldScrollRight = cardRect.right > viewportRect.right - safePadding;
    if (!shouldCenterSelectedBlock && !shouldScrollLeft && !shouldScrollRight) {
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }
    if (preservedSceneWidth > 0 && this.columnsEl) {
      this.columnsEl.style.minWidth = `${Math.max(preservedSceneWidth, viewport.clientWidth)}px`;
    }
    const cardCenter = viewport.scrollLeft + (cardRect.left - viewportRect.left) + cardRect.width / 2;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const centeredTargetLeft = Math.max(0, Math.min(cardCenter - viewport.clientWidth / 2, maxScrollLeft));
    const targetLeft = shouldCenterSelectedBlock ? centeredTargetLeft : shouldScrollLeft ? Math.max(
      0,
      Math.min(
        viewport.scrollLeft - (viewportRect.left + safePadding - cardRect.left),
        maxScrollLeft
      )
    ) : Math.max(
      0,
      Math.min(
        viewport.scrollLeft + (cardRect.right - (viewportRect.right - safePadding)),
        maxScrollLeft
      )
    );
    this.animateViewportScrollTo(viewport, targetLeft);
  }
  alignColumnsToActivePath() {
    if (!this.state) {
      return;
    }
    const viewport = this.columnsViewportEl ?? this.contentEl.querySelector(".arbor-columns-viewport");
    const columnsRoot = this.columnsEl ?? this.contentEl.querySelector(".arbor-columns");
    if (!viewport || !columnsRoot) {
      return;
    }
    const columns = Array.from(columnsRoot.querySelectorAll(".arbor-column"));
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (columns.length === 0) {
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const columnsRootRect = columnsRoot.getBoundingClientRect();
    const rootAnchorCenterY = viewportRect.top - columnsRootRect.top + viewport.clientHeight * 0.44;
    const resolvedCenterYByColumn = /* @__PURE__ */ new Map();
    columns.forEach((columnEl, index) => {
      const listEl = columnEl.querySelector(".arbor-card-list");
      if (!listEl) {
        return;
      }
      const fallbackCards = Array.from(columnEl.querySelectorAll(".arbor-card"));
      const preferredFallbackCard = fallbackCards[Math.floor((Math.max(fallbackCards.length, 1) - 1) / 2)] ?? null;
      const pathBlock = path[index];
      const alignmentTarget = (pathBlock ? columnEl.querySelector(`.arbor-card[data-block-id="${pathBlock.id}"]`) : null) ?? columnEl.querySelector(".arbor-column-empty") ?? preferredFallbackCard;
      if (!alignmentTarget) {
        return;
      }
      const naturalCenterY = this.getElementOffsetTopWithin(alignmentTarget, columnsRoot) + alignmentTarget.offsetHeight / 2;
      const anchorCenterY = index === 0 ? rootAnchorCenterY : resolvedCenterYByColumn.get(index - 1) ?? naturalCenterY;
      const shift = anchorCenterY - naturalCenterY;
      if (Math.abs(shift) < 0.25) {
        listEl.style.transform = "";
      } else {
        listEl.style.transform = `translate3d(0, ${shift}px, 0)`;
      }
      if (listEl.hasClass("is-rebinding")) {
        window.requestAnimationFrame(() => {
          listEl.removeClass("is-rebinding");
        });
      }
      resolvedCenterYByColumn.set(index, naturalCenterY + shift);
    });
  }
  getElementOffsetTopWithin(element, ancestor) {
    let offset = 0;
    let current = element;
    while (current && current !== ancestor) {
      offset += current.offsetTop;
      current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    return offset;
  }
  async handleEditorPaste(event, textarea) {
    const items = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    for (const item of items) {
      const file = item.getAsFile();
      if (file) {
        await this.insertImageFileIntoEditor(file, textarea);
      }
    }
  }
  async handleEditorDrop(event, textarea) {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of files) {
      await this.insertImageFileIntoEditor(file, textarea);
    }
  }
  async insertImageFileIntoEditor(file, textarea) {
    if (!this.file || !this.editingSession) {
      return;
    }
    try {
      const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(this.buildAttachmentName(file), this.file.path);
      const created = await this.app.vault.createBinary(attachmentPath, await file.arrayBuffer());
      const baseLink = this.app.fileManager.generateMarkdownLink(created, this.file.path);
      const embedLink = baseLink.startsWith("!") ? baseLink : `!${baseLink}`;
      this.insertTextAtCursor(textarea, `${textarea.value.trim().length > 0 ? "\n\n" : ""}${embedLink}`);
      this.scheduleColumnAlignment();
    } catch (error) {
      console.error("[Arbor] Failed to save pasted image", error);
      new import_obsidian2.Notice("Arbor could not save the image into the vault.");
    }
  }
  insertTextAtCursor(textarea, insertText) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const nextValue = `${textarea.value.slice(0, start)}${insertText}${textarea.value.slice(end)}`;
    textarea.value = nextValue;
    const nextCursor = start + insertText.length;
    textarea.setSelectionRange(nextCursor, nextCursor);
    textarea.dispatchEvent(new Event("input"));
  }
  buildAttachmentName(file) {
    if (file.name && file.name.trim().length > 0 && file.name !== "image.png") {
      return file.name;
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const extension = file.type.split("/")[1] || "png";
    return `Pasted image ${stamp}.${extension}`;
  }
};

// src/main.ts
var ArborPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.ownWrites = /* @__PURE__ */ new Map();
    this.suppressedAutoOpen = /* @__PURE__ */ new Map();
    this.managedNotePaths = /* @__PURE__ */ new Set();
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_ARBOR, (leaf) => new ArborView(leaf, this));
    this.addSettingTab(new ArborSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof import_obsidian3.TFile) || file.extension !== "md") {
        return;
      }
      if (this.managedNotePaths.has(file.path)) {
        void this.refreshManagedStatus(file);
      }
      void Promise.all(this.getBranchViews().map((view) => view.handleFileModified(file)));
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      void this.handleFileOpen(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      void this.handleActiveLeafChange(leaf);
    }));
    this.registerCommands();
  }
  async onunload() {
    await Promise.all(this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).map((leaf) => leaf.detach()));
  }
  async loadSettings() {
    const raw = await this.loadData();
    const payload = this.normalizePluginData(raw);
    this.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
    this.managedNotePaths.clear();
    payload.managedPaths.forEach((path) => this.managedNotePaths.add(path));
  }
  async saveSettings() {
    await this.savePluginData();
  }
  getBranchViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).map((leaf) => leaf.view).filter((view) => view instanceof ArborView);
  }
  refreshAllBranchViews() {
    this.getBranchViews().forEach((view) => {
      void view.refreshView();
    });
  }
  markOwnWrite(path) {
    this.ownWrites.set(path, (this.ownWrites.get(path) ?? 0) + 1);
  }
  consumeOwnWrite(path) {
    const count = this.ownWrites.get(path) ?? 0;
    if (count <= 0) {
      return false;
    }
    if (count === 1) {
      this.ownWrites.delete(path);
    } else {
      this.ownWrites.set(path, count - 1);
    }
    return true;
  }
  suppressAutoOpenOnce(path) {
    this.suppressedAutoOpen.set(path, (this.suppressedAutoOpen.get(path) ?? 0) + 3);
  }
  rememberManagedNote(path) {
    if (this.managedNotePaths.has(path)) {
      return;
    }
    this.managedNotePaths.add(path);
    void this.savePluginData();
  }
  forgetManagedNote(path) {
    if (!this.managedNotePaths.delete(path)) {
      return;
    }
    void this.savePluginData();
  }
  consumeSuppressedAutoOpen(path) {
    const count = this.suppressedAutoOpen.get(path) ?? 0;
    if (count <= 0) {
      return false;
    }
    if (count === 1) {
      this.suppressedAutoOpen.delete(path);
    } else {
      this.suppressedAutoOpen.set(path, count - 1);
    }
    return true;
  }
  registerCommands() {
    this.addCommand({
      id: COMMANDS.openView,
      name: "Open Arbor view for current note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.openBranchViewForFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: COMMANDS.createNote,
      name: "Create new Arbor note",
      callback: () => void this.createArborNote(true)
    });
    this.addCommand({
      id: COMMANDS.createNoteMarkdown,
      name: "Create new Arbor note in markdown editor",
      callback: () => void this.createArborNote(false)
    });
    this.addCommand({
      id: COMMANDS.createDemo,
      name: "Create Arbor demo note",
      callback: () => void this.createDemoNote()
    });
    this.addBranchCommand(COMMANDS.openBlockMenu, "Open block actions menu", (view) => {
      view.openActiveBlockMenu();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectParent, "Select parent block", (view) => {
      view.selectParentBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectPreviousSibling, "Select previous sibling block", (view) => {
      view.selectPreviousSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectNextSibling, "Select next sibling block", (view) => {
      view.selectNextSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectFirstChild, "Select first child block", (view) => {
      view.selectFirstChildBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectFirstSibling, "Select first sibling block", (view) => {
      view.selectFirstSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectLastSibling, "Select last sibling block", (view) => {
      view.selectLastSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.newRoot, "Create new root block", (view) => view.createRootBlock());
    this.addBranchCommand(COMMANDS.siblingAbove, "Create sibling above", (view) => view.createSiblingAbove());
    this.addBranchCommand(COMMANDS.siblingBelow, "Create sibling below", (view) => view.createSiblingBelow());
    this.addBranchCommand(COMMANDS.childRight, "Create child to the right", (view) => view.createChild());
    this.addBranchCommand(COMMANDS.parentLevelLeft, "Create block to the left at parent level", (view) => view.createParentLevelBlock());
    this.addBranchCommand(COMMANDS.moveUp, "Move block up among siblings", (view) => view.moveSelectedUp());
    this.addBranchCommand(COMMANDS.moveDown, "Move block down among siblings", (view) => view.moveSelectedDown());
    this.addBranchCommand(COMMANDS.moveLeft, "Move block left to parent level", (view) => view.moveSelectedLeft());
    this.addBranchCommand(COMMANDS.moveRight, "Move block right to become child of previous block", (view) => view.moveSelectedRight());
    this.addBranchCommand(COMMANDS.deleteBlock, "Delete block", (view) => view.deleteSelectedBlock());
    this.addBranchCommand(COMMANDS.deleteSubtree, "Delete subtree", (view) => view.deleteSelectedSubtree());
    this.addBranchCommand(COMMANDS.duplicateBlock, "Duplicate block", (view) => view.duplicateSelectedBlock());
    this.addBranchCommand(COMMANDS.duplicateSubtree, "Duplicate subtree", (view) => view.duplicateSelectedSubtree());
    this.addBranchCommand(COMMANDS.toggleEditMode, "Toggle edit mode", (view) => {
      view.toggleEditMode();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.revealInMarkdown, "Reveal current block in linear markdown", (view) => view.revealCurrentBlockInMarkdown());
    this.addBranchCommand(COMMANDS.rebuildMarkdown, "Rebuild linear markdown from tree", (view) => view.rebuildLinearMarkdownFromTree());
    this.addBranchCommand(COMMANDS.rebuildTree, "Rebuild tree from metadata", (view) => view.rebuildTreeFromMetadata());
    this.addBranchCommand(COMMANDS.undo, "Undo branch action", (view) => view.undo());
    this.addBranchCommand(COMMANDS.redo, "Redo branch action", (view) => view.redo());
  }
  addBranchCommand(id, name, callback) {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const available = Boolean(this.getActiveMarkdownFile() || this.getActiveBranchView()?.file);
        if (!available) {
          return false;
        }
        if (!checking) {
          void this.withBranchView(callback);
        }
        return true;
      }
    });
  }
  async withBranchView(callback) {
    const view = await this.ensureBranchViewForCurrentNote();
    if (!view) {
      new import_obsidian3.Notice("Open a markdown note first to use Arbor.");
      return;
    }
    await callback(view);
  }
  getActiveBranchView() {
    const activeView = this.app.workspace.getActiveViewOfType(ArborView);
    return activeView ?? null;
  }
  getActiveMarkdownFile() {
    const markdownView = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    return markdownView?.file ?? null;
  }
  async ensureBranchViewForCurrentNote() {
    const activeBranchView = this.getActiveBranchView();
    if (activeBranchView?.file) {
      return activeBranchView;
    }
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return null;
    }
    return this.openBranchViewForFile(file);
  }
  async openBranchViewForFile(file) {
    if (import_obsidian3.Platform.isMobileApp) {
      new import_obsidian3.Notice("Arbor is desktop-first. Mobile support is intentionally limited.");
      return null;
    }
    const existingLeaf = this.findLeafForFile(file);
    const leaf = existingLeaf ?? this.app.workspace.getLeaf("split", this.settings.splitDirection);
    await leaf.setViewState({
      type: VIEW_TYPE_ARBOR,
      active: true,
      state: {
        file: file.path
      }
    });
    this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof ArborView ? leaf.view : null;
  }
  async createDemoNote() {
    const sourcePath = `.obsidian/plugins/${this.manifest.id}/demo/Arbor Demo.md`;
    const targetPath = "40 Resources/Obsidian/Arbor Demo.md";
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof import_obsidian3.TFile) {
      await this.openBranchViewForFile(existing);
      return existing;
    }
    const sourceExists = await this.app.vault.adapter.exists(sourcePath);
    if (!sourceExists) {
      new import_obsidian3.Notice("The bundled Arbor demo note could not be found.");
      return null;
    }
    const folderPath = "40 Resources/Obsidian";
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    const demoContent = await this.app.vault.adapter.read(sourcePath);
    const file = await this.app.vault.create(targetPath, demoContent);
    await this.openBranchViewForFile(file);
    return file;
  }
  async createArborNote(openInBranchView) {
    const folderPath = this.getCreationFolderPath();
    const filePath = this.buildAvailableNotePath(folderPath, "Arbor Note");
    const file = await this.app.vault.create(filePath, "");
    if (openInBranchView) {
      await this.openBranchViewForFile(file);
    } else {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
    return file;
  }
  getCreationFolderPath() {
    const sourceFile = this.getActiveMarkdownFile() ?? this.getActiveBranchView()?.file ?? null;
    const folderPath = sourceFile?.parent?.path ?? "";
    return folderPath === "/" ? "" : folderPath;
  }
  buildAvailableNotePath(folderPath, baseName) {
    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : ` ${index}`;
      const fileName = `${baseName}${suffix}.md`;
      const candidate = folderPath ? `${folderPath}/${fileName}` : fileName;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      index += 1;
    }
  }
  findLeafForFile(file) {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).find((leaf) => {
      const view = leaf.view;
      return view instanceof ArborView && view.file?.path === file.path;
    }) ?? null;
  }
  async handleFileOpen(file) {
    if (!file || file.extension !== "md" || import_obsidian3.Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }
    if (this.consumeSuppressedAutoOpen(file.path)) {
      return;
    }
    if (!await this.isManagedBranchNote(file)) {
      return;
    }
    await this.autoOpenManagedNote(file);
  }
  async handleActiveLeafChange(leaf) {
    if (!leaf || import_obsidian3.Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }
    if (leaf.view instanceof ArborView) {
      return;
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian3.MarkdownView) || !view.file) {
      return;
    }
    if (this.consumeSuppressedAutoOpen(view.file.path)) {
      return;
    }
    if (!await this.isManagedBranchNote(view.file)) {
      return;
    }
    await this.autoOpenManagedNote(view.file, leaf);
  }
  async autoOpenManagedNote(file, preferredLeaf) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const leaf = this.findMarkdownLeafForFile(file, preferredLeaf);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_ARBOR,
          active: true,
          state: {
            file: file.path
          }
        });
        this.app.workspace.revealLeaf(leaf);
        return;
      }
      await this.wait(40 * (attempt + 1));
    }
  }
  async isManagedBranchNote(file) {
    if (this.managedNotePaths.has(file.path)) {
      return true;
    }
    const text = await this.app.vault.cachedRead(file);
    if (!this.containsMetadataMarker(text)) {
      this.forgetManagedNote(file.path);
      return false;
    }
    const managed = Boolean(parseBranchDocument(text).metadata);
    if (managed) {
      this.rememberManagedNote(file.path);
    } else {
      this.forgetManagedNote(file.path);
    }
    return managed;
  }
  findMarkdownLeafForFile(file, preferredLeaf) {
    if (preferredLeaf?.view instanceof import_obsidian3.MarkdownView && preferredLeaf.view.file?.path === file.path) {
      return preferredLeaf;
    }
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view instanceof import_obsidian3.MarkdownView && activeLeaf.view.file?.path === file.path) {
      return activeLeaf;
    }
    return this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view;
      return view instanceof import_obsidian3.MarkdownView && view.file?.path === file.path;
    }) ?? null;
  }
  wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  normalizePluginData(raw) {
    if (!raw || typeof raw !== "object") {
      return { settings: DEFAULT_SETTINGS, managedPaths: [] };
    }
    const candidate = raw;
    if ("settings" in candidate || "managedPaths" in candidate) {
      return {
        settings: { ...DEFAULT_SETTINGS, ...candidate.settings ?? {} },
        managedPaths: Array.isArray(candidate.managedPaths) ? candidate.managedPaths.filter((item) => typeof item === "string") : []
      };
    }
    return {
      settings: { ...DEFAULT_SETTINGS, ...candidate },
      managedPaths: []
    };
  }
  async savePluginData() {
    const payload = {
      settings: this.settings,
      managedPaths: [...this.managedNotePaths].sort((left, right) => left.localeCompare(right))
    };
    await this.saveData(payload);
  }
  async refreshManagedStatus(file) {
    const text = await this.app.vault.cachedRead(file);
    const managed = this.containsMetadataMarker(text) && Boolean(parseBranchDocument(text).metadata);
    if (managed) {
      this.rememberManagedNote(file.path);
    } else {
      this.forgetManagedNote(file.path);
    }
  }
  containsMetadataMarker(text) {
    return text.includes(METADATA_MARKER);
  }
};
