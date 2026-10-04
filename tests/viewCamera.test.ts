import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchViewportController } from "../src/view/branch/BranchViewportController";
import { OverviewViewportController } from "../src/view/overview/OverviewViewportController";
import type { EditingSession } from "../src/view/state/viewTypes";
import { fixtureLoaded, fixtureSettings } from "./helpers/arborFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

function overviewCamera(zoom = 1) {
  const scrollTo = vi.fn();
  const viewport = {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 800,
    clientHeight: 600,
    scrollWidth: 1600,
    scrollHeight: 1200,
    scrollTo
  } as unknown as HTMLElement;
  const scene = { offsetLeft: 0, offsetTop: 0 } as HTMLElement;
  const camera = new OverviewViewportController({
    getElements: () => ({ viewport, scene, surface: null }),
    getZoom: () => zoom
  });
  return { camera, scrollTo, viewport };
}

describe("OverviewViewportController", () => {
  it("retains a preserved position until a replacement viewport can restore it", () => {
    let viewport: HTMLElement | null = {
      scrollLeft: 120,
      scrollTop: 240,
      clientWidth: 800,
      clientHeight: 600,
      scrollWidth: 1600,
      scrollHeight: 1200,
      scrollTo: vi.fn()
    } as unknown as HTMLElement;
    const camera = new OverviewViewportController({
      getElements: () => ({ viewport, scene: null, surface: null }),
      getZoom: () => 1
    });

    camera.preserve();
    viewport = null;
    camera.restore();
    const replacementScrollTo = vi.fn();
    const replacement = {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 800,
      clientHeight: 600,
      scrollWidth: 1600,
      scrollHeight: 1200,
      scrollTo: replacementScrollTo
    } as unknown as HTMLElement;
    viewport = replacement;

    camera.restore();

    expect(replacementScrollTo).toHaveBeenCalledWith({ left: 120, top: 240, behavior: "auto" });
  });

  it("does not move a camera for an already visible card", () => {
    const { camera, scrollTo } = overviewCamera();
    const card = { offsetLeft: 100, offsetTop: 100, offsetWidth: 300, offsetHeight: 200 } as HTMLElement;

    camera.revealOverviewSelectedCard(card);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reveals a card below the safe viewport padding", () => {
    const { camera, scrollTo } = overviewCamera();
    const card = { offsetLeft: 200, offsetTop: 900, offsetWidth: 300, offsetHeight: 200 } as HTMLElement;

    camera.revealOverviewSelectedCard(card);

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 536, behavior: "smooth" });
  });

  it("uses zoomed screen geometry without changing card layout dimensions", () => {
    const { camera, scrollTo } = overviewCamera(0.25);
    const card = { offsetLeft: 200, offsetTop: 900, offsetWidth: 300, offsetHeight: 200 } as HTMLElement;

    camera.revealOverviewSelectedCard(card);

    expect(card.offsetWidth).toBe(300);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("keeps an oversized editing card's top accessible on repeated reveals", () => {
    const { camera, scrollTo, viewport } = overviewCamera();
    const card = { offsetLeft: 100, offsetTop: 100, offsetWidth: 300, offsetHeight: 1000,
      classList: { contains: (name: string) => name === "is-editing" } } as unknown as HTMLElement;
    camera.revealOverviewSelectedCard(card);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 64, behavior: "smooth" });
    viewport.scrollTop = 64;
    camera.revealOverviewSelectedCard(card);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 64, behavior: "smooth" });
  });

  it("discards an old orientation restore without consuming the next preserve", () => {
    const { camera, viewport, scrollTo } = overviewCamera();
    viewport.scrollLeft = 120;
    viewport.scrollTop = 240;
    camera.preserve();
    camera.discardPendingRestore();
    scrollTo.mockClear();
    camera.restore();
    expect(scrollTo).not.toHaveBeenCalled();
    viewport.scrollTop = 360;
    camera.preserve();
    viewport.scrollTop = 0;
    camera.restore();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 120, top: 360, behavior: "auto" });
    scrollTo.mockClear();
    camera.restore();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

function branchCamera(elements: Partial<{
  root: HTMLElement;
  stage: HTMLElement | null;
  viewport: HTMLElement | null;
  columns: HTMLElement | null;
  previewContent: HTMLElement | null;
}>, session: EditingSession | null = null) {
  return new BranchViewportController({
    read: {
      getState: () => null,
      getSettings: fixtureSettings,
      getMode: () => "editor",
      getFilePath: () => ""
    },
    getElements: () => ({
      root: { querySelectorAll: () => [] } as unknown as HTMLElement,
      stage: null,
      viewport: null,
      columns: null,
      previewContent: null,
      ...elements
    }),
    getSession: () => session,
    isCompact: () => false,
    consumeAutofocus: () => {}
  });
}

