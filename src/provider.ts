import {
  findEnvKeys,
  getEnvApiKey,
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  type KnownProvider,
  type Model as PiModel,
} from "@earendil-works/pi-ai";

export type ProviderDriverKind = "codex" | "claudeAgent" | "opencode" | "piAi";
export type PlatformProviderDriverKind = Exclude<ProviderDriverKind, "piAi">;
export type ProviderInstanceId = PlatformProviderDriverKind | `pi:${KnownProvider}`;
export type ProviderGroup = "platform" | "api";
export type TuiMode = "build" | "plan";

export interface ProviderOptionChoice {
  id: string;
  label: string;
  isDefault?: boolean;
}

export interface ProviderOptionDescriptor {
  id: string;
  label: string;
  type: "select" | "boolean";
  options?: ProviderOptionChoice[];
  currentValue?: string | boolean;
}

export interface ServerProviderModel {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom: boolean;
  contextWindow?: number;
  capabilities: {
    optionDescriptors: ProviderOptionDescriptor[];
  } | null;
}

export interface LocalProviderSnapshot {
  instanceId: ProviderInstanceId;
  driver: ProviderDriverKind;
  group: ProviderGroup;
  apiProviderId?: KnownProvider;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  status: "ready" | "warning" | "error" | "disabled";
  message?: string;
  models: ServerProviderModel[];
}

interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

const CODEX_MODELS: ServerProviderModel[] = [
  model("gpt-5.5", "GPT-5.5", [
    select("reasoningEffort", "Reasoning", ["low", "medium", "high", "xhigh"], "medium"),
  ]),
  model("gpt-5.4", "GPT-5.4", [
    select("reasoningEffort", "Reasoning", ["low", "medium", "high", "xhigh"], "medium"),
  ]),
  model("gpt-5.4-mini", "GPT-5.4 Mini", [
    select("reasoningEffort", "Reasoning", ["low", "medium", "high"], "medium"),
  ]),
  model("gpt-5.3-codex", "GPT-5.3 Codex", [
    select("reasoningEffort", "Reasoning", ["low", "medium", "high"], "medium"),
  ]),
  model("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", [
    select("reasoningEffort", "Reasoning", ["low", "medium", "high"], "medium"),
  ]),
];

const CLAUDE_MODELS: ServerProviderModel[] = [
  model("claude-opus-4-7", "Claude Opus 4.7", [
    select("effort", "Reasoning", ["low", "medium", "high", "xhigh", "max", "ultrathink"], "xhigh"),
    select("contextWindow", "Context Window", ["200k", "1m"], "200k"),
  ]),
  model("claude-opus-4-6", "Claude Opus 4.6", [
    select("effort", "Reasoning", ["low", "medium", "high", "max", "ultrathink"], "high"),
    booleanOption("fastMode", "Fast Mode"),
    select("contextWindow", "Context Window", ["200k", "1m"], "200k"),
  ]),
  model("claude-sonnet-4-6", "Claude Sonnet 4.6", [
    select("effort", "Reasoning", ["low", "medium", "high", "ultrathink"], "high"),
    select("contextWindow", "Context Window", ["200k", "1m"], "200k"),
  ]),
  model("claude-haiku-4-5", "Claude Haiku 4.5", [booleanOption("thinking", "Thinking")]),
];

const OPENCODE_FALLBACK_MODELS: ServerProviderModel[] = [
  model("openai/gpt-5", "GPT-5"),
  model("anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6"),
];

export async function loadLocalProviders(): Promise<LocalProviderSnapshot[]> {
  const [codex, claude, opencode] = await Promise.all([
    probeCodex(),
    probeProvider("claudeAgent", "claude", CLAUDE_MODELS),
    probeOpenCode(),
  ]);
  return [codex, claude, opencode, ...loadPiApiProviders()];
}

