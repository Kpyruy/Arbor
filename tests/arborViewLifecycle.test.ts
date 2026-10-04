import { build } from "esbuild";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ViewWorkScope } from "../src/view/runtime/ViewWorkScope";
import type { TFile } from "obsidian";
import { buildBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import type { DocumentPort } from "../src/view/state/DocumentController";
import type { LoadingOverlayState } from "../src/view/state/viewTypes";
import { fixtureSettings, fixtureTree } from "./helpers/arborFixtures";
import type { BranchHistory } from "../src/history";
import { TreeOverviewController } from "../src/view/overview/TreeOverviewController";

type LifecycleModule = typeof import("../src/view/ArborView") & {
  DocumentController: typeof import("../src/view/state/DocumentController").DocumentController;
};

type TestFile = TFile;

type BundledDocumentController = InstanceType<LifecycleModule["DocumentController"]>;

interface TestView {
  file: TestFile;
  loadGeneration: number;
  loadingState: LoadingOverlayState | null;
  documentController: BundledDocumentController;
  plugin: {
    consumeExplicitArborOpen(): boolean;
    rememberManagedNote(path: string): void;
    settings: { defaultPresentationMode: "editor"; layoutDirection: "ltr" };
    openFileInMarkdownView(leaf: unknown, file: TestFile): Promise<void>;
  };
  onLoadFile(file: TestFile): Promise<void>;
  refreshView(): Promise<void>;
  onUnloadFile(): Promise<void>;
  onClose(): Promise<void>;
  clear(): void;
  render(): void;
  getOverviewOrientation(): string;
  setOverviewOrientationOverride(value: "horizontal" | "vertical-top-down" | "vertical-bottom-up" | null): Promise<void>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface LifecycleHarness {
  view: TestView;
  files: { a: TestFile; b: TestFile };
  disk: Map<string, string>;
  writes: Array<{ path: string; contents: string }>;
  remembered: string[];
  opened: string[];
  paintWaiters: Array<Deferred<void>>;
  processWaiters: Array<Deferred<void>>;
  renderCount: number;
  setFile(file: TestFile): void;
  queueRead(file: TestFile, result: Promise<string>): void;
}

let lifecycle: LifecycleModule;

beforeAll(async () => {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      contents: [
        'export { ArborView } from "./src/view/ArborView";',
        'export { DocumentController } from "./src/view/state/DocumentController";'
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "arbor-view-lifecycle-test-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-host" }));
        builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
          contents: [
            "export class App {}",
            "export class ButtonComponent {}",
            "export class FileView { onClose() { return Promise.resolve(); } }",
            "export class MarkdownView {}",
            "export class Menu {}",
            "export class Modal {}",
            "export const MarkdownRenderer = {};",
            "export const Keymap = { isModEvent: () => false };",
            "export const parseLinktext = (text) => { const index = text.indexOf('#'); return { path: index < 0 ? text : text.slice(0, index), subpath: index < 0 ? '' : text.slice(index) }; };",
            "export const resolveSubpath = () => null;",
            "export const Platform = {};",
            "export class Notice {}",
            "export class TFile {}",
            "export class WorkspaceLeaf {}",
            "export const setIcon = () => undefined;"
          ].join("\n"),
          loader: "js"
        }));
        builder.onResolve({ filter: /^html-to-image$/ }, () => ({ path: "html-to-image", namespace: "image-host" }));
        builder.onLoad({ filter: /.*/, namespace: "image-host" }, () => ({
          contents: "export const toBlob = async () => null;",
          loader: "js"
        }));
      }
    }]
  });

  const source = bundled.outputFiles[0].text;
  const loaded: unknown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  lifecycle = loaded as LifecycleModule;
});

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: (value) => resolvePromise(value) };
}

