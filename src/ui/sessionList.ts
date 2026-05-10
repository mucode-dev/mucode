import type { LocalSessionState } from "../types.ts";

export const SESSION_SIDEBAR_WIDTH = 30;

export function formatLastTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}.`;
}

export function formatSessionRow(session: LocalSessionState, active: boolean): string {
  const marker = active ? "> " : "  ";
  const time = formatLastTime(session.lastActiveAt);
  const titleWidth = SESSION_SIDEBAR_WIDTH - marker.length - time.length - 3;
  const title = truncateText(session.title, Math.max(6, titleWidth));
  return `${marker}${title.padEnd(titleWidth)} ${time}`;
}
