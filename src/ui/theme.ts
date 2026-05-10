import { RGBA, SyntaxStyle } from "@opentui/core";

export const APP_BACKGROUND = "#020617";
export const PANEL_BACKGROUND = "#0F172A";
export const INPUT_BACKGROUND = "#111827";
export const PANEL_GAP = 1;
export const PANEL_PADDING = 1;

export const OUTPUT_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  "markup.heading": { fg: RGBA.fromHex("#7DD3FC"), bold: true },
  "markup.heading.1": { fg: RGBA.fromHex("#A7F3D0"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#BAE6FD"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#FDE68A"), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex("#FDE68A"), bold: true },
  "markup.list": { fg: RGBA.fromHex("#7DD3FC") },
  "markup.link": { fg: RGBA.fromHex("#60A5FA"), underline: true },
  "markup.raw": { fg: RGBA.fromHex("#FDE68A") },
  "markup.raw.block": { fg: RGBA.fromHex("#86EFAC") },
  "markup.quote": { fg: RGBA.fromHex("#94A3B8"), italic: true },
  "markup.strong": { fg: RGBA.fromHex("#E2E8F0"), bold: true },
  "markup.italic": { fg: RGBA.fromHex("#CBD5E1"), italic: true },
  "markup.strikethrough": { fg: RGBA.fromHex("#94A3B8"), dim: true },
  tag: { fg: RGBA.fromHex("#7DD3FC") },
  attribute: { fg: RGBA.fromHex("#FDE68A") },
  keyword: { fg: RGBA.fromHex("#FCA5A5"), bold: true },
  "keyword.import": { fg: RGBA.fromHex("#FCA5A5"), bold: true },
  "keyword.export": { fg: RGBA.fromHex("#FCA5A5"), bold: true },
  "keyword.function": { fg: RGBA.fromHex("#FCA5A5"), bold: true },
  "keyword.return": { fg: RGBA.fromHex("#FCA5A5"), bold: true },
  "keyword.operator": { fg: RGBA.fromHex("#FCA5A5") },
  variable: { fg: RGBA.fromHex("#E2E8F0") },
  "variable.builtin": { fg: RGBA.fromHex("#FCA5A5") },
  "variable.parameter": { fg: RGBA.fromHex("#FDBA74") },
  constant: { fg: RGBA.fromHex("#BAE6FD") },
  constructor: { fg: RGBA.fromHex("#FDE68A") },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  "string.special": { fg: RGBA.fromHex("#A7F3D0") },
  comment: { fg: RGBA.fromHex("#94A3B8"), italic: true },
  number: { fg: RGBA.fromHex("#BAE6FD") },
  boolean: { fg: RGBA.fromHex("#BAE6FD") },
  function: { fg: RGBA.fromHex("#DDD6FE") },
  "function.call": { fg: RGBA.fromHex("#DDD6FE") },
  method: { fg: RGBA.fromHex("#DDD6FE") },
  "method.call": { fg: RGBA.fromHex("#DDD6FE") },
  type: { fg: RGBA.fromHex("#FDE68A") },
  "type.builtin": { fg: RGBA.fromHex("#FDE68A") },
  property: { fg: RGBA.fromHex("#93C5FD") },
  field: { fg: RGBA.fromHex("#93C5FD") },
  operator: { fg: RGBA.fromHex("#FCA5A5") },
  punctuation: { fg: RGBA.fromHex("#CBD5E1") },
  "punctuation.bracket": { fg: RGBA.fromHex("#CBD5E1") },
  "punctuation.delimiter": { fg: RGBA.fromHex("#CBD5E1") },
  default: { fg: RGBA.fromHex("#E2E8F0") },
});