describe("Heading Linker subscription lifecycle", () => {
  it("observes index changes even when Reading highlighting is initially disabled", () => {
    const callbacks: Array<() => void> = [];
    const decorated: unknown[] = [];
    const provider = {
      settings: { highlightInReading: false },
      api: {
        getTerms: () => [{ path: "QA.md", linktext: "QA#Target" }],
        findMatches: () => [],
        onChange: (callback: () => void) => {
          callbacks.push(callback);
          return () => { callbacks.splice(callbacks.indexOf(callback), 1); };
        }
      }
    };
    const view = Object.create(lifecycle.ArborView.prototype) as {
      syncLocalHeadingLinks(): void;
      clearHeadingSubscription(): void;
    };
    Object.assign(view, {
      file: { path: "QA.md" },
      app: { plugins: { plugins: { "heading-linker": provider } }, vault: { getAbstractFileByPath: () => null } },
      documentController: { getState: () => fixtureTree() },
      contentEl: { querySelectorAll: () => [{}] },
      localHeadingLinks: { decorate: (_content: unknown, _path: string, snapshot: unknown) => { decorated.push(snapshot); } }
    });
    view.syncLocalHeadingLinks();
    expect(decorated).toEqual([null]);
    expect(callbacks).toHaveLength(1);
    provider.settings.highlightInReading = true;
    callbacks[0]();
    expect(decorated[1]).toMatchObject({ targets: new Set(["QA#Target"]) });
    expect(callbacks).toHaveLength(1);
    view.clearHeadingSubscription();
    expect(callbacks).toHaveLength(0);
  });
});

describe("orientation-only lifecycle", () => {
  function pendingOverview(harness: LifecycleHarness): { work: ViewWorkScope; token: number } {
    const overview = new TreeOverviewController({
      read: { getState: () => harness.view.documentController.getState(), getSettings: fixtureSettings, getMode: () => "overview", getFilePath: () => harness.view.file.path },
      editor: { getSession: () => null, beginEditingBlock() {}, commitEditIfNeeded: async () => {}, clearBlurCommitTimer() {}, wireEditorElement() {}, resizeEditor() {} },
      markdown: { render: async () => {} }, selection: { selectBlock() {} }, getBody: () => null,
      getContext: () => null, getOverviewOrientation: () => "horizontal", bindViewport: () => () => {},
      openBlockMenu() {}, setHoveredBlock() {}, restoreViewport() {}, centerSelected() {}, revealSelected() {},
      syncTouchDock() {}, requestRender() {}, waitForNextPaint: async () => {}, syncOutputCardPresentation() {},
      consumeAutofocus() {}, clearPendingFocus() {}, tryHandleCardLink: () => false
    });
    Object.assign(harness.view, { overview });
    const work = Reflect.get(overview, "work") as unknown as ViewWorkScope;
    return { work, token: work.token() };
  }

  it("invalidates real overview work at same-source load start before the read completes", async () => {
    const harness = createHarness();
    await harness.view.onLoadFile(harness.files.a);
    const previous = harness.view.documentController.getState();
    const { work, token } = pendingOverview(harness);
    const reading = deferred<string>();
    harness.queueRead(harness.files.a, reading.promise);
    const reload = harness.view.onLoadFile(harness.files.a);
    try {
      expect(harness.view.documentController.getState()).toBe(previous);
      expect(work.isCurrent(token)).toBe(false);
    } finally { reading.resolve(harness.disk.get("A.md")!); await reload; }
  });

  it.each(["onUnloadFile", "onClose"] as const)("invalidates overview work immediately on %s before the normal pending save finishes", async method => {
    const harness = createHarness();
    const { work, token } = pendingOverview(harness);
    const saving = deferred<void>();
    Object.assign(harness.view, { commitEditIfNeeded: () => saving.promise });
    const closing = harness.view[method]();
    try { expect(work.isCurrent(token)).toBe(false); }
    finally { saving.resolve(); await closing; }
  });

  it.each(["onUnloadFile", "onClose"] as const)("cancels a queued overview camera frame on %s even if the browser delivers its old callback", async method => {
    const harness = createHarness();
    const { work } = pendingOverview(harness);
    const frames = new Map<number, FrameRequestCallback>();
    let cameraMoves = 0;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(1, callback); return 1; },
      cancelAnimationFrame: (id: number) => frames.delete(id)
    });
    try {
      work.frame(window, () => { cameraMoves += 1; });
      const staleFrame = frames.get(1)!;
      await harness.view[method]();
      expect(frames.size).toBe(0);
      staleFrame(0);
      expect(cameraMoves).toBe(0);
      expect(harness.writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps loaded source, selected ID, output profiles, history and draft without saving", async () => {
    const harness = createHarness();
    await harness.view.onLoadFile(harness.files.a);
    const source = harness.disk.get("A.md");
    const state = harness.view.documentController.getState();
    const history = Reflect.get(harness.view.documentController, "history") as unknown as BranchHistory;
    if (!state) throw Error("Expected loaded source");
    history.push("Prior edit", state.metadata, state.outputState, state.selectedBlockId);
    const historyBefore = JSON.stringify(history);
    const session = { blockId: "a-block", origin: "overview", value: "Unsaved draft", autofocus: false };
    const render = vi.fn();
    Object.assign(harness.view, {
      render,
      overviewOrientationOverride: null, overviewOrientationChangeGeneration: 0,
      app: { workspace: { requestSaveLayout() {} } },
      overview: { invalidate() {}, requestCenterOnNextRender() {} },
      overviewViewport: { discardPendingRestore() {} },
      editor: { getSession: () => session },
      commitEditIfNeeded: async () => { harness.disk.set("A.md", session.value); session.value = ""; }
    });
    await harness.view.setOverviewOrientationOverride("vertical-top-down");
    await harness.view.setOverviewOrientationOverride("vertical-bottom-up");
    const rendersAfterPublication = render.mock.calls.length;
    await harness.view.setOverviewOrientationOverride("vertical-bottom-up");
    expect(render.mock.calls.length).toBe(rendersAfterPublication);
    expect(harness.view.getOverviewOrientation()).toBe("vertical-bottom-up");
    expect(harness.disk.get("A.md")).toBe(source);
    expect(session.value).toBe("Unsaved draft");
    expect(harness.view.documentController.getState()).toBe(state);
    expect(JSON.stringify(history)).toBe(historyBefore);
    expect(harness.writes).toEqual([]);
  });
});

