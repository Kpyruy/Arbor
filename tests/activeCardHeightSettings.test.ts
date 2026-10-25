import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const compiled = buildSync({
  stdin: { contents: 'export { default as ArborPlugin } from "./src/main"; export * from "./src/settings";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian", "html-to-image"]
});
const nodeRequire = createRequire(import.meta.url);

function modules(isMobile = false) {
  const host = new Proxy({ Platform: { isMobile }, PluginSettingTab: class {} }, {
    get: (target, key): unknown => Reflect.get(target, key) ?? class {}
  });
  const module = { exports: {} };
  runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports,
    require: (name: string): unknown => name === "obsidian" ? host : name === "html-to-image" ? {} : nodeRequire(name) as unknown,
    document: { documentElement: { dir: "ltr" } }, window: {}
  });
  return module.exports as typeof import("../src/settings") & { ArborPlugin: typeof import("../src/main").default };
}

describe("active card height settings", () => {
  it.each([undefined, "invalid", null, {}])("preserves bounded behavior for missing or invalid saved mode %j", async saved => {
    const m = modules(), plugin = Object.create(m.ArborPlugin.prototype) as InstanceType<typeof m.ArborPlugin>;
    Object.assign(plugin, { loadData: async () => ({ settings: { activeCardHeightMode: saved } }), managedNotePaths: new Set() });
    await plugin.loadSettings();
    expect(plugin.settings.activeCardHeightMode).toBe("bounded");
  });
  it("retains a persisted fit-content preference", async () => {
    const m = modules(), plugin = Object.create(m.ArborPlugin.prototype) as InstanceType<typeof m.ArborPlugin>;
    Object.assign(plugin, { loadData: async () => ({ settings: { activeCardHeightMode: "content" } }), managedNotePaths: new Set() });
    await plugin.loadSettings();
    expect(plugin.settings.activeCardHeightMode).toBe("content");
  });
  it.each([false, true])("exposes both height modes and applies a persisted selection immediately (mobile=%s)", async mobile => {
    const m = modules(mobile), saved: unknown[] = [];
    let refreshes = 0;
    const plugin = { settings: { ...m.DEFAULT_SETTINGS }, saveSettings: async () => { saved.push({ ...plugin.settings }); }, refreshAllBranchViews: () => { refreshes++; } };
    const tab = new m.ArborSettingTab({} as never, plugin as never);
    const control = tab.getSettingDefinitions().find(d => d.control.key === "activeCardHeightMode")?.control;
    expect(control?.type).toBe("dropdown");
    expect(control?.type === "dropdown" && Object.keys(control.options)).toEqual(["bounded", "content"]);
    await tab.setControlValue("activeCardHeightMode", "content");
    expect(saved.at(-1)).toMatchObject({ activeCardHeightMode: "content" });
    expect(refreshes).toBe(1);
    await tab.setControlValue("activeCardHeightMode", "bad value");
    expect(saved.at(-1)).toMatchObject({ activeCardHeightMode: "bounded" });
  });
});
