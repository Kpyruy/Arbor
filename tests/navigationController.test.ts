import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationController, type NavigationActions } from "../src/view/navigation/NavigationController";
import { CardLinkController } from "../src/view/navigation/CardLinkController";
import { fixtureLoaded, fixtureSettings } from "./helpers/arborFixtures";
import { addChild, addRootBlock, addSibling, deleteBlockAndLiftChildren, getBlock, getChildren, getParentBlock } from "../src/model/tree";
import type { ArborOverviewOrientation, ArborPresentationMode } from "../src/types";
import { timerWindow } from "./helpers/windowTimers";

beforeEach(() => vi.stubGlobal("window", { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) }));
afterEach(() => vi.unstubAllGlobals());

function keyEvent(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    code: options.code ?? "",
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    currentTarget: options.currentTarget ?? null,
    preventDefault: options.preventDefault ?? vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as KeyboardEvent;
}

function createController(orientation: ArborOverviewOrientation = "horizontal", mode: ArborPresentationMode = "editor", getWindow?: () => Window) {
  const state = fixtureLoaded();
  const settings = fixtureSettings();
  const selectBlock = vi.fn((id: string | null) => { state.selectedBlockId = id; });
  const openInternal = vi.fn(async () => undefined);
  const links = new CardLinkController({
    getSourcePath: () => "Folder/Source.md",
    paneForEvent: () => false,
    openInternal,
    selectLocalBlock: (id) => { state.selectedBlockId = id; return true; },
    reportOpenError: vi.fn()
  });
  const actions = {
    beginEditingBlock: vi.fn(),
    createChild: vi.fn(async () => undefined),
    createSiblingAbove: vi.fn(async () => undefined),
    createSiblingBelow: vi.fn(async () => undefined),
    createParentLevelBlock: vi.fn(async () => undefined),
    createRootBlock: vi.fn(async () => undefined),
    deleteSelectedBlock: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
    openSearchOverlay: vi.fn(),
    closeSearchOverlay: vi.fn(),
    isSearchOpen: () => false,
    setKeyboardSelection: (id) => { state.selectedBlockId = id; },
    openBlockMenu: vi.fn(),
    tryHandleCardLink: (event: MouseEvent, card: HTMLElement) => links.handleActivation(event, card)
  } satisfies NavigationActions;
  const controller = new NavigationController({
    getState: () => state,
    getSettings: () => settings,
    getMode: () => mode,
    getFilePath: () => "fixture.md"
  }, { selectBlock }, actions, () => orientation, getWindow);

  return { actions, controller, selectBlock, settings, state, openInternal };
}

// Keep model mutations real; only the file-save/render boundary is omitted.
function createMutationController(orientation: ArborOverviewOrientation, mode: ArborPresentationMode = "overview") {
  const fixture = createController(orientation, mode);
  const { state, actions } = fixture;
  const apply = (result: { metadata: typeof state.metadata; selectedBlockId: string | null }) => {
    Object.assign(state, result);
  };
  actions.createChild = vi.fn(async () => apply(addChild(state.metadata, state.selectedBlockId)));
  actions.createSiblingAbove = vi.fn(async () => apply(addSibling(state.metadata, state.selectedBlockId, "above")));
  actions.createSiblingBelow = vi.fn(async () => apply(addSibling(state.metadata, state.selectedBlockId, "below")));
  actions.createParentLevelBlock = vi.fn(async () => {
    const parent = getParentBlock(state.metadata, state.selectedBlockId);
    if (parent) apply(addSibling(state.metadata, parent.id, "below"));
  });
  actions.createRootBlock = vi.fn(async () => apply(addRootBlock(state.metadata)));
  actions.deleteSelectedBlock = vi.fn(async () => {
    if (state.selectedBlockId) apply(deleteBlockAndLiftChildren(state.metadata, state.selectedBlockId));
  });
  return fixture;
}

