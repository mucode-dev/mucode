import { RGBA, SyntaxStyle } from "@opentui/core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PANEL_GAP = 1;
export const PANEL_PADDING = 1;
export const DEFAULT_THEME_ID = "opencode";

interface ThemePalette {
  neutral: string;
  ink: string;
  primary: string;
  accent?: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  diffAdd?: string;
  diffDelete?: string;
}

interface ThemeVariant {
  palette: ThemePalette;
  overrides?: Record<string, string>;
}

interface DesktopTheme {
  id: string;
  name: string;
  light?: ThemeVariant;
  dark?: ThemeVariant;
}

export interface ThemeSummary {
  id: string;
  name: string;
}

export interface AppTheme {
  id: string;
  name: string;
  appBackground: string;
  panelBackground: string;
  inputBackground: string;
  elevatedBackground: string;
  border: string;
  text: string;
  textStrong: string;
  textMuted: string;
  textDim: string;
  accent: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  selectionBackground: string;
  selectionForeground: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedBackground: string;
  diffAddedContentBackground: string;
  diffRemovedBackground: string;
  diffRemovedContentBackground: string;
  syntaxStyle: SyntaxStyle;
}

const THEME_DIRECTORY = join(import.meta.dir, "..", "themes");

const themeCatalog = loadThemeCatalog();
const fallbackTheme = themeCatalog.find((theme) => theme.id === DEFAULT_THEME_ID) ?? themeCatalog[0];

export const AVAILABLE_THEMES: ThemeSummary[] = themeCatalog.map((theme) => ({
  id: theme.id,
  name: theme.name,
}));

export function resolveThemeId(themeId: string | undefined): string {
  if (themeId && themeCatalog.some((theme) => theme.id === themeId)) return themeId;
  return fallbackTheme?.id ?? DEFAULT_THEME_ID;
}

export function resolveAppTheme(themeId: string | undefined): AppTheme {
  const resolvedId = resolveThemeId(themeId);
  const theme = themeCatalog.find((entry) => entry.id === resolvedId) ?? fallbackTheme;
  if (!theme) {
    return buildAppTheme({
      id: DEFAULT_THEME_ID,
      name: "OpenCode",
      dark: {
        palette: {
          neutral: "#0a0a0a",
          ink: "#eeeeee",
          primary: "#fab283",
          accent: "#9d7cd8",
          success: "#7fd88f",
          warning: "#f5a742",
          error: "#e06c75",
          info: "#56b6c2",
          diffAdd: "#b8db87",
          diffDelete: "#e26a75",
        },
      },
    });
  }
  return buildAppTheme(theme);
}