function model(
  slug: string,
  name: string,
  optionDescriptors: ProviderOptionDescriptor[] = [],
  metadata: Pick<ServerProviderModel, "contextWindow" | "subProvider"> = {},
): ServerProviderModel {
  return {
    slug,
    name,
    ...metadata,
    isCustom: false,
    capabilities: { optionDescriptors },
  };
}

function select(
  id: string,
  label: string,
  values: string[],
  currentValue: string,
): ProviderOptionDescriptor {
  return {
    id,
    label,
    type: "select",
    currentValue,
    options: values.map((value) => ({
      id: value,
      label: titleCase(value),
      ...(value === currentValue ? { isDefault: true } : {}),
    })),
  };
}

function booleanOption(id: string, label: string): ProviderOptionDescriptor {
  return { id, label, type: "boolean" };
}

async function probeProvider(
  driver: PlatformProviderDriverKind,
  binary: string,
  models: ServerProviderModel[],
): Promise<LocalProviderSnapshot> {
  const path = await commandOutput(["/bin/zsh", "-lc", `command -v ${binary}`], 1_500);
  const installed = path.ok && path.stdout.trim().length > 0;
  const version = installed ? await commandOutput([binary, "--version"], 2_500) : null;
  const displayName =
    driver === "claudeAgent" ? "Claude Code" : driver === "opencode" ? "OpenCode" : titleCase(driver);

  return {
    instanceId: driver,
    driver,
    group: "platform",
    displayName,
    enabled: installed,
    installed,
    version: version?.ok ? firstLine(version.stdout) : null,
    status: installed ? "ready" : "disabled",
    message: installed ? undefined : `${displayName} CLI is not installed or not on PATH.`,
    models,
  };
}

function loadPiApiProviders(): LocalProviderSnapshot[] {
  return getProviders().map((provider) => {
    const envKeys = findEnvKeys(provider) ?? [];
    const models = getModels(provider).map(mapPiModel);
    const expectedAuth = providerAuthLabel(provider);
    const configured = envKeys.length > 0 || getEnvApiKey(provider) !== undefined;

    return {
      instanceId: `pi:${provider}`,
      driver: "piAi",
      group: "api",
      apiProviderId: provider,
      displayName: piProviderDisplayName(provider),
      enabled: configured,
      installed: true,
      version: null,
      status: configured ? "ready" : "warning",
      message: configured
        ? `Configured with ${envKeys.join(", ") || expectedAuth}.`
        : `${expectedAuth} not found.`,
      models,
    };
  });
}

function mapPiModel(piModel: PiModel<string>): ServerProviderModel {
  const thinkingLevels = getSupportedThinkingLevels(piModel);
  const defaultThinking = thinkingLevels.includes("medium") ? "medium" : thinkingLevels[0] ?? "off";
  return model(
    piModel.id,
    piModel.name,
    thinkingLevels.length > 1
      ? [select("reasoning", "Reasoning", thinkingLevels, defaultThinking)]
      : [],
    {
      subProvider: `${piModel.provider} · ${piModel.api}`,
      contextWindow: piModel.contextWindow,
    },
  );
}

async function probeCodex(): Promise<LocalProviderSnapshot> {
  const base = await probeProvider("codex", "codex", CODEX_MODELS);
  if (!base.installed) {
    return base;
  }

  const liveModels = await requestCodexModels().catch(() => []);
  if (liveModels.length === 0) {
    return {
      ...base,
      message: "Using fallback Codex models because app-server model discovery failed.",
    };
  }

  return {
    ...base,
    models: liveModels,
  };
}

async function probeOpenCode(): Promise<LocalProviderSnapshot> {
  const base = await probeProvider("opencode", "opencode", OPENCODE_FALLBACK_MODELS);
  if (!base.installed) {
    return base;
  }

  const output = await commandOutput(["opencode", "models"], 4_000);
  const liveModels = output.ok ? parseOpenCodeModels(output.stdout) : [];
  return {
    ...base,
    models: liveModels.length > 0 ? liveModels : base.models,
    message:
      liveModels.length > 0
        ? undefined
        : "Using fallback OpenCode models because `opencode models` returned no rows.",
  };
}

