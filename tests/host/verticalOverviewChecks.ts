import { toCanvas } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { buildSinglePageTreeOverviewPdf } from "../../src/treeOverviewPdf";
import type { ArborLayoutDirection, ArborOverviewOrientation, BranchTreeMetadata } from "../../src/types";
import { resolveBlockColors } from "../../src/model/blockAppearance";
import { syncCardColour } from "../../src/view/appearance/cardColours";
import { createOverviewSnapshot, type OverviewSnapshotInput } from "../../src/view/export/overviewSnapshot";
import { TreeOverviewController, type TreeOverviewPort } from "../../src/view/overview/TreeOverviewController";
import type { MarkdownPort, ViewReadPort } from "../../src/view/state/viewTypes";
import { BlockEditorController } from "../../src/view/editor/BlockEditorController";
import type { ViewShell } from "../../src/view/chrome/ViewShell";
import { fixtureTree } from "../helpers/arborFixtures";
import { getBlock, getChildren } from "../../src/model/tree";
import { parseBranchDocument } from "../../src/storage/document";

interface InstalledNavigationInput {
  root: HTMLElement;
  read: ViewReadPort;
  shell: ViewShell;
  overview: TreeOverviewController;
  editor: BlockEditorController;
  resetTree(metadata: BranchTreeMetadata): Promise<void>;
  setOrientation(value: ArborOverviewOrientation): Promise<void>;
  setDirection(value: ArborLayoutDirection): Promise<void>;
  select(id: string): void;
  setMode(mode: "editor" | "overview" | "output"): Promise<void>;
  openSearch(): void;
  closeSearch(): void;
  waitForSourceMetadata(): Promise<void>;
  activateExternal(anchor: HTMLAnchorElement): MouseEvent;
  readSource(): Promise<string>;
  waitForNextPaint(): Promise<void>;
}

