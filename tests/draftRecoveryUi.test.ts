import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { TFile } from "obsidian";
import type { DocumentPort } from "../src/view/state/DocumentController";
import type { EditingSession } from "../src/view/state/viewTypes";
import type { BranchTreeMetadata, BranchTreeMutationResult } from "../src/types";
import { buildBranchDocument, parseBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { deferred, fixtureTree } from "./helpers/arborFixtures";

type Node = { text: string; value: string; children: Node[]; removed: boolean; remove(): void };
type HostModal = { contentEl: Node; opened: boolean; closed: boolean };
type HostButton = { text: string; action(): unknown; disabled: boolean };
interface RecoveryView {
  file: TFile;
  loadGeneration: number;
  contentEl: { win: { navigator: { clipboard: { writeText(text: string): Promise<void> } } } };
  overview: { invalidate(): void };
  commitEditIfNeeded(): Promise<void>;
  render(): void;
  onEditorCancel(session: EditingSession | null): void;
  onEditorUnchanged(session: EditingSession): Promise<void>;
  onEditorCommitted(session: EditingSession): void;
  onLoadFile(): Promise<void>;
  onClose(): Promise<void>;
  onUnloadFile(): Promise<void>;
  beginLoad(): number;
  showDraftRecovery(): void;
  applyMutation(label: string, mutate: (tree: BranchTreeMetadata) => BranchTreeMutationResult): Promise<void>;
  openTreeOverview(): void;
  closeTreeOverview(): void;
  selectBlock(blockId: string | null): void;
  openCurrentFileInMarkdown(): Promise<void>;
  revealCurrentBlockInMarkdown(): Promise<void>;
  rebuildLinearMarkdownFromTree(): Promise<void>;
  overviewEffects: string[];
  markdownEffects: string[];
  rebuildEffects: string[];
  presentationMode: string;
}
type Module = {
  ArborView: typeof import("../src/view/ArborView").ArborView;
  BlockEditorController: typeof import("../src/view/editor/BlockEditorController").BlockEditorController;
  DocumentController: typeof import("../src/view/state/DocumentController").DocumentController;
  DraftRecoveryStore: typeof import("../src/view/editor/DraftRecoveryStore").DraftRecoveryStore;
  Host: { Modal: { instances: HostModal[] }; ButtonComponent: { instances: HostButton[] }; FileView: { closes: number } };
};
let runtime: Module;
let bundleDirectory: string;
afterAll(async () => { if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true }); });

beforeAll(async () => {
  const result = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, format: "esm", platform: "node",
    stdin: { contents: [
      'export { ArborView } from "./src/view/ArborView";',
      'export { BlockEditorController } from "./src/view/editor/BlockEditorController";',
      'export { DocumentController } from "./src/view/state/DocumentController";',
      'export { DraftRecoveryStore } from "./src/view/editor/DraftRecoveryStore";',
      'export * as Host from "obsidian";'
    ].join("\n"), resolveDir: process.cwd() },
    plugins: [{ name: "recovery-ui-host", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "js", contents: `
        function element(text = '') {
          return { text, value: '', children: [], removed: false,
            createEl(tag, options = {}) { const child = element(options.text); child.tag = tag; this.children.push(child); return child; },
            createDiv(options = {}) { return this.createEl('div', options); },
            addClass() {}, empty() { this.children = []; }, remove() { this.removed = true; }
          };
        }
        export class Modal { static instances = []; constructor() { this.contentEl = element(); this.modalEl = element(); Modal.instances.push(this); } open() { this.opened = true; } close() { this.closed = true; } }
        export class ButtonComponent { static instances = []; constructor(container) { this.text = ''; this.disabled = false; this.container = container; ButtonComponent.instances.push(this); } setButtonText(text) { this.text = text; return this; } setDisabled(value) { this.disabled = value; return this; } setCta() { return this; } setWarning() { return this; } onClick(action) { this.action = action; return this; } }
        export class FileView { static closes = 0; onClose() { FileView.closes += 1; return Promise.resolve(); } }
        export class Notice {}
        export class Menu {}
        export class App {}
        export class MarkdownView {}
        export class TFile {}
        export class WorkspaceLeaf {}
        export const MarkdownRenderer = {};
        export const Keymap = { isModEvent: () => false };
        export const Platform = {};
        export const parseLinktext = text => ({path: text, subpath: ''});
        export const resolveSubpath = () => null;
        export const setIcon = () => {};
      ` }));
      builder.onResolve({ filter: /^html-to-image$/ }, () => ({ path: "image", namespace: "image" }));
      builder.onLoad({ filter: /.*/, namespace: "image" }, () => ({ loader: "js", contents: "export const toBlob = async () => null;" }));
    } }]
  });
  bundleDirectory = await mkdtemp(`${tmpdir()}/arbor-draft-ui-`);
  const modulePath = `${bundleDirectory}/runtime.mjs`;
  await writeFile(modulePath, result.outputFiles[0].text);
  runtime = await import(pathToFileURL(modulePath).href) as Module;
});

