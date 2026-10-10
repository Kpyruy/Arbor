import { describe, expect, it, vi } from "vitest";
import { getChildren } from "../src/model/tree";
import type { BranchTreeMetadata, BranchTreeMutationResult } from "../src/types";
import { DragDropController } from "../src/view/branch/DragDropController";
import { fixtureLoaded, fixtureSettings } from "./helpers/arborFixtures";

function controllerForTree() {
  const state = fixtureLoaded();
  const requestRender = vi.fn();
  const controller = new DragDropController({
    read: { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "fixture.md" },
    getDocument: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document),
    getRoot: () => ({ querySelectorAll: () => [], createEl: () => ({ remove() {} }) } as unknown as HTMLElement),
    getStage: () => null,
    getColumn: (key) => {
      if (key === "root") {
        return { key, label: "Root", parentId: null, blocks: getChildren(state.metadata, null) };
      }
      if (key === "depth-1") {
        return { key, label: "Root children", parentId: "root", blocks: getChildren(state.metadata, "root") };
      }
      return null;
    },
    usesTouchControls: () => false,
    isEditing: () => false,
    selectBlock: vi.fn(),
    move: async (_label, mutate) => { state.metadata = mutate(state.metadata).metadata; },
    requestRender
  });
  return { controller, requestRender, state };
}

function startDrag(controller: DragDropController, blockId: string) {
  const payload = new Map<string, string>();
  const transfer = { types: ["application/x-arbor-card-move", "text/plain"], setData: (type: string, value: string) => payload.set(type, value),
    getData: (type: string) => payload.get(type) ?? "", setDragImage() {} };
  const card = { dataset: { blockId, columnKey: "depth-1", blockIndex: "0" }, addClass() {} };
  controller.handleCardDragStart({ currentTarget: card, target: card, dataTransfer: transfer } as unknown as DragEvent);
  return transfer;
}