// Runs against the installed facade, DOM listeners, save path and native SVG icons.
// The caller owns an isolated note/leaf and restores its workspace in finally.
export async function checkInstalledVerticalNavigationHost(input: InstalledNavigationInput): Promise<{ checks: number }> {
  let checks = 0;
  const assert = (condition: unknown, label: string) => {
    if (!condition) throw Error(label);
    checks += 1;
  };
  const wait = async (predicate: () => unknown, label: string) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    }
    throw Error(`Timed out: ${label}`);
  };
  const selected = () => input.read.getState()!.selectedBlockId;
  const tree = () => input.read.getState()!.metadata;
  const viewport = () => input.overview.getElements().viewport!;
  const key = (value: string, options: KeyboardEventInit = {}, target: HTMLElement = viewport()) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const reset = async (metadata = fixtureTree()) => {
    input.editor.cancelEditingSession();
    await input.resetTree(metadata);
    await wait(() => input.overview.getElements().surface?.querySelector('[data-block-id="first"]') && !input.root.querySelector(".is-staging"), "fixture reset");
    input.select("first");
    await input.waitForNextPaint();
  };
  const cases = [
    ["vertical-top-down", "ltr", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    ["vertical-top-down", "rtl", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"],
    ["vertical-bottom-up", "ltr", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"],
    ["vertical-bottom-up", "rtl", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]
  ] as const;
  for (const [orientation, direction, parent, child, previous, next] of cases) {
    await input.setMode("overview");
    await input.setDirection(direction);
    await input.setOrientation(orientation);
    await reset();
    key(child); assert(selected() === "leaf", "physical child must select first child");
    key(parent); assert(selected() === "first", "physical parent must select parent");
    key(next); assert(selected() === "second", "physical next must select next logical sibling");
    key(next); assert(selected() === "second", "siblings must not wrap");
    key(previous); key(parent); assert(selected() === "root", "previous then parent");
    key(parent); assert(selected() === "root", "root parent must not move");
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      for (const [arrow, expectedParent, expectedOrder] of [
        [child, "first", ["leaf", "NEW"]],
        [previous, "root", ["NEW", "first", "second"]],
        [next, "root", ["first", "NEW", "second"]],
        [parent, null, ["root", "NEW"]]
      ] as const) {
        await reset();
        key(arrow, { [modifier]: true });
        await wait(() => selected() !== "first" && tree().blocks.length === 5, "directional create");
        const id = selected()!;
        assert(getBlock(tree(), id)?.parentId === expectedParent, `${orientation}/${direction}/${modifier}/${arrow}: created parent`);
        assert(JSON.stringify(getChildren(tree(), expectedParent).map(block => block.id === id ? "NEW" : block.id)) === JSON.stringify(expectedOrder), "created sibling order/selection");
        await wait(() => !input.root.querySelector(".is-staging") && input.editor.getSession()?.blockId === id, "created editor publication");
        input.editor.cancelEditingSession();
        await input.waitForNextPaint();
        const persisted = parseBranchDocument(await input.readSource()).metadata!;
        assert(getBlock(persisted, id)?.parentId === expectedParent && persisted.blocks.length === 5, "real source save keeps creation topology");
      }
      await reset(); input.select("root"); key(parent, { [modifier]: true });
      await input.waitForNextPaint();
      assert(selected() === "root" && tree().blocks.length === 4, "root modified parent must not create");
    }
    await reset(); key("Delete");
    await wait(() => tree().blocks.length === 3 && !input.root.querySelector(".is-staging"), "delete publication");
    assert(selected() === "leaf" && getBlock(tree(), "leaf")?.parentId === "root", "Delete lifts child and selects it");
    key(next); assert(selected() === "second", "arrow navigation continues after Delete");
    key(parent); assert(selected() === "root", "parent after Delete");
    await reset(); key("Enter");
    await wait(() => input.editor.getSession()?.blockId === "first" && input.root.querySelector("textarea"), "Enter editing");
    assert(input.editor.getSession()?.origin === "overview", "Enter keeps overview origin");
    const textarea = input.root.querySelector<HTMLTextAreaElement>("textarea")!;
    const before = selected();
    const nativeKey = key(child, { ctrlKey: true }, textarea);
    assert(!nativeKey.defaultPrevented && selected() === before && tree().blocks.length === 4, "textarea owns native modified arrows");
    input.editor.cancelEditingSession();
    await input.waitForNextPaint();
    const card = input.overview.getElements().surface!.querySelector<HTMLElement>('[data-block-id="second"]')!;
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    await wait(() => input.editor.getSession()?.blockId === "second", "double click editing");
    assert(selected() === "second" && input.editor.getSession()?.origin === "overview", "double-click selects and edits its block");
    input.editor.cancelEditingSession();
    await input.waitForNextPaint();
    for (const width of [480, 360]) {
      input.root.setCssStyles({ width: `${width}px` });
      input.shell.applyViewClasses(input.root);
      input.shell.syncTouchDock();
      await input.waitForNextPaint();
      input.select("first");
      const labels = ["Parent block", "Previous block", "Next block", "Child block"];
      for (const [index, arrow] of [parent, previous, next, child].entries()) {
        const button = input.root.querySelector<HTMLButtonElement>(`button[aria-label="${labels[index]}"]`)!;
        assert(Boolean(button?.querySelector(`.lucide-${arrow.replace("Arrow", "arrow-").toLowerCase()}`)), `${width}px dock physical glyph ${labels[index]}`);
        const box = button.getBoundingClientRect();
        assert(box.width >= 44 && box.height >= 44 && getComputedStyle(button).visibility !== "hidden", "dock hit target at least 44px");
        assert(button.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("button") === button, "dock target is not occluded");
      }
      const previousButton = input.root.querySelector<HTMLButtonElement>('button[aria-label="Previous block"]')!;
      const nextButton = input.root.querySelector<HTMLButtonElement>('button[aria-label="Next block"]')!;
      assert(previousButton.disabled && !nextButton.disabled, "dock disabled state follows logical sibling edge");
      nextButton.click(); assert(selected() === "second", "dock next routes logical action");
      input.root.querySelector<HTMLButtonElement>('button[aria-label="Parent block"]')!.click();
      assert(selected() === "root", "dock parent routes logical action");
    }
    input.root.setCssStyles({ width: "900px" });
    input.shell.applyViewClasses(input.root); input.shell.syncTouchDock();
    assert(!input.root.querySelector(".arbor-touch-dock"), "wide desktop keeps dock absent");
    const threeChildren = fixtureTree();
    threeChildren.blocks.push({ id: "third", parentId: "root", order: 2, content: "Third", after: "" });
    await reset(threeChildren);
    input.root.setCssStyles({ width: "480px" });
    input.shell.applyViewClasses(input.root); input.shell.syncTouchDock();
    input.select("root");
    input.root.querySelector<HTMLButtonElement>('button[aria-label="Child block"]')!.click();
    assert(selected() === "second", "dock keeps preferred middle child");
    input.select("root"); key(child);
    assert(selected() === "first", "keyboard keeps first child instead of preferred child");
    for (const tag of ["input", "div"] as const) {
      const nativeInput = viewport().createEl(tag);
      if (tag === "div") nativeInput.setAttribute("contenteditable", "true");
      const nativeKey = key(child, { metaKey: true }, nativeInput);
      assert(!nativeKey.defaultPrevented && selected() === "first" && tree().blocks.length === 5, "input/contenteditable owns modified arrow");
      nativeInput.remove();
    }
    const manyChildren = fixtureTree();
    manyChildren.blocks = [manyChildren.blocks[0], ...Array.from({length:25}, (_, index) => ({
      id: index === 0 ? "first" : `child-${index + 1}`, parentId: "root", order: index,
      content: index === 24 ? "Needle last child" : `Child ${index + 1}`, after: "\n\n"
    }))];
    await reset(manyChildren); input.select("root");
    key("2"); await new Promise(resolve => globalThis.setTimeout(resolve, 100)); key("5");
    await new Promise(resolve => globalThis.setTimeout(resolve, 200));
    assert(selected() === "root", "multi-digit input waits after last digit");
    await wait(() => selected() === "child-25", "250ms multi-digit child");
    assert(selected() === "child-25", "25 selects twenty-fifth child");
    key("0"); await wait(() => selected() === "root", "zero parent");
    key("9"); key("9"); await wait(() => selected() === "child-25", "clamped numeric child");
    assert(selected() === "child-25", "99 clamps to last child");
    input.select("root");
    // Start far from the result, so activation must also reveal it in the viewport.
    viewport().scrollLeft = direction === "ltr" ? 0 : viewport().scrollWidth;
    input.openSearch();
    await wait(() => input.root.querySelector(".arbor-search-input"), "search input");
    const search = input.root.querySelector<HTMLInputElement>(".arbor-search-input")!;
    search.value = "Needle last child"; search.dispatchEvent(new Event("input"));
    await wait(() => input.root.querySelector(".arbor-search-result"), "search results");
    key("Enter", {}, search);
    await wait(() => selected() === "child-25", "search reveal selection");
    assert(selected() === "child-25", "search reveals matched overview block");
    input.closeSearch();
    await input.waitForNextPaint();
    await wait(() => {
      const card = input.overview.getElements().surface?.querySelector('[data-block-id="child-25"]')?.getBoundingClientRect();
      if (!card) return false;
      const visible = viewport().getBoundingClientRect();
      return card.right > visible.left && card.left < visible.right && card.bottom > visible.top && card.top < visible.bottom;
    }, "search result enters visible viewport");
    assert(Boolean(input.overview.getElements().surface?.querySelector('[data-block-id="child-25"]')), "search result is visibly published");
    const linkTree = fixtureTree();
    linkTree.blocks[0].content = "# Root\n\n[[#Root]]\n\n[External](https://example.invalid/)";
    await reset(linkTree);
    await input.waitForSourceMetadata();
    const rootCard = input.overview.getElements().surface!.querySelector<HTMLElement>('[data-block-id="root"]')!;
    const internal = rootCard.querySelector<HTMLAnchorElement>("a.internal-link")!;
    assert(Boolean(internal), "MarkdownRenderer supplies real internal anchor");
    input.select("leaf");
    const sourceBeforeLink = await input.readSource();
    internal.click();
    await wait(() => selected() === "root", "local internal heading selection");
    assert(input.read.getMode() === "overview" && await input.readSource() === sourceBeforeLink, "internal heading reveals without source/mode change");
    const external = rootCard.querySelector<HTMLAnchorElement>('a[href="https://example.invalid/"]')!;
    assert(Boolean(external), "MarkdownRenderer supplies real external anchor");
    const externalEvent = input.activateExternal(external);
    assert(!externalEvent.defaultPrevented && selected() === "root" && !input.editor.getSession(), "external link stays native, never selects/edits the card");
    input.root.setCssStyles({ width: "480px" });
    await input.setMode("editor");
    input.shell.applyViewClasses(input.root); input.shell.syncTouchDock();
    for (const [label, icon] of [["Parent block", direction === "rtl" ? "arrow-right" : "arrow-left"], ["Child block", direction === "rtl" ? "arrow-left" : "arrow-right"], ["Previous block", "chevron-up"], ["Next block", "chevron-down"]]) {
      assert(Boolean(input.root.querySelector(`button[aria-label="${label}"] .lucide-${icon}`)), "Branch Editor retains horizontal glyphs");
    }
    await input.setMode("output");
    input.shell.syncTouchDock();
    assert(!input.root.querySelector(".arbor-touch-dock"), "Output keeps dock absent");
  }
  return { checks };
}

interface NativeInput {
  document: Document;
  markdown: MarkdownPort;
  read: ViewReadPort;
  waitForNextPaint(): Promise<void>;
  recordRaster?(canvas: HTMLCanvasElement, orientation: ArborOverviewOrientation, direction: ArborLayoutDirection): void;
}

const metadata: BranchTreeMetadata = { version: 1, prefix: "", blocks: [
  { id: "root", parentId: null, order: 0, content: "Root with `code`", after: "", appearance: { branchColor: "#44aa88" } },
  { id: "first", parentId: "root", order: 0, content: "First child", after: "" },
  { id: "second", parentId: "root", order: 1, content: "Second child\n\nTaller card\n\nLast paragraph", after: "" }
] };
const variables = {
  "--font-text": "Georgia, serif", "--font-monospace": '"Courier New", monospace',
  "--text-normal": "#eeeeee", "--background-primary": "#202020", "--background-secondary": "#202020"
};
const orientations = ["vertical-top-down", "vertical-bottom-up"] as const;

export async function checkOrientationEditorHost(input: NativeInput): Promise<{ checks: number }> {
  const original = input.read.getState();
  if (!original) throw Error("A loaded native state is required");
  let checks = 0;
  const failures: string[] = [];
  for (const scenario of ["late draft", "measurement", "autofocus", "begin edit autofocus", "unfocused", "session", "source", "close", "latest orientation", "selection"] as const) {
    const fixture = input.document.body.createDiv({ cls: "arbor-view" });
    let state = { ...original, metadata, selectedBlockId: "root" };
    let source = "isolated-A.md";
    let orientation: ArborOverviewOrientation = "horizontal";
    let pauseNext = false;
    let resume: (() => void) | null = null;
    let entered: (() => void) | null = null;
    let pending: Promise<void> | null = null;
    const lateDraft = scenario === "measurement" ? "Late line\n".repeat(18) : "Draft typed after Markdown started\n\nLate text";
    const editor = new BlockEditorController({
      getState: () => state, usesTouchControls: () => false, getViewportHeight: () => 800,
      onBegin() {}, onCancel() {}, onUnchanged: async () => {}, saveEdit: async () => { throw Error("Orientation saved a draft"); },
      onInput() {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
    });
    const port: TreeOverviewPort = {
      read: { getState: () => state, getSettings: () => input.read.getSettings(), getMode: () => "overview", getFilePath: () => source },
      editor, getOverviewOrientation: () => orientation,
      markdown: { render: async (text, target, path) => {
        await input.markdown.render(text, target, path);
        if (pauseNext) { pauseNext = false; await new Promise<void>(resolve => { resume = resolve; entered?.(); }); }
      } },
      selection: { selectBlock() {} }, getBody: () => fixture, getContext: () => null,
      bindViewport: () => () => {}, openBlockMenu() {}, setHoveredBlock() {}, restoreViewport() {}, centerSelected() {}, revealSelected() {}, syncTouchDock() {}, requestRender() {},
      waitForNextPaint: () => input.waitForNextPaint(), syncOutputCardPresentation() {}, consumeAutofocus: session => editor.consumeAutofocus(session), clearPendingFocus() {}, tryHandleCardLink: () => false
    };
    let centeredId: string | undefined;
    const controller = new TreeOverviewController(port);
    port.centerSelected = () => { centeredId = controller.getElements().surface?.querySelector<HTMLElement>(".is-active")?.dataset.blockId; };
    const focusTarget = fixture.createEl("input");
    Object.assign(port, {
      captureOverviewEditorSelection: () => {
        const textarea = controller.getElements().surface?.querySelector<HTMLTextAreaElement>("textarea");
        const session = editor.getSession();
        return textarea && session ? { session, start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection, focused: input.document.activeElement === textarea } : null;
      },
      restoreOverviewEditorSelection: (saved: { session: unknown; start: number; end: number; direction: "forward" | "backward" | "none"; focused: boolean }) => {
        const textarea = controller.getElements().surface?.querySelector<HTMLTextAreaElement>("textarea");
        if (!textarea || editor.getSession() !== saved.session) return;
        if (saved.focused) textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(saved.start, saved.end, saved.direction);
      }
    });
    try {
      if (scenario !== "begin edit autofocus") editor.prepareCreatedBlock(metadata.blocks[0], "overview");
      await controller.syncTreeOverview();
      await input.waitForNextPaint();
      if (scenario === "begin edit autofocus") {
        focusTarget.focus();
        editor.prepareCreatedBlock(metadata.blocks[0], "overview");
        controller.openOverviewEditorInPlace(metadata.blocks[0]);
      }
      const oldSurface = controller.getElements().surface!;
      const oldEditor = oldSurface.querySelector<HTMLTextAreaElement>("textarea")!;
      if (scenario !== "begin edit autofocus") oldEditor.focus({ preventScroll: true });
      oldEditor.value = "Draft before staging";
      oldEditor.dispatchEvent(new Event("input"));
      oldEditor.setSelectionRange(2, 7, "backward");
      if (scenario === "autofocus") editor.getSession()!.autofocus = true;
      orientation = "vertical-top-down";
      controller.invalidate();
      pauseNext = true;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      pending = controller.syncTreeOverview();
      await waiting;
      await input.waitForNextPaint();
      if (input.document.activeElement !== (scenario === "begin edit autofocus" ? focusTarget : oldEditor) || !oldSurface.isConnected) failures.push(`${scenario}: staging stole focus or removed the usable published editor`);
      if (scenario === "begin edit autofocus" && !editor.getSession()?.autofocus) failures.push("begin edit autofocus: staging consumed autofocus before publication");
      oldEditor.value = lateDraft;
      oldEditor.dispatchEvent(new Event("input"));
      oldEditor.setSelectionRange(4, 19, "backward");
      if (scenario === "unfocused") { focusTarget.focus(); editor.clearBlurCommitTimer(); }
      if (scenario === "session") editor.prepareCreatedBlock(metadata.blocks[1], "overview");
      if (scenario === "source") { source = "isolated-B.md"; state = { ...state }; }
      if (scenario === "close") controller.reset();
      if (scenario === "selection") {
        state.selectedBlockId = "second";
        controller.syncOverviewSelection(true);
        focusTarget.focus();
        editor.clearBlurCommitTimer();
        controller.requestCenterOnNextRender();
      }
      if (scenario === "latest orientation") {
        for (const choice of ["vertical-bottom-up", "horizontal"] as const) {
          orientation = choice;
          controller.invalidate();
          await controller.syncTreeOverview();
        }
      }
      const release = resume as (() => void) | null;
      release?.();
      await pending;
      pending = null;
      await input.waitForNextPaint();
      const published = controller.getElements().surface;
      if (scenario === "source" || scenario === "session") {
        if (published !== oldSurface || fixture.querySelector(".is-staging")) failures.push("source: stale draft was published");
      } else if (scenario === "close") {
        if (published || fixture.querySelector(".arbor-overview-stage")) failures.push("close: stale draft reappeared");
      } else {
        const current = published?.querySelector<HTMLTextAreaElement>("textarea");
        if (!current || current.value !== lateDraft) failures.push(`${scenario}: latest draft was lost`);
        if (scenario === "measurement" && current && (current.clientHeight < 300 || current.clientHeight + 2 < current.scrollHeight)) failures.push("measurement: late draft was not resized before publication");
        if (scenario === "begin edit autofocus") {
          if (current && (input.document.activeElement !== current || current.selectionStart !== current.value.length || current.selectionEnd !== current.value.length || editor.getSession()?.autofocus)) failures.push("begin edit autofocus: normal focus was not consumed on the published editor");
        } else if (current && (input.document.activeElement !== (scenario === "unfocused" || scenario === "selection" ? focusTarget : current) || current.selectionStart !== 4 || current.selectionEnd !== 19 || current.selectionDirection !== "backward")) failures.push(`${scenario}: latest caret/focus was lost`);
        if (scenario === "selection" && published) {
          if (published.querySelector<HTMLElement>(".is-active")?.dataset.blockId !== "second") failures.push("selection: stale active card published");
          const path = Array.from(published.querySelectorAll<HTMLElement>(".is-on-path")).map(card => card.dataset.blockId);
          if (path.length !== 1 || path[0] !== "root") failures.push("selection: stale ancestor path published");
          if (centeredId !== "second") failures.push("selection: centered stale card");
        }
        if (scenario === "latest orientation" && published) {
          const root = published.querySelector<HTMLElement>('[data-block-id="root"]')!;
          const child = published.querySelector<HTMLElement>('[data-block-id="first"]')!;
          const isHorizontal = input.read.getSettings().layoutDirection === "rtl"
            ? child.offsetLeft + child.offsetWidth < root.offsetLeft
            : root.offsetLeft + root.offsetWidth < child.offsetLeft;
          if (!isHorizontal) failures.push("latest orientation: obsolete geometry won");
        }
      }
      checks += 3;
    } finally {
      const release = resume as (() => void) | null;
      release?.();
      await pending;
      editor.reset();
      controller.reset();
      fixture.remove();
    }
  }
  if (failures.length) throw Error(failures.join("; "));
  return { checks };
}

function inspectGeometry(surface: HTMLElement, orientation: ArborOverviewOrientation, direction: ArborLayoutDirection): number {
  const win = surface.ownerDocument.defaultView!;
  const root = surface.querySelector<HTMLElement>('[data-block-id="root"]')!;
  const first = surface.querySelector<HTMLElement>('[data-block-id="first"]')!;
  const second = surface.querySelector<HTMLElement>('[data-block-id="second"]')!;
  const parentBox = root.getBoundingClientRect();
  const childBox = first.getBoundingClientRect();
  const otherBox = second.getBoundingClientRect();
  const topDown = orientation === "vertical-top-down";
  if (topDown ? parentBox.bottom >= Math.min(childBox.top, otherBox.top) : parentBox.top <= Math.max(childBox.bottom, otherBox.bottom)) {
    throw Error(`${orientation}/${direction}: root must be ${topDown ? "above" : "below"} both children`);
  }
  if (direction === "ltr" ? childBox.left >= otherBox.left : childBox.left <= otherBox.left) throw Error("Sibling order did not mirror");
  const surfaceBox = surface.getBoundingClientRect();
  const paths = Array.from(surface.querySelectorAll("path"));
  if (paths.length !== 2) throw Error("Missing native links");
  for (const [index, path] of paths.entries()) {
    const coordinates = path.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const targetBox = index === 0 ? childBox : otherBox;
    const expected = [
      parentBox.left + parentBox.width / 2 - surfaceBox.left,
      (topDown ? parentBox.bottom : parentBox.top) - surfaceBox.top,
      targetBox.left + targetBox.width / 2 - surfaceBox.left,
      (topDown ? targetBox.top : targetBox.bottom) - surfaceBox.top
    ];
    const actual = [coordinates[0], coordinates[1], coordinates[6], coordinates[7]];
    if (actual.some((value, position) => Math.abs(value - expected[position]) > 1)) throw Error(`Wrong vertical path anchors: ${actual.join(",")} vs ${expected.join(",")}`);
  }
  const paragraph = root.querySelector("p")!;
  const code = root.querySelector("code")!;
  if (win.getComputedStyle(paragraph).fontFamily !== variables["--font-text"] || !win.getComputedStyle(code).fontFamily.includes("Courier New")) throw Error("Native fonts changed");
  if (win.getComputedStyle(paragraph).color !== "rgb(238, 238, 238)") throw Error("Native text colour changed");
  for (const card of [root, first, second]) {
    if (card.style.getPropertyValue("--arbor-block-color") !== "#44aa88" || win.getComputedStyle(card).backgroundColor === "rgb(32, 32, 32)") throw Error("Inherited card tint lost");
    for (const element of [card, card.querySelector(".arbor-overview-card-content")!]) {
      if (win.getComputedStyle(element).transform !== "none") throw Error("Text/card must remain upright");
    }
  }
  return 16;
}

export async function checkVerticalSnapshotsHost(input: NativeInput): Promise<{ checks: number }> {
  let checks = 0;
  for (const orientation of orientations) {
    for (const direction of ["ltr", "rtl"] as const) {
      let snapshot: Awaited<ReturnType<typeof createOverviewSnapshot>> | null = null;
      const request: OverviewSnapshotInput = {
        document: input.document, metadata, selectedBlockId: null, sourcePath: "", cardWidth: 200,
        direction, orientation, snippetLength: 100, themeVariables: variables, textMuted: "#b3b3b3",
        markdown: { render: async (text, target, path) => {
          await input.markdown.render(text, target, path);
          if (target.parentElement?.dataset.blockId === "first") {
            const surface = target.closest(".arbor-overview-surface")!;
            const rootBox = surface.querySelector('[data-block-id="root"]')!.getBoundingClientRect();
            const childBox = target.parentElement.getBoundingClientRect();
            if (orientation === "vertical-top-down" ? rootBox.top >= childBox.top : rootBox.top <= childBox.top) throw Error("Initial snapshot pass lost orientation");
            checks += 1;
          }
          request.orientation = "horizontal";
          request.direction = direction === "ltr" ? "rtl" : "ltr";
        } },
        waitForNextPaint: async () => {
          request.orientation = "horizontal";
          request.direction = direction === "ltr" ? "rtl" : "ltr";
          await input.waitForNextPaint();
        }
      };
      try {
        snapshot = await createOverviewSnapshot(request);
        const surface = snapshot.frame.querySelector<HTMLElement>(".arbor-overview-surface")!;
        checks += inspectGeometry(surface, orientation, direction);
        const canvas = await toCanvas(snapshot.frame, { width: snapshot.width, height: snapshot.height, pixelRatio: 1, backgroundColor: "#202020" });
        const frameBox = snapshot.frame.getBoundingClientRect();
        const rootBox = surface.querySelector('[data-block-id="root"]')!.getBoundingClientRect();
        const childBoxes = Array.from(surface.querySelectorAll('[data-block-id="first"], [data-block-id="second"]')).map(card => card.getBoundingClientRect());
        const top = Math.ceil((orientation === "vertical-top-down" ? rootBox.bottom : Math.max(...childBoxes.map(box => box.bottom))) - frameBox.top + 8);
        const bottom = Math.floor((orientation === "vertical-top-down" ? Math.min(...childBoxes.map(box => box.top)) : rootBox.top) - frameBox.top - 8);
        const left = Math.floor(surface.getBoundingClientRect().left - frameBox.left);
        const width = Math.floor(surface.getBoundingClientRect().width);
        if (bottom <= top) throw Error("No raster sampling gap");
        const data = canvas.getContext("2d")!.getImageData(left, top, width, bottom - top).data;
        let painted = 0;
        let background = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index] > 50 && Math.abs(data[index] - data[index + 1]) < 3 && Math.abs(data[index] - data[index + 2]) < 3) painted += 1;
          if ([data[index], data[index + 1], data[index + 2]].every(value => value >= 28 && value <= 36)) background += 1;
        }
        if (painted < 10 || background / (data.length / 4) < 0.9) throw Error(`Vertical raster lost thin connector paint: ${painted}/${background}`);
        input.recordRaster?.(canvas, orientation, direction);
        const png = new Uint8Array(await (await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("No PNG"))))).arrayBuffer());
        const pdf = await PDFDocument.load(await buildSinglePageTreeOverviewPdf(png, snapshot.width, snapshot.height));
        const page = pdf.getPages()[0];
        if (pdf.getPageCount() !== 1 || page.getWidth() !== snapshot.width || page.getHeight() !== snapshot.height) throw Error("PDF must preserve one-page geometry");
        checks += 2;
      } finally {
        snapshot?.dispose();
      }
    }
  }
  return { checks };
}

