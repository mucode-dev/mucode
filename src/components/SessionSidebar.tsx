import type { LocalSessionState } from "../types.ts";
import { formatSessionRow, SESSION_SIDEBAR_WIDTH } from "../ui/sessionList.ts";

interface SessionSidebarProps {
  activeSessionId: string;
  sessions: LocalSessionState[];
}

export function SessionSidebar({ activeSessionId, sessions }: SessionSidebarProps) {
  return (
    <box width={SESSION_SIDEBAR_WIDTH + 4} flexDirection="column" border padding={1} gap={0}>
      <text fg="#FDE68A">Sessions</text>
      {sessions.map((session) => (
        <text
          key={session.id}
          fg={session.id === activeSessionId ? "#0F172A" : "#CBD5E1"}
          bg={session.id === activeSessionId ? "#A7F3D0" : undefined}
        >
          {formatSessionRow(session, session.id === activeSessionId)}
        </text>
      ))}
    </box>
  );
}