describe("DragDropController", () => {
  it("does not infer a card movement from ID-looking external text", async () => {
    const { controller, state } = controllerForTree();
    const before = JSON.stringify(state.metadata);
    const preventDefault = vi.fn();
    controller.handleCardDragOver({
      currentTarget: { dataset: { columnKey: "depth-1", blockIndex: "1" }, getBoundingClientRect: () => ({ top: 0, height: 20 }) },
      dataTransfer: { types: ["text/plain"], getData: () => "first" },
      clientY: 0, preventDefault
    } as unknown as DragEvent);
    await controller.applyDrop({ key: "depth-1", label: "Root children", parentId: "root", blocks: [] });
    expect(JSON.stringify(state.metadata)).toBe(before);
    expect(controller.getDragState()).toBeNull();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("leaves link dragging native without starting a card move", () => {
    const { controller } = controllerForTree();
    const content = {};
    const anchor = {
      nodeType: 1,
      closest: (selector: string): unknown => selector === "a" ? anchor
        : selector.includes(".arbor-card-content") ? content : null
    };
    const addClass = vi.fn();
    const preventDefault = vi.fn();
    const card = {
      dataset: { blockId: "first", columnKey: "depth-1", blockIndex: "0" },
      contains: (node: unknown) => node === content,
      addClass
    };
    controller.handleCardDragStart({ currentTarget: card, target: anchor, preventDefault } as unknown as DragEvent);
    expect(controller.getDragState()).toBeNull();
    expect(addClass).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("moves a leaf to root children at index 1 through the real move mutation callback", async () => {
    const { controller, state } = controllerForTree();
    const transfer = startDrag(controller, "leaf");
    controller.handleCardDragOver({
      currentTarget: { dataset: { columnKey: "depth-1", blockIndex: "1" }, getBoundingClientRect: () => ({ top: 0, height: 20 }) },
      dataTransfer: transfer,
      clientY: 0,
      preventDefault: () => {}
    } as unknown as DragEvent);
    await controller.applyDrop({ key: "depth-1", label: "Root children", parentId: "root", blocks: [] });

    expect(getChildren(state.metadata, "root").map((block) => block.id)).toEqual(["first", "leaf", "second"]);
    expect(state.metadata.blocks.find((block) => block.id === "leaf")?.parentId).toBe("root");
  });

  it("runs the move callback for self and descendant drops while the real tree stays unchanged", async () => {
    const { state } = controllerForTree();
    const before = JSON.stringify(state.metadata);
    const moves: string[] = [];
    const controllerWithMoveOrder = new DragDropController({
      read: { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "fixture.md" },
      getDocument: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document),
      getRoot: () => ({ querySelectorAll: () => [], createEl: () => ({ remove() {} }) } as unknown as HTMLElement),
      getStage: () => null,
      getColumn: (key) => {
        if (key === "depth-1") return { key, label: "First", parentId: "first", blocks: [] };
        if (key === "depth-2") return { key, label: "Leaf", parentId: "leaf", blocks: [] };
        return null;
      },
      usesTouchControls: () => false,
      isEditing: () => false,
      selectBlock: () => {},
      move: async (label, mutate) => {
        moves.push(label);
        state.metadata = mutate(state.metadata).metadata;
      },
      requestRender: () => {}
    });
    let transfer = startDrag(controllerWithMoveOrder, "first");
    controllerWithMoveOrder.handleCardDragOver({
      currentTarget: { dataset: { columnKey: "depth-1", blockIndex: "0" }, getBoundingClientRect: () => ({ top: 0, height: 20 }) },
      dataTransfer: transfer,
      clientY: 0,
      preventDefault: () => {}
    } as unknown as DragEvent);
    await controllerWithMoveOrder.applyDrop({ key: "depth-1", label: "First", parentId: "first", blocks: [] });
    transfer = startDrag(controllerWithMoveOrder, "first");
    controllerWithMoveOrder.handleCardDragOver({
      currentTarget: { dataset: { columnKey: "depth-2", blockIndex: "0" }, getBoundingClientRect: () => ({ top: 0, height: 20 }) },
      dataTransfer: transfer,
      clientY: 0,
      preventDefault: () => {}
    } as unknown as DragEvent);
    await controllerWithMoveOrder.applyDrop({ key: "depth-2", label: "Leaf", parentId: "leaf", blocks: [] });

    expect(JSON.stringify(state.metadata)).toBe(before);
    expect(moves).toEqual(["Move block", "Move block"]);
  });

  it("refuses a drag from a textarea when it belongs to the actively edited card", () => {
    const { state } = controllerForTree();
    const controller = new DragDropController({
      read: { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "fixture.md" },
      getDocument: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document),
      getRoot: () => ({ querySelectorAll: () => [] } as unknown as HTMLElement),
      getStage: () => null,
      getColumn: () => ({ key: "root", label: "Root", parentId: null, blocks: getChildren(state.metadata, null) }),
      usesTouchControls: () => false,
      isEditing: (id) => id === "first",
      selectBlock: () => {},
      move: async () => {},
      requestRender: () => {}
    });
    const preventDefault = vi.fn();
    const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget;
    const card = { dataset: { blockId: "first", columnKey: "root", blockIndex: "0" } } as unknown as HTMLElement;
    controller.handleCardDragStart({ currentTarget: card, target: textarea, preventDefault } as unknown as DragEvent);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(controller.getDragState()).toBeNull();
  });

  it("cleans up the original document listener and stage state before the move callback", async () => {
    const state = fixtureLoaded();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const document = { addEventListener, removeEventListener } as unknown as Document;
    const removeStageClass = vi.fn();
    const stage = {
      addClass: vi.fn(),
      removeClass: removeStageClass,
      appendChild: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 })
    } as unknown as HTMLElement;
    const card = {
      dataset: { blockId: "first", columnKey: "depth-1", blockIndex: "0" },
      addClass: vi.fn(),
      cloneNode: () => ({
        removeAttribute: vi.fn(),
        classList: { remove: vi.fn(), add: vi.fn() },
        dataset: {},
        setAttribute: vi.fn(),
        querySelectorAll: () => [],
        setCssProps: vi.fn(),
        remove: vi.fn(),
        draggable: false
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 40 }),
      offsetWidth: 120
    } as unknown as HTMLElement;
    const root = {
      createEl: () => ({ remove: vi.fn(), width: 0, height: 0 }),
      querySelectorAll: () => [card]
    } as unknown as HTMLElement;
    Object.assign(card, { classList: { remove: vi.fn() } });
    let controller!: DragDropController;
    const move = vi.fn(async (
      _label: string,
      mutate: (tree: BranchTreeMetadata) => BranchTreeMutationResult
    ) => {
      expect(controller.getDragState()).toBeNull();
      expect(removeStageClass).toHaveBeenCalledWith("is-dragging");
      mutate(state.metadata);
    });
    controller = new DragDropController({
      read: { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "fixture.md" },
      getDocument: () => document,
      getRoot: () => root,
      getStage: () => stage,
      getColumn: (key) => key === "depth-1" ? { key, label: "Root children", parentId: "root", blocks: getChildren(state.metadata, "root") } : null,
      usesTouchControls: () => false,
      isEditing: () => false,
      selectBlock: () => {},
      move,
      requestRender: () => {}
    });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", getData: () => "first" };

    controller.handleCardDragStart({ currentTarget: card, target: card, dataTransfer, clientX: 0, clientY: 0, preventDefault: vi.fn() } as unknown as DragEvent);
    await controller.applyDrop({ key: "depth-1", label: "Root children", parentId: "root", blocks: [] });
    controller.reset();
    controller.reset();

    expect(addEventListener).toHaveBeenCalledExactlyOnceWith("dragover", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledTimes(4);
    expect(removeEventListener).toHaveBeenLastCalledWith("dragover", addEventListener.mock.calls[0][1]);
    expect(removeStageClass).toHaveBeenCalledTimes(4);
    expect(move).toHaveBeenCalledOnce();
  });
});