function documentFor(label: string, legacy: boolean): string {
  const metadata = {
    ...fixtureTree(),
    blocks: [{
      id: `${label.toLowerCase()}-block`,
      parentId: null,
      order: 0,
      content: `Content ${label}`,
      after: ""
    }]
  };
  const body = linearizeTree(metadata).body;
  if (!legacy) {
    return buildBranchDocument("", body, metadata);
  }

  const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");
  return `${body}\n<!-- arbor:metadata:v1\n${encoded}\n-->`;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await flush();
  }
  throw new Error("Controlled lifecycle condition did not become true");
}

function createHarness(options: { legacyA?: boolean; legacyB?: boolean; manualPaint?: boolean; manualProcess?: boolean } = {}): LifecycleHarness {
  const files = {
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- lightweight controlled vault fixture
    a: { path: "A.md", basename: "A" } as unknown as TFile,
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- lightweight controlled vault fixture
    b: { path: "B.md", basename: "B" } as unknown as TFile
  };
  const disk = new Map([
    [files.a.path, documentFor("A", options.legacyA ?? false)],
    [files.b.path, documentFor("B", options.legacyB ?? false)]
  ]);
  const writes: Array<{ path: string; contents: string }> = [];
  const remembered: string[] = [];
  const opened: string[] = [];
  const paintWaiters: Array<Deferred<void>> = [];
  const processWaiters: Array<Deferred<void>> = [];
  const queuedReads = new Map<string, Array<Promise<string>>>();
  let currentFile = files.a;
  let renderCount = 0;

  const port: DocumentPort = {
    getFile: () => currentFile,
    cachedRead: (file: TestFile) => queuedReads.get(file.path)?.shift() ?? Promise.resolve(disk.get(file.path) ?? ""),
    process: async (file: TestFile, transform: (text: string) => string) => {
      if (options.manualProcess) {
        const pending = deferred<void>();
        processWaiters.push(pending);
        await pending.promise;
      }
      const contents = transform(disk.get(file.path) ?? "");
      disk.set(file.path, contents);
      writes.push({ path: file.path, contents });
      return contents;
    },
    markOwnWrite: () => undefined,
    rememberManagedNote: (path: string) => { remembered.push(path); },
    commitEditIfNeeded: async () => undefined,
    clearEditingSession: () => undefined,
    beforeOverviewEditSave: () => undefined,
    onMutationPrepared: () => undefined,
    onSelectionRestored: () => undefined,
    onEditedBlockSaved: () => undefined,
    onProfileActivated: () => undefined,
    requestRender: () => undefined,
    notify: () => undefined,
    reportError: () => undefined
  };

  const view = Object.create(lifecycle.ArborView.prototype) as TestView;
  Object.assign(view, {
    loadGeneration: 0,
    work: new ViewWorkScope(),
    renderGeneration: 0,
    file: currentFile,
    documentController: new lifecycle.DocumentController(port),
    plugin: {
      consumeExplicitArborOpen: () => false,
      rememberManagedNote: (path: string) => { remembered.push(path); },
      settings: { defaultPresentationMode: "editor", layoutDirection: "ltr" },
      openFileInMarkdownView: async (_leaf: unknown, file: TestFile) => { opened.push(file.path); }
    },
    leaf: {},
    editor: { reset: () => undefined },
    zoomController: { reset: () => undefined },
    touchController: { reset: () => undefined },
    navigationController: { clearNumericNavigation: () => undefined },
    branchViewport: { reset: () => undefined },
    overviewViewport: { reset: () => undefined },
    overview: { reset: () => undefined, invalidate: () => undefined },
    dragDropController: { reset: () => undefined },
    search: { reset: () => undefined },
    preview: { reset: () => undefined },
    output: { reset: () => undefined },
    clearBlurCommitTimer: () => undefined,
    clearBreadcrumbScrollFrame: () => undefined,
    cleanupViewportPan: () => undefined,
    cleanupOverviewPan: () => undefined,
    teardownShell: () => undefined,
    commitEditIfNeeded: async () => undefined,
    resetViewState: () => {
      view.documentController.reset();
      view.loadingState = null;
    },
    ensureShell: () => undefined,
    syncLoadingOverlay: () => undefined,
    resetLoadedUiState: () => undefined,
    render: () => { renderCount += 1; },
    openFileInMarkdownView: async (file: TestFile) => { opened.push(file.path); },
    wait: async () => undefined,
    waitForNextPaint: options.manualPaint
      ? () => {
        const pending = deferred<void>();
        paintWaiters.push(pending);
        return pending.promise;
      }
      : async () => undefined,
    loadingState: null
  });

  return {
    view,
    files,
    disk,
    writes,
    remembered,
    opened,
    paintWaiters,
    processWaiters,
    get renderCount() { return renderCount; },
    setFile(file) {
      currentFile = file;
      view.file = file;
    },
    queueRead(file, result) {
      const pending = queuedReads.get(file.path) ?? [];
      pending.push(result);
      queuedReads.set(file.path, pending);
    }
  };
}

