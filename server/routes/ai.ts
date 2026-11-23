import { Router, Request, Response } from "express";

const aiRouter = Router();

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");

const MODELS_TIMEOUT_MS = 20_000;
const NON_STREAM_TIMEOUT_MS = 180_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const KEY_COOLDOWN_MS = 60_000;
const MODELS_CACHE_MS = 10 * 60_000;

const DEFAULT_GROQ_MODEL = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();

function readKeyList(...names: string[]): string[] {
  const keys: string[] = [];
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const piece of raw.split(/[\s,;]+/)) {
      const key = piece.trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

const groqKeys = () => readKeyList("GROQ_API_KEYS", "GROQ_API_KEY");
const hasGroq = () => groqKeys().length > 0;

const keyCooldownUntil = new Map<string, number>();
let nextGroqKeyIndex = 0;

function isCoolingDown(key: string): boolean {
  const until = keyCooldownUntil.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    keyCooldownUntil.delete(key);
    return false;
  }
  return true;
}

function coolDownKey(key: string, ms = KEY_COOLDOWN_MS): void {
  keyCooldownUntil.set(key, Date.now() + ms);
  console.warn(`[ai] Groq key ...${key.slice(-6)} resting for ${Math.round(ms / 1000)}s`);
}

function orderedGroqKeys(): string[] {
  const keys = groqKeys();
  if (keys.length <= 1) return keys;
  const start = nextGroqKeyIndex % keys.length;
  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  return [...rotated.filter((k) => !isCoolingDown(k)), ...rotated.filter(isCoolingDown)];
}

interface ModelInfo {
  id: string;
  label?: string;
  owned_by?: string;
  description?: string;
}

// Current text-chat models on Groq's API. Older entries (Llama 3.1/3.3,
// Qwen 3 32B, DeepSeek R1, Kimi K2) were retired by Groq, so they are not
// offered here anymore.
const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B (Recommended)", owned_by: "OpenAI", description: "Flagship 120B open-weights reasoning model. Best all-round choice, especially for code." },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", owned_by: "OpenAI", description: "Faster, lighter 20B reasoning model with high throughput." },
  { id: "qwen/qwen3.8-27b", label: "Qwen3.8 27B", owned_by: "Alibaba Cloud", description: "Strong analytical and multilingual model with a 131k context window." },
  { id: "allam-2-7b", label: "ALLaM 2 7B", owned_by: "SDAIA", description: "Compact Arabic-first instruction model." },
  { id: "openai/gpt-oss-safeguard-20b", label: "Safety GPT OSS 20B", owned_by: "OpenAI", description: "Safety and moderation tuned 20B model." },
];

let modelsCache: { at: number; models: ModelInfo[] } | null = null;

function upstreamFetch(url: string, key: string, init: RequestInit = {}, signal?: AbortSignal) {
  return fetch(url, {
    ...init,
    ...(signal ? { signal } : {}),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...((init.headers as Record<string, string>) || {}),
    },
  });
}

async function readErrorMessage(response: globalThis.Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      return parsed?.error?.message || parsed?.message || text.slice(0, 200) || fallback;
    } catch {
      return text.slice(0, 200) || fallback;
    }
  } catch {
    return fallback;
  }
}

function isGroqChatModel(model: any): boolean {
  if (!model || model.active === false) return false;
  const id = String(model.id || "").toLowerCase();
  // Prompt-guard classifiers are not chat models, but gpt-oss-safeguard is.
  if (id.includes("prompt-guard") || id.includes("prompt_guard") || id.includes("guard-2-")) return false;
  if (id.includes("whisper") || id.includes("orpheus") || id.includes("tts")) return false;
  const outputs = model.output_modalities;
  if (Array.isArray(outputs) && (!outputs.includes("text") || outputs.includes("speech") || outputs.includes("transcription"))) {
    return false;
  }
  return true;
}

async function fetchGroqModels(): Promise<ModelInfo[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_CACHE_MS) return modelsCache.models;
  if (!hasGroq()) return GROQ_FALLBACK_MODELS;

  for (const key of orderedGroqKeys()) {
    try {
      const response = await upstreamFetch(
        `${GROQ_BASE_URL}/models`,
        key,
        {},
        AbortSignal.timeout(MODELS_TIMEOUT_MS),
      );
      if (!response.ok) continue;
      const data: any = await response.json();
      const chatModels = Array.isArray(data?.data) ? data.data.filter(isGroqChatModel) : [];
      if (chatModels.length === 0) continue;

      const models: ModelInfo[] = chatModels.map((m: any) => {
        const known = GROQ_FALLBACK_MODELS.find((f) => f.id === m.id);
        return {
          id: m.id,
          label: known?.label || m.name || m.id,
          owned_by: m.owned_by || "groq",
          description: known?.description || `Groq LPU accelerated ${m.name || m.id}`,
        };
      });
      models.sort((a, b) => {
        if (a.id === DEFAULT_GROQ_MODEL) return -1;
        if (b.id === DEFAULT_GROQ_MODEL) return 1;
        const ai = GROQ_FALLBACK_MODELS.findIndex((f) => f.id === a.id);
        const bi = GROQ_FALLBACK_MODELS.findIndex((f) => f.id === b.id);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return (a.label || "").localeCompare(b.label || "");
      });

      modelsCache = { at: Date.now(), models };
      return models;
    } catch (err: any) {
      console.error("[ai] Groq /models failed:", err?.message || err);
    }
  }

  return modelsCache?.models || GROQ_FALLBACK_MODELS;
}

