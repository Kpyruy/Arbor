import { ArborCustomTheme, ArborSavedTheme } from "./types";

export const AUTOMATIC_THEME_ID = "automatic";

export const DEFAULT_CUSTOM_THEME: ArborCustomTheme = {
  canvas: "#15161c",
  card: "#22242d",
  text: "#f2f2f7",
  muted: "#afb2c1",
  accent: "#8f6bff"
};

export const BUILT_IN_THEMES: readonly ArborSavedTheme[] = [
  {
    id: "builtin:midnight",
    name: "Midnight",
    palette: { ...DEFAULT_CUSTOM_THEME }
  },
  {
    id: "builtin:paper",
    name: "Paper",
    palette: {
      canvas: "#f6f2e8",
      card: "#fffdf6",
      text: "#2a2520",
      muted: "#746a5f",
      accent: "#7c4dff"
    }
  },
  {
    id: "builtin:forest",
    name: "Forest",
    palette: {
      canvas: "#101b17",
      card: "#192a23",
      text: "#eef7f2",
      muted: "#9eb8aa",
      accent: "#56c596"
    }
  },
  {
    id: "builtin:rose",
    name: "Rose",
    palette: {
      canvas: "#21151c",
      card: "#322029",
      text: "#fff2f7",
      muted: "#c8a7b7",
      accent: "#f16aa2"
    }
  }
];

export const ARBOR_THEME_VARIABLES = [
  "--background-primary",
  "--background-secondary",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--interactive-accent",
  "--interactive-accent-hover",
  "--interactive-normal",
  "--interactive-hover",
  "--background-modifier-hover",
  "--icon-color",
  "--icon-color-hover",
  "--text-on-accent",
  "--background-modifier-border"
] as const;

export interface ArborThemeState {
  activeThemeId: string;
  customThemes: ArborSavedTheme[];
}

interface RawThemeSettings {
  activeThemeId?: unknown;
  customThemes?: unknown;
  themeMode?: unknown;
  customTheme?: unknown;
}

export function normalizeThemeSettings(raw: RawThemeSettings): {
  activeThemeId: string;
  customThemes: ArborSavedTheme[];
} {
  const customThemes = Array.isArray(raw.customThemes)
    ? raw.customThemes.map(normalizeSavedTheme).filter((theme): theme is ArborSavedTheme => theme !== null)
    : [];
  const legacyPalette = normalizePalette(raw.customTheme);
  const legacyWasCustomized = legacyPalette && !palettesEqual(legacyPalette, DEFAULT_CUSTOM_THEME);
  if (raw.themeMode === "custom" || legacyWasCustomized) {
    const migrated: ArborSavedTheme = {
      id: "custom:migrated",
      name: "My theme",
      palette: legacyPalette ?? { ...DEFAULT_CUSTOM_THEME }
    };
    return {
      activeThemeId: raw.themeMode === "custom" ? migrated.id : AUTOMATIC_THEME_ID,
      customThemes: [...customThemes, migrated]
    };
  }

  const requestedId = typeof raw.activeThemeId === "string" ? raw.activeThemeId : null;
  if (requestedId) {
    return {
      activeThemeId: isAvailableThemeId(requestedId, customThemes) ? requestedId : AUTOMATIC_THEME_ID,
      customThemes
    };
  }

  return { activeThemeId: AUTOMATIC_THEME_ID, customThemes };
}

export function findThemeById(themeId: string, customThemes: readonly ArborSavedTheme[]): ArborSavedTheme | null {
  return BUILT_IN_THEMES.find((theme) => theme.id === themeId)
    ?? customThemes.find((theme) => theme.id === themeId)
    ?? null;
}

export function cloneThemeState(state: ArborThemeState): ArborThemeState {
  return {
    activeThemeId: state.activeThemeId,
    customThemes: state.customThemes.map((theme) => ({
      ...theme,
      palette: { ...theme.palette }
    }))
  };
}

export function applyThemeSelection(state: ArborThemeState, themeId: string): ArborThemeState {
  const next = cloneThemeState(state);
  next.activeThemeId = isAvailableThemeId(themeId, next.customThemes)
    ? themeId
    : AUTOMATIC_THEME_ID;
  return next;
}

