import type { ProviderOptionDescriptor } from "../providerHarness.ts";
import type { PickerKind, PickerOption } from "../types.ts";
import { pickerTitle } from "../ui/options.ts";

interface PickerPanelProps {
  activeOptionDescriptor: ProviderOptionDescriptor | undefined;
  options: PickerOption[];
  pickerKind: PickerKind;
  selectedIndex: number;
}

export function PickerPanel({
  activeOptionDescriptor,
  options,
  pickerKind,
  selectedIndex,
}: PickerPanelProps) {
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="column" border padding={1} gap={0}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg="#FDE68A">{pickerTitle(pickerKind, activeOptionDescriptor)}</text>
          <text fg="#94A3B8">Esc to chat, Esc again to exit</text>
        </box>
        {options.map((option, index) => (
          <text
            key={`${option.value}-${index}`}
            fg={
              option.disabled ? "#64748B" : index === selectedIndex ? "#0F172A" : "#E2E8F0"
            }
            bg={index === selectedIndex ? "#A7F3D0" : undefined}
          >
            {pickerKind === "path"
              ? `${index === selectedIndex ? "> " : "  "}${option.description || option.label}`
              : `${index === selectedIndex ? "> " : "  "}${option.label.padEnd(16)} ${option.description}`}
          </text>
        ))}
      </box>
      {pickerKind === "sessions" ? (
        <box flexDirection="row" gap={2}>
          <text fg="#94A3B8">Enter switch</text>
          <text fg="#FCA5A5">Delete delete</text>
          <text fg="#94A3B8">Esc chat</text>
          <text fg="#94A3B8">Esc again exit</text>
        </box>
      ) : null}
    </box>
  );
}
