import type { SessionCodeBlock, SessionStreamKind } from "../session.ts";
import type { SessionWorkBlock } from "../types.ts";
import type { AppTheme } from "./theme.ts";

export function escapeMarkdownInline(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/gu, "\\$&").replace(/\n/gu, " ");
}

export function displaySessionOutput(value: string | undefined): string {
  const output = value?.trim() ? value : "Output will appear here after you submit a Codex turn.";
  return normalizeMarkdownDisplay(
    closeDanglingMarkdownFences(output.replace(/(^|\n)\*\*You:\*\*/gu, "$1You:")),
  );
}

function normalizeMarkdownDisplay(value: string): string {
  return value
    .replace(/([^\n])### Tool call:/gu, "$1\n### Tool call:")
    .replace(
      /([^\n])### ((?:Command|File change|MCP tool call|Web search|Collab agent|Context compaction)\b)/gu,
      "$1\n### $2",
    )
    .replace(/(^|\n)(#{1,2})\s+/gu, "$1$2 ")
    .replace(/(^|\n)\s*>\s?/gu, "$1> ");
}

function closeDanglingMarkdownFences(value: string): string {
  const lines = value.split("\n");
  const normalized: string[] = [];
  let openFence: string | null = null;

  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
    if (fence) {
      if (openFence && fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      } else if (!openFence) {
        openFence = fence;
      }
      normalized.push(line);
      continue;
    }

    if (openFence && startsTranscriptBlock(line)) {
      normalized.push(openFence);
      openFence = null;
    }
    normalized.push(line);
  }

  if (openFence) normalized.push(openFence);
  return normalized.join("\n");
}

function startsTranscriptBlock(line: string): boolean {
  return /^(You:|#{1,6}\s+\S|\*\*[^*]+\*\*)/u.test(line.trimStart());
}

export function streamHeading(stream: SessionStreamKind): string | null {
  switch (stream) {
    case "assistant":
      return null;
    case "thinking":
      return "Thinking";
    case "thinking_summary":
      return "Thinking summary";
    case "plan":
      return "Plan";
    case "command_output":
      return "Command output";
    case "file_change_output":
      return "File change output";
  }
}

export function streamFenceLanguage(stream: SessionStreamKind): string | null {
  switch (stream) {
    case "command_output":
      return "text";
    case "file_change_output":
      return "diff";
    default:
      return null;
  }
}

export function closeActiveStreamFence(stream: SessionStreamKind | undefined): string {
  return stream && streamFenceLanguage(stream) ? "\n```\n" : "";
}

export function formatStreamDelta(text: string): string {
  return text;
}

export function workBlockMarker(id: string): string {
  return `\n\n[[work-block:${id}]]\n\n`;
}

export function codeBlockMarker(id: string): string {
  return `\n\n[[code-block:${id}]]\n\n`;
}

export function executionBlockTitle(block: SessionCodeBlock): string {
  if (block.title) return block.title;
  if (block.path && block.kind === "diff") return `Diff: ${block.path}`;
  if (block.path) return block.path;
  return block.kind === "diff" ? "Diff" : "Code";
}

export function statusColor(status: SessionWorkBlock["status"], theme: AppTheme): string {
  switch (status) {
    case "completed":
      return theme.success;
    case "failed":
      return theme.danger;
    case "running":
      return theme.warning;
    case "started":
      return theme.info;
    default:
      return theme.textMuted;
  }
}

export function formatWorkDetailLines(detail: string | undefined): string[] {
  if (!detail) return [];
  return detail
    .split(/\r?\n/gu)
    .map((line) => unescapeMarkdownInline(line.trim()))
    .filter(Boolean)
    .slice(0, 12);
}

function unescapeMarkdownInline(value: string): string {
  return value.replace(/\\([\\`*_{}[\]()#+\-.!|>])/gu, "$1");
}

type RenderableSegment =
  | { kind: "markdown"; content: string }
  | { kind: "legacy-work"; block: SessionWorkBlock };

export function splitLegacyWorkSegments(content: string): RenderableSegment[] {
  const segments: RenderableSegment[] = [];
  const lines = content.split("\n");
  let markdown: string[] = [];
  let currentWork: SessionWorkBlock | null = null;
  let currentDetail: string[] = [];

  const flushMarkdown = () => {
    const text = markdown.join("\n");
    if (text.trim()) segments.push({ kind: "markdown", content: text });
    markdown = [];
  };
  const flushWork = () => {
    if (!currentWork) return;
    segments.push({
      kind: "legacy-work",
      block: {
        ...currentWork,
        ...(currentDetail.length > 0 ? { detail: currentDetail.join("\n") } : {}),
      },
    });
    currentWork = null;
    currentDetail = [];
  };

  for (const line of lines) {
    const heading = /^###\s+(.+?)(?:\s+(started|running|completed|failed))?\s*$/u.exec(line);
    if (heading && isLegacyWorkLabel(heading[1] ?? "")) {
      flushWork();
      flushMarkdown();
      currentWork = {
        label: unescapeMarkdownInline(heading[1] ?? ""),
        ...(isWorkStatus(heading[2]) ? { status: heading[2] } : {}),
      };
      continue;
    }

    if (currentWork) {
      const detail = /^\s*-\s+(.*)$/u.exec(line)?.[1];
      if (detail !== undefined) {
        currentDetail.push(unescapeMarkdownInline(detail));
        continue;
      }
      if (!line.trim()) continue;
      flushWork();
    }
    markdown.push(line);
  }

  flushWork();
  flushMarkdown();
  return segments.length > 0 ? segments : [{ kind: "markdown", content }];
}

function isLegacyWorkLabel(label: string): boolean {
  return /^(Tool call:|Command|File change|MCP tool call|Web search|Collab agent|Context compaction)/u.test(
    unescapeMarkdownInline(label),
  );
}

function isWorkStatus(value: unknown): value is SessionWorkBlock["status"] {
  return value === "started" || value === "running" || value === "completed" || value === "failed";
}