export function saveCustomTheme(state: ArborThemeState, theme: ArborSavedTheme): ArborThemeState {
  const next = cloneThemeState(state);
  const saved = { ...theme, palette: { ...theme.palette } };
  const index = next.customThemes.findIndex((candidate) => candidate.id === saved.id);
  if (index >= 0) {
    next.customThemes[index] = saved;
  } else {
    next.customThemes.push(saved);
  }
  return next;
}

export function deleteCustomTheme(state: ArborThemeState, themeId: string): ArborThemeState {
  const next = cloneThemeState(state);
  next.customThemes = next.customThemes.filter((theme) => theme.id !== themeId);
  if (next.activeThemeId === themeId) {
    next.activeThemeId = AUTOMATIC_THEME_ID;
  }
  return next;
}

export function hasUnsavedThemeDraft(
  original: ArborSavedTheme | null,
  draft: ArborSavedTheme | null
): boolean {
  if (!draft) {
    return false;
  }
  if (!original) {
    return true;
  }
  if (original.id !== draft.id || original.name !== draft.name) {
    return true;
  }
  return (Object.keys(original.palette) as Array<keyof ArborCustomTheme>)
    .some((key) => original.palette[key] !== draft.palette[key]);
}

export function resolveArborThemeVariables(
  themeId: string,
  customThemes: readonly ArborSavedTheme[]
): Record<string, string> {
  if (themeId === AUTOMATIC_THEME_ID) {
    return {};
  }

  const theme = findThemeById(themeId, customThemes);
  if (!theme) {
    return {};
  }

  return resolveArborPaletteVariables(theme.palette);
}

export function resolveArborPaletteVariables(palette: ArborCustomTheme): Record<string, string> {
  return {
    "--background-primary": palette.canvas,
    "--background-secondary": palette.card,
    "--text-normal": palette.text,
    "--text-muted": palette.muted,
    "--text-faint": `color-mix(in srgb, ${palette.muted} 72%, transparent)`,
    "--interactive-accent": palette.accent,
    "--interactive-accent-hover": `color-mix(in srgb, ${palette.accent} 88%, ${palette.text})`,
    "--interactive-normal": palette.card,
    "--interactive-hover": `color-mix(in srgb, ${palette.card} 84%, ${palette.text})`,
    "--background-modifier-hover": `color-mix(in srgb, ${palette.card} 88%, ${palette.text})`,
    "--icon-color": palette.muted,
    "--icon-color-hover": palette.text,
    "--text-on-accent": textColorForBackground(palette.accent),
    "--background-modifier-border": `color-mix(in srgb, ${palette.muted} 30%, ${palette.card})`
  };
}

function textColorForBackground(color: string): "#000000" | "#ffffff" {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return "#ffffff";
  }
  const value = Number.parseInt(match[1], 16);
  const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.36 ? "#000000" : "#ffffff";
}

function isAvailableThemeId(themeId: string, customThemes: readonly ArborSavedTheme[]): boolean {
  return themeId === AUTOMATIC_THEME_ID || findThemeById(themeId, customThemes) !== null;
}

function normalizeSavedTheme(raw: unknown): ArborSavedTheme | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id.startsWith("custom:") ? candidate.id : null;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const palette = normalizePalette(candidate.palette);
  if (!id || !name || !palette) {
    return null;
  }

  return { id, name, palette };
}

function normalizePalette(raw: unknown): ArborCustomTheme | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const palette = { ...DEFAULT_CUSTOM_THEME };
  (Object.keys(palette) as Array<keyof ArborCustomTheme>).forEach((key) => {
    if (typeof candidate[key] === "string" && candidate[key].trim().length > 0) {
      palette[key] = candidate[key].trim();
    }
  });
  return palette;
}

function palettesEqual(left: ArborCustomTheme, right: ArborCustomTheme): boolean {
  return (Object.keys(left) as Array<keyof ArborCustomTheme>).every((key) => left[key] === right[key]);
}