async function requestCodexModels(): Promise<ServerProviderModel[]> {
  const proc = Bun.spawn(["codex", "app-server"], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const writer = proc.stdin;
  const reader = proc.stdout.getReader();
  const textDecoder = new TextDecoder();
  const pending = new Map<number, (value: JsonRpcResponse) => void>();
  let nextId = 1;
  let remainder = "";
  let stopped = false;

  const stderrPromise = new Response(proc.stderr).text().catch(() => "");

  const readLoop = (async () => {
    while (!stopped) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remainder += textDecoder.decode(chunk.value, { stream: true });
      const lines = remainder.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (isJsonRpcResponse(parsed)) {
          pending.get(Number(parsed.id))?.(parsed);
          pending.delete(Number(parsed.id));
          continue;
        }
        if (isJsonRpcRequest(parsed)) {
          await writeJson(writer, {
            id: parsed.id,
            error: { code: -32601, message: `Method not found: ${parsed.method}` },
          });
        }
      }
    }
  })();

  const request = async (method: string, params?: unknown) => {
    const id = nextId++;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 6_000);
      pending.set(id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
    await writeJson(writer, { id, method, ...(params !== undefined ? { params } : {}) });
    const payload = await response;
    if (payload.error) {
      throw new Error(payload.error.message ?? `Codex app-server request failed: ${method}`);
    }
    return payload.result;
  };

  const notify = (method: string, params?: unknown) =>
    writeJson(writer, { method, ...(params !== undefined ? { params } : {}) });

  try {
    await request("initialize", {
      clientInfo: {
        name: "code_tui",
        title: "Code TUI",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await notify("initialized");

    const account = await request("account/read", {});
    if (isCodexAccountReadResponse(account) && !account.account && account.requiresOpenaiAuth) {
      return [];
    }

    const models: ServerProviderModel[] = [];
    let cursor: string | null | undefined;
    do {
      const result = await request("model/list", cursor ? { cursor } : {});
      if (!isCodexModelListResponse(result)) break;
      models.push(...result.data.map(mapCodexModel));
      cursor = result.nextCursor;
    } while (cursor);

    return models;
  } finally {
    stopped = true;
    await Promise.resolve(writer.end()).catch(() => undefined);
    proc.kill();
    await Promise.race([readLoop, proc.exited, stderrPromise]).catch(() => undefined);
  }
}

function parseOpenCodeModels(raw: string): ServerProviderModel[] {
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => /^[^/\s]+\/[^/\s]+$/.test(line))
    .map((slug) => {
      const [, modelId = slug] = slug.split("/");
      return model(slug, titleCase(modelId));
    });
}

function mapCodexModel(raw: CodexModelListItem): ServerProviderModel {
  const reasoningEfforts = raw.supportedReasoningEfforts
    .map((entry) => entry.reasoningEffort.trim())
    .filter(Boolean);
  return model(raw.model, formatCodexDisplayName(raw.displayName || raw.model), [
    ...(reasoningEfforts.length > 0
      ? [select("reasoningEffort", "Reasoning", reasoningEfforts, raw.defaultReasoningEffort)]
      : []),
    ...((raw.additionalSpeedTiers ?? []).includes("fast")
      ? [booleanOption("fastMode", "Fast Mode")]
      : []),
  ]);
}

interface CodexModelListItem {
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
  additionalSpeedTiers?: string[];
}

function isCodexModelListResponse(value: unknown): value is {
  data: CodexModelListItem[];
  nextCursor?: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) return false;
  return value.data.every(
    (item) =>
      isRecord(item) &&
      typeof item.model === "string" &&
      typeof item.displayName === "string" &&
      typeof item.defaultReasoningEffort === "string" &&
      Array.isArray(item.supportedReasoningEfforts),
  );
}

