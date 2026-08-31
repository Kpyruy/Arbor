import { ArborCustomTheme, ArborThemeMode } from "./types";

export const DEFAULT_CUSTOM_THEME: ArborCustomTheme = {
  canvas: "#15161c",
  card: "#22242d",
  text: "#f2f2f7",
  muted: "#afb2c1",
  accent: "#8f6bff"
};

export const ARBOR_THEME_VARIABLES = [
  "--background-primary",
  "--background-secondary",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--interactive-accent",
  "--background-modifier-border"
] as const;

export function resolveArborThemeVariables(
  mode: ArborThemeMode,
  theme: ArborCustomTheme
): Record<string, string> {
  if (mode === "automatic") {
    return {};
  }

  return {
    "--background-primary": theme.canvas,
    "--background-secondary": theme.card,
    "--text-normal": theme.text,
    "--text-muted": theme.muted,
    "--text-faint": `color-mix(in srgb, ${theme.muted} 72%, transparent)`,
    "--interactive-accent": theme.accent,
    "--background-modifier-border": `color-mix(in srgb, ${theme.muted} 30%, ${theme.card})`
  };
}
