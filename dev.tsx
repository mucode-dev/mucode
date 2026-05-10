import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { pathToFileURL } from "node:url";
import { Component, type ErrorInfo, type ReactElement, type ReactNode, useMemo, useState } from "react";

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

type AppComponent = (props: AppProps) => ReactElement;

interface AppInstance {
  id: string;
  label: string;
  component: AppComponent;
  loadedAt: number;
}

interface DevOverlayProps {
  initialApp: AppComponent;
  onExit: () => void;
}

interface InstanceBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

class InstanceBoundary extends Component<
  InstanceBoundaryProps,
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  override render() {
    if (this.state.error) {
      return (
        <box padding={1}>
          <text fg="#FCA5A5">{this.state.error.message}</text>
        </box>
      );
    }
    return this.props.children;
  }
}

async function loadAppInstance(version: number): Promise<AppComponent> {
  const appUrl = `${pathToFileURL(`${process.cwd()}/src/App.tsx`).href}?dev=${version}`;
  const mod = await import(appUrl);
  return mod.App as AppComponent;
}

function DevOverlay({ initialApp, onExit }: DevOverlayProps) {
  const [devMode, setDevMode] = useState(false);
  const [log, setLog] = useState("dev mode off");
  const [loadCount, setLoadCount] = useState(0);
  const [mainInstanceId, setMainInstanceId] = useState("main");
  const [activeInstanceId, setActiveInstanceId] = useState("main");
  const [instances, setInstances] = useState<AppInstance[]>([
    {
      id: "main",
      label: "main",
      component: initialApp,
      loadedAt: Date.now(),
    },
  ]);

  const activeInstance = instances.find((instance) => instance.id === activeInstanceId) ?? instances[0];
  const viewingMain = !devMode || activeInstance?.id === mainInstanceId;
  const devHint = useMemo(
    () => {
      if (!devMode) return "/dev on";
      return viewingMain
        ? "/load changes  /dev off"
        : "/apply changes  /main  /load changes  /dev off";
    },
    [devMode, viewingMain],
  );

  function enableDevMode() {
    if (!activeInstance) return;
    setDevMode(true);
    setMainInstanceId(activeInstance.id);
    setLog(`${activeInstance.label} is development instance`);
  }

  function disableDevMode() {
    setDevMode(false);
    setActiveInstanceId(mainInstanceId);
    setLog("dev mode off");
  }

  async function loadChanges() {
    if (!devMode) {
      setLog("Turn on dev mode first");
      return;
    }
    const nextLoadCount = loadCount + 1;
    setLoadCount(nextLoadCount);
    setLog("loading changes...");
    try {
      const component = await loadAppInstance(nextLoadCount);
      const id = `candidate-${Date.now()}`;
      setInstances((current) => [
        ...current,
        {
          id,
          label: `loaded ${nextLoadCount}`,
          component,
          loadedAt: Date.now(),
        },
      ]);
      setActiveInstanceId(id);
      setLog("loaded changes");
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    }
  }

  function applyChanges() {
    if (!devMode) {
      setLog("Turn on dev mode first");
      return;
    }
    if (!activeInstance || activeInstance.id === mainInstanceId) {
      setLog("No loaded changes to apply");
      return;
    }
    setMainInstanceId(activeInstance.id);
    setLog(`${activeInstance.label} is now main process`);
  }

  function showMain() {
    if (!devMode) {
      setLog("dev mode is off");
      return;
    }
    setActiveInstanceId(mainInstanceId);
    setLog("development instance");
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} flexDirection="column">
        {instances.map((instance) => {
          const AppComponent = instance.component;
          const active = instance.id === activeInstance?.id;
          const devActions: DevActions = {
            enabled: devMode,
            viewingMain,
            onEnableDevMode: enableDevMode,
            onDisableDevMode: disableDevMode,
            onLoadChanges: () => void loadChanges(),
            onApplyChanges: applyChanges,
            onMain: showMain,
            onExit,
          };
          return (
            <box
              key={instance.id}
              flexDirection="column"
              flexGrow={active ? 1 : 0}
              height={active ? undefined : 0}
              visible={active}
            >
              <InstanceBoundary
                onError={(error) => {
                  setLog(`${instance.label} failed: ${error.message}`);
                }}
              >
                <AppComponent active={active} preserveOnUnmount devActions={active ? devActions : undefined} />
              </InstanceBoundary>
            </box>
          );
        })}
      </box>
      {devMode ? (
        <box height={3} padding={1} backgroundColor="#020617" flexDirection="row" gap={2}>
          <text fg={viewingMain ? "#A7F3D0" : "#FDE68A"}>
            {viewingMain ? "development" : `preview ${activeInstance?.label ?? ""}`}
          </text>
          <text fg="#94A3B8">{devHint}</text>
          {!viewingMain ? <text fg="#FDE68A">apply changes</text> : null}
          <text fg="#94A3B8">{log}</text>
        </box>
      ) : null}
    </box>
  );
}

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const initialApp = await loadAppInstance(0);
  const root = createRoot(renderer);

  root.render(<DevOverlay initialApp={initialApp} onExit={() => renderer.destroy()} />);
}

main();
