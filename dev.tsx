import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState, useEffect } from "react";
import { Box, Input } from "@opentui/core";

const isDev = process.env.NODE_ENV === "development";

async function loadApp() {
  return await import("./src/App.tsx");
}

interface DevOverlayProps {
  onReload: () => void;
  onExit: () => void;
}

function DevOverlay({ onReload, onExit }: DevOverlayProps) {
  const [cmd, setCmd] = useState("");
  const [AppComponent, setAppComponent] = useState<React.ComponentType | null>(null);
  
  useEffect(() => {
    loadApp().then((mod) => setAppComponent(() => mod.App));
  }, []);
  
  return (
    <box flexDirection="column" flex={1}>
      <box flex={1}>
        {AppComponent ? <AppComponent /> : <text>Loading...</text>}
      </box>
      <input
        placeholder="Type /reload to reload, /exit to quit"
        value={cmd}
        onChange={setCmd}
        onSubmit={(value: string) => {
          if (value === "/reload") {
            onReload();
            setCmd("");
          } else if (value === "/exit") {
            onExit();
          }
        }}
        flex={0}
      />
    </box>
  );
}

async function main() {
  if (!isDev) {
    console.log("Use 'npm run dev' for development mode with /reload support");
    process.exit(1);
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  console.log("🔧 Dev mode - type /reload to reload app, /exit to quit\n");
  
  let reloadCount = 0;
  let root: ReturnType<typeof createRoot> | null = null;
  
  function render() {
    root = createRoot(renderer);
    root.render(<DevOverlay onReload={handleReload} onExit={handleExit} />);
  }
  
  function handleReload() {
    console.clear();
    console.log(`♻️ Reloading... (${++reloadCount})`);
    render();
  }
  
  function handleExit() {
    renderer.destroy();
  }
  
  render();
}

main();