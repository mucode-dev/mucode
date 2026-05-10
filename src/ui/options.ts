import type { LocalProviderSnapshot, ProviderOptionDescriptor, ServerProviderModel, TuiMode } from "../provider.ts";
import type { LocalSessionState, OptionSelectionValue, PickerKind, PickerOption } from "../types.ts";
import { formatLastTime } from "./sessionList.ts";

export function detectPickerKind(input: string): PickerKind | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const commandText = trimmed.slice(1);
  const [command = ""] = commandText.split(/\s+/g);
  const hasCommandSpace = /\s/u.test(commandText);
  if (command === "") return "slash";
  if (command === "provider") return "provider";
  if (command === "model") return "model";
  if (command === "mode") return "mode";
  if (command === "options") return "options";
  if (command === "sessions") return "sessions";
  if (command === "sidebar") return "sidebar";
  if (command === "path") return "path";
  if (!hasCommandSpace && "provider".startsWith(command)) return "slash";
  if (!hasCommandSpace && "model".startsWith(command)) return "slash";
  if (!hasCommandSpace && "mode".startsWith(command)) return "slash";
  if (!hasCommandSpace && "options".startsWith(command)) return "slash";
  if (!hasCommandSpace && "sessions".startsWith(command)) return "slash";
  if (!hasCommandSpace && "sidebar".startsWith(command)) return "slash";
  if (!hasCommandSpace && "path".startsWith(command)) return "slash";
  if (!hasCommandSpace && "compact".startsWith(command)) return "slash";
  if (!hasCommandSpace && "new".startsWith(command)) return "slash";
  return null;
}

function slashCommandQuery(input: string): string {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.slice(1).split(/\s+/u)[0] ?? "";
}

export function slashOptions(sidebarOpen: boolean, input: string): PickerOption[] {
  const query = slashCommandQuery(input);
  const options = [
    { label: "/provider", value: "provider", description: "Switch between local provider CLIs" },
    { label: "/model", value: "model", description: "Choose a model from the selected provider" },
    { label: "/options", value: "options", description: "Edit options for the selected model" },
    { label: "/new", value: "new", description: "Start a new empty local session" },
    { label: "/sessions", value: "sessions", description: "Switch between local sessions" },
    { label: "/path", value: "path", description: "Set this session's working directory" },
    { label: "/compact", value: "compact", description: "Manually compact this session context" },
    {
      label: "/sidebar",
      value: "sidebar",
      description: sidebarOpen ? "Close the sessions sidebar" : "Open the sessions sidebar",
    },
    { label: "/mode", value: "mode", description: "Choose build or plan mode" },
  ];
  return query ? options.filter((option) => option.value.startsWith(query)) : options;
}

export function modeOptions(mode: TuiMode): PickerOption[] {
  return [
    {
      label: "build",
      value: "build",
      description: mode === "build" ? "Current mode" : "Implementation turns",
    },
    {
      label: "plan",
      value: "plan",
      description: mode === "plan" ? "Current mode" : "Planning-only turns",
    },
  ];
}

export function providerOptions(providers: LocalProviderSnapshot[]): PickerOption[] {
  return providers.map((provider) => ({
    label: provider.displayName,
    value: provider.instanceId,
    description: provider.installed
      ? `${provider.version ?? "installed"} · ${provider.models.length} models`
      : provider.message ?? "Not installed",
    disabled: !provider.installed,
  }));
}

export function modelOptions(models: ServerProviderModel[]): PickerOption[] {
  return models.map((model) => ({
    label: model.name,
    value: model.slug,
    description: [
      model.slug,
      model.subProvider,
      model.capabilities?.optionDescriptors.length
        ? `${model.capabilities.optionDescriptors.length} option groups`
        : "no extra options",
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export function sessionOptions(
  sessions: ReadonlyArray<LocalSessionState>,
  activeSessionId: string,
): PickerOption[] {
  return sessions.map((session) => ({
    label: session.title,
    value: session.id,
    description: [
      session.id === activeSessionId ? "current" : undefined,
      session.status,
      formatLastTime(session.lastActiveAt),
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export function descriptorOptions(
  descriptor: ProviderOptionDescriptor | undefined,
  selections: Record<string, OptionSelectionValue>,
): PickerOption[] {
  if (!descriptor) return [];
  const currentValue = selections[descriptor.id] ?? descriptor.currentValue;
  if (descriptor.type === "boolean") {
    return [
      {
        label: "on",
        value: "true",
        description: currentValue === true ? "Current value" : descriptor.label,
      },
      {
        label: "off",
        value: "false",
        description: currentValue === false ? "Current value" : descriptor.label,
      },
    ];
  }
  return (descriptor.options ?? []).map((choice) => ({
    label: choice.label,
    value: choice.id,
    description:
      currentValue === choice.id
        ? "Current value"
        : choice.isDefault
          ? "Default"
          : descriptor.label,
  }));
}

export function defaultOptionSelections(
  model: ServerProviderModel | undefined,
): Record<string, OptionSelectionValue> {
  const selections: Record<string, OptionSelectionValue> = {};
  for (const descriptor of model?.capabilities?.optionDescriptors ?? []) {
    if (typeof descriptor.currentValue === "string" || typeof descriptor.currentValue === "boolean") {
      selections[descriptor.id] = descriptor.currentValue;
      continue;
    }
    if (descriptor.type === "select") {
      const defaultChoice = descriptor.options?.find((choice) => choice.isDefault);
      if (defaultChoice) selections[descriptor.id] = defaultChoice.id;
    }
  }
  return selections;
}

export function pickerTitle(
  pickerKind: PickerKind,
  activeOptionDescriptor: ProviderOptionDescriptor | undefined,
): string {
  switch (pickerKind) {
    case "slash":
      return "Commands";
    case "provider":
      return "Providers";
    case "model":
      return "Models";
    case "mode":
      return "Modes";
    case "sessions":
      return "Sessions";
    case "sidebar":
      return "Sidebar";
    case "path":
      return "Path";
    case "options":
      return activeOptionDescriptor?.label ?? "Options";
  }
}
