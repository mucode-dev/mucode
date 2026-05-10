import {
  createOpencodeClient,
  createOpencodeServer,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2";

import type { ProviderDriverKind, TuiMode } from "./provider.ts";

export type SessionStatus = "idle" | "starting" | "running" | "ready" | "error";
export type SessionStreamKind =
  | "assistant"
  | "thinking"
  | "thinking_summary"
  | "plan"
  | "command_output"
  | "file_change_output";

export interface SessionCodeBlock {
  kind?: "code" | "diff";
  title?: string;
  path?: string;
  type?: string;
  filetype?: string;
  content: string;
}

export interface TokenUsageSnapshot {
  usedTokens: number;
  totalProcessedTokens?: number;
  maxTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  lastUsedTokens?: number;
  compactsAutomatically?: boolean;
}

export interface SubmitTurnInput {
  provider: ProviderDriverKind;
  prompt: string;
  model: string;
  mode: TuiMode;
  options: Record<string, string | boolean>;
  cwd: string;
  onEvent: (event: SessionEvent) => void;
}

export interface CompactSessionInput {
  provider: ProviderDriverKind;
  model: string;
  cwd: string;
  onEvent: (event: SessionEvent) => void;
}

export type SessionEvent =
  | { type: "status"; status: SessionStatus; message?: string }
  | { type: "delta"; text: string }
  | { type: "stream"; stream: SessionStreamKind; text: string }
  | {
      type: "work";
      label: string;
      detail?: string;
      code?: SessionCodeBlock;
      status?: "started" | "running" | "completed" | "failed";
    }
  | { type: "usage"; usage: TokenUsageSnapshot }
  | { type: "compacted"; automatic?: boolean; overflow?: boolean }
  | { type: "error"; message: string };

interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface CodexThreadStartResponse {
  thread: {
    id: string;
  };
}

type OpenCodeParsedEvent =
  | SessionEvent
  | { type: "session"; sessionId: string };

export class CodeSession {
  private codex: CodexAppServerSession | null = null;
  private readonly openCode = new OpenCodeCliSession();

  async submitTurn(input: SubmitTurnInput): Promise<void> {
    if (input.provider === "opencode") {
      await this.openCode.sendTurn(input);
      return;
    }
    if (input.provider !== "codex") {
      input.onEvent({ type: "error", message: "Submit is currently wired for Codex and OpenCode." });
      return;
    }

    if (!this.codex) {
      input.onEvent({ type: "status", status: "starting", message: "Starting Codex session" });
      this.codex = await CodexAppServerSession.start(input.cwd, input.onEvent);
    }

    await this.codex.sendTurn(input);
  }

  async compactSession(input: CompactSessionInput): Promise<void> {
    if (input.provider === "opencode") {
      await this.openCode.compact(input);
      return;
    }
    if (input.provider !== "codex") {
      input.onEvent({
        type: "error",
        message: "Manual compacting is currently wired for Codex and OpenCode.",
      });
      return;
    }
    if (!this.codex) {
      input.onEvent({ type: "error", message: "No Codex session to compact yet." });
      return;
    }
    await this.codex.compact();
  }

  async close(): Promise<void> {
    const current = this.codex;
    this.codex = null;
    await current?.close();
    await this.openCode.close();
  }
}

class OpenCodeCliSession {
  private sessionId: string | null = null;
  private activeProcess: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private readonly eventTranslator = new OpenCodeCliEventTranslator();
  private sdkSession: OpenCodeSdkSession | null = null;

  async sendTurn(input: SubmitTurnInput): Promise<void> {
    try {
      const sdkSession = await this.ensureSdkSession(input);
      await sdkSession.sendTurn(input);
      this.sessionId = sdkSession.sessionId;
      return;
    } catch (error) {
      input.onEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  private async sendTurnViaCli(input: SubmitTurnInput): Promise<void> {
    input.onEvent({ type: "status", status: "running", message: "Running OpenCode turn" });

    const agent = typeof input.options.agent === "string" ? input.options.agent : undefined;
    const variant = typeof input.options.variant === "string" ? input.options.variant : undefined;
    const prompt =
      input.mode === "plan"
        ? `Plan mode: propose a concise implementation plan only. Do not edit files yet.\n\n${input.prompt}`
        : input.prompt;

    const args = [
      "run",
      "--format",
      "json",
      "--model",
      input.model,
      "--dir",
      input.cwd,
      "--dangerously-skip-permissions",
      ...(this.sessionId ? ["--session", this.sessionId] : []),
      ...(agent ? ["--agent", agent] : input.mode === "plan" ? ["--agent", "plan"] : []),
      ...(variant ? ["--variant", variant] : []),
      prompt,
    ];

    const proc = Bun.spawn(["opencode", ...args], {
      cwd: input.cwd,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.activeProcess = proc;

    let rawStdout = "";
    let emittedText = false;
    const stdoutTask = this.readOpenCodeStdout(proc.stdout, (event) => {
      if (event.type === "delta") {
        emittedText = true;
        input.onEvent(event);
        return;
      }
      if (event.type === "usage") {
        input.onEvent(event);
        return;
      }
      if (event.type === "status" || event.type === "compacted") {
        input.onEvent(event);
        return;
      }
      if (event.type === "session") {
        this.sessionId = event.sessionId;
      }
    }).then((raw) => {
      rawStdout = raw;
    });
    const stderrTask = new Response(proc.stderr).text();
    const [exitCode, stderr] = await Promise.all([proc.exited, stderrTask, stdoutTask]).then(
      ([code, err]) => [code, err] as const,
    );

    this.activeProcess = null;
    if (exitCode !== 0) {
      input.onEvent({
        type: "error",
        message: stderr.trim() || `OpenCode exited with ${exitCode}`,
      });
      return;
    }

    if (!emittedText) {
      const fallback = fallbackOpenCodeText(rawStdout);
      if (fallback) input.onEvent({ type: "delta", text: fallback });
    }
    input.onEvent({ type: "status", status: "ready", message: "OpenCode turn completed" });
  }

  async close(): Promise<void> {
    this.activeProcess?.kill();
    this.activeProcess = null;
    await this.sdkSession?.close();
    this.sdkSession = null;
  }

  async compact(input: CompactSessionInput): Promise<void> {
    if (this.sdkSession) {
      await this.sdkSession.compact(input);
      return;
    }
    if (!this.sessionId) {
      input.onEvent({ type: "error", message: "No OpenCode session to compact yet." });
      return;
    }
    const parsedModel = parseOpenCodeModel(input.model);
    if (!parsedModel) {
      input.onEvent({
        type: "error",
        message: "OpenCode manual compact requires a provider/model model slug.",
      });
      return;
    }

    input.onEvent({ type: "status", status: "running", message: "Compacting OpenCode context" });
    const proc = Bun.spawn(["opencode", "serve", "--hostname=127.0.0.1", "--port=0"], {
      cwd: input.cwd,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.activeProcess = proc;

    let stderr = "";
    const stderrTask = new Response(proc.stderr)
      .text()
      .then((text) => {
        stderr = text;
      })
      .catch(() => undefined);

    try {
      const serverUrl = await waitForOpenCodeServerUrl(proc.stdout);
      const url = new URL(`/session/${encodeURIComponent(this.sessionId)}/summarize`, serverUrl);
      url.searchParams.set("directory", input.cwd);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: parsedModel.providerId,
          modelID: parsedModel.modelId,
          auto: false,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        input.onEvent({
          type: "error",
          message: body.trim() || `OpenCode compact failed with HTTP ${response.status}`,
        });
        return;
      }
      input.onEvent({ type: "compacted", automatic: false });
      input.onEvent({ type: "status", status: "ready", message: "OpenCode context compacted" });
    } catch (error) {
      input.onEvent({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : stderr.trim() || "OpenCode compact failed.",
      });
    } finally {
      proc.kill();
      this.activeProcess = null;
      await Promise.race([proc.exited, stderrTask, new Promise((resolve) => setTimeout(resolve, 500))]).catch(
        () => undefined,
      );
    }
  }

  private async readOpenCodeStdout(
    stream: ReadableStream<Uint8Array>,
    emit: (event: OpenCodeParsedEvent) => void,
  ): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let remainder = "";
    let raw = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      raw += text;
      remainder += text;
      const lines = remainder.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        this.eventTranslator.handleJsonLine(line, emit);
      }
    }
    if (remainder.trim()) {
      this.eventTranslator.handleJsonLine(remainder, emit);
    }
    return raw;
  }

  private async ensureSdkSession(input: SubmitTurnInput): Promise<OpenCodeSdkSession> {
    if (this.sdkSession) return this.sdkSession;
    input.onEvent({ type: "status", status: "starting", message: "Starting OpenCode server" });
    this.sdkSession = await OpenCodeSdkSession.start(input.cwd, input.onEvent);
    return this.sdkSession;
  }
}

class OpenCodeSdkSession {
  readonly sessionId: string;
  private readonly client: OpencodeClient;
  private readonly server: { close(): void };
  private readonly eventTranslator = new OpenCodeCliEventTranslator();
  private readonly abortController = new AbortController();
  private eventPump: Promise<void>;
  private turnEmitter: ((event: SessionEvent) => void) | null = null;
  private resolveIdle: (() => void) | null = null;

  private constructor(input: {
    client: OpencodeClient;
    server: { close(): void };
    sessionId: string;
    eventPump: Promise<void>;
  }) {
    this.client = input.client;
    this.server = input.server;
    this.sessionId = input.sessionId;
    this.eventPump = input.eventPump;
  }

  static async start(
    cwd: string,
    onEvent: (event: SessionEvent) => void,
  ): Promise<OpenCodeSdkSession> {
    const server = await createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: cwd,
      throwOnError: true,
    });
    const created = await client.session.create({
      directory: cwd,
      title: "Code TUI",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    });
    const sessionId = created.data?.id;
    if (!sessionId) {
      server.close();
      throw new Error("OpenCode session.create returned no session id.");
    }

    const sdkSession = new OpenCodeSdkSession({
      client,
      server,
      sessionId,
      eventPump: Promise.resolve(),
    });
    const subscription = await client.event.subscribe(undefined, {
      signal: sdkSession.abortController.signal,
    });
    sdkSession.eventPump = sdkSession.pumpEvents(subscription, onEvent);
    onEvent({ type: "status", status: "ready", message: "OpenCode session ready" });
    return sdkSession;
  }

  async sendTurn(input: SubmitTurnInput): Promise<void> {
    const model = parseOpenCodeModel(input.model);
    if (!model) {
      throw new Error("OpenCode turns require a provider/model model slug.");
    }

    const agent = typeof input.options.agent === "string" ? input.options.agent : undefined;
    const variant = typeof input.options.variant === "string" ? input.options.variant : undefined;
    const prompt =
      input.mode === "plan"
        ? `Plan mode: propose a concise implementation plan only. Do not edit files yet.\n\n${input.prompt}`
        : input.prompt;

    input.onEvent({ type: "status", status: "running", message: "Running OpenCode turn" });
    this.turnEmitter = input.onEvent;
    const idle = new Promise<void>((resolve) => {
      this.resolveIdle = resolve;
    });

    try {
      await this.client.session.promptAsync({
        sessionID: this.sessionId,
        directory: input.cwd,
        model: { providerID: model.providerId, modelID: model.modelId },
        ...(agent ? { agent } : input.mode === "plan" ? { agent: "plan" } : {}),
        ...(variant ? { variant } : {}),
        parts: [{ type: "text", text: prompt }],
      });

      await idle;
      input.onEvent({ type: "status", status: "ready", message: "OpenCode turn completed" });
    } finally {
      this.resolveIdle = null;
      this.turnEmitter = null;
    }
  }

  async compact(input: CompactSessionInput): Promise<void> {
    const model = parseOpenCodeModel(input.model);
    if (!model) {
      input.onEvent({
        type: "error",
        message: "OpenCode manual compact requires a provider/model model slug.",
      });
      return;
    }

    input.onEvent({ type: "status", status: "running", message: "Compacting OpenCode context" });
    await this.client.session.summarize({
      sessionID: this.sessionId,
      directory: input.cwd,
      providerID: model.providerId,
      modelID: model.modelId,
      auto: false,
    });
    input.onEvent({ type: "compacted", automatic: false });
    input.onEvent({ type: "status", status: "ready", message: "OpenCode context compacted" });
  }

  async close(): Promise<void> {
    this.abortController.abort();
    await this.client.session.abort({ sessionID: this.sessionId }).catch(() => undefined);
    this.server.close();
    await Promise.race([
      this.eventPump.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  }

  private async pumpEvents(
    subscription: { stream: AsyncIterable<unknown> },
    defaultEmit: (event: SessionEvent) => void,
  ): Promise<void> {
    try {
      for await (const event of subscription.stream) {
        if (this.abortController.signal.aborted) break;
        if (!isOpenCodeEventForSession(event, this.sessionId)) continue;

        const emit = (event: OpenCodeParsedEvent) => {
          if (event.type === "session") return;
          (this.turnEmitter ?? defaultEmit)(event);
        };
        const status = openCodeEventStatusType(event);
        if (status === "busy") {
          emit({ type: "status", status: "running", message: "OpenCode is running" });
        }
        if (status === "idle" || event.type === "session.idle") {
          this.resolveIdle?.();
        }
        if (event.type === "session.error") {
          emit({ type: "error", message: openCodeEventErrorMessage(event) });
          this.resolveIdle?.();
        }

        this.eventTranslator.handleEvent(event, (translated) => {
          if (translated.type !== "session") emit(translated);
        });
      }
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        defaultEmit({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

interface OpenCodeCliPart {
  id: string;
  messageID?: string;
  messageId?: string;
  callID?: string;
  callId?: string;
  type?: string;
  tool?: string;
  text?: string;
  args?: unknown;
  input?: unknown;
  params?: unknown;
  state?: {
    status?: string;
    title?: string;
    output?: string;
    error?: string;
  };
}

class OpenCodeCliEventTranslator {
  private readonly messageRoleById = new Map<string, "user" | "assistant">();
  private readonly partById = new Map<string, OpenCodeCliPart>();
  private readonly emittedTextByPartId = new Map<string, string>();

  handleEvent(event: unknown, emit: (event: OpenCodeParsedEvent) => void): void {
    if (isRecord(event)) {
      this.handleParsedEvent(event, emit);
    }
  }

  handleJsonLine(line: string, emit: (event: OpenCodeParsedEvent) => void): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (isRecord(parsed)) {
      this.handleParsedEvent(parsed, emit);
    }
  }

  private handleParsedEvent(
    parsed: Record<string, unknown>,
    emit: (event: OpenCodeParsedEvent) => void,
  ): void {
    const sessionId = findStringValue(parsed, ["sessionID", "sessionId"]);
    if (sessionId) {
      emit({ type: "session", sessionId });
    }

    const compaction = extractOpenCodeCompaction(parsed);
    if (compaction) {
      emit({ type: "compacted", ...compaction });
    }

    if (isOpenCodeCompacting(parsed)) {
      emit({ type: "status", status: "running", message: "Compacting context" });
    }

    const usage = extractGenericTokenUsage(parsed);
    if (usage) {
      emit({ type: "usage", usage: { ...usage, compactsAutomatically: true } });
    }

    switch (parsed.type) {
      case "message.updated": {
        const info = openCodeEventInfo(parsed);
        const messageId = stringValue(info, "id");
        const role = openCodeRole(info);
        if (!messageId || !role) break;

        this.messageRoleById.set(messageId, role);
        if (role === "assistant") {
          for (const part of this.partById.values()) {
            if (openCodePartMessageId(part) === messageId) {
              this.emitTextPartDelta(part, emit);
            }
          }
        }
        break;
      }
      case "message.removed": {
        const messageId = findStringValue(parsed, ["messageID", "messageId"]);
        if (messageId) this.messageRoleById.delete(messageId);
        break;
      }
      case "message.part.updated": {
        const part = openCodeEventPart(parsed);
        if (!part) break;

        this.partById.set(part.id, part);
        if (part.type === "tool") {
          emit(openCodeToolWorkEvent(part));
        } else if (this.roleForPart(part) === "assistant") {
          this.emitTextPartDelta(part, emit);
        } else if (isAssistantTextShape(parsed)) {
          this.emitTextPartDelta(part, emit);
        }
        break;
      }
      case "message.part.delta": {
        this.handlePartDelta(parsed, emit);
        break;
      }
      case "step_finish": {
        const usage = extractOpenCodePartTokenUsage(parsed);
        if (usage) {
          emit({ type: "usage", usage: { ...usage, compactsAutomatically: true } });
        }
        break;
      }
      case "session.status": {
        break;
      }
      case "text": {
        const part = openCodeEventPart(parsed);
        if (part) {
          this.partById.set(part.id, part);
          this.emitTextPartDelta(part, emit);
          break;
        }
        const text = stringValue(parsed, "text");
        if (text) emit({ type: "delta", text });
        break;
      }
      default: {
        const delta = extractLooseOpenCodeDelta(parsed);
        if (delta) emit({ type: "delta", text: delta });
      }
    }
  }

  private handlePartDelta(
    event: Record<string, unknown>,
    emit: (event: OpenCodeParsedEvent) => void,
  ): void {
    const properties = isRecord(event.properties) ? event.properties : event;
    const partId = stringValue(properties, "partID") ?? stringValue(properties, "partId");
    if (!partId) return;

    const existingPart = this.partById.get(partId);
    if (existingPart && this.roleForPart(existingPart) !== "assistant") return;
    const stream = openCodeStreamForPart(existingPart);

    const delta = stringValue(properties, "delta") ?? stringValue(properties, "text");
    if (!delta) return;

    const previousText =
      this.emittedTextByPartId.get(partId) ??
      (existingPart ? textFromOpenCodePart(existingPart) : undefined) ??
      "";
    const { nextText, deltaToEmit } = appendOpenCodeAssistantTextDelta(previousText, delta);
    if (!deltaToEmit) return;

    this.emittedTextByPartId.set(partId, nextText);
    if (existingPart && isOpenCodeTextPart(existingPart)) {
      this.partById.set(partId, { ...existingPart, text: nextText });
    }
    emit(
      stream === "assistant"
        ? { type: "delta", text: deltaToEmit }
        : { type: "stream", stream, text: deltaToEmit },
    );
  }

  private emitTextPartDelta(
    part: OpenCodeCliPart,
    emit: (event: OpenCodeParsedEvent) => void,
  ): void {
    const text = textFromOpenCodePart(part);
    if (text === undefined) return;

    const previousText = this.emittedTextByPartId.get(part.id);
    const { latestText, deltaToEmit } = mergeOpenCodeAssistantText(previousText, text);
    this.emittedTextByPartId.set(part.id, latestText);
    if (latestText !== text && isOpenCodeTextPart(part)) {
      this.partById.set(part.id, { ...part, text: latestText });
    }
    if (deltaToEmit) {
      const stream = openCodeStreamForPart(part);
      emit(
        stream === "assistant"
          ? { type: "delta", text: deltaToEmit }
          : { type: "stream", stream, text: deltaToEmit },
      );
    }
  }

  private roleForPart(part: OpenCodeCliPart): "user" | "assistant" | undefined {
    const messageId = openCodePartMessageId(part);
    if (!messageId) return undefined;
    return this.messageRoleById.get(messageId);
  }
}

class CodexAppServerSession {
  private readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly writer: Bun.FileSink;
  private readonly reader;
  private readonly pending = new Map<number, (value: JsonRpcResponse) => void>();
  private readonly textDecoder = new TextDecoder();
  private readonly onEvent: (event: SessionEvent) => void;
  private nextId = 1;
  private remainder = "";
  private stopped = false;
  private threadId: string | null = null;
  private readLoop: Promise<void>;

  private constructor(
    proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
    onEvent: (event: SessionEvent) => void,
  ) {
    this.proc = proc;
    this.writer = proc.stdin;
    this.reader = proc.stdout.getReader();
    this.onEvent = onEvent;
    this.readLoop = this.read();
    new Response(proc.stderr).text().catch(() => "");
  }

  static async start(
    cwd: string,
    onEvent: (event: SessionEvent) => void,
  ): Promise<CodexAppServerSession> {
    const proc = Bun.spawn(["codex", "app-server"], {
      cwd,
      env: process.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const session = new CodexAppServerSession(proc, onEvent);
    await session.request("initialize", {
      clientInfo: {
        name: "code_tui",
        title: "Code TUI",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await session.notify("initialized");
    onEvent({ type: "status", status: "ready", message: "Codex session ready" });
    return session;
  }

  async sendTurn(input: SubmitTurnInput): Promise<void> {
    input.onEvent({ type: "status", status: "running", message: "Running Codex turn" });

    if (!this.threadId) {
      const response = await this.request("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        model: input.model,
      });
      if (!isCodexThreadStartResponse(response)) {
        throw new Error("Codex thread/start returned an unexpected response.");
      }
      this.threadId = response.thread.id;
    }

    const effort = input.options.reasoningEffort;
    const prompt =
      input.mode === "plan"
        ? `Plan mode: propose a concise implementation plan only. Do not edit files yet.\n\n${input.prompt}`
        : input.prompt;

    await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      model: input.model,
      ...(typeof effort === "string" ? { effort } : {}),
    });
  }

  async compact(): Promise<void> {
    if (!this.threadId) {
      this.onEvent({ type: "error", message: "No Codex thread to compact yet." });
      return;
    }
    this.onEvent({ type: "status", status: "running", message: "Compacting Codex context" });
    await this.request("thread/compact/start", {
      threadId: this.threadId,
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    await Promise.resolve(this.writer.end()).catch(() => undefined);
    this.proc.kill();
    await Promise.race([this.readLoop, this.proc.exited]).catch(() => undefined);
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);
      this.pending.set(id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });

    await this.write({ id, method, ...(params !== undefined ? { params } : {}) });
    const payload = await response;
    if (payload.error) {
      throw new Error(payload.error.message ?? `Codex app-server request failed: ${method}`);
    }
    return payload.result;
  }

  private notify(method: string, params?: unknown): Promise<void> {
    return this.write({ method, ...(params !== undefined ? { params } : {}) });
  }

  private async read(): Promise<void> {
    while (!this.stopped) {
      const chunk = await this.reader.read();
      if (chunk.done) break;
      this.remainder += this.textDecoder.decode(chunk.value, { stream: true });
      const lines = this.remainder.split("\n");
      this.remainder = lines.pop() ?? "";
      for (const line of lines) {
        await this.handleLine(line);
      }
    }
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      this.pending.get(Number(parsed.id))?.(parsed);
      this.pending.delete(Number(parsed.id));
      return;
    }

    if (isJsonRpcRequest(parsed)) {
      if (parsed.method === "item/tool/call") {
        const work = codexToolCallWorkEvent(parsed.params);
        if (work) this.onEvent(work);
      }
      await this.write({
        id: parsed.id,
        error: { code: -32601, message: `Method not found: ${parsed.method}` },
      });
      return;
    }

    if (isJsonRpcNotification(parsed)) {
      this.handleNotification(parsed);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "item/agentMessage/delta" && isRecord(notification.params)) {
      const delta = notification.params.delta;
      if (typeof delta === "string") {
        this.onEvent({ type: "delta", text: delta });
      }
      return;
    }
    if (notification.method === "item/reasoning/textDelta" && isRecord(notification.params)) {
      const delta = stringValue(notification.params, "delta");
      if (delta) this.onEvent({ type: "stream", stream: "thinking", text: delta });
      return;
    }
    if (
      notification.method === "item/reasoning/summaryTextDelta" &&
      isRecord(notification.params)
    ) {
      const delta = stringValue(notification.params, "delta");
      if (delta) this.onEvent({ type: "stream", stream: "thinking_summary", text: delta });
      return;
    }
    if (notification.method === "item/plan/delta" && isRecord(notification.params)) {
      const delta = stringValue(notification.params, "delta");
      if (delta) this.onEvent({ type: "stream", stream: "plan", text: delta });
      return;
    }
    if (
      notification.method === "item/commandExecution/outputDelta" &&
      isRecord(notification.params)
    ) {
      const delta = stringValue(notification.params, "delta");
      if (delta) this.onEvent({ type: "stream", stream: "command_output", text: delta });
      return;
    }
    if (
      notification.method === "item/fileChange/outputDelta" &&
      isRecord(notification.params)
    ) {
      const delta = stringValue(notification.params, "delta");
      if (delta) this.onEvent({ type: "stream", stream: "file_change_output", text: delta });
      return;
    }
    if (notification.method === "item/mcpToolCall/progress" && isRecord(notification.params)) {
      const summary =
        stringValue(notification.params, "message") ?? stringValue(notification.params, "summary");
      this.onEvent({
        type: "work",
        label: "MCP tool call",
        ...(summary ? { detail: summary } : {}),
        status: "running",
      });
      return;
    }
    if (notification.method === "item/started" || notification.method === "item/completed") {
      const work = codexLifecycleWorkEvent(
        notification.params,
        notification.method === "item/completed" ? "completed" : "started",
      );
      if (work) this.onEvent(work);
      return;
    }
    if (notification.method === "turn/completed") {
      this.onEvent({ type: "status", status: "ready", message: "Turn completed" });
      return;
    }
    if (notification.method === "thread/tokenUsage/updated") {
      const usage = normalizeCodexTokenUsage(notification.params);
      if (usage) {
        this.onEvent({ type: "usage", usage });
      }
      return;
    }
    if (notification.method === "thread/compacted") {
      this.onEvent({ type: "compacted", automatic: true });
      return;
    }
    if (notification.method === "error" && isRecord(notification.params)) {
      const error = notification.params.error;
      const message =
        isRecord(error) && typeof error.message === "string" ? error.message : "Codex error";
      this.onEvent({ type: "error", message });
    }
  }

  private async write(payload: Record<string, unknown>): Promise<void> {
    this.writer.write(`${JSON.stringify(payload)}\n`);
    await Promise.resolve(this.writer.flush());
  }
}

function isCodexThreadStartResponse(value: unknown): value is CodexThreadStartResponse {
  return (
    isRecord(value) &&
    isRecord(value.thread) &&
    typeof value.thread.id === "string"
  );
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && ("result" in value || "error" in value) && value.id !== undefined;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value) && typeof value.method === "string" && value.id !== undefined;
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && typeof value.method === "string" && value.id === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codexLifecycleWorkEvent(
  value: unknown,
  status: "started" | "completed",
): SessionEvent | null {
  if (!isRecord(value)) return null;
  const item = isRecord(value.item) ? value.item : value;
  const itemType = stringValue(item, "type");
  const label = codexItemLabel(itemType);
  if (!label) return null;
  const detail = detailLines([
    ["item id", stringValue(item, "id")],
    ["type", itemType],
    ...recordDetailEntries(item),
    ["raw", stringifyCompact(item, 900)],
  ]);
  return {
    type: "work",
    label,
    ...(detail ? { detail } : {}),
    ...(status === "completed" ? { code: executionBlockFromRecord(item, label) } : {}),
    status,
  };
}

function codexToolCallWorkEvent(value: unknown): SessionEvent | null {
  if (!isRecord(value)) return null;
  const tool = isRecord(value.tool) ? value.tool : value;
  const name =
    stringValue(tool, "name") ??
    stringValue(tool, "title") ??
    stringValue(tool, "toolName") ??
    stringValue(value, "toolName") ??
    "Tool call";
  const detail = detailLines([
    ["tool", name],
    ["request id", stringValue(value, "requestId") ?? stringValue(value, "id")],
    ["call id", stringValue(value, "callId") ?? stringValue(value, "callID")],
    ...recordDetailEntries(value),
    ...(tool !== value ? recordDetailEntries(tool) : []),
    ["raw", stringifyCompact(value, 900)],
  ]);
  return {
    type: "work",
    label: `Tool call: ${name}`,
    ...(detail ? { detail } : {}),
    status: "started",
  };
}

function codexItemLabel(rawType: string | null): string | null {
  const type = normalizeItemType(rawType);
  if (!type) return null;
  if (type.includes("agent message") || type.includes("assistant") || type.includes("user")) {
    return null;
  }
  if (type.includes("reasoning") || type.includes("thought")) return "Thinking";
  if (type.includes("plan") || type.includes("todo")) return "Plan";
  if (type.includes("command")) return "Command";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit")) {
    return "File change";
  }
  if (type.includes("mcp")) return "MCP tool call";
  if (type.includes("dynamic tool")) return "Tool call";
  if (type.includes("collab")) return "Collab agent";
  if (type.includes("web search")) return "Web search";
  if (type.includes("image")) return "Image view";
  if (type.includes("compact")) return "Context compaction";
  if (type.includes("error")) return "Error";
  return capitalizeWords(type);
}

function normalizeItemType(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function capitalizeWords(value: string): string {
  return value.replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function detailLines(entries: Array<readonly [string, unknown]>): string | undefined {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const [label, value] of entries) {
    const formatted = formatDetailValue(value);
    if (!formatted) continue;
    const line = `${label}: ${formatted}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function recordDetailEntries(record: Record<string, unknown>): Array<readonly [string, unknown]> {
  return [
    ["status", findValue(record, ["status"])],
    ["title", findValue(record, ["title"])],
    ["summary", findValue(record, ["summary", "message", "description"])],
    ["cwd", findValue(record, ["cwd", "directory", "workingDirectory"])],
    ["command", findValue(record, ["command", "cmd"])],
    ["path", findValue(record, ["path", "filePath", "filepath"])],
    ["paths", findValue(record, ["paths", "files", "changedFiles"])],
    ["args", findValue(record, ["args", "arguments", "params", "input"])],
    ["output", findValue(record, ["output", "stdout", "stderr"])],
    ["error", findValue(record, ["error"])],
  ];
}

function findValue(record: Record<string, unknown>, keys: ReadonlyArray<string>): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  for (const nestedKey of ["tool", "state", "payload", "item"]) {
    const nested = record[nestedKey];
    if (!isRecord(nested)) continue;
    const value = findValue(nested, keys);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function formatDetailValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join(" ");
  }
  return stringifyCompact(value, 600);
}

function stringifyCompact(value: unknown, maxLength = 160): string | undefined {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  } catch {
    return undefined;
  }
}

function executionBlockFromToolOutput(output: string | undefined): SessionCodeBlock | undefined {
  if (!output) return undefined;
  const path = firstXmlTag(output, "path");
  const type = firstXmlTag(output, "type");
  const content = firstXmlTag(output, "content");
  const diff = firstXmlTag(output, "diff") ?? detectUnifiedDiff(output);
  if (diff) {
    return {
      kind: "diff",
      title: path ? `Diff: ${path}` : "Diff",
      ...(path ? { path } : {}),
      ...(type ? { type } : {}),
      filetype: filePathToFenceLanguage(path ?? undefined) || filetypeFromUnifiedDiff(diff),
      content: diff,
    };
  }
  if (!content) return undefined;

  return {
    kind: "code",
    title: path ? `Code: ${path}` : "Code",
    ...(path ? { path } : {}),
    ...(type ? { type } : {}),
    filetype: filePathToFenceLanguage(path),
    content: stripLineNumberPrefixes(content),
  };
}

function executionBlockFromRecord(
  record: Record<string, unknown>,
  title: string,
): SessionCodeBlock | undefined {
  const diff =
    findStringValue(record, ["diff", "patch", "unifiedDiff"]) ??
    detectUnifiedDiff(stringifyCompact(record, 20_000) ?? "");
  if (diff) {
    const path = findStringValue(record, ["path", "filePath", "filepath"]);
    return {
      kind: "diff",
      title,
      ...(path ? { path } : {}),
      filetype: filePathToFenceLanguage(path ?? undefined) || filetypeFromUnifiedDiff(diff),
      content: diff,
    };
  }

  const output = findStringValue(record, ["output", "stdout"]);
  return executionBlockFromToolOutput(output ?? undefined);
}

function detectUnifiedDiff(value: string): string | undefined {
  const lines = value.split(/\r?\n/gu);
  const start = lines.findIndex(
    (line, index) =>
      line.startsWith("diff --git ") ||
      (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) ||
      line.startsWith("@@ "),
  );
  if (start < 0) return undefined;
  const diff = lines.slice(start).join("\n").trim();
  return diff.includes("@@") && (/^[-+@ ]/mu.test(diff) || diff.includes("diff --git "))
    ? diff
    : undefined;
}

function filetypeFromUnifiedDiff(diff: string): string {
  const path =
    /^diff --git a\/(.+?) b\/.+$/mu.exec(diff)?.[1] ??
    /^\+\+\+ b\/(.+)$/mu.exec(diff)?.[1] ??
    /^--- a\/(.+)$/mu.exec(diff)?.[1];
  return filePathToFenceLanguage(path);
}

function firstXmlTag(value: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "u").exec(value);
  return match?.[1]?.trim() || undefined;
}

function stripLineNumberPrefixes(value: string): string {
  return value.replace(/^\s*\d+:\s?/gmu, "");
}

function filePathToFenceLanguage(path: string | undefined): string {
  if (!path) return "";
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".json")
  ) {
    return "javascript";
  }
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".zig")) return "zig";
  return "";
}

function normalizeCodexTokenUsage(value: unknown): TokenUsageSnapshot | null {
  const payload = isRecord(value) ? value : null;
  const tokenUsage = isRecord(payload?.tokenUsage)
    ? payload.tokenUsage
    : isRecord(payload?.payload) && isRecord(payload.payload.tokenUsage)
      ? payload.payload.tokenUsage
      : null;
  if (!tokenUsage) return null;

  const total = isRecord(tokenUsage.total) ? tokenUsage.total : null;
  const last = isRecord(tokenUsage.last) ? tokenUsage.last : null;
  const usedTokens = asFinitePositiveNumber(last?.totalTokens);
  if (usedTokens === null) return null;

  const totalProcessedTokens = asFinitePositiveNumber(total?.totalTokens);
  const maxTokens = asFinitePositiveNumber(tokenUsage.modelContextWindow);
  const inputTokens = asFiniteNonNegativeNumber(last?.inputTokens);
  const cachedInputTokens = asFiniteNonNegativeNumber(last?.cachedInputTokens);
  const outputTokens = asFiniteNonNegativeNumber(last?.outputTokens);
  const reasoningOutputTokens = asFiniteNonNegativeNumber(last?.reasoningOutputTokens);

  return {
    usedTokens,
    ...(totalProcessedTokens !== null && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(maxTokens !== null ? { maxTokens } : {}),
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(cachedInputTokens !== null ? { cachedInputTokens } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== null ? { reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    compactsAutomatically: true,
  };
}

function asFinitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function asFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function suffixPrefixOverlap(text: string, delta: string): number {
  const maxLength = Math.min(text.length, delta.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(delta.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function mergeOpenCodeAssistantText(
  previousText: string | undefined,
  nextText: string,
): { latestText: string; deltaToEmit: string } {
  const latestText =
    previousText && previousText.length > nextText.length && previousText.startsWith(nextText)
      ? previousText
      : nextText;
  return {
    latestText,
    deltaToEmit: latestText.slice(commonPrefixLength(previousText ?? "", latestText)),
  };
}

function appendOpenCodeAssistantTextDelta(
  previousText: string,
  delta: string,
): { nextText: string; deltaToEmit: string } {
  const deltaToEmit = delta.slice(suffixPrefixOverlap(previousText, delta));
  return {
    nextText: previousText + deltaToEmit,
    deltaToEmit,
  };
}

function stringValue(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const found = value[key];
  return typeof found === "string" && found.length > 0 ? found : null;
}

function openCodeEventInfo(event: Record<string, unknown>): Record<string, unknown> | null {
  const properties = isRecord(event.properties) ? event.properties : event;
  return isRecord(properties.info) ? properties.info : null;
}

function openCodeRole(value: unknown): "user" | "assistant" | undefined {
  const role = stringValue(value, "role");
  return role === "user" || role === "assistant" ? role : undefined;
}

function openCodeEventPart(event: Record<string, unknown>): OpenCodeCliPart | null {
  const properties = isRecord(event.properties) ? event.properties : event;
  const part = isRecord(properties.part) ? properties.part : properties;
  const id = stringValue(part, "id") ?? stringValue(part, "partID") ?? stringValue(part, "partId");
  if (!id) return null;

  const state = isRecord(part.state)
    ? {
        ...(typeof part.state.status === "string" ? { status: part.state.status } : {}),
        ...(typeof part.state.title === "string" ? { title: part.state.title } : {}),
        ...(typeof part.state.output === "string" ? { output: part.state.output } : {}),
        ...(typeof part.state.error === "string" ? { error: part.state.error } : {}),
      }
    : undefined;

  return {
    id,
    ...(stringValue(part, "messageID") ? { messageID: stringValue(part, "messageID")! } : {}),
    ...(stringValue(part, "messageId") ? { messageId: stringValue(part, "messageId")! } : {}),
    ...(stringValue(part, "callID") ? { callID: stringValue(part, "callID")! } : {}),
    ...(stringValue(part, "callId") ? { callId: stringValue(part, "callId")! } : {}),
    ...(stringValue(part, "type") ? { type: stringValue(part, "type")! } : {}),
    ...(stringValue(part, "tool") ? { tool: stringValue(part, "tool")! } : {}),
    ...(stringValue(part, "text") ? { text: stringValue(part, "text")! } : {}),
    ...(part.args !== undefined ? { args: part.args } : {}),
    ...(part.input !== undefined ? { input: part.input } : {}),
    ...(part.params !== undefined ? { params: part.params } : {}),
    ...(state ? { state } : {}),
  };
}

function openCodePartMessageId(part: OpenCodeCliPart): string | undefined {
  return part.messageID ?? part.messageId;
}

function isOpenCodeTextPart(part: OpenCodeCliPart): boolean {
  return part.type === "text" || part.type === "reasoning";
}

function textFromOpenCodePart(part: OpenCodeCliPart): string | undefined {
  return isOpenCodeTextPart(part) ? part.text : undefined;
}

function openCodeStreamForPart(part: OpenCodeCliPart | undefined): SessionStreamKind {
  return part?.type === "reasoning" ? "thinking" : "assistant";
}

function openCodeToolWorkEvent(part: OpenCodeCliPart): SessionEvent {
  const rawStatus = part.state?.status;
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "error"
        ? "failed"
        : rawStatus === "running"
          ? "running"
          : "started";
  const code = executionBlockFromToolOutput(part.state?.output);
  return {
    type: "work",
    label: `Tool call: ${part.state?.title ?? part.tool ?? "unknown"}`,
    ...(code ? { code } : {}),
    detail: code
      ? detailLines([
          ["part id", part.id],
          ["call id", part.callID ?? part.callId],
          ["tool", part.tool],
          ["state", rawStatus],
          ["title", part.state?.title],
          ["args", part.args ?? part.input ?? part.params],
          ["error", part.state?.error],
        ])
      : detailLines([
          ["part id", part.id],
          ["call id", part.callID ?? part.callId],
          ["tool", part.tool],
          ["state", rawStatus],
          ["title", part.state?.title],
          ["args", part.args ?? part.input ?? part.params],
          ["output", part.state?.output],
          ["error", part.state?.error],
        ]),
    status,
  };
}

function isAssistantTextShape(event: Record<string, unknown>): boolean {
  const properties = isRecord(event.properties) ? event.properties : event;
  const role =
    openCodeRole(properties) ?? openCodeRole(properties.message) ?? openCodeRole(properties.info);
  return role === "assistant";
}

function openCodeSessionStatus(event: Record<string, unknown>): string | null {
  const properties = isRecord(event.properties) ? event.properties : event;
  const status = isRecord(properties.status) ? properties.status : properties;
  return stringValue(status, "type");
}

function isOpenCodeEventForSession(event: unknown, sessionId: string): event is Record<string, unknown> {
  if (!isRecord(event)) return false;
  const eventSessionId = findStringValue(event, ["sessionID", "sessionId"]);
  return eventSessionId === sessionId;
}

function openCodeEventStatusType(event: unknown): string | null {
  if (!isRecord(event)) return null;
  return openCodeSessionStatus(event);
}

function openCodeEventErrorMessage(event: unknown): string {
  if (!isRecord(event)) return "OpenCode error";
  const properties = isRecord(event.properties) ? event.properties : event;
  const error = isRecord(properties.error) ? properties.error : null;
  const data = isRecord(error?.data) ? error.data : null;
  return (
    stringValue(data, "message") ??
    stringValue(error, "message") ??
    stringValue(error, "name") ??
    "OpenCode error"
  );
}

function extractOpenCodePartTokenUsage(value: unknown): TokenUsageSnapshot | null {
  if (!isRecord(value)) return null;
  const part = isRecord(value.part)
    ? value.part
    : isRecord(value.properties) && isRecord(value.properties.part)
      ? value.properties.part
      : null;
  const tokens = isRecord(part?.tokens) ? part.tokens : null;
  if (!tokens) return null;

  const inputTokens = asFiniteNonNegativeNumber(tokens.input);
  const outputTokens = asFiniteNonNegativeNumber(tokens.output);
  const reasoningOutputTokens = asFiniteNonNegativeNumber(tokens.reasoning);
  const totalTokens =
    asFinitePositiveNumber(tokens.total) ??
    (inputTokens !== null || outputTokens !== null || reasoningOutputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningOutputTokens ?? 0)
      : null);
  if (totalTokens === null || totalTokens <= 0) return null;

  return {
    usedTokens: totalTokens,
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== null ? { reasoningOutputTokens } : {}),
    lastUsedTokens: totalTokens,
  };
}

function extractLooseOpenCodeDelta(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const type = stringValue(value, "type");
  if (type !== "session.next.text.delta") return null;
  const properties = isRecord(value.properties) ? value.properties : value;
  return stringValue(properties, "delta");
}

function extractOpenCodeCompaction(
  value: unknown,
): { automatic?: boolean; overflow?: boolean } | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  const properties = isRecord(value.properties) ? value.properties : value;

  if (type === "session.compacted") {
    return { automatic: true };
  }

  const part = isRecord(properties.part) ? properties.part : properties;
  if (part.type === "compaction") {
    return {
      automatic: typeof part.auto === "boolean" ? part.auto : undefined,
      overflow: typeof part.overflow === "boolean" ? part.overflow : undefined,
    };
  }

  const info = isRecord(properties.info) ? properties.info : null;
  const time = isRecord(info?.time) ? info.time : null;
  if (typeof time?.compacted === "number") return { automatic: true };

  return null;
}

function isOpenCodeCompacting(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const properties = isRecord(value.properties) ? value.properties : value;
  const info = isRecord(properties.info) ? properties.info : null;
  const time = isRecord(info?.time) ? info.time : null;
  return typeof time?.compacting === "number" && typeof time.compacted !== "number";
}

function parseOpenCodeModel(
  slug: string,
): { providerId: string; modelId: string } | null {
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return null;
  return {
    providerId: slug.slice(0, separator),
    modelId: slug.slice(separator + 1),
  };
}

async function waitForOpenCodeServerUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let stdout = "";

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Timed out waiting for OpenCode server start."));
    }, 5_000);
  });

  const read = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stdout += decoder.decode(chunk.value, { stream: true });
      const url = parseOpenCodeServerUrl(stdout);
      if (url) {
        return url;
      }
    }
    throw new Error("OpenCode server exited before reporting its URL.");
  })();

  return Promise.race([read, timeout]);
}

function parseOpenCodeServerUrl(output: string): string | null {
  for (const line of output.split(/\r?\n/g)) {
    if (!line.startsWith("opencode server listening")) continue;
    const match = /on\s+(https?:\/\/[^\s]+)/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractOpenCodeDelta(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  const properties = isRecord(value.properties) ? value.properties : value;

  if (type === "text") {
    const text = findStringValue(value, ["text"]);
    if (text) return text;
  }

  if (type === "message.part.delta") {
    const delta = findStringValue(properties, ["delta", "text"]);
    if (delta) return delta;
  }

  if (type === "message.part.updated" || type === "message.updated") {
    const role = findStringValue(properties, ["role"]);
    if (role && role !== "assistant") return null;
    const text = findStringValue(properties, ["text", "content"]);
    if (text) return text;
  }

  const text = findStringValue(value, ["delta"]);
  return text;
}

function fallbackOpenCodeText(raw: string): string {
  const chunks: string[] = [];
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const delta = extractOpenCodeDelta(parsed);
      if (delta) chunks.push(delta);
    } catch {
      chunks.push(trimmed);
    }
  }
  return chunks.join(chunks.length > 1 ? "\n" : "");
}

function extractGenericTokenUsage(value: unknown): TokenUsageSnapshot | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage)
    ? value.usage
    : isRecord(value.properties) && isRecord(value.properties.usage)
      ? value.properties.usage
      : null;
  if (!usage) return null;

  const inputTokens =
    asFiniteNonNegativeNumber(usage.inputTokens) ??
    asFiniteNonNegativeNumber(usage.input_tokens) ??
    asFiniteNonNegativeNumber(usage.promptTokens) ??
    asFiniteNonNegativeNumber(usage.prompt_tokens);
  const outputTokens =
    asFiniteNonNegativeNumber(usage.outputTokens) ??
    asFiniteNonNegativeNumber(usage.output_tokens) ??
    asFiniteNonNegativeNumber(usage.completionTokens) ??
    asFiniteNonNegativeNumber(usage.completion_tokens);
  const reasoningOutputTokens =
    asFiniteNonNegativeNumber(usage.reasoningOutputTokens) ??
    asFiniteNonNegativeNumber(usage.reasoning_output_tokens);
  const totalTokens =
    asFinitePositiveNumber(usage.totalTokens) ??
    asFinitePositiveNumber(usage.total_tokens) ??
    asFinitePositiveNumber(usage.total) ??
    (inputTokens !== null || outputTokens !== null || reasoningOutputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningOutputTokens ?? 0)
      : null);
  if (totalTokens === null || totalTokens <= 0) return null;

  const maxTokens =
    asFinitePositiveNumber(usage.maxTokens) ??
    asFinitePositiveNumber(usage.max_tokens) ??
    asFinitePositiveNumber(usage.contextWindow) ??
    asFinitePositiveNumber(usage.context_window);
  const totalProcessedTokens =
    asFinitePositiveNumber(usage.totalProcessedTokens) ??
    asFinitePositiveNumber(usage.total_processed_tokens);

  return {
    usedTokens: totalTokens,
    ...(totalProcessedTokens !== null && totalProcessedTokens > totalTokens
      ? { totalProcessedTokens }
      : {}),
    ...(maxTokens !== null ? { maxTokens } : {}),
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== null ? { reasoningOutputTokens } : {}),
    lastUsedTokens: totalTokens,
  };
}

function findStringValue(value: unknown, keys: ReadonlyArray<string>): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  for (const nestedKey of ["properties", "session", "info", "part", "message", "item", "tool", "state", "payload", "result"]) {
    const nested = value[nestedKey];
    const found = findStringValue(nested, keys);
    if (found) return found;
  }
  return null;
}
