import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { App } from "obsidian";
import type ArborPlugin from "../src/main";
import type { ArborSettingTab } from "../src/settings";
import type { ArborSettings } from "../src/types";

// Obsidian ships types only. Exercise the real settings class with just its host API stubbed.
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/settings.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["obsidian"]
});

describe("mobile settings availability", () => {
  function createTab(isMobile = false): { tab: ArborSettingTab; platform: { isMobile: boolean } } {
    const platform = { isMobile };
    const host = { Platform: platform, PluginSettingTab: class {}, Setting: class {} };
    const module = { exports: {} };
    runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: () => host });
    const exports = module.exports as { ArborSettingTab: new (app: App, plugin: ArborPlugin) => ArborSettingTab; DEFAULT_SETTINGS: ArborSettings };
    return {
      tab: new exports.ArborSettingTab({} as App, {
        settings: { ...exports.DEFAULT_SETTINGS, customThemes: [] }
      } as unknown as ArborPlugin),
      platform
    };
  }

  it("keeps desktop controls available on desktop", () => {
    const keys = createTab().tab.getSettingDefinitions().map((definition) => definition.control.key);
    expect(keys).toEqual(expect.arrayContaining(["splitDirection", "dragAndDrop", "liveLinearPreview"]));
  });

  it("omits split, drag and side-panel controls on mobile while retaining usable settings", () => {
    const definitions = createTab(true).tab.getSettingDefinitions();
    const keys = definitions.map((definition) => definition.control.key);
    expect(keys).not.toContain("splitDirection");
    expect(keys).not.toContain("dragAndDrop");
    expect(keys).not.toContain("liveLinearPreview");
    expect(keys).toEqual(expect.arrayContaining(["activeThemeId", "layoutDirection", "defaultPresentationMode", "cardWidth", "zoomLevel"]));
    const zoom = definitions.find((definition) => definition.control.key === "zoomLevel");
    expect(zoom?.control.type).toBe("slider");
    expect(zoom?.control.type === "slider" && zoom.control.min).toBe(25);
  });

  it("does not overwrite preferences when the same configuration is used on a phone", () => {
    const { tab, platform } = createTab(true);
    tab.getSettingDefinitions();
    expect(tab.getControlValue("dragAndDrop")).toBe(true);
    expect(tab.getControlValue("splitDirection")).toBe("vertical");
    platform.isMobile = false;
    expect(tab.getSettingDefinitions().map((definition) => definition.control.key)).toContain("dragAndDrop");
  });
});