function content(view: TestView): string | undefined {
  return view.documentController.getState()?.metadata.blocks[0]?.content;
}

describe("ArborView load lifecycle", () => {
  it("stops an older render pipeline as soon as a newer render is requested", async () => {
    const harness = createHarness();
    await harness.view.onLoadFile(harness.files.a);
    const branch = deferred<void>();
    let requestedFrame: FrameRequestCallback | undefined;
    let previews = 0;
    let reveals = 0;
    Object.assign(harness.view.plugin, { settings: fixtureSettings() });
    Object.assign(harness.view, {
      render: () => lifecycle.ArborView.prototype.render.call(harness.view),
      contentEl: { addClass: () => undefined },
      applyCssVars: () => undefined,
      applyViewClasses: () => undefined,
      syncOutputProfileButton: () => undefined,
      syncOverviewModeButton: () => undefined,
      syncTouchDock: () => undefined,
      syncViewportEdgeFades: () => undefined,
      syncBreadcrumbs: () => undefined,
      syncBanner: () => undefined,
      shell: { showMode: () => undefined, isCompact: () => false },
      search: { getQuery: () => "", syncSearchOverlay: () => undefined },
      overview: { invalidate: () => undefined, hide: () => undefined },
      output: { invalidate: () => undefined },
      branchRenderer: { invalidate: () => undefined, syncColumns: () => branch.promise },
      preview: { invalidate: () => undefined, syncPreview: async () => { previews += 1; } },
      armSceneWidthForPendingScroll: () => 0,
      applyPendingFocusAndScroll: () => { reveals += 1; },
      syncHoverLinkedState: () => undefined
    });
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => { requestedFrame = callback; return 1; },
      cancelAnimationFrame: () => undefined
    });
    try {
      const view = harness.view as TestView & { renderNow(): Promise<void> };
      const oldRender = view.renderNow();
      view.render();
      branch.resolve(undefined);
      await oldRender;
      expect(previews).toBe(0);
      expect(reveals).toBe(0);
      requestedFrame?.(1);
      await waitUntil(() => reveals === 1);
      expect(previews).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not clear a newer loaded document when an old unload finishes saving", async () => {
    const harness = createHarness();
    await harness.view.onLoadFile(harness.files.a);
    const saving = deferred<void>();
    Object.assign(harness.view, { commitEditIfNeeded: () => saving.promise });
    const unloading = harness.view.onUnloadFile();
    harness.setFile(harness.files.b);
    await harness.view.onLoadFile(harness.files.b);
    saving.resolve(undefined);
    await unloading;
    expect(content(harness.view)).toBe("Content B");
  });

  it("cancels queued render work on close and rejects later render requests", async () => {
    const harness = createHarness();
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++nextId, callback);
        return nextId;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id)
    });
    Object.assign(harness.view, {
      render: () => lifecycle.ArborView.prototype.render.call(harness.view),
      overview: { invalidate: () => undefined, reset: () => undefined },
      output: { invalidate: () => undefined, reset: () => undefined },
      branchRenderer: { invalidate: () => undefined },
      preview: { invalidate: () => undefined, reset: () => undefined }
    });
    try {
      harness.view.render();
      expect(frames.size).toBe(1);
      await harness.view.onClose();
      expect(frames.size).toBe(0);
      harness.view.render();
      expect(frames.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { label: "canonical", legacy: false },
    { label: "legacy", legacy: true }
  ])("does not let a stale $label A load publish over B or write B", async ({ legacy }) => {
    const harness = createHarness({ legacyA: legacy });
    const pendingA = deferred<string>();
    harness.queueRead(harness.files.a, pendingA.promise);

    const loadingA = harness.view.onLoadFile(harness.files.a);
    harness.setFile(harness.files.b);
    await harness.view.onLoadFile(harness.files.b);

    pendingA.resolve(harness.disk.get(harness.files.a.path)!);
    await loadingA;

    expect(content(harness.view)).toBe("Content B");
    expect(harness.writes.some((write) => write.path === harness.files.b.path && write.contents.includes("Content A"))).toBe(false);
    expect(harness.opened).toEqual([]);
  });

  it("publishes only the newest overlapping request for the same file", async () => {
    const harness = createHarness();
    const pendingFirst = deferred<string>();
    harness.queueRead(harness.files.a, pendingFirst.promise);
    harness.queueRead(harness.files.a, Promise.resolve(documentFor("Newest", false)));

    const first = harness.view.onLoadFile(harness.files.a);
    await harness.view.onLoadFile(harness.files.a);
    pendingFirst.resolve(documentFor("Oldest", false));
    await first;

    expect(content(harness.view)).toBe("Content Newest");
    expect(harness.renderCount).toBe(1);
  });

  it("rejects a different file object reusing the same path", async () => {
    const harness = createHarness();
    const pending = deferred<string>();
    harness.queueRead(harness.files.a, pending.promise);
    const loading = harness.view.onLoadFile(harness.files.a);
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- replacement vault file identity
    const replacement = { path: "A.md", basename: "A" } as unknown as TFile;
    harness.setFile(replacement);
    pending.resolve(documentFor("Removed file", false));
    await loading;
    expect(harness.view.documentController.getState()).toBeNull();
    expect(harness.renderCount).toBe(0);
  });

  it("uses the same generation when refreshView overlaps an earlier load", async () => {
    const harness = createHarness();
    const pendingFirst = deferred<string>();
    harness.queueRead(harness.files.a, pendingFirst.promise);
    harness.queueRead(harness.files.a, Promise.resolve(documentFor("Refreshed", false)));

    const first = harness.view.onLoadFile(harness.files.a);
    await harness.view.refreshView();
    pendingFirst.resolve(documentFor("Stale", false));
    await first;

    expect(content(harness.view)).toBe("Content Refreshed");
  });

  it.each(["clear", "unload", "close"] as const)("invalidates a pending load when the view %s", async (action) => {
    const harness = createHarness();
    const pending = deferred<string>();
    harness.queueRead(harness.files.a, pending.promise);
    const loading = harness.view.onLoadFile(harness.files.a);
    await flush();

    if (action === "clear") harness.view.clear();
    if (action === "unload") await harness.view.onUnloadFile();
    if (action === "close") await harness.view.onClose();

    pending.resolve(harness.disk.get(harness.files.a.path)!);
    await loading;

    expect(harness.view.documentController.getState()).toBeNull();
    expect(harness.opened).toEqual([]);
  });

  it.each(["clear", "unload", "close"] as const)("does not open an invalidated plain note when the view %s", async (action) => {
    const harness = createHarness();
    harness.disk.set(harness.files.a.path, "Plain Markdown");
    const pending = deferred<string>();
    harness.queueRead(harness.files.a, pending.promise);
    const loading = harness.view.onLoadFile(harness.files.a);
    await flush();

    if (action === "clear") harness.view.clear();
    if (action === "unload") await harness.view.onUnloadFile();
    if (action === "close") await harness.view.onClose();

    pending.resolve("Plain Markdown");
    await loading;

    expect(harness.opened).toEqual([]);
  });

  it("awaits a pending draft save before close cleans up UI controllers", async () => {
    const harness = createHarness();
    const order: string[] = [];
    const saving = deferred<void>();
    Object.assign(harness.view, {
      commitEditIfNeeded: async () => {
        order.push("save-start");
        await saving.promise;
        order.push("save-finish");
      },
      zoomController: { reset: () => order.push("zoom-reset") },
      touchController: { reset: () => order.push("touch-reset") },
      branchViewport: { reset: () => order.push("branch-reset") },
      overviewViewport: { reset: () => order.push("overview-viewport-reset") },
      dragDropController: { reset: () => order.push("drag-reset") },
      overview: { reset: () => order.push("overview-reset"), invalidate() {} }
    });

    const closing = harness.view.onClose();
    await flush();
    expect(order).toEqual(["save-start"]);

    saving.resolve(undefined);
    await closing;
    expect(order).toContain("save-finish");
    expect(order.indexOf("zoom-reset")).toBeGreaterThan(order.indexOf("save-finish"));
    expect(order.indexOf("touch-reset")).toBeGreaterThan(order.indexOf("save-finish"));
    expect(order.indexOf("overview-reset")).toBeGreaterThan(order.indexOf("save-finish"));
  });

  it("does not persist a migration after it pauses at the next paint and the file switches", async () => {
    const harness = createHarness({ legacyA: true, manualPaint: true });
    const loadingA = harness.view.onLoadFile(harness.files.a);
    await waitUntil(() => harness.paintWaiters.length === 1);

    harness.setFile(harness.files.b);
    await harness.view.onLoadFile(harness.files.b);
    harness.paintWaiters[0].resolve(undefined);
    await loadingA;

    expect(harness.writes).toEqual([]);
    expect(content(harness.view)).toBe("Content B");
  });

  it("does not let an old migration finally clear a newer loading overlay", async () => {
    const harness = createHarness({ legacyA: true, legacyB: true, manualProcess: true });
    const loadingA = harness.view.onLoadFile(harness.files.a);
    await waitUntil(() => harness.processWaiters.length === 1);

    harness.setFile(harness.files.b);
    const loadingB = harness.view.onLoadFile(harness.files.b);
    await waitUntil(() => harness.processWaiters.length === 2);
    const newerOverlay = harness.view.loadingState;
    expect(newerOverlay).not.toBeNull();

    harness.processWaiters[0].resolve(undefined);
    await loadingA;

    expect(harness.view.loadingState).toBe(newerOverlay);
    harness.processWaiters[1].resolve(undefined);
    await loadingB;
    expect(harness.view.loadingState).toBeNull();
  });

  it("keeps ordinary canonical loads and legacy migrations successful", async () => {
    const canonical = createHarness();
    await canonical.view.onLoadFile(canonical.files.a);
    expect(content(canonical.view)).toBe("Content A");
    expect(canonical.writes).toEqual([]);

    const legacy = createHarness({ legacyA: true });
    await legacy.view.onLoadFile(legacy.files.a);
    expect(content(legacy.view)).toBe("Content A");
    expect(legacy.writes).toHaveLength(1);
    expect(legacy.writes[0].path).toBe(legacy.files.a.path);
    expect(legacy.view.loadingState).toBeNull();
  });

  it("keeps load generations independent across separate view instances", async () => {
    const first = createHarness();
    const second = createHarness();
    const pendingFirst = deferred<string>();
    const pendingSecond = deferred<string>();
    first.queueRead(first.files.a, pendingFirst.promise);
    second.queueRead(second.files.a, pendingSecond.promise);

    const firstLoad = first.view.onLoadFile(first.files.a);
    const secondLoad = second.view.onLoadFile(second.files.a);
    pendingSecond.resolve(second.disk.get(second.files.a.path)!);
    await secondLoad;
    pendingFirst.resolve(first.disk.get(first.files.a.path)!);
    await firstLoad;

    expect(content(first.view)).toBe("Content A");
    expect(content(second.view)).toBe("Content A");
  });

  it("settles an A persistence without mutating the newer B state or remembering B as the write", async () => {
    const harness = createHarness();
    const pendingProcess = deferred<string>();
    const originalProcess = harness.view.documentController;
    const port: DocumentPort = {
      getFile: () => harness.files.a,
      cachedRead: async (file: TestFile) => harness.disk.get(file.path) ?? "",
      process: async (file: TestFile, transform: (text: string) => string) => {
        const next = transform(harness.disk.get(file.path) ?? "");
        harness.disk.set(file.path, next);
        harness.writes.push({ path: file.path, contents: next });
        return pendingProcess.promise;
      },
      markOwnWrite: () => undefined,
      rememberManagedNote: (path: string) => harness.remembered.push(path),
      commitEditIfNeeded: async () => undefined,
      clearEditingSession: () => undefined,
      beforeOverviewEditSave: () => undefined,
      onMutationPrepared: () => undefined,
      onSelectionRestored: () => undefined,
      onEditedBlockSaved: () => undefined,
      onProfileActivated: () => undefined,
      requestRender: () => undefined,
      notify: () => undefined,
      reportError: () => undefined
    };
    const controller = new lifecycle.DocumentController(port);
    const first = await controller.readLoadedFileState(harness.files.a, null);
    controller.replaceLoadedState(first.state);
    const savingA = controller.persistState("A migration");
    await flush();

    const second = await originalProcess.readLoadedFileState(harness.files.b, null);
    second.state.origin = "reconciled";
    second.state.staleMetadata = fixtureTree();
    const expectedSecond = structuredClone(second.state);
    port.getFile = () => harness.files.b;
    controller.replaceLoadedState(second.state);
    pendingProcess.resolve(harness.disk.get(harness.files.a.path)!);
    await savingA;

    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].path).toBe(harness.files.a.path);
    expect(harness.writes[0].contents).toContain("Content A");
    expect(harness.remembered).toEqual([harness.files.a.path]);
    expect(controller.getState()).toEqual(expectedSecond);
  });
});
