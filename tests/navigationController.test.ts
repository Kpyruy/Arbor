import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationController, type NavigationActions } from "../src/view/navigation/NavigationController";
import { CardLinkController } from "../src/view/navigation/CardLinkController";
import { fixtureLoaded, fixtureSettings } from "./helpers/arborFixtures";

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

function createController() {
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
    getMode: () => "editor",
    getFilePath: () => "fixture.md"
  }, { selectBlock }, actions);

  return { actions, controller, selectBlock, settings, state, openInternal };
}

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
