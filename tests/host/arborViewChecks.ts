import type { BranchColumnModel } from "../../src/types";
import type { ArborSettings, BranchBlock, BranchBlockId } from "../../src/types";
import type { BranchRenderer } from "../../src/view/branch/BranchRenderer";
import { TreeOverviewController } from "../../src/view/overview/TreeOverviewController";
import type { BranchViewContext, LoadedFileState, MarkdownPort } from "../../src/view/state/viewTypes";

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