async function fixture() {
  runtime.Host.Modal.instances.length = 0;
  runtime.Host.ButtonComponent.instances.length = 0;
  const tree = fixtureTree();
  const files: { a: TFile; b: TFile } = { a: { path: "Recovery.md" } as never, b: { path: "Other.md" } as never };
  let file = files.a;
  const disk = new Map([[files.a.path, buildBranchDocument("", linearizeTree(tree).body, tree)],
    [files.b.path, buildBranchDocument("", linearizeTree(tree).body, tree)]]);
  let writes: string[] = [];
  const clipboard: string[] = [];
  const errors: unknown[] = [];
  const overviewEffects: string[] = [];
  const markdownEffects: string[] = [];
  const rebuildEffects: string[] = [];
  const store = new runtime.DraftRecoveryStore();
  const view = Object.create(runtime.ArborView.prototype) as RecoveryView;
  const port: DocumentPort = {
    getFile: () => file, cachedRead: async target => disk.get(target.path)!,
    process: async (target, transform) => { const contents = transform(disk.get(target.path)!); disk.set(target.path, contents); writes.push(target.path); return contents; },
    markOwnWrite() {}, rememberManagedNote() {}, commitEditIfNeeded: () => view.commitEditIfNeeded(),
    clearEditingSession: () => editor.reset(), beforeOverviewEditSave() {}, onMutationPrepared() {}, onSelectionRestored() {},
    onEditedBlockSaved() {}, onProfileActivated() {}, requestRender: () => view.render(), notify() {}, reportError() {}
  };
  const controller = new runtime.DocumentController(port);
  controller.replaceLoadedState((await controller.readLoadedFileState(file, "first")).state);
  const editor = new runtime.BlockEditorController({
    getState: () => controller.getState(), getFilePath: () => file.path, getLoadedFileIdentity: () => controller.getLoadedFileIdentity(), recoveryStore: store,
    usesTouchControls: () => false, getViewportHeight: () => 600, onBegin() {}, onCancel: session => view.onEditorCancel(session),
    onUnchanged: session => view.onEditorUnchanged(session), saveEdit: session => controller.commitEditedBlock(session),
    onCommitted: session => view.onEditorCommitted(session), onInput() {}, handleSearchShortcut: () => false,
    paste: async () => {}, drop: async () => {}
  });
  let editorVisible = false;
  Object.assign(view, {
    file, loadGeneration: 1, documentController: controller, editor, presentationMode: "editor",
    contentEl: { win: { navigator: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } } } },
    reportActionError: (error: unknown) => errors.push(error),
    onLoadFile: async () => { view.loadGeneration += 1; editor.reset(); controller.reset(); view.file = file; controller.replaceLoadedState((await controller.readLoadedFileState(file, "first")).state); },
    overview: { invalidate() {}, requestCenterOnNextRender() { overviewEffects.push("center"); } },
    syncLocalHeadingLinks() {},
    overviewEffects, markdownEffects, rebuildEffects,
    plugin: { draftRecoveryStore: store, openFileInMarkdownView: async (_leaf: unknown, target: TFile) => { markdownEffects.push(`open:${target.path}`); }, suppressAutoOpenOnce() {} },
    app: { vault: { cachedRead: (target: TFile) => port.cachedRead(target) }, workspace: {
      getLeavesOfType: () => [], getLeaf: () => ({ openFile: async (target: TFile) => { markdownEffects.push(`reveal:${target.path}`); }, view: { editor: { setCursor() {}, focus() {} } } }),
      setActiveLeaf: () => { markdownEffects.push("activate"); }
    } },
    persistState: async () => { rebuildEffects.push(file.path); },
    syncTouchDock() {},
    render: () => { editorVisible = editor.getSession() !== null; overviewEffects.push("render"); }
  });
  return { view, editor, controller, store, port, clipboard, errors, files, overviewEffects, markdownEffects, rebuildEffects, get file() { return file; }, get writes() { return writes; },
    get disk() { return disk.get(file.path)!; }, set disk(text: string) { disk.set(file.path, text); }, get editorVisible() { return editorVisible; },
    async switchToB() { file = files.b; await view.onLoadFile(); } };
}

