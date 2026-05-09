import type { LocalSessionState } from "../types.ts";
import { formatSessionRow, SESSION_SIDEBAR_WIDTH } from "../ui/sessionList.ts";
import { type AppTheme, PANEL_PADDING } from "../ui/theme.ts";

interface SessionSidebarProps {
  activeSessionId: string;
  sessions: LocalSessionState[];
  theme: AppTheme;
}

export function SessionSidebar({ activeSessionId, sessions, theme }: SessionSidebarProps) {
  return (
    <box
      width={SESSION_SIDEBAR_WIDTH + 4}
      flexDirection="column"
      padding={PANEL_PADDING}
      gap={0}
      backgroundColor={theme.panelBackground}
    >
      <text fg={theme.accent}>Sessions</text>
      {sessions.map((session) => (
        <text
          key={session.id}
          fg={session.id === activeSessionId ? theme.selectionForeground : theme.text}
          bg={session.id === activeSessionId ? theme.selectionBackground : undefined}
        >
          {formatSessionRow(session, session.id === activeSessionId)}
        </text>
      ))}
    </box>
  );
}
