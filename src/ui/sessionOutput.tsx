import type { SessionCodeBlock } from "../sessionHarness.ts";
import type { LocalSessionState, SessionWorkBlock } from "../types.ts";
import { codeHighlightChunks, normalizeSyntaxFiletype, renderMarkdownNode } from "./codeHighlight.ts";
import { OUTPUT_SYNTAX_STYLE } from "./theme.ts";
import {
  displaySessionOutput,
  executionBlockTitle,
  formatWorkDetailLines,
  splitLegacyWorkSegments,
  statusColor,
} from "./transcript.ts";

interface SessionOutputOptions {
  showWorkDetails?: boolean;
}

export function renderSessionOutput(
  session: LocalSessionState | undefined,
  options: SessionOutputOptions = {},
) {
  const content = displaySessionOutput(session?.output);
  const parts = content.split(/(\[{1,2}(?:code|work)-block:[^\]]+\]{1,2})/gu);
  return parts.map((part, index) => {
    const codeMatch = /^\[{1,2}code-block:([^\]]+)\]{1,2}$/u.exec(part);
    const workMatch = /^\[{1,2}work-block:([^\]]+)\]{1,2}$/u.exec(part);
    if (!codeMatch && !workMatch) {
      if (!part) return null;
      return splitLegacyWorkSegments(part).map((segment, segmentIndex) =>
        segment.kind === "legacy-work"
          ? renderWorkBlock(segment.block, `legacy-${index}-${segmentIndex}`, options.showWorkDetails)
          : renderMarkdownPart(
              segment.content,
              `markdown-${index}-${segmentIndex}`,
              session?.status === "running" && index === parts.length - 1,
            ),
      );
    }

    if (workMatch) {
      const blockId = workMatch[1];
      if (!blockId) return null;
      const block = session?.workBlocks?.[blockId];
      if (!block) return null;
      return renderWorkBlock(block, blockId, options.showWorkDetails);
    }

    const blockId = codeMatch?.[1];
    if (!blockId) return null;
    const block = session?.codeBlocks?.[blockId];
    if (!block) return null;
    return renderExecutionCodeBlock(block, blockId);
  });
}

function renderMarkdownPart(content: string, key: string, streaming: boolean) {
  if (!content.trim()) return null;
  return (
    <markdown
      key={key}
      content={content}
      syntaxStyle={OUTPUT_SYNTAX_STYLE}
      fg="#E2E8F0"
      streaming={streaming}
      conceal
      concealCode
      internalBlockMode={streaming ? "top-level" : "coalesced"}
      renderNode={renderMarkdownNode}
      tableOptions={{
        style: "columns",
        widthMode: "content",
        columnFitter: "balanced",
        wrapMode: "word",
        borderColor: "#475569",
        selectable: true,
      }}
    />
  );
}

function renderWorkBlock(block: SessionWorkBlock, blockId: string, showDetails = false) {
  const detailLines = workDetailLines(block.detail);
  const summary = workBlockSummary(block, detailLines);
  const accent = statusColor(block.status);

  return (
    <box
      key={`work-${blockId}`}
      flexDirection="column"
      marginTop={0}
      marginBottom={showDetails ? 1 : 0}
      gap={0}
    >
      <box flexDirection="row" gap={1}>
        <text fg={accent}>{workStatusPrefix(block.status)}</text>
        <text fg="#E2E8F0">{summary.title}</text>
        {summary.meta.map((item, index) => (
          <text key={`${blockId}-meta-${index}`} fg={index === 0 ? "#94A3B8" : "#64748B"}>
            {item}
          </text>
        ))}
        {block.status ? <text fg={accent}>{block.status}</text> : null}
      </box>
      {showDetails ? (
        <box
          flexDirection="column"
          border
          padding={1}
          marginTop={1}
          gap={0}
        >
          {detailLines.slice(0, 6).map((line, lineIndex) => (
            <text key={`${blockId}-detail-${lineIndex}`} fg="#94A3B8">
              {line}
            </text>
          ))}
          {block.code ? renderExecutionCodePreview(block.code, `${blockId}-preview`) : null}
        </box>
      ) : null}
    </box>
  );
}

function workBlockSummary(block: SessionWorkBlock, detailLines: string[]) {
  const cleanLabel = block.label.replace(/^Tool call:\s*/u, "").trim();
  const tool = detailValue(detailLines, "tool") ?? cleanLabel;
  const title = detailValue(detailLines, "title");
  const detailObject = detailObjectFromLines(detailLines);
  const meta = compactWorkMetadata({
    tool,
    title,
    block,
    detailObject,
  });
  return {
    title: actionLabel(tool),
    meta,
  };
}

