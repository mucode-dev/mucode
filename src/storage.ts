import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ProviderInstanceId, TuiMode } from "./provider.ts";
import type { SessionCodeBlock, SessionStatus } from "./session.ts";

export interface PersistedSession {
  id: string;
  title: string;
  status: SessionStatus;
  output: string;
  lastActiveAt: number;
  workingDirectory: string;
  codeBlocks?: Record<string, SessionCodeBlock>;
  workBlocks?: Record<string, PersistedWorkBlock>;
}

export interface PersistedWorkBlock {
  eventId?: string;
  label: string;
  detail?: string;
  status?: "started" | "running" | "completed" | "failed";
  code?: SessionCodeBlock;
}

export interface PersistedState {
  schemaVersion: 1;
  activeSessionId: string;
  sidebarOpen: boolean;
  settings: {
    providerId: string;
    modelSlug: string;
    mode: TuiMode;
    optionSelections: Record<string, string | boolean>;
  };
  sessions: PersistedSession[];
}

const DB_PATH = join(Bun.env.HOME ?? ".", ".local", "share", "code", "code.db");
const SETTINGS_PATH = join(Bun.env.HOME ?? ".", ".config", "code", "code.json");
let saveQueue: Promise<void> = Promise.resolve();

export function createDefaultPersistedState(now = Date.now()): PersistedState {
  return {
    schemaVersion: 1,
    activeSessionId: "",
    sidebarOpen: false,
    settings: {
      providerId: "codex",
      modelSlug: "gpt-5.4",
      mode: "build",
      optionSelections: {},
    },
    sessions: [],
  };
}

export async function loadPersistedState(): Promise<PersistedState> {
  const db = openStateDatabase();
  try {
    const state = await readState(db);
    if (state) {
      const normalized = normalizePersistedState(state);
      if (!(await Bun.file(SETTINGS_PATH).exists())) {
        await writeSettings(normalized);
      }
      return normalized;
    }

    const fallback = createDefaultPersistedState();
    await writeState(db, fallback);
    return fallback;
  } finally {
    db.close();
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  const normalized = normalizePersistedState(state);
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => writePersistedState(normalized));
  return saveQueue;
}

async function writePersistedState(state: PersistedState): Promise<void> {
  const db = openStateDatabase();
  try {
    await writeState(db, state);
  } finally {
    db.close();
  }
}

function openStateDatabase(): Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT NOT NULL,
      last_active_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  ensureColumn(db, "sessions", "working_directory", "TEXT");
  ensureColumn(db, "sessions", "code_blocks_json", "TEXT");
  ensureColumn(db, "sessions", "work_blocks_json", "TEXT");
  db.query("UPDATE sessions SET working_directory = $workingDirectory WHERE working_directory IS NULL OR working_directory = ''").run({
    $workingDirectory: process.cwd(),
  });
  db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schemaVersion', '1')").run();
  return db;
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function readState(db: Database): Promise<Partial<PersistedState> | null> {
  const settings = (await readSettings()) ?? readLegacyDbSettings(db);
  const sessions = readSessions(db);

  if (!settings && sessions.length === 0) return null;

  return {
    schemaVersion: 1,
    activeSessionId: settings?.activeSessionId,
    sidebarOpen: settings?.sidebarOpen ?? false,
    settings: settings?.settings,
    sessions,
  };
}

async function readSettings(): Promise<Partial<PersistedState> | null> {
  const file = Bun.file(SETTINGS_PATH);
  if (!(await file.exists())) return null;

  try {
    const parsed = JSON.parse(await file.text()) as Partial<PersistedState>;
    return {
      schemaVersion: 1,
      activeSessionId: parsed.activeSessionId,
      sidebarOpen: parsed.sidebarOpen,
      settings: parsed.settings,
    };
  } catch {
    return null;
  }
}