export async function checkVerticalLiveHost(input: NativeInput): Promise<{ checks: number }> {
  const originalState = input.read.getState();
  if (!originalState) throw Error("Native view must have a loaded state");
  let checks = 0;
  for (const orientation of orientations) {
    for (const direction of ["ltr", "rtl"] as const) {
      const fixture = input.document.body.createDiv({ cls: "arbor-view" });
      fixture.setCssProps(variables);
      fixture.toggleClass("is-rtl", direction === "rtl");
      let state = { ...originalState, metadata, selectedBlockId: null };
      let sourcePath = "";
      const settings = { ...input.read.getSettings(), cardWidth: 200, zoomLevel: 1, layoutDirection: direction };
      let effectiveOrientation: ArborOverviewOrientation = orientation;
      let pauseAt: "markdown" | "paint" | null = null;
      let entered: (() => void) | null = null;
      const gate: { resume?: () => void } = {};
      const pause = async (phase: "markdown" | "paint") => {
        if (pauseAt !== phase) return;
        pauseAt = null;
        await new Promise<void>(resolve => { gate.resume = resolve; entered?.(); });
      };
      const colours = resolveBlockColors(metadata);
      const port: TreeOverviewPort = {
        read: { getState: () => state, getSettings: () => settings, getMode: () => "overview", getFilePath: () => sourcePath },
        getOverviewOrientation: () => effectiveOrientation,
        editor: { getSession: () => null, beginEditingBlock: () => {}, commitEditIfNeeded: async () => {}, clearBlurCommitTimer: () => {}, wireEditorElement: () => {}, resizeEditor: () => {} },
        markdown: { render: async (text, target, path) => { await input.markdown.render(text, target, path); await pause("markdown"); } },
        selection: { selectBlock: () => {} }, getBody: () => fixture, getContext: () => null,
        bindViewport: () => () => {}, openBlockMenu: () => {}, setHoveredBlock: () => {}, restoreViewport: () => {}, centerSelected: () => {}, revealSelected: () => {}, syncTouchDock: () => {}, requestRender: () => {},
        waitForNextPaint: async () => { await input.waitForNextPaint(); await pause("paint"); },
        syncOutputCardPresentation: (card, id) => syncCardColour(card, colours.get(id) ?? null), consumeAutofocus: () => {}, clearPendingFocus: () => {}, tryHandleCardLink: () => false
      };
      const controller = new TreeOverviewController(port);
      let pending: Promise<void> | null = null;
      try {
        await controller.syncTreeOverview();
        const published = controller.getElements().surface!;
        checks += inspectGeometry(published, orientation, direction);
        for (const phase of ["markdown", "paint"] as const) {
          for (const change of ["orientation", "direction", "state", "source", "invalidate"] as const) {
            pauseAt = phase;
            const reachedPause = new Promise<void>(resolve => { entered = resolve; });
            pending = controller.syncTreeOverview();
            await reachedPause;
            if (change === "orientation") effectiveOrientation = "horizontal";
            else if (change === "direction") settings.layoutDirection = direction === "ltr" ? "rtl" : "ltr";
            else if (change === "state") state = { ...state };
            else if (change === "source") sourcePath = "changed.md";
            else controller.invalidate();
            gate.resume?.();
            await pending;
            pending = null;
            if (controller.getElements().surface !== published || !published.isConnected || fixture.querySelector(".is-staging")) throw Error(`Stale ${change} at ${phase} published or leaked staging`);
            effectiveOrientation = orientation;
            settings.layoutDirection = direction;
            sourcePath = "";
            checks += 1;
          }
        }
        pauseAt = "markdown";
        const reachedPause = new Promise<void>(resolve => { entered = resolve; });
        pending = controller.syncTreeOverview();
        await reachedPause;
        effectiveOrientation = orientation === "vertical-top-down" ? "vertical-bottom-up" : "vertical-top-down";
        await controller.syncTreeOverview();
        const replacement = controller.getElements().surface!;
        checks += inspectGeometry(replacement, effectiveOrientation, direction);
        gate.resume?.();
        await pending;
        pending = null;
        if (replacement === published || controller.getElements().surface !== replacement || !replacement.isConnected || published.isConnected || fixture.querySelector(".is-staging")) throw Error("Older render removed or replaced the newer publication");
        checks += 1;
      } finally {
        gate.resume?.();
        try {
          await pending;
        } finally {
          controller.reset();
          fixture.remove();
        }
      }
    }
  }
  return { checks };
}
