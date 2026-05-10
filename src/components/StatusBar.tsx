import type { LocalProviderSnapshot, ServerProviderModel, TuiMode } from "../providerHarness.ts";
import type { OptionSelectionValue } from "../types.ts";
import type { TokenUsageSnapshot } from "../sessionHarness.ts";

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
  workingDirectory,
}: StatusBarProps) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" gap={2}>
        <text fg="#94A3B8">{selectedProvider?.displayName ?? providerId}</text>
        <text fg="#94A3B8">{selectedModel?.name ?? modelSlug}</text>
        <text fg="#94A3B8">{activeContextLabel}</text>
        {activeContextUsage.compactsAutomatically ? <text fg="#94A3B8">auto-compact</text> : null}
        <text fg="#94A3B8">
          {Object.entries(optionSelections)
            .map(([id, value]) => `${id}:${value}`)
            .join(" ")}
        </text>
        <text fg="#94A3B8">{mode}</text>
        <text fg="#94A3B8">{status}</text>
        {pathReadyToConfirm ? <text fg="#94A3B8">Enter to confirm</text> : null}
      </box>
      <box flexDirection="row" gap={2}>
        {log ? <text fg="#94A3B8">{log}</text> : null}
        <text fg="#94A3B8">{workingDirectory}</text>
      </box>
    </box>
  );
}