const verticalCases = [
  ["vertical-top-down", "ltr", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  ["vertical-top-down", "rtl", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"],
  ["vertical-bottom-up", "ltr", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"],
  ["vertical-bottom-up", "rtl", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]
] as const;

function renderedLinkEvent(type = "click", button = 0) {
  const content = {};
  const anchor = {
    nodeType: 1,
    closest: (selector: string): unknown => selector === "a" ? anchor
      : selector.includes(".arbor-card-content") ? content : null,
    classList: { contains: (name: string) => name === "internal-link" },
    getAttribute: () => "Target#Heading"
  };
  const card = { dataset: { blockId: "second" }, contains: (node: unknown) => node === content };
  const preventDefault = vi.fn();
  const event = {
    type, button, detail: 1, currentTarget: card, target: anchor,
    defaultPrevented: false, preventDefault, stopPropagation: vi.fn()
  } as unknown as MouseEvent;
  return { anchor: anchor as unknown as EventTarget, card: card as unknown as EventTarget, event, preventDefault };
}

describe("NavigationController", () => {
  let controller: NavigationController | null = null;

  afterEach(() => {
    controller?.clearNumericNavigation();
    controller = null;
    vi.useRealTimers();
  });

  it("cancels numeric debounce in its owning window when the view migrates", () => {
    const first = timerWindow();
    const second = timerWindow();
    let owner = first.win;
    const fixture = createController("horizontal", "editor", () => owner);
    controller = fixture.controller;
    controller.tryHandleNumericChildNavigation(keyEvent("2"), "root");
    expect(first.pendingCount()).toBe(1);
    owner = second.win;
    controller.clearNumericNavigation();
    first.flush();
    expect(fixture.state.selectedBlockId).toBe("first");
    controller.tryHandleNumericChildNavigation(keyEvent("2"), "root");
    second.flush();
    expect(fixture.state.selectedBlockId).toBe("second");
  });

  describe.each(verticalCases)("vertical overview %s/%s", (orientation, direction, parent, child, previous, next) => {
    it("navigates through parent, first child and logical siblings", () => {
      const fixture = createController(orientation, "overview");
      fixture.settings.layoutDirection = direction;
      controller = fixture.controller;
      controller.handleOverviewKeyDown(keyEvent(child));
      expect(fixture.state.selectedBlockId).toBe("leaf");
      controller.handleOverviewKeyDown(keyEvent(parent));
      expect(fixture.state.selectedBlockId).toBe("first");
      controller.handleOverviewKeyDown(keyEvent(next));
      expect(fixture.state.selectedBlockId).toBe("second");
      controller.handleOverviewKeyDown(keyEvent(next));
      expect(fixture.state.selectedBlockId).toBe("second");
      controller.handleOverviewKeyDown(keyEvent(previous));
      controller.handleOverviewKeyDown(keyEvent(parent));
      expect(fixture.state.selectedBlockId).toBe("root");
      controller.handleOverviewKeyDown(keyEvent(parent));
      expect(fixture.state.selectedBlockId).toBe("root");
    });

    it.each(["ctrlKey", "metaKey"] as const)("%s physical arrows create the correct topology and selected ID", (modifier) => {
      for (const [key, expectedParent, expectedSiblings] of [
        [child, "first", ["leaf", "NEW"]],
        [previous, "root", ["NEW", "first", "second"]],
        [next, "root", ["first", "NEW", "second"]],
        [parent, null, ["root", "NEW"]]
      ] as const) {
        const fixture = createMutationController(orientation);
        fixture.settings.layoutDirection = direction;
        controller = fixture.controller;
        controller.handleOverviewKeyDown(keyEvent(key, { [modifier]: true }));
        const createdId = fixture.state.selectedBlockId!;
        expect(createdId).not.toBe("first");
        expect(fixture.state.metadata.blocks).toHaveLength(5);
        expect(getBlock(fixture.state.metadata, createdId)?.parentId).toBe(expectedParent);
        expect(getChildren(fixture.state.metadata, expectedParent).map(block => block.id === createdId ? "NEW" : block.id)).toEqual(expectedSiblings);
        expect(getBlock(fixture.state.metadata, "leaf")?.parentId).toBe("first");
      }
      const rootFixture = createMutationController(orientation);
      rootFixture.settings.layoutDirection = direction;
      rootFixture.state.selectedBlockId = "root";
      rootFixture.controller.handleOverviewKeyDown(keyEvent(parent, { [modifier]: true }));
      expect(rootFixture.state.selectedBlockId).toBe("root");
      expect(rootFixture.state.metadata.blocks).toHaveLength(4);
    });

    it("continues arrow navigation after deleting and lifting children", () => {
      const fixture = createMutationController(orientation);
      fixture.settings.layoutDirection = direction;
      controller = fixture.controller;
      controller.handleOverviewKeyDown(keyEvent("Delete"));
      expect(fixture.state.selectedBlockId).toBe("leaf");
      expect(getBlock(fixture.state.metadata, "leaf")?.parentId).toBe("root");
      controller.handleOverviewKeyDown(keyEvent(next));
      expect(fixture.state.selectedBlockId).toBe("second");
      controller.handleOverviewKeyDown(keyEvent(parent));
      expect(fixture.state.selectedBlockId).toBe("root");
    });

    it.each(["input", "textarea", "[contenteditable='true']"])("leaves %s keys native", (selector) => {
      const fixture = createMutationController(orientation);
      const preventDefault = vi.fn();
      const target = { closest: (query: string) => query.includes(selector) ? {} : null } as unknown as EventTarget;
      fixture.controller.handleOverviewKeyDown(keyEvent(child, { ctrlKey: true, target, preventDefault }));
      expect(fixture.state.selectedBlockId).toBe("first");
      expect(fixture.state.metadata.blocks).toHaveLength(4);
      expect(preventDefault).not.toHaveBeenCalled();
    });
  });

  it.each(["editor", "output"] as const)("keeps %s creation horizontal despite a vertical overview default", (mode) => {
    for (const orientation of ["vertical-top-down", "vertical-bottom-up"] as const) {
      for (const direction of ["ltr", "rtl"] as const) {
        for (const modifier of ["ctrlKey", "metaKey"] as const) {
          for (const [key, expectedParent, expectedOrder] of [
            [direction === "ltr" ? "ArrowRight" : "ArrowLeft", "first", ["leaf", "NEW"]],
            ["ArrowUp", "root", ["NEW", "first", "second"]],
            ["ArrowDown", "root", ["first", "NEW", "second"]],
            [direction === "ltr" ? "ArrowLeft" : "ArrowRight", null, ["root", "NEW"]]
          ] as const) {
            const fixture = createMutationController(orientation, mode);
            fixture.settings.layoutDirection = direction;
            fixture.controller.handleViewportKeyDown(keyEvent(key, { [modifier]: true }));
            const selected = fixture.state.selectedBlockId;
            expect(getBlock(fixture.state.metadata, selected)?.parentId).toBe(expectedParent);
            expect(getChildren(fixture.state.metadata, expectedParent).map(block => block.id === selected ? "NEW" : block.id)).toEqual(expectedOrder);
          }
        }
      }
    }
  });

  it("waits the complete 250 ms before selecting a numeric child", async () => {
    vi.useFakeTimers();
    const fixture = createController();
    controller = fixture.controller;
    const event = keyEvent("2");

    controller.tryHandleNumericChildNavigation(event, "root");
    await vi.advanceTimersByTimeAsync(249);
    expect(fixture.selectBlock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.selectBlock).toHaveBeenCalledWith("second", { focus: true });
  });

  it("collects two digits, clamps numeric children, and maps zero to the parent", async () => {
    vi.useFakeTimers();
    const fixture = createController();
    fixture.state.metadata.blocks = [
      { id: "root", parentId: null, order: 0, content: "Root", after: "" },
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `child-${index + 1}`,
        parentId: "root",
        order: index,
        content: String(index + 1),
        after: ""
      }))
    ];
    controller = fixture.controller;

    controller.tryHandleNumericChildNavigation(keyEvent("2"), "root");
    await vi.advanceTimersByTimeAsync(100);
    controller.tryHandleNumericChildNavigation(keyEvent("5"), "root");
    await vi.advanceTimersByTimeAsync(249);
    expect(fixture.selectBlock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.selectBlock).toHaveBeenLastCalledWith("child-25", { focus: true });

    controller.tryHandleNumericChildNavigation(keyEvent("9"), "root");
    controller.tryHandleNumericChildNavigation(keyEvent("9"), "root");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.selectBlock).toHaveBeenLastCalledWith("child-25", { focus: true });

    controller.tryHandleNumericChildNavigation(keyEvent("0"), "child-1");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.selectBlock).toHaveBeenLastCalledWith("root", { focus: true });
  });

  it("clears pending numeric navigation and ignores modified digits", async () => {
    vi.useFakeTimers();
    const fixture = createController();
    controller = fixture.controller;

    expect(controller.tryHandleNumericChildNavigation(keyEvent("2", { ctrlKey: true }), "root")).toBe(false);
    expect(controller.tryHandleNumericChildNavigation(keyEvent("2", { metaKey: true }), "root")).toBe(false);
    expect(controller.tryHandleNumericChildNavigation(keyEvent("2", { altKey: true }), "root")).toBe(false);
    controller.tryHandleNumericChildNavigation(keyEvent("2"), "root");
    controller.clearNumericNavigation();
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.selectBlock).not.toHaveBeenCalled();
  });

  it("uses RTL arrows and Ctrl or Cmd directional creation", () => {
    const fixture = createController();
    controller = fixture.controller;
    fixture.settings.layoutDirection = "rtl";
    fixture.state.selectedBlockId = "first";

    controller.handleViewportKeyDown(keyEvent("ArrowRight"));
    expect(fixture.selectBlock).toHaveBeenCalledWith("root", { focus: true });
    controller.handleViewportKeyDown(keyEvent("ArrowLeft", { ctrlKey: true }));
    controller.handleViewportKeyDown(keyEvent("ArrowUp", { metaKey: true }));
    expect(fixture.actions.createChild).toHaveBeenCalledOnce();
    expect(fixture.actions.createSiblingAbove).toHaveBeenCalledOnce();
  });

  it("edits the card target but the selected viewport or overview block", () => {
    const fixture = createController();
    controller = fixture.controller;
    fixture.state.selectedBlockId = "leaf";

    controller.handleCardKeyDown(keyEvent("Enter", { currentTarget: { dataset: { blockId: "second" } } as unknown as EventTarget }));
    fixture.state.selectedBlockId = "leaf";
    controller.handleViewportKeyDown(keyEvent("Enter"));
    controller.handleOverviewKeyDown(keyEvent("Enter"));

    expect(fixture.actions.beginEditingBlock).toHaveBeenNthCalledWith(1, "second");
    expect(fixture.actions.beginEditingBlock).toHaveBeenNthCalledWith(2, "leaf");
    expect(fixture.actions.beginEditingBlock).toHaveBeenNthCalledWith(3, "leaf", "overview");
  });

  it("keeps navigation active after Delete", () => {
    const fixture = createController();
    controller = fixture.controller;
    fixture.state.selectedBlockId = "first";

    controller.handleViewportKeyDown(keyEvent("Delete"));
    controller.handleViewportKeyDown(keyEvent("ArrowDown"));

    expect(fixture.actions.deleteSelectedBlock).toHaveBeenCalledOnce();
    expect(fixture.selectBlock).toHaveBeenCalledWith("second", { focus: true });
  });

  it("preserves link defaults and selects before opening a card context menu", () => {
    const fixture = createController();
    controller = fixture.controller;
    const preventDefault = vi.fn();
    const linkEvent = {
      currentTarget: { dataset: { blockId: "second" } },
      target: { closest: (selector: string) => selector === "a" ? {} : null },
      preventDefault
    } as unknown as MouseEvent;
    const menuEvent = {
      currentTarget: { dataset: { blockId: "second" } },
      preventDefault: vi.fn()
    } as unknown as MouseEvent;

    controller.handleCardClick(linkEvent);
    controller.handleCardContextMenu(menuEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(fixture.selectBlock).toHaveBeenCalledWith("second");
    expect(fixture.actions.openBlockMenu).toHaveBeenCalledWith("second", menuEvent);
  });

  it("opens an internal card link without selecting or editing the card", () => {
    const fixture = createController();
    const { event } = renderedLinkEvent();
    fixture.controller.handleCardClick(event);
    expect(fixture.openInternal).toHaveBeenCalledExactlyOnceWith("Target#Heading", "Folder/Source.md", false);
    expect(fixture.selectBlock).not.toHaveBeenCalled();
    expect(fixture.actions.beginEditingBlock).not.toHaveBeenCalled();
  });

  it("routes middle activation to the link without a card action", () => {
    const fixture = createController();
    const { event } = renderedLinkEvent("auxclick", 1);
    fixture.controller.handleCardAuxClick(event);
    expect(fixture.openInternal).toHaveBeenCalledOnce();
    expect(fixture.selectBlock).not.toHaveBeenCalled();
    expect(fixture.actions.beginEditingBlock).not.toHaveBeenCalled();
  });

  it("leaves a link context menu and double-click separate from card actions", () => {
    const fixture = createController();
    const { event, preventDefault } = renderedLinkEvent("contextmenu", 2);
    fixture.controller.handleCardContextMenu(event);
    fixture.controller.handleCardDoubleClick(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(fixture.selectBlock).not.toHaveBeenCalled();
    expect(fixture.actions.openBlockMenu).not.toHaveBeenCalled();
    expect(fixture.actions.beginEditingBlock).not.toHaveBeenCalled();
  });

  it.each(["handleCardKeyDown", "handleViewportKeyDown", "handleOverviewKeyDown"] as const)(
    "%s preserves native link Enter without changing selection", (method) => {
      const fixture = createController();
      const { anchor, card } = renderedLinkEvent();
      const before = fixture.state.selectedBlockId;
      const preventDefault = vi.fn();
      const event = keyEvent("Enter", { target: anchor, currentTarget: card, preventDefault });
      fixture.controller[method](event);
      expect(fixture.state.selectedBlockId).toBe(before);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(fixture.selectBlock).not.toHaveBeenCalled();
      expect(fixture.actions.beginEditingBlock).not.toHaveBeenCalled();
      expect(fixture.openInternal).not.toHaveBeenCalled();
    }
  );
});