describe("BranchViewportController", () => {
  it("cancels an earlier horizontal animation before starting a new one", () => {
    let nextFrame = 1;
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn(() => nextFrame++),
      cancelAnimationFrame
    });
    const viewport = {
      scrollLeft: 0,
      clientWidth: 800,
      scrollWidth: 1600,
      getBoundingClientRect: () => ({ left: 0, right: 800 })
    } as unknown as HTMLElement;
    const card = {
      getBoundingClientRect: () => ({ left: 900, right: 1000 })
    } as HTMLElement;
    const camera = branchCamera({ viewport });

    camera.scrollCardIntoHorizontalView(card, viewport);
    camera.scrollCardIntoHorizontalView(card, viewport);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("does not focus after reset cancels a pending focus frame", () => {
    const queued = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const focus = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const frame = nextFrame++;
        queued.set(frame, callback);
        return frame;
      }),
      cancelAnimationFrame: vi.fn((frame: number) => queued.delete(frame))
    });
    const viewport = {
      focus,
      classList: { remove: vi.fn() }
    } as unknown as HTMLElement;
    const columns = {
      querySelector: () => null,
      setCssProps: vi.fn()
    } as unknown as HTMLElement;
    const camera = branchCamera({ viewport, columns });

    camera.applyPendingFocusAndScroll({
      focusBlockId: "block-1",
      scrollBlockId: null,
      snap: false,
      preservedSceneWidth: 0
    });
    camera.reset();
    queued.forEach((callback) => callback(0));

    expect(focus).not.toHaveBeenCalled();
  });

  it("prioritizes the preview editor and focuses it without scrolling", () => {
    const queued: FrameRequestCallback[] = [];
    const focus = vi.fn();
    const consumeAutofocus = vi.fn();
    const editor = {
      value: "preview text",
      focus,
      setSelectionRange: vi.fn()
    } as unknown as HTMLTextAreaElement;
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn((next: FrameRequestCallback) => {
        queued.push(next);
        return 1;
      }),
      cancelAnimationFrame: vi.fn()
    });
    const viewport = { focus: vi.fn(), classList: { remove: vi.fn() } } as unknown as HTMLElement;
    const columns = {
      querySelector: vi.fn(() => null),
      setCssProps: vi.fn()
    } as unknown as HTMLElement;
    const previewContent = { querySelector: vi.fn(() => editor) } as unknown as HTMLElement;
    const session: EditingSession = {
      blockId: "block-1",
      originalContent: "preview text",
      value: "preview text",
      origin: "preview",
      autofocus: true
    };
    const camera = new BranchViewportController({
      read: { getState: () => null, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "" },
      getElements: () => ({ root: { querySelectorAll: () => [] } as unknown as HTMLElement, stage: null, viewport, columns, previewContent }),
      getSession: () => session,
      isCompact: () => false,
      consumeAutofocus
    });

    camera.applyPendingFocusAndScroll({ focusBlockId: session.blockId, scrollBlockId: null, snap: false, preservedSceneWidth: 0 });
    queued[0]?.(0);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(consumeAutofocus).toHaveBeenCalledWith(session);
  });

  it("aligns using root fallback nodes when direct viewport references are unavailable", () => {
    vi.stubGlobal("HTMLElement", class {});
    const state = fixtureLoaded();
    const setCssProps = vi.fn();
    const list = {
      classList: { contains: () => false },
      setCssProps
    } as unknown as HTMLElement;
    const card = {
      classList: { contains: (name: string) => name === "is-active" },
      dataset: { blockId: "root" },
      offsetHeight: 80,
      offsetTop: 20,
      offsetParent: null
    } as unknown as HTMLElement;
    const column = {
      dataset: { columnDepth: "0" },
      querySelector: (selector: string) => selector === ".arbor-card-list" ? list : card,
      querySelectorAll: () => [card]
    } as unknown as HTMLElement;
    const columns = {
      querySelectorAll: () => [column],
      getBoundingClientRect: () => ({ top: 0 })
    } as unknown as HTMLElement;
    const viewport = {
      clientHeight: 600,
      getBoundingClientRect: () => ({ top: 0 })
    } as unknown as HTMLElement;
    const root = {
      querySelector: (selector: string) => selector === ".arbor-columns-viewport" ? viewport : columns,
      querySelectorAll: () => []
    } as unknown as HTMLElement;
    const camera = new BranchViewportController({
      read: {
        getState: () => state,
        getSettings: fixtureSettings,
        getMode: () => "editor",
        getFilePath: () => "fixture.md"
      },
      getElements: () => ({ root, stage: null, viewport: null, columns: null, previewContent: null }),
      getSession: () => null,
      isCompact: () => false,
      consumeAutofocus: () => {}
    });

    camera.alignColumnsToActivePath();

    expect(setCssProps).toHaveBeenCalledWith({ "--arbor-card-list-offset-y": "204px" });
  });

  it("does not release pointer capture again after lostpointercapture", () => {
    const releasePointerCapture = vi.fn();
    const viewport = {
      scrollLeft: 0,
      clientWidth: 800,
      scrollWidth: 1600,
      classList: { add: vi.fn(), remove: vi.fn() },
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    } as unknown as HTMLElement;
    const camera = branchCamera({ viewport });
    const pointer = { pointerId: 7, pointerType: "mouse", button: 0, clientX: 10, target: null } as unknown as PointerEvent;

    camera.handleViewportPointerDown(pointer, viewport);
    camera.handleViewportPointerCaptureLost(pointer, viewport);

    expect(releasePointerCapture).not.toHaveBeenCalled();
  });
});
