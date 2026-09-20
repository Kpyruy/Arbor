import type { TFile } from "obsidian";
import type { BranchColumnModel } from "../../src/types";
import type { ArborSettings, BranchBlock, BranchBlockId } from "../../src/types";
import type { BranchRenderer } from "../../src/view/branch/BranchRenderer";
import { TreeOverviewController } from "../../src/view/overview/TreeOverviewController";
import { LinearPreviewController } from "../../src/view/preview/LinearPreviewController";
import { OutputPreviewController } from "../../src/view/preview/OutputPreviewController";
import { SearchController } from "../../src/view/chrome/SearchController";
import { ExportController, type ExportPort } from "../../src/view/export/ExportController";
import { projectOutput } from "../../src/outputProjection";
import { buildViewContext } from "../../src/view/state/viewModel";
import type { BranchViewContext, EditingSession, LoadedFileState, MarkdownPort } from "../../src/view/state/viewTypes";

export function assertHost(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function checkBranchIdentity(
  renderer: BranchRenderer,
  columns: HTMLElement,
  models: BranchColumnModel[],
  context: BranchViewContext,
  getMarkdownRenderCount: () => number
): Promise<void> {
  const before = columns.querySelector('[data-block-id="first"]');
  assertHost(before, "Fixture first card missing");
  const renderCount = getMarkdownRenderCount();
  await renderer.syncColumns(models, context);
  await renderer.syncColumns(models, context);
  assertHost(columns.querySelector('[data-block-id="first"]') === before, "Card identity changed");
  assertHost(getMarkdownRenderCount() === renderCount, "Stable card sync rendered Markdown again");
}

export async function checkTextareaIdentity(
  renderer: BranchRenderer,
  columns: HTMLElement,
  models: BranchColumnModel[],
  context: BranchViewContext,
  beginEditing: () => void,
  expectedValue: string
): Promise<void> {
  beginEditing();
  await renderer.syncColumns(models, context);
  const card = columns.querySelector<HTMLElement>('[data-block-id="first"]');
  const before = card?.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
  assertHost(before, "Fixture editor textarea missing");
  assertHost(before.value === expectedValue, "Editor textarea value changed");
  await renderer.syncColumns(models, context);
  assertHost(card?.querySelector("textarea.arbor-editor") === before, "Editor textarea identity changed");
  assertHost(before.value === expectedValue, "Editor textarea value changed after stable sync");
}

export async function checkEmptyColumnMenuActionSelection(
  openEmptyColumnMenu: () => void,
  chooseCreateChild: () => Promise<void>,
  selectAnotherBlock: () => void,
  getSelectedBlockId: () => string | null,
  getSelectedBlockParentId: (blockId: string) => string | null,
  parentId: string,
  actionSelectedBlockId: string
): Promise<void> {
  openEmptyColumnMenu();
  assertHost(getSelectedBlockId() === parentId, "Empty-column menu did not select its parent when opened");
  selectAnotherBlock();
  const actionTimeSelectedBlockId = getSelectedBlockId();
  assertHost(actionTimeSelectedBlockId !== null, "Create child action had no selected parent");
  await chooseCreateChild();
  const createdChildId = getSelectedBlockId();
  assertHost(
    createdChildId === actionSelectedBlockId,
    "Create child action did not select the created child"
  );
  assertHost(
    createdChildId !== actionTimeSelectedBlockId,
    "Create child action did not move selection to the created child"
  );
  assertHost(
    getSelectedBlockParentId(createdChildId) === actionTimeSelectedBlockId,
    "Created child parent does not match the action-time selection"
  );
}

export function checkButtonHitTarget(button: HTMLButtonElement): void {
  const rect = button.getBoundingClientRect();
  assertHost(rect.width > 0 && rect.height > 0, "Button has no hit area");
  const hit = button.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  assertHost(hit && (hit === button || button.contains(hit)), "Button is covered by another element");
}

interface DeferredRender {
  readonly promise: Promise<void>;
  resolve(): void;
}

function createDeferredRender(): DeferredRender {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: () => resolvePromise?.()
  };
}