function readLegacyDbSettings(db: Database): Partial<PersistedState> | null {
  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'")
    .get();
  if (!tableExists) return null;

  const row = db
    .query(
      `SELECT
        active_session_id AS activeSessionId,
        sidebar_open AS sidebarOpen,
        provider_id AS providerId,
        model_slug AS modelSlug,
        mode,
        option_selections_json AS optionSelectionsJson
      FROM app_settings
      WHERE id = 1`,
    )
    .get() as
    | {
        activeSessionId: string;
        sidebarOpen: number;
        providerId: string;
        modelSlug: string;
        mode: TuiMode;
        optionSelectionsJson: string;
      }
    | null;

  if (!row) return null;

  return {
    schemaVersion: 1,
    activeSessionId: row.activeSessionId,
    sidebarOpen: row.sidebarOpen === 1,
    settings: {
      providerId: row.providerId,
      modelSlug: row.modelSlug,
      mode: row.mode,
      optionSelections: parseOptionSelections(row.optionSelectionsJson),
    },
  };
}

function readSessions(db: Database): PersistedSession[] {
  const sessions = db
    .query(
      `SELECT
        id,
        title,
        status,
        output,
        last_active_at AS lastActiveAt,
        working_directory AS workingDirectory,
        code_blocks_json AS codeBlocksJson,
        work_blocks_json AS workBlocksJson
      FROM sessions
      ORDER BY last_active_at DESC, created_at DESC`,
    )
    .all() as Array<PersistedSession & { codeBlocksJson?: string | null; workBlocksJson?: string | null }>;

  return sessions.map(({ codeBlocksJson, workBlocksJson, ...session }) => ({
    ...session,
    codeBlocks: parseCodeBlocks(codeBlocksJson ?? undefined),
    workBlocks: parseWorkBlocks(workBlocksJson ?? undefined),
  }));
}

async function writeState(db: Database, state: PersistedState): Promise<void> {
  await writeSettings(state);
  writeSessions(db, state.sessions);
}

