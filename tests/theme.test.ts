import { describe, expect, it } from "vitest";
import {
  BUILT_IN_THEMES,
  DEFAULT_CUSTOM_THEME,
  normalizeThemeSettings,
  resolveArborThemeVariables
} from "../src/theme";

describe("Arbor theme presets", () => {
  it("ships readable built-in themes alongside Automatic", () => {
    expect(BUILT_IN_THEMES.map((theme) => [theme.id, theme.name])).toEqual([
      ["builtin:midnight", "Midnight"],
      ["builtin:paper", "Paper"],
      ["builtin:forest", "Forest"],
      ["builtin:rose", "Rose"]
    ]);
  });

  it("leaves Obsidian theme variables untouched for Automatic", () => {
    expect(resolveArborThemeVariables("automatic", [])).toEqual({});
  });

  it("resolves both built-in and user-created presets", () => {
    expect(resolveArborThemeVariables("builtin:paper", [])["--background-primary"]).toBe("#f6f2e8");
    expect(resolveArborThemeVariables("custom:violet", [{
      id: "custom:violet",
      name: "Violet",
      palette: {
        canvas: "#10131a",
        card: "#1c2330",
        text: "#f6f7fb",
        muted: "#aab4c4",
        accent: "#7c5cff"
      }
    }])).toEqual({
      "--background-modifier-border": "color-mix(in srgb, #aab4c4 30%, #1c2330)",
      "--background-primary": "#10131a",
      "--background-secondary": "#1c2330",
      "--interactive-accent": "#7c5cff",
      "--text-faint": "color-mix(in srgb, #aab4c4 72%, transparent)",
      "--text-muted": "#aab4c4",
      "--text-normal": "#f6f7fb"
    });
  });

  it("migrates an active legacy Custom palette into My theme", () => {
    expect(normalizeThemeSettings({
      themeMode: "custom",
      customTheme: { ...DEFAULT_CUSTOM_THEME, accent: "#ff00aa" }
    })).toEqual({
      activeThemeId: "custom:migrated",
      customThemes: [{
        id: "custom:migrated",
        name: "My theme",
        palette: { ...DEFAULT_CUSTOM_THEME, accent: "#ff00aa" }
      }]
    });
  });

  it("migrates legacy Custom even after new defaults were merged in", () => {
    expect(normalizeThemeSettings({
      activeThemeId: "automatic",
      customThemes: [],
      themeMode: "custom",
      customTheme: { ...DEFAULT_CUSTOM_THEME, accent: "#ff5cad" }
    })).toEqual({
      activeThemeId: "custom:migrated",
      customThemes: [{
        id: "custom:migrated",
        name: "My theme",
        palette: { ...DEFAULT_CUSTOM_THEME, accent: "#ff5cad" }
      }]
    });
  });

  it("falls back to Automatic when a selected custom preset no longer exists", () => {
    expect(normalizeThemeSettings({ activeThemeId: "custom:missing", customThemes: [] })).toEqual({
      activeThemeId: "automatic",
      customThemes: []
    });
  });
});