export interface TreeOverviewHostFixture {
  body: HTMLElement;
  state: LoadedFileState;
  settings: ArborSettings;
  selectedBlockId: BranchBlockId;
  editorBlock: BranchBlock;
  renderCallsPerSurface: number;
  expectedSecondRenderMarker: string;
  createOverview(markdown: MarkdownPort, revealSelected: (card: HTMLElement) => void): TreeOverviewController;
  prepareOverviewEditor(block: BranchBlock): void;
  finishOverviewEditor(): void;
  setSecondRenderState(): void;
  getCamera(): { left: number; top: number };
}

async function takePendingRender(pending: DeferredRender[]): Promise<DeferredRender> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const next = pending.shift();
    if (next) return next;
    await Promise.resolve();
  }
  throw new Error("Controlled MarkdownPort did not receive a render call");
}

async function resolveSurfaceRenders(pending: DeferredRender[], count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const render = await takePendingRender(pending);
    render.resolve();
  }
}

export async function checkTreeOverviewControllerHost(fixture: TreeOverviewHostFixture): Promise<void> {
  const pending: DeferredRender[] = [];
  let markdownRenderCount = 0;
  const markdown: MarkdownPort = {
    render: async (content, target) => {
      markdownRenderCount += 1;
      const render = createDeferredRender();
      pending.push(render);
      await render.promise;
      target.setText(content);
    }
  };
  let revealCount = 0;
  const overview = fixture.createOverview(markdown, () => { revealCount += 1; });
  assertHost(overview instanceof TreeOverviewController, "Fixture did not create the real TreeOverviewController");

  try {

  const first = overview.syncTreeOverview();
  const firstRender = await takePendingRender(pending);
  fixture.setSecondRenderState();
  overview.invalidate();
  const second = overview.syncTreeOverview();
  await resolveSurfaceRenders(pending, fixture.renderCallsPerSurface);
  await second;

  const mounted = overview.getElements();
  assertHost(mounted.stage !== null && fixture.body.contains(mounted.stage), "Overview stage was not mounted in the injected host body");
    assertHost(mounted.scene?.querySelectorAll(".arbor-overview-surface").length === 1, "Stale overview surface remained published");
    assertHost(fixture.expectedSecondRenderMarker.length > 0, "Fixture did not provide a second-render marker");
    assertHost(mounted.surface?.textContent?.includes(fixture.expectedSecondRenderMarker) === true, "Published overview does not contain the second render");

  firstRender.resolve();
  await resolveSurfaceRenders(pending, fixture.renderCallsPerSurface - 1);
  await first;
  assertHost(overview.getElements().surface === mounted.surface, "Stale overview render replaced the published surface");

  fixture.state.selectedBlockId = fixture.selectedBlockId;
  const previousSurface = overview.getElements().surface;
  const rendersBeforeSelection = markdownRenderCount;
  overview.syncOverviewSelection(true);
  assertHost(overview.getElements().surface === previousSurface, "Selection replaced the published overview surface");
  assertHost(markdownRenderCount === rendersBeforeSelection, "Selection rendered Markdown");
  assertHost(
    previousSurface?.querySelector(".arbor-overview-card.is-active")?.getAttribute("data-block-id") === fixture.selectedBlockId,
    "Selection did not activate the requested overview card"
  );
  assertHost(revealCount === 1, "Selection did not reveal the requested overview card exactly once");

  const cameraBeforeEditor = fixture.getCamera();
  fixture.prepareOverviewEditor(fixture.editorBlock);
  assertHost(overview.openOverviewEditorInPlace(fixture.editorBlock), "Overview editor did not open in place");
    const editorCard = overview.getElements().surface?.querySelector<HTMLElement>(
      `.arbor-overview-card[data-block-id="${fixture.editorBlock.id}"]`
    );
    assertHost(editorCard, "Overview editor card is missing");
    const textarea = editorCard.querySelector("textarea.arbor-overview-editor-input");
    assertHost(textarea, "Overview textarea is not in the selected card");

    fixture.finishOverviewEditor();
    const restore = overview.restoreOverviewCardContentInPlace(fixture.editorBlock.id);
    (await takePendingRender(pending)).resolve();
    await restore;
    assertHost(overview.getElements().surface === mounted.surface, "Overview restore replaced the published surface");
    assertHost(editorCard.parentElement === mounted.surface, "Overview restore replaced the editor card");
    assertHost(editorCard.querySelector("textarea.arbor-overview-editor-input") === null, "Overview textarea remained after restore");
    assertHost(editorCard.querySelector(".arbor-overview-card-content.markdown-rendered"), "Overview card did not restore Markdown content in place");
    assertHost(JSON.stringify(fixture.getCamera()) === JSON.stringify(cameraBeforeEditor), "Overview editor changed the camera");

    const outsideFocus = fixture.body.ownerDocument.createElement("button");
    fixture.body.append(outsideFocus);
    outsideFocus.focus();
    overview.requestKeyboardFocusAfterMutation(true);
    overview.requestKeyboardFocusAfterMutation(false);
    overview.requestCenterOnNextRender(true);
    overview.requestCenterOnNextRender(false);
    const cameraBeforeNoopRequests = fixture.getCamera();
    overview.invalidate();
    const noOpRender = overview.syncTreeOverview();
    await resolveSurfaceRenders(pending, fixture.renderCallsPerSurface);
    await noOpRender;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    assertHost(fixture.body.ownerDocument.activeElement === outsideFocus, "False focus request still focused the overview viewport");
    assertHost(JSON.stringify(fixture.getCamera()) === JSON.stringify(cameraBeforeNoopRequests), "False center request moved the overview camera");
  } finally {
    overview.reset();
  }
}

