import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { ViewWorkScope } from "../src/view/runtime/ViewWorkScope";
import { OverviewViewportController } from "../src/view/overview/OverviewViewportController";
import { deferred, fixtureSettings } from "./helpers/arborFixtures";

type Modules = typeof import("../src/view/ArborView") & typeof import("../src/settings") & typeof import("../src/view/ArborLoadingView") & {
  ArborPlugin: typeof import("../src/main").default;
};
let modules: Modules;
const nodeRequire = createRequire(import.meta.url);
let duringSetState: ((view: object) => void | Promise<void>) | null = null;

beforeAll(() => {
  const compiled = buildSync({
    stdin: { contents: 'export { ArborView } from "./src/view/ArborView"; export { ArborLoadingView } from "./src/view/ArborLoadingView"; export { default as ArborPlugin } from "./src/main"; export * from "./src/settings";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian", "html-to-image"]
  });
  class FileView {
    baseState: Record<string, unknown> = {};
    getState() { return { ...this.baseState }; }
    async setState(state: Record<string, unknown>) {
      this.baseState = { file: state.file };
      await duringSetState?.(this);
      await Promise.resolve();
    }
  }
  const host = new Proxy({ FileView, Platform: {}, PluginSettingTab: class {} }, {
    get: (target, key): unknown => (Reflect.get(target, key) as unknown) ?? class {}
  });
  const module = { exports: {} };
  runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports,
    require: (name: string): unknown => name === "obsidian" ? host : name === "html-to-image" ? {} : nodeRequire(name) as unknown,
    document: { documentElement: { dir: "ltr" } }, window: {}
  });
  modules = module.exports as Modules;
});

function viewFixture(settings = fixtureSettings()) {
  const view = Object.create(modules.ArborView.prototype) as InstanceType<Modules["ArborView"]>;
  let publication = "horizontal";
  let savedState: unknown;
  Object.assign(view, {
    baseState: { file: "A.md", unknownHostField: 42 }, file: { path: "A.md" },
    plugin: { settings }, work: new ViewWorkScope(), loadGeneration: 0,
    overviewOrientationOverride: null, overviewOrientationChangeGeneration: 0,
    app: { workspace: { requestSaveLayout: () => { savedState = view.getState(); } } },
    overview: { invalidate() {}, requestCenterOnNextRender() {} },
    overviewViewport: { discardPendingRestore() {} },
    render: () => { publication = view.getOverviewOrientation(); }
  });
  return { view, settings, get publication() { return publication; }, get savedState() { return savedState; } };
}

