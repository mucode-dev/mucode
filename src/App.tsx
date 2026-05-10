import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { createDefaultPersistedState, loadPersistedState, savePersistedState } from "./storage.ts";
import type { LocalSessionState, OptionSelectionValue, PickerOption } from "./types.ts";
import { deriveContextUsage, formatContextUsage, modelContextWindow } from "./ui/context.ts";
import { defaultOptionSelections, descriptorOptions, detectPickerKind, modeOptions, modelOptions, providerOptions, sessionOptions, slashOptions } from "./ui/options.ts";
import { commonPrefixLength, parsePathCommand, pathInputForOption, pathOptions, resolveWorkingDirectory } from "./ui/path.ts";
import { renderSessionOutput } from "./ui/sessionOutput.tsx";
import { closeActiveStreamFence, escapeMarkdownInline, formatStreamDelta, streamFenceLanguage, streamHeading, workBlockMarker } from "./ui/transcript.ts";

function isCompactCommand(input: string): boolean {
  return /^\/compact(?:\s*)$/u.test(input.trim());
}

export function App() {
  const defaultState = useMemo(() => createDefaultPersistedState(), []);
  const renderer = useRenderer();
  const [providers, setProviders] = useState<LocalProviderSnapshot[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<TuiMode>(defaultState.settings.mode);
  const [providerId, setProviderId] = useState(defaultState.settings.providerId);
  const [modelSlug, setModelSlug] = useState(defaultState.settings.modelSlug);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [log, setLog] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(defaultState.activeSessionId);
  const [sidebarOpen, setSidebarOpen] = useState(defaultState.sidebarOpen);
  const [sessions, setSessions] = useState<LocalSessionState[]>(defaultState.sessions);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(null);
  const [hiddenPathInput, setHiddenPathInput] = useState<string | null>(null);
  const [pathCompletionAnchor, setPathCompletionAnchor] = useState<string | null>(null);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelectionValue>>(
    defaultState.settings.optionSelections,
  );
  const sessionRefs = useRef(new Map<string, CodeSession>());
  const programmaticInputRef = useRef(false);
  const nextSessionNumberRef = useRef(2);
  const persistenceReadyRef = useRef(false);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadPersistedState().then((state) => {
      if (!alive) return;
      setProviderId(state.settings.providerId);
      setModelSlug(state.settings.modelSlug);
      setMode(state.settings.mode);
      setOptionSelections(state.settings.optionSelections);
      setSessions(state.sessions);
      setActiveSessionId(state.activeSessionId);
      setSidebarOpen(state.sidebarOpen);
      const highestSessionNumber = state.sessions.reduce((highest, session) => {
        const match = /^session-(\d+)$/u.exec(session.id);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 1);
      nextSessionNumberRef.current = highestSessionNumber + 1;
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
  }, [activeSessionId, mode, modelSlug, optionSelections, providerId, sessions, sidebarOpen]);

  useEffect(() => {
    return () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadLocalProviders()
      .then((nextProviders) => {
        if (!alive) return;
        setProviders(nextProviders);
        const firstReady = nextProviders.find((provider) => provider.installed);
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
      for (const session of sessionRefs.current.values()) {
        void session.close();
      }
      sessionRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    for (const session of sessions) {
      if (!sessionRefs.current.has(session.id)) {
        sessionRefs.current.set(session.id, new CodeSessionHarness());
      }
    }
  }, [sessions]);

  const selectedProvider = providers.find((provider) => provider.instanceId === providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.slug === modelSlug);
  const optionDescriptors = selectedModel?.capabilities?.optionDescriptors ?? [];
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const activeContextMaxTokens = modelContextWindow(providerId, modelSlug, optionSelections);
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

  const options = useMemo(() => {
    switch (pickerKind) {
      case "slash":
        return slashOptions(sidebarOpen, input);
      case "provider":
        return providerOptions(providers);
      case "model":
        return modelOptions(selectedProvider?.models ?? []);
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
          activeSession?.workingDirectory ?? process.cwd(),
          pathCompletionAnchor ?? input,
        );
      default:
        return [];
    }
  }, [
    activeOptionDescriptor,
    activeSessionId,
    activeSession?.workingDirectory,
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
    pathCompletionAnchor,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeOptionIndex, pickerKind, providerId]);

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
        const blockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return {
          ...session,
          output: `${session.output}${closeActiveStreamFence(session.activeStreamKind)}${workBlockMarker(blockId)}`,
          workBlocks: {
            ...(session.workBlocks ?? {}),
            [blockId]: {
              label: event.label,
              ...(event.detail ? { detail: event.detail } : {}),
              ...(event.status ? { status: event.status } : {}),
              ...(event.code ? { code: event.code } : {}),
            },
          },
          activeStreamKind: undefined,
          lastActiveAt: Date.now(),
        };
      }),
    );
  }

  function isReusableEmptySession(session: LocalSessionState | undefined): boolean {
    return Boolean(session && session.status === "idle" && session.output.trim() === "");
  }

  function createSession() {
    const reusableSession = isReusableEmptySession(activeSession) ? activeSession : undefined;
    if (reusableSession) {
      setActiveSessionId(reusableSession.id);
      setInput("");
      setActiveOptionIndex(null);
      setHiddenPathInput(null);
      setPathCompletionAnchor(null);
      return;
    }

    const nextNumber = nextSessionNumberRef.current++;
    const id = `session-${nextNumber}`;
    sessionRefs.current.set(id, new CodeSessionHarness());
    setSessions((current) => [
      ...current,
      {
        id,
        title: `Session ${nextNumber}`,
        status: "idle",
        output: "",
        lastActiveAt: Date.now(),
        workingDirectory: process.cwd(),
      },
    ]);
    setActiveSessionId(id);
    setInput("");
    setActiveOptionIndex(null);
  }

  function deleteSession(sessionId: string) {
    void sessionRefs.current.get(sessionId)?.close();
    sessionRefs.current.delete(sessionId);

    setSessions((current) => {
      const deletedIndex = current.findIndex((session) => session.id === sessionId);
      if (deletedIndex < 0) return current;

      if (current.length === 1) {
        const nextNumber = nextSessionNumberRef.current++;
        const replacementId = `session-${nextNumber}`;
        sessionRefs.current.set(replacementId, new CodeSessionHarness());
        setActiveSessionId(replacementId);
        setSelectedIndex(0);
        return [
          {
            id: replacementId,
            title: `Session ${nextNumber}`,
            status: "idle",
            output: "",
            lastActiveAt: Date.now(),
            workingDirectory: process.cwd(),
          },
        ];
      }

      const nextSessions = current.filter((session) => session.id !== sessionId);
      if (sessionId === activeSessionId) {
        const nextActiveSession =
          nextSessions[Math.min(deletedIndex, nextSessions.length - 1)] ?? nextSessions[0];
        if (nextActiveSession) setActiveSessionId(nextActiveSession.id);
      }
      setSelectedIndex((currentIndex) => Math.min(currentIndex, nextSessions.length - 1));
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
    const sessionId = activeSessionId;
    const harness = sessionRefs.current.get(sessionId);
    if (!harness || !selectedProvider) return;
    const workingDirectory = activeSession?.workingDirectory ?? process.cwd();
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: session.output ? session.title : prompt.slice(0, 32) || session.title,
              output: `${session.output}${session.output ? "\n\n" : ""}You: ${escapeMarkdownInline(prompt)}\n\n`,
              activeStreamKind: undefined,
              lastActiveAt: Date.now(),
            }
          : session,
      ),
    );
    setLog("");
    try {
      await harness.submitTurn({
        provider: selectedProvider.driver,
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
    if (!harness || !selectedProvider) return;
    const workingDirectory = activeSession?.workingDirectory ?? process.cwd();
    setLog("");
    try {
      await harness.compactSession({
        provider: selectedProvider.driver,
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
    const currentPath = activeSession?.workingDirectory ?? process.cwd();
    try {
      const nextPath = resolveWorkingDirectory(pathInput, currentPath);
      await sessionRefs.current.get(sessionId)?.close();
      sessionRefs.current.set(sessionId, new CodeSessionHarness());
      updateSession(sessionId, { workingDirectory: nextPath });
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
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#A7F3D0">Code TUI</text>
        <text fg="#94A3B8">
          {loadingProviders ? "loading providers" : `${providers.filter((p) => p.installed).length}/${providers.length} providers`}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {sidebarOpen ? <SessionSidebar activeSessionId={activeSessionId} sessions={sessions} /> : null}

        <box flexDirection="column" flexGrow={1} gap={1}>
          <box flexGrow={1} flexDirection="column">
            {pickerKind ? (
              <PickerPanel
                activeOptionDescriptor={activeOptionDescriptor}
                options={options}
                pickerKind={pickerKind}
                selectedIndex={selectedIndex}
              />
            ) : (
              <box flexGrow={1} border padding={1}>
                <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
                  {renderSessionOutput(activeSession)}
                </scrollbox>
              </box>
            )}
          </box>

          <box border padding={1} height={3}>
            {showingPathPreview ? (
              <box flexDirection="row">
                <text fg="#F8FAFC">{input.slice(0, pathPreviewPrefixLength)}</text>
                <text fg="#0F172A" bg="#FDE68A">
                  {input.slice(pathPreviewPrefixLength)}
                </text>
              </box>
            ) : (
              <box flexDirection="row" gap={2}>
                <input
                  focused
                  flexGrow={1}
                  placeholder="Ask Code, or type / for commands"
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
            workingDirectory={activeSession?.workingDirectory ?? process.cwd()}
          />
        </box>
      </box>
    </box>
  );
}