function isCodexAccountReadResponse(value: unknown): value is {
  account: unknown;
  requiresOpenaiAuth: boolean;
} {
  return isRecord(value) && typeof value.requiresOpenaiAuth === "boolean";
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && ("result" in value || "error" in value) && typeof value.id !== "undefined";
}

function isJsonRpcRequest(value: unknown): value is { id: number | string; method: string } {
  return isRecord(value) && typeof value.method === "string" && typeof value.id !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function writeJson(
  writer: Bun.FileSink,
  payload: Record<string, unknown>,
) {
  writer.write(`${JSON.stringify(payload)}\n`);
  await Promise.resolve(writer.flush());
}

async function commandOutput(
  command: string[],
  timeoutMs: number,
): Promise<{ ok: true; stdout: string } | { ok: false; stdout: string; error: string }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));

  if (exitCode === 0) {
    return { ok: true, stdout };
  }
  return { ok: false, stdout, error: stderr.trim() || `Exited with ${exitCode}` };
}

function firstLine(value: string): string | null {
  return value.split(/\r?\n/g)[0]?.trim() || null;
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_/\s]+/g)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt$/i.test(part)) return "GPT";
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function piProviderDisplayName(provider: KnownProvider): string {
  const overrides: Partial<Record<KnownProvider, string>> = {
    "amazon-bedrock": "Amazon Bedrock",
    "azure-openai-responses": "Azure OpenAI",
    "cloudflare-ai-gateway": "Cloudflare AI Gateway",
    "cloudflare-workers-ai": "Cloudflare Workers AI",
    "github-copilot": "GitHub Copilot",
    "google-vertex": "Vertex AI",
    "kimi-coding": "Kimi For Coding",
    "minimax-cn": "MiniMax CN",
    moonshotai: "Moonshot AI",
    "moonshotai-cn": "Moonshot AI CN",
    "openai-codex": "OpenAI Codex OAuth",
    opencode: "OpenCode Zen",
    "opencode-go": "OpenCode Go",
    "vercel-ai-gateway": "Vercel AI Gateway",
    "xiaomi-token-plan-ams": "Xiaomi Token Plan AMS",
    "xiaomi-token-plan-cn": "Xiaomi Token Plan CN",
    "xiaomi-token-plan-sgp": "Xiaomi Token Plan SGP",
    xai: "xAI",
    zai: "Z.ai",
  };
  return overrides[provider] ?? titleCase(provider);
}

function providerAuthLabel(provider: KnownProvider): string {
  const authLabels: Partial<Record<KnownProvider, string>> = {
    "amazon-bedrock": "AWS credentials",
    "github-copilot": "GitHub OAuth token",
    "google-vertex": "GOOGLE_CLOUD_API_KEY or Google ADC",
    "openai-codex": "ChatGPT OAuth token",
  };
  return authLabels[provider] ?? piProviderEnvName(provider);
}

function piProviderEnvName(provider: KnownProvider): string {
  const envNames: Partial<Record<KnownProvider, string>> = {
    anthropic: "ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN",
    "azure-openai-responses": "AZURE_OPENAI_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
    "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    fireworks: "FIREWORKS_API_KEY",
    google: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    huggingface: "HF_TOKEN",
    "kimi-coding": "KIMI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    moonshotai: "MOONSHOT_API_KEY",
    "moonshotai-cn": "MOONSHOT_API_KEY",
    openai: "OPENAI_API_KEY",
    opencode: "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    xai: "XAI_API_KEY",
    xiaomi: "XIAOMI_API_KEY",
    "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    zai: "ZAI_API_KEY",
  };
  return envNames[provider] ?? titleCase(provider);
}

function formatCodexDisplayName(value: string): string {
  return value.replace(/^gpt/i, "GPT").replace(/-([a-z])/g, (_, char: string) => `-${char.toUpperCase()}`);
}
