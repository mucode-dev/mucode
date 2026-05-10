import type { SessionCodeBlock, SessionStatus, SessionStreamKind, TokenUsageSnapshot } from "./session.ts";

export type PickerKind =
  | "slash"
  | "provider"
  | "model"
  | "mode"
  | "options"
  | "sessions"
  | "sidebar"
  | "path";

export type OptionSelectionValue = string | boolean;

export interface LocalSessionState {
  id: string;
  title: string;
  status: SessionStatus;
  output: string;
  lastActiveAt: number;
  workingDirectory: string;
  tokenUsage?: TokenUsageSnapshot;
  activeStreamKind?: SessionStreamKind;
  codeBlocks?: Record<string, SessionCodeBlock>;
  workBlocks?: Record<string, SessionWorkBlock>;
}

export interface SessionWorkBlock {
  eventId?: string;
  label: string;
  detail?: string;
  status?: "started" | "running" | "completed" | "failed";
  code?: SessionCodeBlock;
}

export interface PickerOption {
  label: string;
  description: string;
  value: string;
  disabled?: boolean;
}