describe("draft recovery UI and view boundaries", () => {
  it.each(["openTreeOverview", "closeTreeOverview", "selectBlock", "openCurrentFileInMarkdown", "revealCurrentBlockInMarkdown", "rebuildLinearMarkdownFromTree"] as const)(
    "does not run the %s continuation against a newly loaded file", async method => {
      const test = await fixture();
      const durable = deferred<void>();
      const receipt = deferred<void>();
      const process = test.port.process.bind(test.port);
      test.port.process = async (target, transform) => {
        const persisted = await process(target, transform);
        durable.resolve();
        await receipt.promise;
        return persisted;
      };
      if (method === "closeTreeOverview") test.view.presentationMode = "overview";
      test.editor.beginEditingBlock("first");
      test.editor.getSession()!.value = "Saved A while following up";
      const promise = method === "openTreeOverview" || method === "closeTreeOverview"
        ? (test.view[method](), null)
        : method === "selectBlock" ? (test.view.selectBlock("second"), null)
        : test.view[method]();
      await durable.promise;
      await test.switchToB();
      const bState = structuredClone(test.controller.getState());
      receipt.resolve();
      if (promise) await promise;
      else await new Promise<void>(resolve => setImmediate(resolve));
      expect(test.writes).toEqual(["Recovery.md"]);
      expect(test.controller.getState()).toEqual(bState);
      expect(test.overviewEffects).toEqual([]);
      expect(test.markdownEffects).toEqual([]);
      expect(test.rebuildEffects).toEqual([]);
      expect(test.view.presentationMode).toBe(method === "closeTreeOverview" ? "overview" : "editor");
      expect(test.errors).toEqual([]);
    }
  );

  it.each(["openTreeOverview", "closeTreeOverview", "selectBlock", "openCurrentFileInMarkdown", "revealCurrentBlockInMarkdown", "rebuildLinearMarkdownFromTree"] as const)(
    "still runs %s after a successful same-load save", async method => {
      const test = await fixture();
      if (method === "closeTreeOverview") test.view.presentationMode = "overview";
      test.editor.beginEditingBlock("first");
      test.editor.getSession()!.value = "Saved A on same load";
      if (method === "openTreeOverview" || method === "closeTreeOverview") {
        test.view[method]();
        await new Promise<void>(resolve => setImmediate(resolve));
      } else if (method === "selectBlock") {
        test.view.selectBlock("second");
        await new Promise<void>(resolve => setImmediate(resolve));
      } else {
        await test.view[method]();
      }
      expect(test.writes).toEqual(["Recovery.md"]);
      if (method === "openTreeOverview") expect(test.view.presentationMode).toBe("overview");
      if (method === "closeTreeOverview") expect(test.view.presentationMode).toBe("editor");
      if (method === "selectBlock") expect(test.controller.getState()?.selectedBlockId).toBe("second");
      if (method === "openCurrentFileInMarkdown") expect(test.markdownEffects).toEqual(["open:Recovery.md"]);
      if (method === "revealCurrentBlockInMarkdown") expect(test.markdownEffects).toContain("reveal:Recovery.md");
      if (method === "rebuildLinearMarkdownFromTree") expect(test.rebuildEffects).toEqual(["Recovery.md"]);
    }
  );

  it.each(["onClose", "onUnloadFile"] as const)("retains a failed draft while %s completes unavoidable cleanup", async method => {
    const test = await fixture();
    const failure = Error("disk full");
    const previousCloses = runtime.Host.FileView.closes;
    test.port.process = async () => { throw failure; };
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Kept after close";
    const reset = () => {};
    Object.assign(test.view, {
      work: { reset, dispose: reset }, clearHeadingSubscription: reset,
      overview: { invalidate: reset, reset }, navigationController: { clearNumericNavigation: reset },
      zoomController: { reset }, touchController: { reset }, branchViewport: { reset }, overviewViewport: { reset },
      dragDropController: { reset }, search: { reset }, preview: { reset }, output: { reset },
      clearBlurCommitTimer: reset, clearBreadcrumbScrollFrame: reset, cleanupViewportPan: reset, cleanupOverviewPan: reset, teardownShell: reset
    });
    await expect(test.view[method]()).rejects.toMatchObject({ name: "DocumentWriteError", cause: failure });
    expect(test.editor.getSession()).toBeNull();
    expect(test.controller.getState()).toBeNull();
    expect(test.store.getForFile(test.file.path)).toMatchObject([{ value: "Kept after close" }]);
    if (method === "onClose") expect(runtime.Host.FileView.closes).toBe(previousCloses + 1);
  });
  it("invalidates a pending same-file write at reload start, before the new read completes", async () => {
    const test = await fixture();
    const gate = deferred<void>();
    const entered = deferred<void>();
    const process = test.port.process.bind(test.port);
    test.port.process = async (file, transform) => { entered.resolve(); await gate.promise; return process(file, transform); };
    const save = test.controller.saveOverviewOrientation("horizontal");
    await entered.promise;
    const rejection = expect(save).rejects.toMatchObject({ name: "DocumentLoadChangedError" });
    test.view.overview = { invalidate() {} };
    test.view.beginLoad();
    gate.resolve();
    await rejection;
    expect(test.writes).toHaveLength(0);
  });
  it("shows current and both recovered values; Restore creates only the chosen draft", async () => {
    const test = await fixture();
    for (const [draftId, value] of [["one", "First recovery"], ["two", "Second recovery"]]) {
      test.store.retain({ draftId, value, filePath: test.file.path, blockId: "first", originalContent: "Older content" });
    }
    test.view.showDraftRecovery();
    const modal = runtime.Host.Modal.instances[0];
    expect(modal.opened).toBe(true);
    const collectValues = (node: Node): string[] => [node.value, ...node.children.flatMap(collectValues)].filter(Boolean);
    expect(collectValues(modal.contentEl)).toEqual(expect.arrayContaining(["First", "First recovery", "Second recovery"]));
    const restores = runtime.Host.ButtonComponent.instances.filter(button => button.text === "Restore");
    await restores[1].action();
    expect(test.editor.getSession()).toMatchObject({ value: "Second recovery", originalContent: "First", recoveryId: "two" });
    expect(test.writes).toHaveLength(0);
    expect(test.store.getAll(test.file.path, "first")).toHaveLength(2);
    await test.editor.commitEditIfNeeded();
    expect(test.store.getAll(test.file.path, "first").map(draft => draft.draftId)).toEqual(["one"]);
  });

  it("Copy failure keeps the recovery and explicit Discard removes only its own entry", async () => {
    const test = await fixture();
    test.store.retain({ draftId: "one", value: "Recovery", filePath: test.file.path, blockId: "first", originalContent: "First" });
    test.view.contentEl.win.navigator.clipboard.writeText = async () => { throw Error("Clipboard denied"); };
    test.view.showDraftRecovery();
    await runtime.Host.ButtonComponent.instances.find(button => button.text === "Copy")!.action();
    expect(test.store.getAll(test.file.path, "first")).toHaveLength(1);
    await runtime.Host.ButtonComponent.instances.find(button => button.text === "Discard")!.action();
    expect(test.store.getAll(test.file.path, "first")).toEqual([]);
    expect(test.writes).toHaveLength(0);
  });

  it("offers Copy and Discard for a retained draft whose block no longer exists", async () => {
    const test = await fixture();
    test.store.retain({ draftId: "orphan", value: "Deleted card draft", filePath: test.file.path, blockId: "deleted", originalContent: "Original" });
    test.view.showDraftRecovery();
    expect(runtime.Host.Modal.instances[0].opened).toBe(true);
    expect(runtime.Host.ButtonComponent.instances.find(button => button.text === "Restore")!.disabled).toBe(true);
    await runtime.Host.ButtonComponent.instances.find(button => button.text === "Copy")!.action();
    expect(test.clipboard).toEqual(["Deleted card draft"]);
    expect(test.store.getAll(test.file.path, "deleted")).toHaveLength(1);
  });

  it("rerenders after the saved editing session clears, not only before", async () => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Saved";
    test.view.render();
    expect(test.editorVisible).toBe(true);
    await test.editor.commitEditIfNeeded();
    expect(test.editor.getSession()).toBeNull();
    expect(test.editorVisible).toBe(false);
  });

  it("reloads an external edit after cancel before allowing another mutation", async () => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Cancelled draft";
    test.disk = test.disk.replace("Second", "External second");
    test.editor.cancelEditingSession();
    await test.view.applyMutation("Import", (tree: ReturnType<typeof fixtureTree>) => ({
      metadata: { ...tree, blocks: tree.blocks.map(block => block.id === "first" ? { ...block, content: "Imported" } : block) },
      selectedBlockId: "first"
    }));
    expect(parseBranchDocument(test.disk).body).toContain("External second");
    expect(parseBranchDocument(test.disk).body).toContain("Imported");
    expect(test.store.getAll(test.file.path, "first")[0].value).toBe("Cancelled draft");
  });
});
