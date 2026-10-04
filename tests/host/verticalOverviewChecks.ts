import { toCanvas } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { buildSinglePageTreeOverviewPdf } from "../../src/treeOverviewPdf";
import type { ArborLayoutDirection, ArborOverviewOrientation, BranchTreeMetadata } from "../../src/types";
import { resolveBlockColors } from "../../src/model/blockAppearance";
import { syncCardColour } from "../../src/view/appearance/cardColours";
import { createOverviewSnapshot, type OverviewSnapshotInput } from "../../src/view/export/overviewSnapshot";
import { TreeOverviewController, type TreeOverviewPort } from "../../src/view/overview/TreeOverviewController";
import type { MarkdownPort, ViewReadPort } from "../../src/view/state/viewTypes";

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
