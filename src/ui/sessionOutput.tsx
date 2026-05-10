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
      internalBlockMode="top-level"
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
        {summary.target ? <text fg="#94A3B8">{summary.target}</text> : null}
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
  const title = detailValue(detailLines, "title") ?? (block.code ? executionBlockTitle(block.code) : null);
  const target = title && title !== tool ? title : null;
  return {
    title: actionLabel(tool),
    target,
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
