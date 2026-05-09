import {
  createContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { CodeSession } from "./session.ts";
import { createDefaultPersistedState } from "./storage.ts";
import type { LocalSessionState, OptionSelectionValue } from "./types.ts";
import type { TuiMode } from "./provider.ts";

export interface SharedSessionContextValue {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  mode: TuiMode;
  setMode: Dispatch<SetStateAction<TuiMode>>;
  providerId: string;
  setProviderId: Dispatch<SetStateAction<string>>;
  modelSlug: string;
  setModelSlug: Dispatch<SetStateAction<string>>;
  themeId: string;
  setThemeId: Dispatch<SetStateAction<string>>;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  log: string;
  setLog: Dispatch<SetStateAction<string>>;
  activeSessionId: string;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  draftWorkingDirectory: string;
  setDraftWorkingDirectory: Dispatch<SetStateAction<string>>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  showToolDetails: boolean;
  setShowToolDetails: Dispatch<SetStateAction<boolean>>;
  sessions: LocalSessionState[];
  setSessions: Dispatch<SetStateAction<LocalSessionState[]>>;
  activeOptionIndex: number | null;
  setActiveOptionIndex: Dispatch<SetStateAction<number | null>>;
  hiddenPathInput: string | null;
  setHiddenPathInput: Dispatch<SetStateAction<string | null>>;
  pathCompletionAnchor: string | null;
  setPathCompletionAnchor: Dispatch<SetStateAction<string | null>>;
  optionSelections: Record<string, OptionSelectionValue>;
  setOptionSelections: Dispatch<SetStateAction<Record<string, OptionSelectionValue>>>;
  sessionRefs: MutableRefObject<Map<string, CodeSession>>;
  programmaticInputRef: MutableRefObject<boolean>;
  persistenceReadyRef: MutableRefObject<boolean>;
  persistenceTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

const SharedSessionContext = createContext<SharedSessionContextValue | null>(null);

export function SharedSessionProvider({ children }: { children: ReactNode }) {
  const defaultState = useMemo(() => createDefaultPersistedState(), []);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<TuiMode>(defaultState.settings.mode);
  const [providerId, setProviderId] = useState<string>(defaultState.settings.providerId);
  const [modelSlug, setModelSlug] = useState(defaultState.settings.modelSlug);
  const [themeId, setThemeId] = useState(defaultState.settings.themeId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [log, setLog] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(defaultState.activeSessionId);
  const [draftWorkingDirectory, setDraftWorkingDirectory] = useState(process.cwd());
  const [sidebarOpen, setSidebarOpen] = useState(defaultState.sidebarOpen);
  const [showToolDetails, setShowToolDetails] = useState(false);
  const [sessions, setSessions] = useState<LocalSessionState[]>(defaultState.sessions);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(null);
  const [hiddenPathInput, setHiddenPathInput] = useState<string | null>(null);
  const [pathCompletionAnchor, setPathCompletionAnchor] = useState<string | null>(null);
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelectionValue>>(
    defaultState.settings.optionSelections,
  );
  const sessionRefs = useRef(new Map<string, CodeSession>());
  const programmaticInputRef = useRef(false);
  const persistenceReadyRef = useRef(false);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = useMemo<SharedSessionContextValue>(
    () => ({
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
    }),
    [
      activeOptionIndex,
      activeSessionId,
      draftWorkingDirectory,
      hiddenPathInput,
      input,
      log,
      mode,
      modelSlug,
      themeId,
      optionSelections,
      pathCompletionAnchor,
      providerId,
      selectedIndex,
      sessions,
      showToolDetails,
      sidebarOpen,
    ],
  );

  return <SharedSessionContext.Provider value={value}>{children}</SharedSessionContext.Provider>;
}

export function useMaybeSharedSession(): SharedSessionContextValue | null {
  return useContext(SharedSessionContext);
}

export function useSharedSession(): SharedSessionContextValue {
  const context = useContext(SharedSessionContext);
  if (!context) {
    throw new Error("useSharedSession must be used inside SharedSessionProvider.");
  }
  return context;
}
