import type { TokenUsageSnapshot } from "../session.ts";
import type { LocalSessionState, OptionSelectionValue } from "../types.ts";

export function formatContextWindowTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatContextUsage(usage: TokenUsageSnapshot | undefined, maxTokens: number | null): string {
  const usedTokens = usage?.usedTokens ?? 0;
  const effectiveMaxTokens = usage?.maxTokens ?? maxTokens;
  if (effectiveMaxTokens && effectiveMaxTokens > 0) {
    const usedPercentage = Math.min(100, (usedTokens / effectiveMaxTokens) * 100);
    const percentage =
      usedPercentage < 10
        ? usedPercentage.toFixed(1).replace(/\.0$/, "")
        : String(Math.round(usedPercentage));
    return `${formatContextWindowTokens(usedTokens)}/${formatContextWindowTokens(effectiveMaxTokens)} ${percentage}%`;
  }
  return `${formatContextWindowTokens(usedTokens)} tok`;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function modelContextWindow(
  providerId: string,
  modelSlug: string,
  selections: Record<string, OptionSelectionValue>,
  modelContextWindow?: number,
): number | null {
  if (typeof modelContextWindow === "number" && Number.isFinite(modelContextWindow)) {
    return modelContextWindow;
  }
  const selectedWindow = selections.contextWindow;
  if (selectedWindow === "1m") return 1_000_000;
  if (selectedWindow === "200k") return 200_000;
  if (providerId === "codex") return 258_400;
  if (modelSlug.includes("claude")) return 200_000;
  if (modelSlug.includes("gpt-5")) return 400_000;
  return null;
}

export function deriveContextUsage(
  session: LocalSessionState | undefined,
  maxTokens: number | null,
  compactsAutomatically = false,
): TokenUsageSnapshot {
  if (session?.tokenUsage) {
    return {
      ...session.tokenUsage,
      ...(session.tokenUsage.compactsAutomatically === undefined && compactsAutomatically
        ? { compactsAutomatically }
        : {}),
    };
  }
  return {
    usedTokens: estimateTokens(session?.output ?? ""),
    ...(maxTokens !== null ? { maxTokens } : {}),
    ...(compactsAutomatically ? { compactsAutomatically } : {}),
  };
}
