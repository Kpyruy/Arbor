import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_THEME, resolveArborThemeVariables } from "../src/theme";

describe("Arbor themes", () => {
  it("leaves Obsidian theme variables untouched in Automatic mode", () => {
    expect(resolveArborThemeVariables("automatic", DEFAULT_CUSTOM_THEME)).toEqual({});
  });

  it("maps a custom palette onto Arbor's local Obsidian variables", () => {
    expect(resolveArborThemeVariables("custom", {
      canvas: "#10131a",
      card: "#1c2330",
      text: "#f6f7fb",
      muted: "#aab4c4",
      accent: "#7c5cff"
    })).toEqual({
      "--background-modifier-border": "color-mix(in srgb, #aab4c4 30%, #1c2330)",
      "--background-primary": "#10131a",
      "--background-secondary": "#1c2330",
      "--interactive-accent": "#7c5cff",
      "--text-faint": "color-mix(in srgb, #aab4c4 72%, transparent)",
      "--text-muted": "#aab4c4",
      "--text-normal": "#f6f7fb"
    });
  });
});
