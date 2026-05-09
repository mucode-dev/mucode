import { useKeyboard, useRenderer } from "@opentui/react";
import { CliRenderEvents, type Selection } from "@opentui/core";
import { realpathSync } from "node:fs";
import { useEffect, useMemo, useState } from "react";

import { PickerPanel } from "./components/PickerPanel.tsx";
import { SessionSidebar } from "./components/SessionSidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import {
  loadLocalProviders,
  type LocalProviderSnapshot,
  type ServerProviderModel,
  type TuiMode,
} from "./provider.ts";
import { CodeSession, type SessionEvent, type SessionStreamKind } from "./session.ts";
import { SharedSessionProvider, useMaybeSharedSession, useSharedSession } from "./sessionContext.tsx";
import { loadPersistedState, savePersistedState } from "./storage.ts";
import type { LocalSessionState, OptionSelectionValue, PickerOption } from "./types.ts";
import { deriveContextUsage, formatContextUsage, modelContextWindow } from "./ui/context.ts";
import { defaultOptionSelections, descriptorOptions, detectPickerKind, modeOptions, modelOptions, providerOptions, sessionOptions, slashOptions, themeOptions } from "./ui/options.ts";
import { commonPrefixLength, parsePathCommand, pathInputForOption, pathOptions, resolveWorkingDirectory } from "./ui/path.ts";
import { renderSessionOutput } from "./ui/sessionOutput.tsx";
import { AVAILABLE_THEMES, PANEL_GAP, PANEL_PADDING, resolveAppTheme } from "./ui/theme.ts";
import { closeActiveStreamFence, codeBlockMarker, escapeMarkdownInline, formatStreamDelta, streamFenceLanguage, streamHeading, workBlockMarker } from "./ui/transcript.ts";

function isCompactCommand(input: string): boolean {
  return /^\/compact(?:\s*)$/u.test(input.trim());
}

function normalizeDirectoryForCompare(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}

interface AppProps {
  active?: boolean;
  preserveOnUnmount?: boolean;
  devActions?: DevActions;
}

interface DevActions {
  enabled: boolean;
  viewingMain: boolean;
  onEnableDevMode: () => void;
  onDisableDevMode: () => void;
  onLoadChanges: () => void;
  onApplyChanges: () => void;
  onMain: () => void;
  onExit: () => void;
}

function devCommandKind(input: string): "enable" | "disable" | "load" | "apply" | "main" | "exit" | null {
  const trimmed = input.trim();
  if (trimmed === "/dev on" || trimmed === "/dev") return "enable";
  if (trimmed === "/dev off") return "disable";
  if (trimmed === "/load changes" || trimmed === "/load" || trimmed === "/reload") return "load";
  if (trimmed === "/apply changes" || trimmed === "/apply") return "apply";
  if (trimmed === "/main" || trimmed === "/back") return "main";
  if (trimmed === "/exit") return "exit";
  return null;
}

export function App(props: AppProps = {}) {
  const sharedSession = useMaybeSharedSession();
  if (!sharedSession) {
    return (
      <SharedSessionProvider>
        <AppContent {...props} />
      </SharedSessionProvider>
    );
  }
  return <AppContent {...props} />;
}

