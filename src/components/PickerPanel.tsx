import type { ProviderOptionDescriptor } from "../provider.ts";
import type { PickerKind, PickerOption } from "../types.ts";
import { pickerTitle } from "../ui/options.ts";
import type { AppTheme } from "../ui/theme.ts";

interface PickerPanelProps {
  activeOptionDescriptor: ProviderOptionDescriptor | undefined;
  options: PickerOption[];
  pickerKind: PickerKind;
  selectedIndex: number;
  theme: AppTheme;
  themePreview?: AppTheme;
}

export function PickerPanel({
  activeOptionDescriptor,
  options,
  pickerKind,
  selectedIndex,
  theme,
  themePreview,
}: PickerPanelProps) {
  const selectedTheme = themePreview ?? theme;

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1}>
        <box flexDirection="column" flexGrow={1} padding={1} gap={0} backgroundColor={theme.inputBackground}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.accent}>{pickerTitle(pickerKind, activeOptionDescriptor)}</text>
            <text fg={theme.textMuted}>Esc to chat, Esc again to exit</text>
          </box>
          {options.map((option, index) => (
            <text
              key={`${option.value}-${index}`}
              fg={
                option.groupTitle
                  ? theme.accent
                  : option.disabled
                    ? theme.textDim
                    : index === selectedIndex
                      ? theme.selectionForeground
                      : theme.text
              }
              bg={!option.groupTitle && index === selectedIndex ? theme.selectionBackground : undefined}
            >
              {option.groupTitle
                ? option.label
                : pickerKind === "path"
                ? `${index === selectedIndex ? "> " : "  "}${option.description || option.label}`
                : `${index === selectedIndex ? "> " : "  "}${option.label.padEnd(16)} ${option.description}`}
            </text>
          ))}
        </box>
        {pickerKind === "theme" ? (
          <box width={34} flexDirection="column" padding={1} gap={1} backgroundColor={selectedTheme.elevatedBackground}>
            <text fg={selectedTheme.accent}>{selectedTheme.name}</text>
            <text fg={selectedTheme.textMuted}>{selectedTheme.id}</text>
            <box height={1} backgroundColor={selectedTheme.appBackground} />
            <box height={1} backgroundColor={selectedTheme.panelBackground} />
            <box height={1} backgroundColor={selectedTheme.selectionBackground} />
            <box flexDirection="row" gap={1}>
              <text fg={selectedTheme.textStrong}>Aa</text>
              <text fg={selectedTheme.textMuted}>Muted</text>
              <text fg={selectedTheme.success}>OK</text>
              <text fg={selectedTheme.warning}>Warn</text>
              <text fg={selectedTheme.danger}>Err</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={selectedTheme.info}>const</text>
              <text fg={selectedTheme.accent}>theme</text>
              <text fg={selectedTheme.success}>=</text>
              <text fg={selectedTheme.textStrong}>"preview"</text>
            </box>
            <text fg={selectedTheme.textDim}>Arrow keys preview, Enter applies.</text>
          </box>
        ) : null}
      </box>
      {pickerKind === "sessions" ? (
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>Enter switch</text>
          <text fg={theme.danger}>Delete delete</text>
          <text fg={theme.textMuted}>Esc chat</text>
          <text fg={theme.textMuted}>Esc again exit</text>
        </box>
      ) : null}
    </box>
  );
}
