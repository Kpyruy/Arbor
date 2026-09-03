import { describe, expect, it } from "vitest";
import {
  BUILT_IN_THEMES,
  applyThemeSelection,
  cloneThemeState,
  DEFAULT_CUSTOM_THEME,
  deleteCustomTheme,
  hasUnsavedThemeDraft,
  normalizeThemeSettings,
  resolveArborThemeVariables,
  saveCustomTheme
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
    const paper = resolveArborThemeVariables("builtin:paper", []);
    expect(paper["--background-primary"]).toBe("#f6f2e8");
    expect(paper["--interactive-normal"]).toBe("#fffdf6");
    expect(paper["--icon-color"]).toBe("#746a5f");
    expect(paper["--icon-color-hover"]).toBe("#2a2520");
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
      "--background-modifier-hover": "color-mix(in srgb, #1c2330 88%, #f6f7fb)",
      "--background-primary": "#10131a",
      "--background-secondary": "#1c2330",
      "--icon-color": "#aab4c4",
      "--icon-color-hover": "#f6f7fb",
      "--interactive-accent": "#7c5cff",
      "--interactive-accent-hover": "color-mix(in srgb, #7c5cff 88%, #f6f7fb)",
      "--interactive-hover": "color-mix(in srgb, #1c2330 84%, #f6f7fb)",
      "--interactive-normal": "#1c2330",
      "--text-faint": "color-mix(in srgb, #aab4c4 72%, transparent)",
      "--text-muted": "#aab4c4",
      "--text-normal": "#f6f7fb",
      "--text-on-accent": "#ffffff"
    });
  });

  it("clones custom themes deeply for cancellable live previews", () => {
    const source = {
      activeThemeId: "custom:violet",
      customThemes: [{
        id: "custom:violet",
        name: "Violet",
        palette: { ...DEFAULT_CUSTOM_THEME }
      }]
    };
    const draft = cloneThemeState(source);
    draft.customThemes[0].palette.accent = "#ff00aa";

    expect(source.customThemes[0].palette.accent).toBe(DEFAULT_CUSTOM_THEME.accent);
    expect(draft.customThemes[0].palette.accent).toBe("#ff00aa");
  });

  it("saves an edited preset without applying it", () => {
    const state = {
      activeThemeId: "builtin:paper",
      customThemes: [{
        id: "custom:violet",
        name: "Violet",
        palette: { ...DEFAULT_CUSTOM_THEME }
      }]
    };
    const edited = {
      ...state.customThemes[0],
      palette: { ...state.customThemes[0].palette, accent: "#ff00aa" }
    };
    const saved = saveCustomTheme(state, edited);

    expect(saved.activeThemeId).toBe("builtin:paper");
    expect(saved.customThemes[0].palette.accent).toBe("#ff00aa");
    expect(state.customThemes[0].palette.accent).toBe(DEFAULT_CUSTOM_THEME.accent);
  });

  it("applies and deletes themes independently", () => {
    const state = {
      activeThemeId: "automatic",
      customThemes: [{
        id: "custom:violet",
        name: "Violet",
        palette: { ...DEFAULT_CUSTOM_THEME }
      }]
    };
    expect(applyThemeSelection(state, "custom:violet").activeThemeId).toBe("custom:violet");
    expect(deleteCustomTheme(applyThemeSelection(state, "custom:violet"), "custom:violet")).toEqual({
      activeThemeId: "automatic",
      customThemes: []
    });
  });

  it("prompts only when a theme editor contains unsaved changes", () => {
    const saved = {
      id: "custom:violet",
      name: "Violet",
      palette: { ...DEFAULT_CUSTOM_THEME }
    };
    expect(hasUnsavedThemeDraft(saved, { ...saved, palette: { ...saved.palette } })).toBe(false);
    expect(hasUnsavedThemeDraft(saved, { ...saved, palette: { ...saved.palette, accent: "#ff00aa" } })).toBe(true);
    expect(hasUnsavedThemeDraft(null, saved)).toBe(true);
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