function workDetailLines(detail: string | undefined): string[] {
  return formatWorkDetailLines(detail).filter(
    (line) => !/^(part id|call id|request id|item id|raw):/u.test(line),
  );
}

function detailValue(lines: string[], key: string): string | null {
  const prefix = `${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  return value || null;
}

function detailObjectFromLines(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key || !rawValue) continue;
    result[key] = parseMaybeJson(rawValue);
  }
  return result;
}

function compactWorkMetadata(input: {
  tool: string;
  title: string | null;
  block: SessionWorkBlock;
  detailObject: Record<string, unknown>;
}): string[] {
  const args = asRecord(input.detailObject.args);
  const path =
    firstString(input.detailObject.path, fieldValue(args, ["file_path", "filepath", "path"])) ??
    codePath(input.block.code);
  const pattern = firstString(
    fieldValue(args, ["pattern", "glob", "query"]),
    fieldValue(args, ["include", "regex"]),
  );
  const command = firstString(input.detailObject.command, fieldValue(args, ["command", "cmd"]));
  const title = input.title && input.title !== input.tool ? input.title : null;
  const output = outputMetadata(firstString(input.detailObject.output, input.detailObject.summary));

  return uniqueNonEmpty([
    title,
    path,
    pattern ? quoteIfNeeded(pattern) : null,
    command ? quoteIfNeeded(command) : null,
    output,
  ]).slice(0, 3);
}

function codePath(block: SessionCodeBlock | undefined): string | null {
  if (!block) return null;
  return block.path ?? (block.title && block.title !== "Code" && block.title !== "Diff" ? block.title : null);
}

function outputMetadata(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const matchCount = /\b(\d+)\s+matches?\b/iu.exec(trimmed)?.[0];
  if (matchCount) return matchCount;
  const array = parseJsonArray(trimmed);
  if (array) return `${array.length} ${array.length === 1 ? "match" : "matches"}`;
  const firstLine = trimmed.split(/\r?\n/u).find(Boolean);
  return firstLine ? clipText(firstLine, 48) : null;
}

function fieldValue(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMaybeJson(value: string): unknown {
  if (!/^[{["0-9tfn-]/u.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function quoteIfNeeded(value: string): string {
  return /\s/u.test(value) ? `"${clipText(value, 48)}"` : clipText(value, 48);
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function uniqueNonEmpty(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function actionLabel(value: string): string {
  const label = value.replace(/^Tool call:\s*/u, "").trim();
  if (!label) return "Tool";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function workStatusPrefix(status: SessionWorkBlock["status"] | undefined): string {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
      return "!!";
    case "running":
      return ">>";
    case "started":
      return "..";
    default:
      return "--";
  }
}

function renderExecutionCodePreview(block: SessionCodeBlock, blockId: string) {
  const maxLines = 10;
  const lines = block.content.split("\n");
  const clipped = lines.length > maxLines;
  const content = clipped
    ? `${lines.slice(0, maxLines).join("\n")}\n... +${lines.length - maxLines} lines`
    : block.content;
  return renderExecutionCodeBlock({ ...block, content }, blockId);
}

function renderExecutionCodeBlock(block: SessionCodeBlock, blockId: string) {
  return (
    <box key={`code-${blockId}`} flexDirection="column" marginTop={1} marginBottom={1} gap={0}>
      <box flexDirection="row" gap={2} marginBottom={1}>
        <text fg={block.kind === "diff" ? "#A7F3D0" : "#93C5FD"}>
          {executionBlockTitle(block)}
        </text>
        {block.filetype ? <text fg="#94A3B8">{block.filetype}</text> : null}
      </box>
      {block.kind === "diff" ? (
        <diff
          diff={block.content}
          filetype={normalizeSyntaxFiletype(block.filetype)}
          syntaxStyle={OUTPUT_SYNTAX_STYLE}
          treeSitterClient={undefined}
          view="unified"
          wrapMode="word"
          showLineNumbers
          conceal
          lineNumberFg="#64748B"
          addedBg="#06381D"
          removedBg="#3A1216"
          addedContentBg="#052E16"
          removedContentBg="#331015"
          addedSignColor="#22C55E"
          removedSignColor="#F87171"
        />
      ) : (
        <code
          content={block.content}
          filetype={normalizeSyntaxFiletype(block.filetype)}
          syntaxStyle={OUTPUT_SYNTAX_STYLE}
          onChunks={codeHighlightChunks}
          wrapMode="word"
          conceal
          drawUnstyledText
          streaming={false}
        />
      )}
    </box>
  );
}
