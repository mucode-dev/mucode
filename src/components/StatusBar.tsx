import type { LocalProviderSnapshot, ServerProviderModel, TuiMode } from "../provider.ts";
import type { OptionSelectionValue } from "../types.ts";
import type { TokenUsageSnapshot } from "../session.ts";
import { type AppTheme, PANEL_PADDING } from "../ui/theme.ts";

interface StatusBarProps {
  activeContextLabel: string;
  activeContextUsage: TokenUsageSnapshot;
  log: string;
  mode: TuiMode;
  modelSlug: string;
  optionSelections: Record<string, OptionSelectionValue>;
  pathReadyToConfirm: boolean;
  providerId: string;
  selectedModel: ServerProviderModel | undefined;
  selectedProvider: LocalProviderSnapshot | undefined;
  status: string;
  theme: AppTheme;
  workingDirectory: string;
}

export function StatusBar({
  activeContextLabel,
  activeContextUsage,
  log,
  mode,
  modelSlug,
  optionSelections,
  pathReadyToConfirm,
  providerId,
  selectedModel,
  selectedProvider,
  status,
  theme,
  workingDirectory,
}: StatusBarProps) {
  return (
    <box flexDirection="row">
      <box width={PANEL_PADDING} />
      <box flexDirection="row" justifyContent="space-between" flexGrow={1}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>{selectedProvider?.displayName ?? providerId}</text>
          <text fg={theme.textMuted}>{selectedModel?.name ?? modelSlug}</text>
          <text fg={theme.textMuted}>{activeContextLabel}</text>
          {activeContextUsage.compactsAutomatically ? <text fg={theme.textMuted}>auto-compact</text> : null}
          <text fg={theme.textMuted}>
            {Object.entries(optionSelections)
              .map(([id, value]) => `${id}:${value}`)
              .join(" ")}
          </text>
          <text fg={theme.textMuted}>{mode}</text>
          <text fg={theme.textMuted}>{status}</text>
          {pathReadyToConfirm ? <text fg={theme.textMuted}>Enter to confirm</text> : null}
        </box>
        <box flexDirection="row" gap={2}>
          {log ? <text fg={theme.textMuted}>{log}</text> : null}
          <text fg={theme.textMuted}>{workingDirectory}</text>
        </box>
      </box>
      <box width={PANEL_PADDING} />
    </box>
  );
}
