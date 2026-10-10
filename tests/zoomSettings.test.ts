import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const compiled = buildSync({
  stdin: { contents: 'export { default as ArborPlugin } from "./src/main"; export * from "./src/settings";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian", "html-to-image"]
});
const nodeRequire = createRequire(import.meta.url);
const host = new Proxy({ Platform: {}, PluginSettingTab: class {} }, {
  get: (target, key): unknown => Reflect.get(target, key) ?? class {}
});
const module = { exports: {} };
runInNewContext(compiled.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name: string): unknown => name === "obsidian" ? host : name === "html-to-image" ? {} : nodeRequire(name) as unknown,
  document: { documentElement: { dir: "ltr" } }, window: {}
});
const modules = module.exports as typeof import("../src/settings") & { ArborPlugin: typeof import("../src/main").default };

describe("configurable zoom settings", () => {
  it.each([
    [{ minZoomLevel: 3, maxZoomLevel: 1, zoomLevel: 8 }, [1, 3, 3]],
    [{ minZoomLevel: NaN, maxZoomLevel: Infinity, zoomLevel: NaN }, [0.25, 5, 1]],
    [{ minZoomLevel: "invalid", maxZoomLevel: -4, zoomLevel: 0 }, [0.25, 0.25, 0.25]]
  ])("normalizes persisted invalid bounds and current zoom", async (settings, expected) => {
    const plugin = Object.create(modules.ArborPlugin.prototype) as InstanceType<typeof modules.ArborPlugin>;
    Object.assign(plugin, { loadData: async () => ({ settings }), managedNotePaths: new Set() });
    await plugin.loadSettings();
    expect([plugin.settings.minZoomLevel, plugin.settings.maxZoomLevel, plugin.settings.zoomLevel]).toEqual(expected);
  });

  it("validates setting edits against the other bound and clamps current zoom", async () => {
    const plugin = {
      settings: { ...modules.DEFAULT_SETTINGS, customThemes: [] }, saveSettings: async () => {}, refreshAllBranchViews() {}
    };
    const tab = new modules.ArborSettingTab({} as never, plugin as never);
    await tab.setControlValue("maxZoomLevel", 200);
    await tab.setControlValue("minZoomLevel", 300);
    expect([plugin.settings.minZoomLevel, plugin.settings.maxZoomLevel, plugin.settings.zoomLevel]).toEqual([2, 2, 2]);
    await tab.setControlValue("maxZoomLevel", 25);
    expect(plugin.settings.maxZoomLevel).toBe(2);
    await tab.setControlValue("zoomLevel", 500);
    expect(plugin.settings.zoomLevel).toBe(2);
    expect(tab.getControlValue("minZoomLevel")).toBe(200);
    const zoom = tab.getSettingDefinitions().find(definition => definition.control.key === "zoomLevel")?.control;
    expect(zoom?.type === "slider" && [zoom.min, zoom.max]).toEqual([200, 200]);
  });
});