interface ChatOptions {
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface ChatResult {
  ok: boolean;
  upstream: globalThis.Response | null;
  model: string;
  error: string;
  status: number;
}

const chatOk = (upstream: globalThis.Response, model: string): ChatResult => ({
  ok: true,
  upstream,
  model,
  error: "",
  status: 200,
});

const chatFailed = (error: string, status: number): ChatResult => ({
  ok: false,
  upstream: null,
  model: "",
  error,
  status,
});

function chatBody(model: string, messages: any[], options: ChatOptions) {
  return JSON.stringify({
    model,
    messages,
    stream: options.stream,
    ...(options.temperature !== undefined ? { temperature: Number(options.temperature) } : {}),
    ...(options.max_tokens !== undefined ? { max_completion_tokens: Number(options.max_tokens) } : {}),
  });
}

async function attemptGroq(
  model: string,
  messages: any[],
  options: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const keys = orderedGroqKeys();
  if (keys.length === 0) {
    return chatFailed("No Groq API key is configured on this server (set GROQ_API_KEYS).", 503);
  }

  let lastMessage = "";
  let lastStatus = 502;

  for (const key of keys) {
    try {
      const response = await upstreamFetch(
        `${GROQ_BASE_URL}/chat/completions`,
        key,
        {
          method: "POST",
          body: chatBody(model, messages, options),
        },
        signal,
      );

      if (response.ok) {
        const usedIndex = keys.indexOf(key);
        if (usedIndex !== -1) nextGroqKeyIndex = usedIndex;
        return chatOk(response, model);
      }

      const message = await readErrorMessage(response, `Groq HTTP ${response.status}`);
      lastMessage = message;
      lastStatus = response.status;

      if (response.status === 401 || response.status === 402 || response.status === 429) {
        coolDownKey(key);
        continue;
      }

      return chatFailed(message, response.status);
    } catch (err: any) {
      lastMessage = err?.message || "Could not reach Groq";
      lastStatus = 504;
    }
  }

  return chatFailed(
    lastMessage || "All Groq keys are rate limited right now. Try again in a minute.",
    lastStatus === 429 ? 429 : 502,
  );
}

async function pipeStream(
  upstream: globalThis.Response,
  res: Response,
  controller: AbortController,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  // Abort only when the model goes quiet for a long time. A reply that keeps
  // streaming (for example a long script) is never cut off by a total timeout.
  const resetIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      console.warn("[ai] stream went quiet for too long; aborting upstream request");
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  res.on("close", () => {
    clearIdle();
    controller.abort();
    reader.cancel().catch(() => {});
  });

  try {
    for (;;) {
      resetIdle();
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") console.error("[ai] stream error:", err?.message || err);
  } finally {
    clearIdle();
    res.end();
  }
}

aiRouter.get("/ai/models", async (_req: Request, res: Response) => {
  const models = await fetchGroqModels();
  const defaultModel = models.some((m) => m.id === DEFAULT_GROQ_MODEL)
    ? DEFAULT_GROQ_MODEL
    : models[0]?.id || DEFAULT_GROQ_MODEL;

  return res.json({
    models,
    defaultModel,
    configured: hasGroq(),
  });
});

aiRouter.post("/ai/chat", async (req: Request, res: Response) => {
  const body = req.body || {};
  const { messages, systemPrompt } = body;
  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  const model = requestedModel || DEFAULT_GROQ_MODEL;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'messages' array." });
  }

  const available = await fetchGroqModels();
  if (available.length > 0 && !available.some((m) => m.id === model)) {
    return res.status(400).json({
      error: `Model "${model}" isn't available. Pick a model from the list.`,
    });
  }

  const conversation = [...messages];
  if (systemPrompt && conversation[0]?.role !== "system") {
    conversation.unshift({ role: "system", content: systemPrompt });
  }

  const options: ChatOptions = {
    stream: body.stream !== false,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  };

  const streamController = options.stream ? new AbortController() : null;
  const answer = await attemptGroq(
    model,
    conversation,
    options,
    streamController ? streamController.signal : AbortSignal.timeout(NON_STREAM_TIMEOUT_MS),
  );

  if (!answer.ok) {
    const status = answer.status === 429 ? 429 : answer.status >= 500 ? answer.status : 502;
    return res.status(status).json({ error: answer.error });
  }

  if (options.stream && answer.upstream) {
    await pipeStream(answer.upstream, res, streamController!);
    return;
  }

  const data: any = await answer.upstream.json().catch(() => ({}));
  data.model = answer.model;
  return res.json(data);
});

aiRouter.get("/ai/health", (_req: Request, res: Response) => {
  const keys = groqKeys();
  return res.json({
    ok: hasGroq(),
    provider: "groq",
    configured: hasGroq(),
    defaultModel: DEFAULT_GROQ_MODEL,
    keyCount: keys.length,
    keysResting: keys.filter(isCoolingDown).length,
  });
});

export default aiRouter;
