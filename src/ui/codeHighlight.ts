import { CodeRenderable, createTextAttributes, RGBA, type Renderable, type TextChunk } from "@opentui/core";
import hljs from "highlight.js";

export function normalizeSyntaxFiletype(filetype: string | undefined): string | undefined {
  if (!filetype) return undefined;
  const normalized = normalizeHighlightLanguage(filetype);
  if (!normalized) return undefined;
  if (
    normalized === "typescript" ||
    normalized === "typescriptreact" ||
    normalized === "javascript" ||
    normalized === "javascriptreact" ||
    normalized === "markdown" ||
    normalized === "markdown_inline" ||
    normalized === "zig"
  ) {
    return normalized;
  }
  return normalized;
}

function normalizeHighlightLanguage(filetype: string | undefined): string | undefined {
  const raw = filetype?.trim().toLowerCase();
  if (!raw) return undefined;
  const aliases: Record<string, string> = {
    cjs: "javascript",
    css: "css",
    diff: "diff",
    html: "xml",
    js: "javascript",
    javascriptreact: "javascriptreact",
    json: "json",
    jsx: "javascriptreact",
    md: "markdown",
    mjs: "javascript",
    mts: "typescript",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
    tsx: "typescriptreact",
    typescriptreact: "typescriptreact",
    zsh: "bash",
  };
  return aliases[raw] ?? raw;
}

function treeSitterFiletype(filetype: string | undefined): string | undefined {
  const normalized = normalizeHighlightLanguage(filetype);
  return normalized === "typescript" ||
    normalized === "typescriptreact" ||
    normalized === "javascript" ||
    normalized === "javascriptreact" ||
    normalized === "markdown" ||
    normalized === "markdown_inline" ||
    normalized === "zig"
    ? normalized
    : undefined;
}

function inferCodeFiletype(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  if (
    (/^[\[{]/u.test(trimmed) && /[\]}]$/u.test(trimmed) && /"[^"]+"\s*:/u.test(trimmed)) ||
    /^(package|tsconfig|composer)\.json$/iu.test(trimmed)
  ) {
    return "json";
  }
  if (/<[A-Z]?[a-z][\s\S]*>/u.test(trimmed) && /<\/[A-Z]?[a-z]>|\/>/u.test(trimmed)) {
    return "xml";
  }
  if (/^\s*(import|export)\s/mu.test(content) || /\b(interface|type|enum)\s+\w+/u.test(content)) {
    return "typescript";
  }
  if (/\b(function|const|let|var)\s+\w+/u.test(content) || /=>/u.test(content)) {
    return "javascript";
  }
  if (/^\s*(diff --git|@@\s)/mu.test(content)) return "diff";
  if (/^\s*#include\s+/mu.test(content)) return "cpp";
  if (/^\s*(def|class)\s+\w+/mu.test(content)) return "python";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE)\s+/imu.test(content)) return "sql";
  if (/^\s*(bun|npm|pnpm|yarn|git|cd|ls|mkdir|rm|cp|mv)\s+/mu.test(content)) return "bash";
  return undefined;
}

export function codeHighlightChunks(chunks: TextChunk[], context: { content: string; filetype: string }): TextChunk[] {
  const language = normalizeHighlightLanguage(context.filetype);
  if (!language || treeSitterFiletype(language)) return chunks;
  return highlightJsChunks(context.content, language) ?? chunks;
}

function highlightJsChunks(content: string, language: string): TextChunk[] | null {
  try {
    const result = hljs.getLanguage(language)
      ? hljs.highlight(content, { language, ignoreIllegals: true })
      : hljs.highlightAuto(content);
    return htmlHighlightToChunks(result.value);
  } catch {
    return null;
  }
}

function htmlHighlightToChunks(html: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  const stack: string[] = [];
  const token = /<span class="([^"]+)">|<\/span>|([^<]+)/gu;
  let match: RegExpExecArray | null;

  while ((match = token.exec(html))) {
    if (match[1]) {
      stack.push(match[1]);
      continue;
    }
    if (match[0] === "</span>") {
      stack.pop();
      continue;
    }
    const text = decodeHtmlEntities(match[2] ?? "");
    if (!text) continue;
    const style = highlightClassStyle(stack.at(-1));
    chunks.push({
      __isChunk: true,
      text,
      ...(style.fg ? { fg: RGBA.fromHex(style.fg) } : {}),
      ...(style.bold || style.italic
        ? { attributes: createTextAttributes({ bold: style.bold, italic: style.italic }) }
        : {}),
    });
  }

  return chunks.length > 0 ? chunks : [{ __isChunk: true, text: decodeHtmlEntities(html) }];
}

function highlightClassStyle(className: string | undefined): {
  fg?: string;
  bold?: boolean;
  italic?: boolean;
} {
  const classes = className?.split(/\s+/u) ?? [];
  if (classes.some((name) => name.endsWith("keyword") || name.endsWith("literal"))) {
    return { fg: "#FCA5A5", bold: true };
  }
  if (classes.some((name) => name.endsWith("string") || name.endsWith("regexp"))) {
    return { fg: "#A5D6FF" };
  }
  if (classes.some((name) => name.endsWith("number") || name.endsWith("built_in"))) {
    return { fg: "#BAE6FD" };
  }
  if (classes.some((name) => name.endsWith("comment") || name.endsWith("quote"))) {
    return { fg: "#94A3B8", italic: true };
  }
  if (classes.some((name) => name.endsWith("type") || name.endsWith("class") || name.endsWith("title"))) {
    return { fg: "#FDE68A" };
  }
  if (classes.some((name) => name.endsWith("attr") || name.endsWith("attribute") || name.endsWith("property"))) {
    return { fg: "#93C5FD" };
  }
  if (classes.some((name) => name.endsWith("tag") || name.endsWith("name"))) {
    return { fg: "#7DD3FC" };
  }
  if (classes.some((name) => name.endsWith("addition"))) return { fg: "#A7F3D0" };
  if (classes.some((name) => name.endsWith("deletion"))) return { fg: "#FCA5A5" };
  return { fg: "#E2E8F0" };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&#x27;|&#39;/gu, "'");
}

export function renderMarkdownNode(
  token: unknown,
  context: { defaultRender: () => Renderable | null },
): Renderable | null | undefined {
  const renderable = context.defaultRender();
  if (renderable instanceof CodeRenderable && isRecord(token)) {
    const content = typeof token.text === "string" ? token.text : renderable.content;
    renderable.filetype = normalizeSyntaxFiletype(
      typeof token.lang === "string" && token.lang ? token.lang : inferCodeFiletype(content),
    );
    renderable.onChunks = codeHighlightChunks;
  }
  return renderable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
