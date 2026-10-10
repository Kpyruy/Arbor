import type { App, TFile } from "obsidian";
import type { ArborView } from "../../src/view/ArborView";
import { buildBranchDocument, parseBranchDocument } from "../../src/storage/document";
import { loadImportedBranchDocument } from "../../src/storage/reconcile";
import { linearizeTree } from "../../src/storage/serializer";
import { generateBlockId } from "../../src/utils";
import { fixtureOutput, fixtureTree } from "../helpers/arborFixtures";
import { checkCardLinkNavigationHost } from "./cardLinkChecks";

export interface ContentIngestionHostFixture {
  app: App;
  view: ArborView;
  file: TFile;
  referenceFile: TFile;
  cleanup(): Promise<void>;
}

export interface ContentIngestionHostReceipt {
  filePath: string;
  blockId: string;
  persistedMarkdown: string;
  blockMarkdown: string;
  route: "synthetic-text" | "operator-drop" | "textarea-paste";
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function ownerWindow(view: ArborView): Window & typeof globalThis {
  const owner = view.contentEl.ownerDocument.defaultView;
  check(owner, "The receiver has no owner window");
  return owner;
}

async function waitFor(view: ArborView, condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const owner = ownerWindow(view);
  const deadline = Date.now() + 5000;
  do {
    if (await condition()) return;
    await new Promise<void>(resolve => owner.setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(message);
}

function cardFor(view: ArborView, blockId: string): HTMLElement | null {
  const { presentationMode } = view as unknown as { presentationMode: "editor" | "overview" | "output" };
  const selector = presentationMode === "overview"
    ? ".arbor-overview-card[data-block-id]"
    : presentationMode === "editor"
      ? ".arbor-card[data-block-id]"
      : null;
  if (!selector) return null;
  return Array.from(view.contentEl.querySelectorAll<HTMLElement>(selector))
    .find(card => card.dataset.blockId === blockId && !card.closest(".is-staging, .arbor-drag-preview")) ?? null;
}

function editingDraft(view: ArborView): string | undefined {
  return (view as unknown as { editor: { getSession(): { value: string } | null } }).editor.getSession()?.value;
}

function preservedState(markdown: string, blockId: string): string {
  const loaded = loadImportedBranchDocument(markdown);
  return JSON.stringify({
    frontmatter: parseBranchDocument(markdown).frontmatter,
    metadata: { ...loaded.metadata, blocks: loaded.metadata.blocks.map(block => block.id === blockId ? { ...block, content: "" } : block) },
    outputState: loaded.outputState
  });
}

async function readBlock(fixture: ContentIngestionHostFixture, blockId: string): Promise<{ raw: string; content: string }> {
  check(fixture.view.file === fixture.file, "The receiver switched away from its synthetic fixture");
  const raw = await fixture.app.vault.read(fixture.file);
  const block = loadImportedBranchDocument(raw).metadata.blocks.find(block => block.id === blockId);
  check(block, `Missing synthetic block ${blockId}`);
  return { raw, content: block.content };
}

export async function createContentIngestionHostFixture(
  app: App,
  openView: (file: TFile) => Promise<ArborView>,
  closeView: (view: ArborView) => Promise<void>
): Promise<ContentIngestionHostFixture> {
  const prefix = `Arbor-content-ingestion-${generateBlockId()}`;
  const owned: TFile[] = [];
  let view: ArborView | null = null;
  const cleanup = async () => {
    try {
      if (view) await closeView(view);
    } finally {
      for (const file of [...owned].reverse()) {
        check(app.vault.getAbstractFileByPath(file.path) === file, `Refusing cleanup of a replaced fixture: ${file.path}`);
        await app.fileManager.trashFile(file);
        owned.splice(owned.indexOf(file), 1);
      }
    }
  };
  try {
    const referenceFile = await app.vault.create(`${prefix}-reference.md`, "# Signal\n\nSynthetic reference.\n\nReference paragraph. ^source\n");
    owned.push(referenceFile);
    const tree = fixtureTree();
    tree.blocks[1].content = `First\n\n[[${referenceFile.path}#Signal|source]]`;
    tree.blocks[1].appearance = { cardColor: "#123456", branchColor: "#abcdef" };
    const file = await app.vault.create(`${prefix}-receiver.md`, buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput()));
    owned.push(file);
    view = await openView(file);
    check(view.file === file, "openView did not open the synthetic receiver");
    await waitFor(view, () => Boolean(cardFor(view!, "first")), "The synthetic receiver card did not render");
    return { app, view, file, referenceFile, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function checkContentDropHost(
  fixture: ContentIngestionHostFixture,
  blockId: string,
  incomingMarkdown: string,
  performDrop?: (card: HTMLElement) => void | Promise<void>
): Promise<ContentIngestionHostReceipt> {
  const before = await readBlock(fixture, blockId);
  const card = cardFor(fixture.view, blockId);
  check(card && !card.querySelector("textarea"), "The drop receiver must be a rendered synthetic card");
  const expected = before.content ? `${before.content}\n\n${incomingMarkdown}` : incomingMarkdown;
  if (performDrop) {
    await performDrop(card);
  } else {
    const owner = ownerWindow(fixture.view);
    const transfer = new owner.DataTransfer();
    transfer.setData("text/plain", incomingMarkdown);
    const event = new owner.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
    (card.querySelector("a") ?? card).dispatchEvent(event);
    check(event.defaultPrevented, "The synthetic text drop was not claimed");
  }
  await waitFor(fixture.view, async () => (await readBlock(fixture, blockId)).content === expected, "Drop did not persist exactly one append to its original card");
  await new Promise<void>(resolve => ownerWindow(fixture.view).setTimeout(resolve, 150));
  const after = await readBlock(fixture, blockId);
  check(after.content === expected, "Drop was duplicated after the initial write");
  check(preservedState(after.raw, blockId) === preservedState(before.raw, blockId), "Drop changed topology, another block, appearance or output profiles");
  return { filePath: fixture.file.path, blockId, persistedMarkdown: after.raw, blockMarkdown: after.content, route: performDrop ? "operator-drop" : "synthetic-text" };
}

async function prepareTextareaPasteHost(fixture: ContentIngestionHostFixture, blockId: string) {
  check(!fixture.view.contentEl.classList.contains("has-touch-controls"), "This textarea host check requires desktop controls; physical-mobile verification is separate");
  const before = await readBlock(fixture, blockId);
  const owner = ownerWindow(fixture.view);
  const card = cardFor(fixture.view, blockId);
  check(card, "Missing textarea receiver card");
  card.dispatchEvent(new owner.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  await waitFor(fixture.view, () => Boolean(cardFor(fixture.view, blockId)?.querySelector("textarea.arbor-editor")), "The actual editor did not open");
  const editor = cardFor(fixture.view, blockId)!.querySelector<HTMLTextAreaElement>("textarea.arbor-editor")!;
  await new Promise<void>(resolve => owner.requestAnimationFrame(() => resolve()));
  editor.value = "ABC";
  editor.dispatchEvent(new owner.Event("input", { bubbles: true }));
  editor.setSelectionRange(1, 2);
  const clipboardData = new owner.DataTransfer();
  clipboardData.setData("text/plain", "quote");
  const event = new owner.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
  editor.dispatchEvent(event);
  check(event.defaultPrevented, "The textarea Paste was not claimed");
  await waitFor(fixture.view, () => editor.value === "AquoteC", "Paste did not replace the actual textarea selection");
  check(editor.selectionStart === 6 && editor.selectionEnd === 6, "Paste moved the caret away from the inserted text");
  await new Promise<void>(resolve => owner.setTimeout(resolve, 150));
  check(editingDraft(fixture.view) === "AquoteC", "Paste did not update the editing session through input");
  check((await fixture.app.vault.read(fixture.file)) === before.raw, "Textarea Paste wrote to disk before explicit save");
  return { before, owner, editor };
}

export async function checkTextareaPasteHost(fixture: ContentIngestionHostFixture, blockId = "first"): Promise<ContentIngestionHostReceipt> {
  const { before, owner, editor } = await prepareTextareaPasteHost(fixture, blockId);
  editor.dispatchEvent(new owner.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  await waitFor(fixture.view, async () => (await readBlock(fixture, blockId)).content === "AquoteC", "Explicit save did not persist the input-updated draft");
  const after = await readBlock(fixture, blockId);
  check(preservedState(after.raw, blockId) === preservedState(before.raw, blockId), "Caret save changed unrelated document state");
  return { filePath: fixture.file.path, blockId, persistedMarkdown: after.raw, blockMarkdown: after.content, route: "textarea-paste" };
}

export async function checkTextareaPasteUndoHost(fixture: ContentIngestionHostFixture, blockId = "first") {
  const document = fixture.view.contentEl.ownerDocument as unknown as { execCommand?: (command: string) => boolean };
  check(typeof document.execCommand === "function", "Cannot verify native Undo: owner document execCommand is unavailable");
  const { before, editor } = await prepareTextareaPasteHost(fixture, blockId);
  editor.focus({ preventScroll: true });
  check(document.execCommand("undo"), "Cannot verify native Undo: the browser did not accept undo");
  await waitFor(fixture.view, () => editor.value === "ABC" && editingDraft(fixture.view) === "ABC", "Native Undo did not restore ABC in both textarea and session");
  const after = await readBlock(fixture, blockId);
  check(after.raw === before.raw, "Native Undo wrote the draft to disk");
  return { filePath: fixture.file.path, blockId, textareaAfterUndo: editor.value, sessionAfterUndo: editingDraft(fixture.view), diskUnchanged: true };
}

export async function checkIncomingReferenceOpeningHost(
  fixture: ContentIngestionHostFixture,
  blockId: string,
  expectedLinktext: string,
  expectedFilePath = fixture.referenceFile.path
): Promise<{ linktext: string; openedFilePath: string; persistedMarkdown: string }> {
  const persistedMarkdown = await fixture.app.vault.read(fixture.file);
  const findAnchor = () => Array.from(cardFor(fixture.view, blockId)?.querySelectorAll<HTMLAnchorElement>("a.internal-link") ?? [])
    .find(anchor => (anchor.getAttribute("data-href") ?? anchor.getAttribute("href")) === expectedLinktext);
  await waitFor(fixture.view, () => Boolean(findAnchor()), "The imported alias/subpath did not render");
  const anchor = findAnchor();
  check(anchor, "The imported alias/subpath has no matching native Markdown link");
  await checkCardLinkNavigationHost(fixture.app, anchor, expectedLinktext, fixture.file.path);
  await waitFor(fixture.view, () => fixture.app.workspace.getActiveFile()?.path === expectedFilePath, "Reference activation did not open the expected file");
  const after = await fixture.app.vault.read(fixture.file);
  check(after === persistedMarkdown, "Reference activation changed the receiver Markdown");
  return { linktext: expectedLinktext, openedFilePath: expectedFilePath, persistedMarkdown };
}