function AppContent({ active = true, preserveOnUnmount = false, devActions }: AppProps = {}) {
  const renderer = useRenderer();
  const [providers, setProviders] = useState<LocalProviderSnapshot[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const {
    input,
    setInput,
    mode,
    setMode,
    providerId,
    setProviderId,
    modelSlug,
    setModelSlug,
    themeId,
    setThemeId,
    selectedIndex,
    setSelectedIndex,
    log,
    setLog,
    activeSessionId,
    setActiveSessionId,
    draftWorkingDirectory,
    setDraftWorkingDirectory,
    sidebarOpen,
    setSidebarOpen,
    showToolDetails,
    setShowToolDetails,
    sessions,
    setSessions,
    activeOptionIndex,
    setActiveOptionIndex,
    hiddenPathInput,
    setHiddenPathInput,
    pathCompletionAnchor,
    setPathCompletionAnchor,
    optionSelections,
    setOptionSelections,
    sessionRefs,
    programmaticInputRef,
    persistenceReadyRef,
    persistenceTimerRef,
  } = useSharedSession();

  useEffect(() => {
    let alive = true;
    loadPersistedState().then((state) => {
      if (!alive) return;
      setProviderId(state.settings.providerId);
      setModelSlug(state.settings.modelSlug);
      setThemeId(state.settings.themeId);
      setMode(state.settings.mode);
      setOptionSelections(state.settings.optionSelections);
      setSessions(state.sessions);
      setActiveSessionId(state.activeSessionId);
      setDraftWorkingDirectory(process.cwd());
      setSidebarOpen(state.sidebarOpen);
      persistenceReadyRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;
    const state = {
      schemaVersion: 1,
      activeSessionId,
      sidebarOpen,
      settings: {
        providerId,
        modelSlug,
        mode,
        themeId,
        optionSelections,
      },
      sessions,
    } as const;
    if (persistenceTimerRef.current) {
      clearTimeout(persistenceTimerRef.current);
    }
    persistenceTimerRef.current = setTimeout(() => {
      persistenceTimerRef.current = null;
      void savePersistedState(state);
    }, 250);
  }, [activeSessionId, mode, modelSlug, optionSelections, providerId, sessions, sidebarOpen, themeId]);

  useEffect(() => {
    return () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function copySelection(selection: Selection) {
      const selectedText = selection.getSelectedText();
      if (!selectedText) return;
      const copied = renderer.copyToClipboardOSC52(selectedText);
      setLog(copied ? "Copied selection." : "Selection copied by terminal is not supported here.");
    }

    renderer.on(CliRenderEvents.SELECTION, copySelection);
    return () => {
      renderer.off(CliRenderEvents.SELECTION, copySelection);
    };
  }, [renderer, setLog]);

  useEffect(() => {
    let alive = true;
    loadLocalProviders()
      .then((nextProviders) => {
        if (!alive) return;
        setProviders(nextProviders);
        const firstReady = nextProviders.find((provider) => provider.installed && provider.enabled);
        if (firstReady && !persistenceReadyRef.current) {
          const firstModel = firstReady.models[0];
          setProviderId(firstReady.instanceId);
          setModelSlug(firstModel?.slug ?? modelSlug);
          setOptionSelections(defaultOptionSelections(firstModel));
        }
      })
      .catch((error) => {
        if (alive) setLog(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setLoadingProviders(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (preserveOnUnmount) return;
      for (const session of sessionRefs.current.values()) {
        void session.close();
      }
      sessionRefs.current.clear();
    };
  }, [preserveOnUnmount]);

  useEffect(() => {
    for (const session of sessions) {
      if (!sessionRefs.current.has(session.id)) {
        sessionRefs.current.set(session.id, new CodeSession());
      }
    }
  }, [sessions]);

  const selectedProvider = providers.find((provider) => provider.instanceId === providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.slug === modelSlug);
  const optionDescriptors = selectedModel?.capabilities?.optionDescriptors ?? [];
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeWorkingDirectory = activeSession?.workingDirectory ?? draftWorkingDirectory;
  const currentWorkingDirectory = useMemo(() => normalizeDirectoryForCompare(process.cwd()), []);
  const sidebarSessions = useMemo(
    () =>
      sessions.filter(
        (session) => normalizeDirectoryForCompare(session.workingDirectory) === currentWorkingDirectory,
      ),
    [currentWorkingDirectory, sessions],
  );
  const activeContextMaxTokens = modelContextWindow(
    providerId,
    modelSlug,
    optionSelections,
    selectedModel?.contextWindow,
  );
  const activeContextUsage = deriveContextUsage(
    activeSession,
    activeContextMaxTokens,
    providerId === "codex" || providerId === "opencode",
  );
  const activeContextLabel = formatContextUsage(activeContextUsage, activeContextMaxTokens);
  const activeOptionDescriptor =
    activeOptionIndex === null ? undefined : optionDescriptors[activeOptionIndex];
  const inputPickerKind = detectPickerKind(input);
  const pickerKind =
    activeOptionDescriptor
      ? "options"
      : inputPickerKind === "path" && hiddenPathInput === input
        ? null
        : inputPickerKind;
  const showingPathPreview =
    pickerKind === "path" && pathCompletionAnchor !== null && input !== pathCompletionAnchor;
  const pathReadyToConfirm = inputPickerKind === "path" && hiddenPathInput === input;
  const pathPreviewPrefixLength = showingPathPreview
    ? commonPrefixLength(pathCompletionAnchor, input)
    : 0;
  const activeTheme = useMemo(() => resolveAppTheme(previewThemeId ?? themeId), [previewThemeId, themeId]);

  const options = useMemo(() => {
    switch (pickerKind) {
      case "slash":
        return slashOptions(
          sidebarOpen,
          input,
          devActions ? { enabled: devActions.enabled, viewingMain: devActions.viewingMain } : undefined,
        );
      case "provider":
        return providerOptions(providers);
      case "model":
        return modelOptions(selectedProvider?.models ?? []);
      case "theme":
        return themeOptions(AVAILABLE_THEMES, themeId, input);
      case "mode":
        return modeOptions(mode);
      case "options":
        return activeOptionDescriptor
          ? descriptorOptions(activeOptionDescriptor, optionSelections)
          : optionDescriptors.length > 0
            ? [
                {
                  label: "edit",
                  value: "edit",
                  description: `${optionDescriptors.length} option groups for ${selectedModel?.name ?? modelSlug}`,
                },
              ]
            : [
                {
                  label: "none",
                  value: "none",
                  description: "Selected model has no extra options",
                  disabled: true,
                },
              ];
      case "sessions":
        return sessionOptions(sessions, activeSessionId);
      case "sidebar":
        return [
          {
            label: sidebarOpen ? "close sidebar" : "open sidebar",
            value: "toggle",
            description: sidebarOpen ? "Hide session list" : "Show session list",
          },
        ];
      case "path":
        return pathOptions(
          input,
          activeWorkingDirectory,
          pathCompletionAnchor ?? input,
        );
      default:
        return [];
    }
  }, [
    activeOptionDescriptor,
    activeSessionId,
    activeWorkingDirectory,
    input,
    mode,
    modelSlug,
    optionDescriptors.length,
    optionSelections,
    pickerKind,
    providers,
    selectedModel?.name,
    selectedProvider,
    sessions,
    sidebarOpen,
    themeId,
    pathCompletionAnchor,
    devActions,
  ]);
  const activeThemePreview =
    pickerKind === "theme" && options[selectedIndex]
      ? resolveAppTheme(options[selectedIndex]?.value)
      : activeTheme;

  useEffect(() => {
    if (pickerKind !== "theme") {
      setPreviewThemeId(null);
      return;
    }
    setPreviewThemeId(options[selectedIndex]?.value ?? themeId);
  }, [options, pickerKind, selectedIndex, themeId]);

  useEffect(() => {
    const firstSelectableIndex = options.findIndex((option) => !option.disabled);
    setSelectedIndex(firstSelectableIndex >= 0 ? firstSelectableIndex : 0);
  }, [activeOptionIndex, options.length, pickerKind, providerId]);

  function openFirstModelOption(model: ServerProviderModel | undefined) {
    const descriptors = model?.capabilities?.optionDescriptors ?? [];
    setActiveOptionIndex(descriptors.length > 0 ? 0 : null);
  }

  function updateSession(
    sessionId: string,
    patch: Partial<Omit<LocalSessionState, "id">>,
    touch = true,
  ) {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              ...patch,
              ...(touch ? { lastActiveAt: Date.now() } : {}),
            }
          : session,
      ),
    );
  }

  function appendSessionOutput(sessionId: string, text: string) {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              output: `${session.output}${closeActiveStreamFence(session.activeStreamKind)}${text}`,
              activeStreamKind: "assistant",
              lastActiveAt: Date.now(),
            }
          : session,
      ),
    );
  }

  function appendSessionStream(sessionId: string, stream: SessionStreamKind, text: string) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;
        const heading = streamHeading(stream);
        const fenceLanguage = streamFenceLanguage(stream);
        const closingFence = session.activeStreamKind !== stream
          ? closeActiveStreamFence(session.activeStreamKind)
          : "";
        const prefix =
          heading && session.activeStreamKind !== stream
            ? `${closingFence}${session.output.endsWith("\n") ? "\n" : "\n\n"}### ${heading}\n\n${fenceLanguage ? `\`\`\`${fenceLanguage}\n` : ""}`
            : "";
        return {
          ...session,
          output: `${session.output}${prefix}${formatStreamDelta(text)}`,
          activeStreamKind: stream,
          lastActiveAt: Date.now(),
        };
      }),
    );
  }

  function appendSessionWork(sessionId: string, event: Extract<SessionEvent, { type: "work" }>) {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;
        const existingEntry = event.id
          ? Object.entries(session.workBlocks ?? {}).find(([, block]) => block.eventId === event.id)
          : undefined;
        const blockId = existingEntry?.[0] ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const codeBlockId = `${blockId}-code`;
        const previousBlock = existingEntry?.[1];
        const hadCodeBlock = Boolean(session.codeBlocks?.[codeBlockId]);
        const shouldAttachCodeBlock = Boolean(event.code);
        const nextBlock = {
          ...(previousBlock ?? {}),
          ...(event.id ? { eventId: event.id } : {}),
          label: event.label,
          ...(event.detail ? { detail: event.detail } : {}),
          ...(event.status ? { status: event.status } : {}),
          ...(event.code ? { code: event.code } : {}),
        };
        return {
          ...session,
          output:
            session.output +
            (!existingEntry ? `${closeActiveStreamFence(session.activeStreamKind)}${workBlockMarker(blockId)}` : "") +
            (shouldAttachCodeBlock && !hadCodeBlock ? codeBlockMarker(codeBlockId) : ""),
          codeBlocks:
            shouldAttachCodeBlock
              ? {
                  ...(session.codeBlocks ?? {}),
                  [codeBlockId]: event.code!,
                }
              : session.codeBlocks,
          workBlocks: {
            ...(session.workBlocks ?? {}),
            [blockId]: nextBlock,
          },
          activeStreamKind: existingEntry ? session.activeStreamKind : undefined,
          lastActiveAt: Date.now(),
        };
      }),
    );
  }

  function createChatId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function chatTitle(prompt: string): string {
    return prompt.trim().replace(/\s+/gu, " ").slice(0, 48) || "Untitled chat";
  }

  function createSession() {
    setActiveSessionId("");
    setInput("");
    setActiveOptionIndex(null);
    setHiddenPathInput(null);
    setPathCompletionAnchor(null);
  }

  function deleteSession(sessionId: string) {
    void sessionRefs.current.get(sessionId)?.close();
    sessionRefs.current.delete(sessionId);

    setSessions((current) => {
      const deletedIndex = current.findIndex((session) => session.id === sessionId);
      if (deletedIndex < 0) return current;

      const nextSessions = current.filter((session) => session.id !== sessionId);
      if (sessionId === activeSessionId) {
        const nextActiveSession =
          nextSessions[Math.min(deletedIndex, nextSessions.length - 1)] ?? nextSessions[0];
        setActiveSessionId(nextActiveSession?.id ?? "");
      }
      setSelectedIndex((currentIndex) => Math.max(0, Math.min(currentIndex, nextSessions.length - 1)));
      return nextSessions;
    });
    setLog("Session deleted");
  }

  function applyOption(option: PickerOption | undefined) {
    if (!option || option.disabled) return;
    if (pickerKind === "slash") {
      if (option.value === "options") {
        openFirstModelOption(selectedModel);
        setInput("");
        return;
      }
      if (option.value === "theme") {
        setInput("/theme ");
        return;
      }
      if (option.value === "sessions") {
        setInput("/sessions ");
        return;
      }
      if (option.value === "new") {
        createSession();
        return;
      }
      if (option.value === "path") {
        setHiddenPathInput(null);
        setPathCompletionAnchor("/path ~/");
        programmaticInputRef.current = true;
        setInput("/path ~/");
        return;
      }
      if (option.value === "compact") {
        setInput("");
        void compactActiveSession();
        return;
      }
      if (option.value === "sidebar") {
        setSidebarOpen((current) => !current);
        setInput("");
        return;
      }
      if (option.value === "load-changes") {
        setInput("");
        devActions?.onLoadChanges();
        return;
      }
      if (option.value === "apply-changes") {
        setInput("");
        devActions?.onApplyChanges();
        return;
      }
      if (option.value === "main-process") {
        setInput("");
        devActions?.onMain();
        return;
      }
      if (option.value === "exit") {
        setInput("");
        devActions?.onExit();
        return;
      }
      if (option.value === "dev-on") {
        setInput("");
        devActions?.onEnableDevMode();
        return;
      }
      if (option.value === "dev-off") {
        setInput("");
        devActions?.onDisableDevMode();
        return;
      }
      setInput(`/${option.value} `);
      return;
    }
    if (pickerKind === "options" && activeOptionDescriptor) {
      if (!activeOptionDescriptor) {
        setInput("");
        setActiveOptionIndex(null);
        return;
      }
      const value =
        activeOptionDescriptor.type === "boolean" ? option.value === "true" : option.value;
      setOptionSelections((current) => ({
        ...current,
        [activeOptionDescriptor.id]: value,
      }));
      const nextIndex = (activeOptionIndex ?? 0) + 1;
      if (nextIndex < optionDescriptors.length) {
        setActiveOptionIndex(nextIndex);
      } else {
        setActiveOptionIndex(null);
      }
      setInput("");
      return;
    }
    if (pickerKind === "provider") {
      const provider = providers.find((candidate) => candidate.instanceId === option.value);
      if (!provider) return;
      const nextModel = provider.models[0];
      setProviderId(provider.instanceId);
      setModelSlug(nextModel?.slug ?? "");
      setOptionSelections(defaultOptionSelections(nextModel));
      setActiveOptionIndex(null);
      setLog(provider.enabled ? "" : provider.message ?? `${provider.displayName} is not configured.`);
      setInput("");
      return;
    }
    if (pickerKind === "model") {
      const nextModel = selectedProvider?.models.find((model) => model.slug === option.value);
      setModelSlug(option.value);
      setOptionSelections(defaultOptionSelections(nextModel));
      setInput("");
      openFirstModelOption(nextModel);
      return;
    }
    if (pickerKind === "mode") {
      setMode(option.value as TuiMode);
      setInput("");
      setActiveOptionIndex(null);
      return;
    }
    if (pickerKind === "theme") {
      setThemeId(option.value);
      setPreviewThemeId(null);
      setInput("");
      setActiveOptionIndex(null);
      setLog(`Theme: ${option.label}`);
      return;
    }
    if (pickerKind === "sessions") {
      setActiveSessionId(option.value);
      setInput("");
      setActiveOptionIndex(null);
      return;
    }
    if (pickerKind === "sidebar") {
      setSidebarOpen((current) => !current);
      setInput("");
      return;
    }
    if (pickerKind === "path") {
      if (option.value === "__use__") {
        setHiddenPathInput(input);
        setPathCompletionAnchor(null);
        return;
      }
      const nextInput = pathInputForOption(option.value);
      programmaticInputRef.current = true;
      setInput(nextInput);
      setHiddenPathInput(nextInput);
      setPathCompletionAnchor(null);
      return;
    }
    if (pickerKind === "options") {
      openFirstModelOption(selectedModel);
      setInput("");
      return;
    }
  }

  function handleSessionEvent(sessionId: string, event: SessionEvent) {
    if (event.type === "delta") {
      appendSessionOutput(sessionId, event.text);
      return;
    }
    if (event.type === "stream") {
      appendSessionStream(sessionId, event.stream, event.text);
      return;
    }
    if (event.type === "work") {
      appendSessionWork(sessionId, event);
      return;
    }
    if (event.type === "status") {
      updateSession(sessionId, { status: event.status });
      setLog(event.message ?? "");
      return;
    }
    if (event.type === "usage") {
      updateSession(sessionId, { tokenUsage: event.usage }, false);
      return;
    }
    if (event.type === "compacted") {
      appendSessionOutput(
        sessionId,
        `\n[context ${event.automatic === false ? "compacted" : "auto-compacted"}${event.overflow ? " after overflow" : ""}]\n`,
      );
      updateSession(
        sessionId,
        {
          tokenUsage: {
            usedTokens: 0,
            ...(activeContextMaxTokens !== null ? { maxTokens: activeContextMaxTokens } : {}),
            compactsAutomatically: event.automatic !== false,
          },
        },
        false,
      );
      setLog("Context compacted");
      return;
    }
    updateSession(sessionId, { status: "error" });
    setLog(event.message);
  }

  async function submitPrompt(prompt: string) {
    if (!selectedProvider) return;
    if (!selectedProvider.enabled) {
      setLog(selectedProvider.message ?? `${selectedProvider.displayName} is not configured.`);
      return;
    }
    const existingSession = activeSession;
    const sessionId = existingSession?.id ?? createChatId();
    const workingDirectory = existingSession?.workingDirectory ?? draftWorkingDirectory;
    const harness = sessionRefs.current.get(sessionId) ?? new CodeSession();
    sessionRefs.current.set(sessionId, harness);
    setActiveSessionId(sessionId);
    setSessions((current) => {
      if (existingSession) {
        return current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: session.output ? session.title : chatTitle(prompt),
                output: `${session.output}${session.output ? "\n\n" : ""}You: ${escapeMarkdownInline(prompt)}\n\n`,
                activeStreamKind: undefined,
                lastActiveAt: Date.now(),
              }
            : session,
        );
      }

      return [
        ...current,
        {
          id: sessionId,
          title: chatTitle(prompt),
          status: "idle",
          output: `You: ${escapeMarkdownInline(prompt)}\n\n`,
          activeStreamKind: undefined,
          lastActiveAt: Date.now(),
          workingDirectory,
        },
      ];
    });
    setLog("");
    try {
      await harness.submitTurn({
        provider: selectedProvider.driver,
        apiProviderId: selectedProvider.apiProviderId,
        prompt,
        model: modelSlug,
        mode,
        options: optionSelections,
        cwd: workingDirectory,
        onEvent: (event) => handleSessionEvent(sessionId, event),
      });
    } catch (error) {
      updateSession(sessionId, { status: "error" });
      setLog(error instanceof Error ? error.message : String(error));
    }
  }

  async function compactActiveSession() {
    const sessionId = activeSessionId;
    const harness = sessionRefs.current.get(sessionId);
    if (!activeSession || !harness || !selectedProvider) {
      setLog("No chat to compact yet");
      return;
    }
    const workingDirectory = activeSession.workingDirectory;
    setLog("");
    try {
      await harness.compactSession({
        provider: selectedProvider.driver,
        apiProviderId: selectedProvider.apiProviderId,
        model: modelSlug,
        cwd: workingDirectory,
        onEvent: (event) => handleSessionEvent(sessionId, event),
      });
    } catch (error) {
      updateSession(sessionId, { status: "error" });
      setLog(error instanceof Error ? error.message : String(error));
    }
  }

  async function setActiveSessionPath(pathInput: string) {
    if (!pathInput) {
      setLog("Type /path /absolute/or/relative/path");
      return;
    }

    const sessionId = activeSessionId;
    const currentPath = activeWorkingDirectory;
    try {
      const nextPath = resolveWorkingDirectory(pathInput, currentPath);
      if (activeSession) {
        await sessionRefs.current.get(sessionId)?.close();
        sessionRefs.current.set(sessionId, new CodeSession());
        updateSession(sessionId, { workingDirectory: nextPath });
      } else {
        setDraftWorkingDirectory(nextPath);
      }
      setLog("");
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    }
  }

  function previewPathOption(option: PickerOption | undefined) {
    if (!option || option.value === "__use__") return;
    setHiddenPathInput(null);
    setPathCompletionAnchor((current) => current ?? input);
    programmaticInputRef.current = true;
    setInput(pathInputForOption(option.value));
  }

  useKeyboard((key) => {
    if (!active) return;

    if (key.ctrl && key.name === "t") {
      setShowToolDetails((current) => {
        const next = !current;
        setLog(next ? "Tool details expanded" : "Tool details collapsed");
        return next;
      });
      return;
    }

    if (key.name === "escape") {
      if (pickerKind) {
        setInput("");
        setActiveOptionIndex(null);
        setHiddenPathInput(null);
        setPathCompletionAnchor(null);
        return;
      }
      renderer.destroy();
    }
    if (!pickerKind || options.length === 0) return;
    if (pickerKind === "sessions" && key.name === "delete") {
      const selectedSession = options[selectedIndex];
      if (selectedSession) deleteSession(selectedSession.value);
      return;
    }
    if (key.name === "up") {
      const nextIndex = Math.max(0, selectedIndex - 1);
      setSelectedIndex(nextIndex);
      if (pickerKind === "path") previewPathOption(options[nextIndex]);
    }
    if (key.name === "down") {
      const nextIndex = Math.min(options.length - 1, selectedIndex + 1);
      setSelectedIndex(nextIndex);
      if (pickerKind === "path") previewPathOption(options[nextIndex]);
    }
    if (key.name === "tab") {
      if (pickerKind === "path") {
        const nextIndex = (selectedIndex + 1) % options.length;
        const nextOption = options[nextIndex];
        setSelectedIndex(nextIndex);
        previewPathOption(nextOption);
        return;
      }
      setSelectedIndex((current) => (current + 1) % options.length);
    }
    if (key.name === "return") {
      applyOption(options[selectedIndex]);
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      padding={PANEL_GAP}
      gap={PANEL_GAP}
      backgroundColor={activeTheme.appBackground}
    >
      <box flexDirection="row" flexGrow={1}>
        {sidebarOpen ? (
          <SessionSidebar activeSessionId={activeSessionId} sessions={sidebarSessions} theme={activeTheme} />
        ) : null}
        {sidebarOpen ? <box width={PANEL_GAP} /> : null}

        <box flexDirection="column" flexGrow={1} backgroundColor={activeTheme.panelBackground}>
          <box flexGrow={1} flexDirection="column">
            {pickerKind ? (
              <PickerPanel
                activeOptionDescriptor={activeOptionDescriptor}
                options={options}
                pickerKind={pickerKind}
                selectedIndex={selectedIndex}
                theme={activeTheme}
                themePreview={activeThemePreview}
              />
            ) : (
              <box flexGrow={1} padding={PANEL_PADDING} backgroundColor={activeTheme.panelBackground}>
                <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
                  {renderSessionOutput(activeSession, activeTheme, { showWorkDetails: showToolDetails })}
                </scrollbox>
              </box>
            )}
          </box>

          <box padding={PANEL_PADDING} height={3} backgroundColor={activeTheme.inputBackground}>
            {showingPathPreview ? (
              <box flexDirection="row">
                <text fg={activeTheme.textStrong}>{input.slice(0, pathPreviewPrefixLength)}</text>
                <text fg={activeTheme.selectionForeground} bg={activeTheme.selectionBackground}>
                  {input.slice(pathPreviewPrefixLength)}
                </text>
              </box>
            ) : (
              <box flexDirection="row" gap={PANEL_GAP}>
                <input
                  focused={active}
                  flexGrow={1}
                  backgroundColor={activeTheme.inputBackground}
                  focusedBackgroundColor={activeTheme.inputBackground}
                  textColor={activeTheme.text}
                  focusedTextColor={activeTheme.textStrong}
                  placeholderColor={activeTheme.textDim}
                  placeholder="Ask Mucode, or type / for commands"
                  value={input}
                  onInput={(value) => {
                    setInput(value);
                    if (programmaticInputRef.current) {
                      programmaticInputRef.current = false;
                      return;
                    }
                    setHiddenPathInput(null);
                    setPathCompletionAnchor(detectPickerKind(value) === "path" ? value : null);
                  }}
                  onSubmit={() => {
                    const trimmed = input.trim();
                    if (!trimmed) return;
                    if (isCompactCommand(trimmed)) {
                      setInput("");
                      void compactActiveSession();
                      return;
                    }
                    if (/^\/new(?:\s*)$/u.test(trimmed)) {
                      createSession();
                      return;
                    }
                    const devCommand = devActions ? devCommandKind(trimmed) : null;
                    if (devCommand) {
                      setInput("");
                      if (devCommand === "enable") devActions?.onEnableDevMode();
                      if (devCommand === "disable") devActions?.onDisableDevMode();
                      if (devCommand === "load") devActions?.onLoadChanges();
                      if (devCommand === "apply") devActions?.onApplyChanges();
                      if (devCommand === "main") devActions?.onMain();
                      if (devCommand === "exit") devActions?.onExit();
                      return;
                    }
                    if (pickerKind) {
                      return;
                    }
                    const pathInput = parsePathCommand(trimmed);
                    if (pathInput !== null) {
                      setInput("");
                      setHiddenPathInput(null);
                      setPathCompletionAnchor(null);
                      void setActiveSessionPath(pathInput);
                      return;
                    }
                    setInput("");
                    void submitPrompt(trimmed);
                  }}
                />
              </box>
            )}
          </box>

          <StatusBar
            activeContextLabel={activeContextLabel}
            activeContextUsage={activeContextUsage}
            log={log}
            mode={mode}
            modelSlug={modelSlug}
            optionSelections={optionSelections}
            pathReadyToConfirm={pathReadyToConfirm}
            providerId={providerId}
            selectedModel={selectedModel}
            selectedProvider={selectedProvider}
            status={activeSession?.status ?? "idle"}
            theme={activeTheme}
            workingDirectory={activeWorkingDirectory}
          />
          <box height={PANEL_GAP} />
        </box>
      </box>
    </box>
  );
}
