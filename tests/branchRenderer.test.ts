import { build } from "esbuild";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildColumnModels } from "../src/model/tree";
import { fixtureLoaded, fixtureSettings } from "./helpers/arborFixtures";

type BranchRendererModule = typeof import("../src/view/branch/BranchRenderer");
type RouteBranchViewportWheel = BranchRendererModule["routeBranchViewportWheel"];

let routeBranchViewportWheel: RouteBranchViewportWheel;

beforeAll(async () => {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/view/branch/BranchRenderer.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "branch-renderer-test-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-host" }));
        builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
          contents: "export class Menu {} export const setIcon = () => undefined;",
          loader: "js"
        }));
      }
    }]
  });
  const source = bundled.outputFiles[0].text;
  const loaded: unknown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  routeBranchViewportWheel = (loaded as BranchRendererModule).routeBranchViewportWheel;
});

function wheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    clientX: 300,
    ctrlKey: false,
    metaKey: false,
    deltaX: 0,
    deltaY: 120,
    preventDefault: vi.fn(),
    ...overrides
  } as unknown as WheelEvent;
}

describe("routeBranchViewportWheel", () => {
  it("selects the child column target before routing later wheel events to siblings", () => {
    const state = fixtureLoaded();
    const columns = buildColumnModels(state.metadata, state.selectedBlockId, 220);
    const selectBlock = vi.fn((id: string | null) => { state.selectedBlockId = id; });
    const next = vi.fn();
    const previous = vi.fn();
    const actions = {
      selectBlock,
      next,
      previous,
      updateZoomLevel: vi.fn()
    };
    const viewport = { clientWidth: 300, scrollWidth: 300, scrollBy: vi.fn() } as unknown as HTMLElement;
    const renderer = { getColumnAtPointerX: () => columns[2] };
    const read = { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor" as const, getFilePath: () => "fixture.md" };

    routeBranchViewportWheel(wheelEvent(), viewport, renderer, read, actions, false);
    routeBranchViewportWheel(wheelEvent(), viewport, renderer, read, actions, false);
    routeBranchViewportWheel(wheelEvent({ deltaY: -120 }), viewport, renderer, read, actions, false);

    expect(selectBlock).toHaveBeenCalledExactlyOnceWith("leaf", { focus: true });
    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
  });

  it("zooms on ctrl-wheel without navigating the branch", () => {
    const state = fixtureLoaded();
    const updateZoomLevel = vi.fn();
    const actions = { selectBlock: vi.fn(), next: vi.fn(), previous: vi.fn(), updateZoomLevel };
    const viewport = { clientWidth: 300, scrollWidth: 300, scrollBy: vi.fn() } as unknown as HTMLElement;
    const renderer = { getColumnAtPointerX: () => null };
    const read = { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor" as const, getFilePath: () => "fixture.md" };

    routeBranchViewportWheel(wheelEvent({ ctrlKey: true, deltaY: -120 }), viewport, renderer, read, actions, false);

    expect(updateZoomLevel).toHaveBeenCalledExactlyOnceWith(1.06);
    expect(actions.next).not.toHaveBeenCalled();
    expect(actions.previous).not.toHaveBeenCalled();
  });

  it("does nothing in the compact layout", () => {
    const state = fixtureLoaded();
    const actions = { selectBlock: vi.fn(), next: vi.fn(), previous: vi.fn(), updateZoomLevel: vi.fn() };
    const viewport = { clientWidth: 300, scrollWidth: 300, scrollBy: vi.fn() } as unknown as HTMLElement;
    const renderer = { getColumnAtPointerX: () => null };
    const read = { getState: () => state, getSettings: fixtureSettings, getMode: () => "editor" as const, getFilePath: () => "fixture.md" };

    routeBranchViewportWheel(wheelEvent({ ctrlKey: true, deltaY: -120 }), viewport, renderer, read, actions, true);

    expect(actions.updateZoomLevel).not.toHaveBeenCalled();
    expect(actions.next).not.toHaveBeenCalled();
    expect(actions.previous).not.toHaveBeenCalled();
  });
});
