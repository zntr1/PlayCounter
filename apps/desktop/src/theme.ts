import type { Theme } from "@playcounter/shared";

export type RgbColor = { r: number; g: number; b: number };

export type AccentPalette = {
  accent: RgbColor;
  hover: RgbColor;
  tint: string;
  foreground: string;
};

export const DEFAULT_ACCENT_COLOR = "#0062ff";

const DARK_SURFACES: RgbColor[] = [
  { r: 15, g: 16, b: 20 },
  { r: 22, g: 24, b: 31 },
  { r: 30, g: 33, b: 42 },
];
const LIGHT_SURFACES: RgbColor[] = [
  { r: 244, g: 245, b: 248 },
  { r: 255, g: 255, b: 255 },
  { r: 238, g: 240, b: 244 },
];
const DARK_FOREGROUND: RgbColor = { r: 15, g: 16, b: 20 };
const LIGHT_FOREGROUND: RgbColor = { r: 255, g: 255, b: 255 };
const MINIMUM_TEXT_CONTRAST = 4.5;
const ACCENT_PROPERTIES = [
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-tint",
  "--color-accent-fg",
] as const;

export function normalizeAccentColor(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

export function deriveAccentPalette(
  color: string,
  theme: Theme,
): AccentPalette {
  const selected = parseHexColor(color) ?? parseHexColor(DEFAULT_ACCENT_COLOR)!;
  const surfaces = theme === "dark" ? DARK_SURFACES : LIGHT_SURFACES;
  const contrastTarget = theme === "dark" ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  const accent = ensureContrast(selected, surfaces, contrastTarget);
  const hover = mixColors(
    accent,
    theme === "dark" ? LIGHT_FOREGROUND : DARK_FOREGROUND,
    theme === "dark" ? 0.18 : 0.15,
  );
  const foreground =
    contrastRatio(accent, DARK_FOREGROUND) >=
    contrastRatio(accent, LIGHT_FOREGROUND)
      ? DARK_FOREGROUND
      : LIGHT_FOREGROUND;

  return {
    accent,
    hover,
    tint: `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${theme === "dark" ? 0.13 : 0.1})`,
    foreground: toRgbTriple(foreground),
  };
}

export function applyTheme(theme: Theme, accentColor: string | null = null) {
  const root = document.documentElement;
  root.dataset.theme = theme;

  const normalizedColor = normalizeAccentColor(accentColor);
  if (!normalizedColor) {
    for (const property of ACCENT_PROPERTIES) {
      root.style.removeProperty(property);
    }
    return;
  }

  const palette = deriveAccentPalette(normalizedColor, theme);
  root.style.setProperty("--color-accent", toRgbTriple(palette.accent));
  root.style.setProperty("--color-accent-hover", toRgbTriple(palette.hover));
  root.style.setProperty("--color-accent-tint", palette.tint);
  root.style.setProperty("--color-accent-fg", palette.foreground);
}

function ensureContrast(
  color: RgbColor,
  surfaces: RgbColor[],
  target: RgbColor,
) {
  if (hasMinimumContrast(color, surfaces)) return color;

  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixColors(color, target, step / 100);
    if (hasMinimumContrast(candidate, surfaces)) {
      return candidate;
    }
  }

  return target;
}

function hasMinimumContrast(color: RgbColor, surfaces: RgbColor[]) {
  return surfaces.every((surface) => {
    const strongestTint = mixColors(surface, color, 0.2);
    return (
      contrastRatio(color, surface) >= MINIMUM_TEXT_CONTRAST &&
      contrastRatio(color, strongestTint) >= MINIMUM_TEXT_CONTRAST
    );
  });
}

function parseHexColor(color: string): RgbColor | null {
  const normalized = normalizeAccentColor(color);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function mixColors(
  first: RgbColor,
  second: RgbColor,
  amount: number,
): RgbColor {
  return {
    r: Math.round(first.r + (second.r - first.r) * amount),
    g: Math.round(first.g + (second.g - first.g) * amount),
    b: Math.round(first.b + (second.b - first.b) * amount),
  };
}

function contrastRatio(first: RgbColor, second: RgbColor) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ r, g, b }: RgbColor) {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function toRgbTriple({ r, g, b }: RgbColor) {
  return `${r} ${g} ${b}`;
}