export interface SearchControllerHostFixture {
  frame: HTMLElement;
  contextA: BranchViewContext;
  contextB: BranchViewContext;
}

export function checkSearchControllerContextHost(fixture: SearchControllerHostFixture): void {
  let context: BranchViewContext | null = fixture.contextA;
  const selected: Array<{ id: BranchBlockId; focus: boolean | undefined }> = [];
  const shortcutCalls: KeyboardEvent[] = [];
  const search = new SearchController({
    getFrame: () => fixture.frame,
    getContext: () => context,
    selectBlock: (id, options) => { selected.push({ id, focus: options?.focus }); },
    handleSearchShortcut: (event) => {
      const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (isSearchShortcut) shortcutCalls.push(event);
      return isSearchShortcut;
    },
    requestRender: () => undefined
  });

  try {
    const firstMatchA = fixture.contextA.overviewNodes.find((node) => node.isSearchMatch);
    const firstMatchB = fixture.contextB.overviewNodes.find((node) => node.isSearchMatch);
    assertHost(firstMatchA, "Search context A has no match");
    assertHost(firstMatchB, "Search context B has no match");
    assertHost(firstMatchA.id !== firstMatchB.id, "Search contexts do not have distinct first matches");

    search.openSearchOverlay();
    search.syncSearchOverlay(fixture.contextA);
    context = fixture.contextB;
    search.syncSearchOverlay(fixture.contextB);
    const input = fixture.frame.querySelector<HTMLInputElement>(".arbor-search-input");
    const go = Array.from(fixture.frame.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Go to match");
    assertHost(input && go, "Search overlay controls were not mounted in the injected host frame");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assertHost(selected[0]?.id === firstMatchB.id, "Enter used stale search context");
    assertHost(selected[0]?.focus === true, "Enter did not focus the current match");
    assertHost(search.isOpen(), "Enter unexpectedly closed the search overlay");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    assertHost(shortcutCalls.length === 1 && shortcutCalls[0]?.key === "k", "Only the search shortcut should be consumed");
    go.click();
    assertHost(selected[1]?.id === firstMatchB.id, "Go to match used stale search context");
    assertHost(selected[1]?.focus === true, "Go to match did not focus the current match");
    assertHost(!search.isOpen(), "Go to match did not close the search overlay");
  } finally {
    search.reset();
  }
}

export interface LinearPreviewControllerHostFixture {
  body: HTMLElement;
  state: LoadedFileState;
  settings: ArborSettings;
  session: EditingSession;
}

export async function checkLinearPreviewControllerHost(fixture: LinearPreviewControllerHostFixture): Promise<void> {
  assertHost(fixture.settings.liveLinearPreview, "Linear host fixture must enable liveLinearPreview");
  assertHost(fixture.session.origin === "preview", "Linear host fixture session must originate in the preview");
  assertHost(fixture.session.autofocus, "Linear host fixture session must request autofocus");
  assertHost(fixture.state.selectedBlockId === fixture.session.blockId, "Linear host fixture must select the session block");
  const state = structuredClone(fixture.state);
  const settings = structuredClone(fixture.settings);
  const session = { ...fixture.session };
  let consumeCount = 0;
  const context = buildViewContext(
    state.metadata,
    state.selectedBlockId,
    state.outputState,
    "",
    settings
  );
  const preview = new LinearPreviewController({
    read: {
      getState: () => state,
      getSettings: () => settings,
      getMode: () => "editor",
      getFilePath: () => "fixture.md"
    },
    markdown: { render: async (markdown, target) => { target.setText(markdown); } },
    editor: {
      getSession: () => session,
      beginEditingBlock: () => undefined,
      commitEditIfNeeded: async () => undefined,
      clearBlurCommitTimer: () => undefined,
      wireEditorElement: (editor) => { editor.value = session.value; },
      resizeEditor: () => undefined
    },
    selection: { selectBlock: () => undefined },
    getBody: () => fixture.body,
    getVisibleBlockIds: () => new Set(),
    setHoveredBlock: () => undefined,
    setCollapsedState: async () => undefined,
    toggleCollapsedState: async () => undefined,
    consumeAutofocus: () => { consumeCount += 1; },
    requestRender: () => undefined
  });

  try {
    await preview.syncPreview(context);
    const content = preview.getContent();
    const pane = fixture.body.querySelector<HTMLElement>(".arbor-preview-pane");
    assertHost(content && pane, "Linear preview did not mount in the injected host body");
    preview.hide();
    assertHost(pane.style.display === "none" && preview.getContent() === content, "Preview hide removed cached DOM");
    await preview.syncPreview(context);
    assertHost(fixture.body.querySelector(".arbor-preview-pane") === pane && preview.getContent() === content, "Preview resume replaced cached DOM");
    assertHost(pane.style.display !== "none", "Preview resume did not restore visibility");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    assertHost(consumeCount === 1, "Preview autofocus was not consumed exactly once");
  } finally {
    preview.reset();
  }
}

export interface OutputPreviewControllerHostFixture {
  stage: HTMLElement;
  state: LoadedFileState;
  settings: ArborSettings;
  draft: EditingSession;
}

export async function checkOutputPreviewControllerHost(fixture: OutputPreviewControllerHostFixture): Promise<void> {
  const state = structuredClone(fixture.state);
  const settings = structuredClone(fixture.settings);
  const sourceMetadata = structuredClone(state.metadata);
  const included = projectOutput(state.metadata, state.outputState).included[0];
  assertHost(included, "Output host fixture must include at least one draft block");
  const draft = {
    ...fixture.draft,
    blockId: included.block.id,
    originalContent: included.block.content,
    value: "Output A"
  };
  const pending: DeferredRender[] = [];
  let resolveCleanChoice!: (value: { frontmatter: "keep"; excluded: "omit" }) => void;
  const cleanChoice = new Promise<{ frontmatter: "keep"; excluded: "omit" }>((resolve) => { resolveCleanChoice = resolve; });
  let createdContents = "";
  let createCount = 0;
  let openedExport: TFile | null = null;
  const getCreateCount = (): number => createCount;
  const getOpenedExport = (): TFile | null => openedExport;
  // Controlled export port observes only file identity, path and name; no vault writes.
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
  const source = { path: "fixture.md", name: "fixture.md" } as TFile;
  const exportController = new ExportController({
    getFile: () => source,
    getState: () => state,
    getSession: () => draft,
    clearBlurCommitTimer: () => undefined,
    commitEditIfNeeded: async () => undefined,
    chooseClean: async () => cleanChoice,
    chooseTree: async () => null,
    createCleanCopy: async (_source, contents) => {
      createCount += 1;
      createdContents = contents;
      // Controlled file result, matching the export unit-test adapter.
      // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
      return { path: "fixture — export.md", name: "fixture — export.md" } as TFile;
    },
    openMarkdown: async (file) => { openedExport = file; },
    createTreeExport: async () => source,
    snapshot: async () => ({ frame: fixture.stage, width: 0, height: 0, dispose: () => undefined }),
    encodePng: async () => null,
    notify: () => undefined,
    reportError: () => undefined
  } satisfies ExportPort);
  const output = new OutputPreviewController({
    read: {
      getState: () => state,
      getSettings: () => settings,
      getMode: () => "output",
      getFilePath: () => "fixture.md"
    },
    markdown: {
      render: async (markdown, target) => {
        const render = createDeferredRender();
        pending.push(render);
        await render.promise;
        target.setText(markdown);
      }
    },
    getStage: () => fixture.stage,
    getSession: () => draft,
    closeOutputPreview: () => undefined,
    exportCleanCopy: () => exportController.exportCleanCopy()
  });

  try {
    const first = output.syncOutputPreview();
    const firstRender = await takePendingRender(pending);
    draft.value = "Output B";
    output.invalidate();
    const second = output.syncOutputPreview();
    let secondFinished = false;
    void second.then(() => { secondFinished = true; });
    firstRender.resolve();
    await first;
    for (let attempt = 0; attempt < 20 && !secondFinished; attempt += 1) {
      const render = pending.shift();
      if (render) {
        render.resolve();
      }
      await Promise.resolve();
    }
    assertHost(secondFinished, "Latest output render did not complete in the controlled host");
    await second;
    const published = fixture.stage.querySelector<HTMLElement>(".arbor-output-preview-surface:not(.is-staging)");
    assertHost(published?.textContent?.includes("Output B") === true, "Latest output render was not published");
    assertHost(fixture.stage.querySelectorAll(".arbor-output-preview-surface:not(.is-staging)").length === 1, "Stale output surface remained published");
    assertHost(JSON.stringify(state.metadata) === JSON.stringify(sourceMetadata), "Output preview mutated source metadata");
    const exportButton = Array.from(fixture.stage.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Export clean copy"));
    assertHost(exportButton, "Output export button was not mounted");
    assertHost(createCount === 0, "Output export created a file before the explicit click");
    draft.value = "Output C after preview";
    exportButton.click();
    await Promise.resolve();
    assertHost(createCount === 0, "Output export created a file before its modal resolved");
    resolveCleanChoice({ frontmatter: "keep", excluded: "omit" });
    for (let attempt = 0; attempt < 20 && openedExport === null; attempt += 1) {
      await Promise.resolve();
    }
    assertHost(getCreateCount() === 1, "Output export did not create exactly one copy");
    assertHost(createdContents.includes("Output C after preview"), "Output export did not use the draft changed after render");
    assertHost(getOpenedExport()?.path === "fixture — export.md", "Output export did not open the created copy");
    assertHost(JSON.stringify(state.metadata) === JSON.stringify(sourceMetadata), "Output export mutated source metadata");
  } finally {
    output.reset();
  }
}