function loadThemeCatalog(): DesktopTheme[] {
  return readdirSync(THEME_DIRECTORY)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => parseTheme(readFileSync(join(THEME_DIRECTORY, entry), "utf8")))
    .filter((theme): theme is DesktopTheme => Boolean(theme?.id && theme?.name && (theme.dark || theme.light)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseTheme(source: string): DesktopTheme | null {
  try {
    return JSON.parse(source) as DesktopTheme;
  } catch {
    return null;
  }
}

function buildAppTheme(theme: DesktopTheme): AppTheme {
  const variant = theme.dark ?? theme.light;
  if (!variant) {
    throw new Error(`Theme ${theme.id} does not define a usable variant.`);
  }

  const palette = variant.palette;
  const overrides = variant.overrides ?? {};
  const base = palette.neutral;
  const ink = palette.ink;
  const accent = palette.accent ?? palette.primary;
  const diffAdd = palette.diffAdd ?? palette.success;
  const diffDelete = palette.diffDelete ?? palette.error;

  return {
    id: theme.id,
    name: theme.name,
    appBackground: mix(base, "#000000", 0.18),
    panelBackground: mix(base, ink, 0.08),
    inputBackground: mix(base, ink, 0.12),
    elevatedBackground: mix(base, ink, 0.16),
    border: mix(base, ink, 0.22),
    text: overrides["markdown-text"] ?? ink,
    textStrong: ink,
    textMuted: overrides["text-weak"] ?? mix(ink, base, 0.38),
    textDim: mix(ink, base, 0.54),
    accent: accent,
    info: palette.info,
    success: palette.success,
    warning: palette.warning,
    danger: palette.error,
    selectionBackground: palette.primary,
    selectionForeground: readableForeground(palette.primary),
    diffAdded: diffAdd,
    diffRemoved: diffDelete,
    diffAddedBackground: mix(diffAdd, base, 0.18),
    diffAddedContentBackground: mix(diffAdd, base, 0.12),
    diffRemovedBackground: mix(diffDelete, base, 0.18),
    diffRemovedContentBackground: mix(diffDelete, base, 0.12),
    syntaxStyle: createSyntaxStyle(palette, overrides),
  };
}

function createSyntaxStyle(palette: ThemePalette, overrides: Record<string, string>): SyntaxStyle {
  const heading = overrides["markdown-heading"] ?? palette.primary;
  const link = overrides["markdown-link"] ?? palette.primary;
  const quote = overrides["markdown-block-quote"] ?? overrides["text-weak"] ?? mix(palette.ink, palette.neutral, 0.38);
  const raw = overrides["markdown-code"] ?? palette.success;
  const keyword = overrides["syntax-keyword"] ?? palette.accent ?? palette.primary;
  const stringColor = overrides["syntax-string"] ?? palette.success;
  const primitive = overrides["syntax-primitive"] ?? palette.primary;
  const variable = overrides["syntax-variable"] ?? palette.error;
  const property = overrides["syntax-property"] ?? palette.info;
  const type = overrides["syntax-type"] ?? palette.warning;
  const constant = overrides["syntax-constant"] ?? palette.warning;
  const punctuation = overrides["syntax-punctuation"] ?? palette.ink;
  const comment = overrides["syntax-comment"] ?? overrides["text-weak"] ?? mix(palette.ink, palette.neutral, 0.45);
  const emphasis = overrides["markdown-emph"] ?? palette.warning;
  const strong = overrides["markdown-strong"] ?? palette.primary;
  const list = overrides["markdown-list-item"] ?? palette.primary;

  return SyntaxStyle.fromStyles({
    "markup.heading": { fg: RGBA.fromHex(heading), bold: true },
    "markup.heading.1": { fg: RGBA.fromHex(heading), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(palette.primary), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(strong), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(strong), bold: true },
    "markup.list": { fg: RGBA.fromHex(list) },
    "markup.link": { fg: RGBA.fromHex(link), underline: true },
    "markup.raw": { fg: RGBA.fromHex(raw) },
    "markup.raw.block": { fg: RGBA.fromHex(raw) },
    "markup.quote": { fg: RGBA.fromHex(quote), italic: true },
    "markup.strong": { fg: RGBA.fromHex(strong), bold: true },
    "markup.italic": { fg: RGBA.fromHex(emphasis), italic: true },
    "markup.strikethrough": { fg: RGBA.fromHex(comment), dim: true },
    tag: { fg: RGBA.fromHex(palette.primary) },
    attribute: { fg: RGBA.fromHex(type) },
    keyword: { fg: RGBA.fromHex(keyword), bold: true },
    "keyword.import": { fg: RGBA.fromHex(keyword), bold: true },
    "keyword.export": { fg: RGBA.fromHex(keyword), bold: true },
    "keyword.function": { fg: RGBA.fromHex(keyword), bold: true },
    "keyword.return": { fg: RGBA.fromHex(keyword), bold: true },
    "keyword.operator": { fg: RGBA.fromHex(keyword) },
    variable: { fg: RGBA.fromHex(variable) },
    "variable.builtin": { fg: RGBA.fromHex(keyword) },
    "variable.parameter": { fg: RGBA.fromHex(type) },
    constant: { fg: RGBA.fromHex(constant) },
    constructor: { fg: RGBA.fromHex(type) },
    string: { fg: RGBA.fromHex(stringColor) },
    "string.special": { fg: RGBA.fromHex(stringColor) },
    comment: { fg: RGBA.fromHex(comment), italic: true },
    number: { fg: RGBA.fromHex(primitive) },
    boolean: { fg: RGBA.fromHex(primitive) },
    function: { fg: RGBA.fromHex(palette.primary) },
    "function.call": { fg: RGBA.fromHex(palette.primary) },
    method: { fg: RGBA.fromHex(palette.primary) },
    "method.call": { fg: RGBA.fromHex(palette.primary) },
    type: { fg: RGBA.fromHex(type) },
    "type.builtin": { fg: RGBA.fromHex(type) },
    property: { fg: RGBA.fromHex(property) },
    field: { fg: RGBA.fromHex(property) },
    operator: { fg: RGBA.fromHex(keyword) },
    punctuation: { fg: RGBA.fromHex(punctuation) },
    "punctuation.bracket": { fg: RGBA.fromHex(punctuation) },
    "punctuation.delimiter": { fg: RGBA.fromHex(punctuation) },
    default: { fg: RGBA.fromHex(palette.ink) },
  });
}

function readableForeground(background: string): string {
  const { r, g, b } = hexToRgb(background);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#f8fafc";
}

function mix(left: string, right: string, ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
  });
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = color.replace(/^#/u, "");
  const hex = normalized.length === 3
    ? normalized
        .split("")
        .map((value) => `${value}${value}`)
        .join("")
    : normalized;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(value: { r: number; g: number; b: number }): string {
  return `#${[value.r, value.g, value.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