describe("overview workspace state", () => {
  it("discards pending pixels from the old orientation before viewport restore", () => {
    const viewport = {
      scrollLeft: 80, scrollTop: 60, scrollWidth: 1200, scrollHeight: 900,
      clientWidth: 320, clientHeight: 240,
      scrollTo(position: { left: number; top: number }) { this.scrollLeft = position.left; this.scrollTop = position.top; }
    };
    const controller = new OverviewViewportController({
      getElements: () => ({ viewport: viewport as unknown as HTMLElement, scene: null, surface: null }),
      getZoom: () => 0.75
    });
    controller.preserve();
    viewport.scrollLeft = 17;
    viewport.scrollTop = 23;
    controller.discardPendingRestore();
    controller.restore();
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([17, 23]);
  });

  it.each([undefined, null, "diagonal", "vertical-bottom-up", "vertical-top-down"])("normalizes stored setting %s", async raw => {
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<Modules["ArborPlugin"]>;
    Object.assign(plugin, { loadData: async () => ({ settings: { overviewOrientation: raw } }), managedNotePaths: new Set() });
    await plugin.loadSettings();
    expect(plugin.settings.overviewOrientation).toBe(raw === "vertical-bottom-up" || raw === "vertical-top-down" ? raw : "horizontal");
  });

  it("uses horizontal for a fresh install", async () => {
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<Modules["ArborPlugin"]>;
    Object.assign(plugin, { loadData: async () => null, managedNotePaths: new Set() });
    await plugin.loadSettings();
    expect(plugin.settings.overviewOrientation).toBe("horizontal");
  });

  it.each(["vertical-top-down", "vertical-bottom-up"] as const)("round trips %s before FileView starts loading", async orientation => {
    const { view } = viewFixture();
    const observed: unknown[] = [];
    duringSetState = current => { observed.push((current as typeof view).getOverviewOrientation()); };
    try {
      await view.setState({ file: "A.md", unknownHostField: 42, arborOverviewOrientation: orientation }, { history: false });
      expect(observed).toEqual([orientation]);
      expect(view.getState()).toEqual({ file: "A.md", unknownHostField: 42, arborOverviewOrientation: orientation });
      await view.setState({ file: "B.md", arborOverviewOrientation: "broken" }, { history: false });
      expect(view.getOverviewOrientation()).toBe("horizontal");
      expect(view.getState()).toEqual({ file: "B.md" });
    } finally { duringSetState = null; }
  });

  it("isolates two overrides and refreshes only a default-following view", async () => {
    const settings = fixtureSettings();
    const first = viewFixture(settings), second = viewFixture(settings), follower = viewFixture(settings);
    await first.view.setOverviewOrientationOverride("vertical-top-down");
    await second.view.setOverviewOrientationOverride("vertical-bottom-up");
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<Modules["ArborPlugin"]>;
    let persisted: unknown;
    Object.assign(plugin, { settings, getBranchViews: () => [first.view, second.view, follower.view], saveSettings: async () => { persisted = { ...settings }; } });
    const tab = new modules.ArborSettingTab({} as never, plugin);
    await tab.setControlValue("overviewOrientation", "vertical-bottom-up");
    expect(persisted).toMatchObject({ overviewOrientation: "vertical-bottom-up" });
    expect([first.publication, second.publication, follower.publication]).toEqual(["vertical-top-down", "vertical-bottom-up", "vertical-bottom-up"]);
    await first.view.setOverviewOrientationOverride(null);
    expect(first.savedState).toEqual({ file: "A.md", unknownHostField: 42 });
    expect(first.publication).toBe("vertical-bottom-up");
    await tab.setControlValue("overviewOrientation", "broken");
    expect(settings.overviewOrientation).toBe("horizontal");
    expect(second.publication).toBe("vertical-bottom-up");
  });

  it("does not apply an older state completion after a newer source choice", async () => {
    const { view } = viewFixture();
    const pending = deferred<void>();
    let first = true;
    duringSetState = () => { if (first) { first = false; return pending.promise; } };
    try {
      const older = view.setState({ file: "A.md", arborOverviewOrientation: "vertical-top-down" }, { history: false });
      Object.assign(view, { file: { path: "B.md" }, loadGeneration: 1 });
      await view.setState({ file: "B.md", arborOverviewOrientation: "vertical-bottom-up", custom: 17 }, { history: false });
      pending.resolve();
      await older;
      expect(view.getState()).toEqual({ file: "B.md", arborOverviewOrientation: "vertical-bottom-up", custom: 17 });
      expect(view.getOverviewOrientation()).toBe("vertical-bottom-up");
      await view.setState({ file: "B.md" }, { history: false });
      expect(view.getState()).toEqual({ file: "B.md" });
      expect(view.getOverviewOrientationOverride()).toBeNull();
    } finally { pending.resolve(); duringSetState = null; }
  });

  it("captures loading override before promotion and preserves unknown host fields", async () => {
    const loading = Object.create(modules.ArborLoadingView.prototype) as InstanceType<Modules["ArborLoadingView"]>;
    Object.assign(loading, { baseState: {} });
    const observed: unknown[] = [];
    duringSetState = current => { observed.push((current as typeof loading).getState()); };
    try {
      await loading.setState({ file: "A.md", unknownHostField: 42, arborOverviewOrientation: "vertical-bottom-up" }, { history: false });
      expect(observed).toEqual([{ file: "A.md", unknownHostField: 42, arborOverviewOrientation: "vertical-bottom-up" }]);
      await loading.setState({ file: "B.md", arborOverviewOrientation: "broken" }, { history: false });
      expect(loading.getState()).toEqual({ file: "B.md" });
    } finally { duringSetState = null; }
  });

  it.each(["A.md", "B.md"])("explicit open %s carries only matching-file state", async path => {
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<Modules["ArborPlugin"]>;
    let opened: unknown;
    const leaf = { view: {}, getViewState: () => ({ state: { file: "A.md", unknownHostField: 42, arborOverviewOrientation: "vertical-top-down" } }), setViewState: async (state: unknown) => { opened = state; } };
    Object.assign(plugin, { settings: fixtureSettings(), findManagedLeafForFile: () => null, expectExplicitArborOpen() {}, app: { workspace: { revealLeaf: async () => {} } } });
    await plugin.openBranchViewForFile({ path } as never, { preferredLeaf: leaf as never });
    expect(opened).toMatchObject({ state: path === "A.md" ? { file: path, unknownHostField: 42, arborOverviewOrientation: "vertical-top-down" } : { file: path } });
    if (path === "B.md") expect((opened as { state: object }).state).toEqual({ file: path });
  });

  it("promotes full loading state for the matching source", async () => {
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<Modules["ArborPlugin"]>;
    let opened: unknown;
    const leaf = { view: { getViewType: () => "arbor-loading-view", getState: () => ({ file: "A.md", unknownHostField: 42, arborOverviewOrientation: "vertical-bottom-up" }) }, getViewState: () => ({ state: { file: "A.md" } }), setViewState: async (state: unknown) => { opened = state; } };
    Object.assign(plugin, { inspectManagedBranchNote: async () => ({ filePath: "A.md", autoManaged: true, canOpenInArbor: true, hasStoredMetadata: true }), consumeExplicitArborOpen: () => true, app: { workspace: { revealLeaf: async () => {} } } });
    await plugin.resolveLoadingLeafOpen({ path: "A.md" } as never, leaf as never);
    expect(opened).toMatchObject({ state: { file: "A.md", unknownHostField: 42, arborOverviewOrientation: "vertical-bottom-up" } });
  });
});