async function writeSettings(state: PersistedState): Promise<void> {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  await Bun.write(
    SETTINGS_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        activeSessionId: state.activeSessionId,
        sidebarOpen: state.sidebarOpen,
        settings: state.settings,
      },
      null,
      2,
    )}\n`,
  );
}

function writeSessions(db: Database, sessions: PersistedSession[]): void {
  const deleteSessions = db.query("DELETE FROM sessions");
  const insertSession = db.query(`
    INSERT INTO sessions (id, title, status, output, last_active_at, created_at, working_directory, code_blocks_json, work_blocks_json)
    VALUES ($id, $title, $status, $output, $lastActiveAt, $createdAt, $workingDirectory, $codeBlocksJson, $workBlocksJson)
  `);

  const transaction = db.transaction((nextSessions: PersistedSession[]) => {
    deleteSessions.run();
    for (const session of nextSessions) {
      insertSession.run({
        $id: session.id,
        $title: session.title,
        $status: session.status,
        $output: session.output,
        $lastActiveAt: session.lastActiveAt,
        $createdAt: session.lastActiveAt,
        $workingDirectory: session.workingDirectory,
        $codeBlocksJson: session.codeBlocks ? JSON.stringify(session.codeBlocks) : null,
        $workBlocksJson: session.workBlocks ? JSON.stringify(session.workBlocks) : null,
      });
    }
  });

  transaction(sessions);
}

function parseOptionSelections(input: string | undefined): Record<string, string | boolean> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return isRecord(parsed) ? coerceOptionSelections(parsed) : {};
  } catch {
    return {};
  }
}

function parseCodeBlocks(input: string | undefined): Record<string, SessionCodeBlock> | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input);
    if (!isRecord(parsed)) return undefined;
    const blocks: Record<string, SessionCodeBlock> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!isRecord(value) || typeof value.content !== "string") continue;
      blocks[id] = {
        ...(value.kind === "code" || value.kind === "diff" ? { kind: value.kind } : {}),
        ...(typeof value.title === "string" ? { title: value.title } : {}),
        ...(typeof value.path === "string" ? { path: value.path } : {}),
        ...(typeof value.type === "string" ? { type: value.type } : {}),
        ...(typeof value.filetype === "string" ? { filetype: value.filetype } : {}),
        content: value.content,
      };
    }
    return Object.keys(blocks).length > 0 ? blocks : undefined;
  } catch {
    return undefined;
  }
}

function parseWorkBlocks(input: string | undefined): Record<string, PersistedWorkBlock> | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input);
    if (!isRecord(parsed)) return undefined;
    const blocks: Record<string, PersistedWorkBlock> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!isRecord(value) || typeof value.label !== "string") continue;
      const code = value.code ? parseCodeBlocks(JSON.stringify({ code: value.code }))?.code : undefined;
      blocks[id] = {
        ...(typeof value.eventId === "string" ? { eventId: value.eventId } : {}),
        label: value.label,
        ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
        ...(isWorkStatus(value.status) ? { status: value.status } : {}),
        ...(code ? { code } : {}),
      };
    }
    return Object.keys(blocks).length > 0 ? blocks : undefined;
  } catch {
    return undefined;
  }
}

function isWorkStatus(value: unknown): value is PersistedWorkBlock["status"] {
  return value === "started" || value === "running" || value === "completed" || value === "failed";
}

function normalizePersistedState(input: Partial<PersistedState>): PersistedState {
  const fallback = createDefaultPersistedState();
  const sessions =
    Array.isArray(input.sessions)
      ? input.sessions.map((session, index) => ({
          id: typeof session.id === "string" && session.id ? session.id : `chat-${Date.now()}-${index}`,
          title:
            typeof session.title === "string" && session.title
              ? normalizeSessionTitle(session.title, session.output)
              : titleFromSessionOutput(session.output) ?? "Untitled chat",
          status: "idle" as const,
          output: typeof session.output === "string" ? session.output : "",
          lastActiveAt:
            typeof session.lastActiveAt === "number" ? session.lastActiveAt : Date.now(),
          workingDirectory:
            typeof session.workingDirectory === "string" && session.workingDirectory
              ? session.workingDirectory
              : process.cwd(),
          ...(session.codeBlocks
            ? { codeBlocks: parseCodeBlocks(JSON.stringify(session.codeBlocks)) }
            : {}),
          ...(session.workBlocks
            ? { workBlocks: parseWorkBlocks(JSON.stringify(session.workBlocks)) }
            : {}),
        })).filter((session) => !isEmptyNumberedSession(session))
      : fallback.sessions;
  const activeSessionId =
    typeof input.activeSessionId === "string" &&
    sessions.some((session) => session.id === input.activeSessionId)
      ? input.activeSessionId
      : "";
  const settings = input.settings ?? fallback.settings;

  return {
    schemaVersion: 1,
    activeSessionId,
    sidebarOpen: typeof input.sidebarOpen === "boolean" ? input.sidebarOpen : false,
    settings: {
      providerId: isProviderId(settings.providerId) ? settings.providerId : fallback.settings.providerId,
      modelSlug: typeof settings.modelSlug === "string" ? settings.modelSlug : fallback.settings.modelSlug,
      mode: settings.mode === "plan" ? "plan" : "build",
      optionSelections: isRecord(settings.optionSelections) ? coerceOptionSelections(settings.optionSelections) : {},
    },
    sessions,
  };
}

function normalizeSessionTitle(title: string, output: unknown): string {
  if (!/^Session \d+$/u.test(title.trim())) return title;
  return titleFromSessionOutput(output) ?? "Untitled chat";
}

function titleFromSessionOutput(output: unknown): string | null {
  if (typeof output !== "string") return null;
  const userLine = /^You:\s*(.+)$/mu.exec(output)?.[1]?.trim();
  if (!userLine) return null;
  return userLine.replace(/[`*_~[\]()]/gu, "").replace(/\s+/gu, " ").slice(0, 48) || null;
}

function isEmptyNumberedSession(session: PersistedSession): boolean {
  return /^(?:Session \d+|Untitled chat)$/u.test(session.title.trim()) && session.output.trim() === "";
}

function isProviderId(value: unknown): value is ProviderInstanceId {
  return (
    value === "codex" ||
    value === "claudeAgent" ||
    value === "opencode" ||
    (typeof value === "string" && value.startsWith("pi:"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceOptionSelections(input: Record<string, unknown>): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}
