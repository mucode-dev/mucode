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

export function renderSessionOutput(session: LocalSessionState | undefined) {
  const content = displaySessionOutput(session?.output);
  const parts = content.split(/(\[{1,2}(?:code|work)-block:[^\]]+\]{1,2})/gu);
  return parts.map((part, index) => {
    const codeMatch = /^\[{1,2}code-block:([^\]]+)\]{1,2}$/u.exec(part);
    const workMatch = /^\[{1,2}work-block:([^\]]+)\]{1,2}$/u.exec(part);
    if (!codeMatch && !workMatch) {
      if (!part) return null;
      return splitLegacyWorkSegments(part).map((segment, segmentIndex) =>
        segment.kind === "legacy-work"
          ? renderWorkBlock(segment.block, `legacy-${index}-${segmentIndex}`)
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
      return renderWorkBlock(block, blockId);
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

function renderWorkBlock(block: SessionWorkBlock, blockId: string) {
  return (
    <box
      key={`work-${blockId}`}
      flexDirection="column"
      border
      padding={1}
      marginTop={1}
      marginBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#E2E8F0">{block.label}</text>
        {block.status ? <text fg={statusColor(block.status)}>{block.status}</text> : null}
      </box>
      {formatWorkDetailLines(block.detail).map((line, lineIndex) => (
        <text key={`${blockId}-detail-${lineIndex}`} fg="#94A3B8">
          {line}
        </text>
      ))}
      {block.code ? renderExecutionCodeBlock(block.code, blockId) : null}
    </box>
  );
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
