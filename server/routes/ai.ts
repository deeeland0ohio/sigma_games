import { Router, Request, Response } from "express";

const aiRouter = Router();

const EMIS_BASE_URL = (process.env.EMIS_BASE_URL || "https://emis.zxs-is-very.cool/v1").replace(/\/+$/, "");
const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");

const UPSTREAM_TIMEOUT_MS = 45_000;
const KEY_COOLDOWN_MS = 60_000;
const PROVIDER_COOLDOWN_MS = 60_000;
const MODELS_CACHE_MS = 10 * 60_000;

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_EMIS_MODEL = "claude-fable-5-1";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
const emisKey = () => (process.env.EMIS_API_KEY || "").trim();
const hasGroq = () => groqKeys().length > 0;
const hasEmis = () => emisKey().length > 0;

const keyCooldownUntil = new Map<string, number>();
let nextGroqKeyIndex = 0;

let emisCooldownUntil = 0;
let emisLastError = "";

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

const emisAvailable = () => hasEmis() && Date.now() >= emisCooldownUntil;

function coolDownEmis(reason: string): void {
  emisCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
  emisLastError = reason;
  console.warn(`[ai] Emis resting for ${PROVIDER_COOLDOWN_MS / 1000}s (${reason})`);
}

interface ModelInfo {
  id: string;
  label?: string;
  owned_by?: string;
  description?: string;
  premium?: boolean;
  tools?: boolean;
  vision?: boolean;
  image?: boolean;
  audio?: boolean;
  video?: boolean;
}

const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B (Recommended)", owned_by: "openai", description: "Flagship 120B open weights model with chain-of-thought reasoning on Groq LPUs." },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", owned_by: "openai", description: "Fast, efficient 20B reasoning model with high throughput." },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", owned_by: "qwen", description: "Multimodal, multilingual open model with strong analytical reasoning." },
  { id: "allam-2-7b", label: "ALLaM 2 7B", owned_by: "sdaia", description: "Bilingual Arabic and English language model." },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", owned_by: "meta", description: "State-of-the-art open weights model for general intelligence, math and coding." },
  { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B", owned_by: "deepseek", description: "Chain-of-thought reasoning distilled from DeepSeek R1." },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", owned_by: "meta", description: "Ultra-low latency model for blazing fast responses." },
];

const DEFAULT_EMIS_MODELS: ModelInfo[] = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (Recommended)", owned_by: "anthropic", description: "Fast, creative writing and high-intelligence assistance." },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", owned_by: "anthropic", description: "Smart, nuanced, and excellent at coding." },
  { id: "claude-opus-5", label: "Claude Opus 5", owned_by: "anthropic", description: "High-capability reasoning and depth." },
  { id: "glm-5.3", label: "GLM-5.3", owned_by: "zhipu", description: "Flagship balanced powerhouse model." },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", owned_by: "openai", description: "Next-gen GPT model with sharp logic." },
  { id: "gpt-6-astra", label: "GPT-6 Astra", owned_by: "openai", description: "Ultra-fast intelligent responses." },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", owned_by: "google", description: "Lightning-fast responses." },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", owned_by: "google", description: "Complex problem solving and coding." },
  { id: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", owned_by: "deepseek", description: "Deep thinking and detailed code." },
  { id: "grok-4.3", label: "Grok 4.3", owned_by: "xai", description: "Witty, straightforward, and capable." },
  { id: "qwen3-coder-plus", label: "Qwen 3 Coder Plus", owned_by: "qwen", description: "Specialized in software engineering." },
  { id: "minimax-m3", label: "MiniMax M3", owned_by: "minimax", description: "Rich context conversational model." },
];

let emisModelsCache: { at: number; models: ModelInfo[] } | null = null;
let groqModelsCache: { at: number; models: ModelInfo[] } | null = null;

function upstreamFetch(url: string, key: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
  if (id.includes("guard")) return false;
  if (id.includes("whisper") || id.includes("orpheus")) return false;
  const outputs = model.output_modalities;
  if (Array.isArray(outputs) && (!outputs.includes("text") || outputs.includes("speech") || outputs.includes("transcription"))) {
    return false;
  }
  return true;
}

async function fetchGroqModels(): Promise<ModelInfo[]> {
  if (groqModelsCache && Date.now() - groqModelsCache.at < MODELS_CACHE_MS) return groqModelsCache.models;
  if (!hasGroq()) return GROQ_FALLBACK_MODELS;

  for (const key of orderedGroqKeys()) {
    try {
      const response = await upstreamFetch(`${GROQ_BASE_URL}/models`, key);
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
        const ai = GROQ_FALLBACK_MODELS.findIndex((f) => f.id === a.id);
        const bi = GROQ_FALLBACK_MODELS.findIndex((f) => f.id === b.id);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return (a.label || "").localeCompare(b.label || "");
      });

      groqModelsCache = { at: Date.now(), models };
      return models;
    } catch (err: any) {
      console.error("[ai] Groq /models failed:", err?.message || err);
    }
  }

  return groqModelsCache?.models || GROQ_FALLBACK_MODELS;
}

async function fetchEmisModels(): Promise<ModelInfo[]> {
  if (emisModelsCache && Date.now() - emisModelsCache.at < MODELS_CACHE_MS) return emisModelsCache.models;
  if (!hasEmis()) return DEFAULT_EMIS_MODELS;

  try {
    const response = await upstreamFetch(`${EMIS_BASE_URL}/models`, emisKey(), {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    if (!response.ok) {
      coolDownEmis(await readErrorMessage(response, `Emis HTTP ${response.status}`));
      return emisModelsCache?.models || DEFAULT_EMIS_MODELS;
    }

    const data: any = await response.json();
    if (!Array.isArray(data?.data) || data.data.length === 0) return DEFAULT_EMIS_MODELS;

    const models: ModelInfo[] = data.data.map((m: any) => ({
      id: m.id,
      label: m.label || m.id,
      owned_by: m.owned_by || "ai",
      description: m.description,
      premium: m.premium,
      tools: m.tools,
      vision: m.vision,
      image: m.image,
      audio: m.audio,
      video: m.video,
    }));
    models.sort((a, b) => {
      if (a.id === DEFAULT_EMIS_MODEL) return -1;
      if (b.id === DEFAULT_EMIS_MODEL) return 1;
      return (a.label || a.id).localeCompare(b.label || b.id);
    });

    emisModelsCache = { at: Date.now(), models };
    return models;
  } catch (err: any) {
    coolDownEmis(err?.message || "Failed to reach Emis");
    return emisModelsCache?.models || DEFAULT_EMIS_MODELS;
  }
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
  allExhausted: boolean;
}

const chatOk = (upstream: globalThis.Response, model: string): ChatResult => ({
  ok: true,
  upstream,
  model,
  error: "",
  status: 200,
  allExhausted: false,
});

const chatFailed = (error: string, status: number, allExhausted: boolean): ChatResult => ({
  ok: false,
  upstream: null,
  model: "",
  error,
  status,
  allExhausted,
});

function chatBody(model: string, messages: any[], options: ChatOptions) {
  return JSON.stringify({
    model,
    messages,
    stream: options.stream,
    ...(options.temperature !== undefined ? { temperature: Number(options.temperature) } : {}),
    ...(options.max_tokens !== undefined ? { max_tokens: Number(options.max_tokens) } : {}),
  });
}

async function attemptGroq(model: string, messages: any[], options: ChatOptions): Promise<ChatResult> {
  const keys = orderedGroqKeys();
  if (keys.length === 0) {
    return chatFailed("No Groq API key is configured on this server (set GROQ_API_KEYS).", 503, false);
  }

  const available = await fetchGroqModels();
  const availableIds = available.map((m) => m.id);
  const wanted = availableIds.includes(model) ? model : DEFAULT_GROQ_MODEL;

  const candidates = [wanted, DEFAULT_GROQ_MODEL, ...availableIds]
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 5);

  let lastMessage = "";
  let lastStatus = 502;

  for (const candidate of candidates) {
    let modelUnsupported = false;

    for (const key of keys) {
      try {
        const response = await upstreamFetch(`${GROQ_BASE_URL}/chat/completions`, key, {
          method: "POST",
          body: chatBody(candidate, messages, options),
        });

        if (response.ok) {
          const usedIndex = keys.indexOf(key);
          if (usedIndex !== -1) nextGroqKeyIndex = usedIndex;
          return chatOk(response, candidate);
        }

        const message = await readErrorMessage(response, `Groq HTTP ${response.status}`);
        lastMessage = message;
        lastStatus = response.status;
        const lower = message.toLowerCase();

        if (response.status === 401 || response.status === 402 || response.status === 429) {
          coolDownKey(key);
          continue;
        }

        if (response.status === 404 || response.status === 503 || lower.includes("does not exist") || lower.includes("not available")) {
          modelUnsupported = true;
          break;
        }

        if (response.status === 400 && lower.includes("model")) {
          modelUnsupported = true;
          break;
        }

        return chatFailed(message, 400, false);
      } catch (err: any) {
        lastMessage = err?.message || "Could not reach Groq";
        lastStatus = 504;
      }
    }

    if (modelUnsupported) continue;
  }

  return chatFailed(
    lastMessage || "All Groq keys are rate limited right now. Try again in a minute.",
    lastStatus === 429 ? 429 : 502,
    true,
  );
}

async function attemptEmis(model: string, messages: any[], options: ChatOptions): Promise<ChatResult> {
  if (!hasEmis()) {
    return chatFailed("No Emis API key is configured on this server (set EMIS_API_KEY).", 503, false);
  }

  try {
    const response = await upstreamFetch(`${EMIS_BASE_URL}/chat/completions`, emisKey(), {
      method: "POST",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      body: chatBody(model, messages, options),
    });

    if (response.ok) {
      emisCooldownUntil = 0;
      emisLastError = "";
      return chatOk(response, model);
    }

    const message = await readErrorMessage(response, `Emis HTTP ${response.status}`);
    coolDownEmis(message);
    return chatFailed(message, response.status === 429 ? 429 : 502, true);
  } catch (err: any) {
    const message = err?.message || "Could not reach Emis";
    coolDownEmis(message);
    return chatFailed(message, 504, true);
  }
}

async function pipeStream(upstream: globalThis.Response, res: Response): Promise<void> {
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

  res.on("close", () => {
    reader.cancel().catch(() => {});
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") console.error("[ai] stream error:", err?.message || err);
  } finally {
    res.end();
  }
}

aiRouter.get("/ai/models", async (req: Request, res: Response) => {
  const provider = String(req.query.provider || "all").toLowerCase();

  const [groq, emis] = await Promise.all([
    provider === "emis" ? Promise.resolve<ModelInfo[]>([]) : fetchGroqModels(),
    provider === "groq" ? Promise.resolve<ModelInfo[]>([]) : fetchEmisModels(),
  ]);

  const emisUp = emisAvailable();
  return res.json({
    groq,
    emis,
    groqConfigured: hasGroq(),
    emisConfigured: hasEmis(),
    emisExhausted: !emisUp,
    emisExhaustedReason: emisUp ? "" : hasEmis() ? emisLastError : "No EMIS_API_KEY configured on the server.",
  });
});

aiRouter.post("/ai/chat", async (req: Request, res: Response) => {
  const body = req.body || {};
  const { messages, systemPrompt } = body;
  const requestedModel = typeof body.model === "string" ? body.model : "";
  const requestedProvider = String(body.provider || "").toLowerCase();

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'messages' array." });
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

  const looksLikeGroq = /^(openai\/gpt-oss|qwen|allam-|llama-?[0-9]|llama-3|deepseek-r1|gemma|mixtral|mistral)/i.test(requestedModel);
  let provider: "groq" | "emis" = requestedProvider === "groq" ? "groq" : requestedProvider === "emis" ? "emis" : looksLikeGroq ? "groq" : "emis";

  if (provider === "emis" && !emisAvailable() && hasGroq()) provider = "groq";
  else if (provider === "groq" && !hasGroq() && hasEmis()) provider = "emis";

  const run = (target: "groq" | "emis"): Promise<ChatResult> =>
    target === "groq"
      ? attemptGroq(requestedModel || DEFAULT_GROQ_MODEL, conversation, options)
      : attemptEmis(requestedModel || DEFAULT_EMIS_MODEL, conversation, options);

  const firstProvider = provider;
  const first = await run(firstProvider);
  const fallback: "groq" | "emis" = firstProvider === "emis" ? "groq" : "emis";
  const canFallBack = !first.ok && (fallback === "groq" ? hasGroq() : emisAvailable());
  const second = canFallBack ? await run(fallback) : null;

  const switchedFrom = second && second.ok ? firstProvider : null;
  const usedProvider: "groq" | "emis" = switchedFrom ? fallback : firstProvider;
  const answer = second && second.ok ? second : first;

  if (!answer.ok) {
    const status = answer.status === 429 ? 429 : answer.status >= 500 ? answer.status : 502;
    return res.status(status).json({
      error: answer.error,
      ...(firstProvider === "emis" || usedProvider === "emis" ? { emisExhausted: true } : { allExhausted: true }),
    });
  }

  if (switchedFrom) {
    console.warn(`[ai] ${firstProvider} unavailable (${first.error}); answered with ${fallback} instead.`);
  }

  res.setHeader("Access-Control-Expose-Headers", "x-switched-provider, x-switched-model, x-original-provider, x-original-model, x-fallback-reason");
  if (switchedFrom) {
    res.setHeader("x-switched-provider", usedProvider);
    res.setHeader("x-original-provider", switchedFrom);
    res.setHeader("x-fallback-reason", "Primary provider unavailable; answered by the backup.");
  }
  if (answer.model !== requestedModel && requestedModel) {
    res.setHeader("x-switched-model", answer.model);
    res.setHeader("x-original-model", requestedModel);
  }

  if (options.stream && answer.upstream) {
    await pipeStream(answer.upstream, res);
    return;
  }

  const data: any = await answer.upstream.json().catch(() => ({}));
  data.provider = usedProvider;
  data.model = answer.model;
  return res.json(data);
});

aiRouter.get("/ai/health", (_req: Request, res: Response) => {
  const keys = groqKeys();
  const emisUp = emisAvailable();
  return res.json({
    ok: hasGroq() || hasEmis(),
    providers: {
      emis: {
        configured: hasEmis(),
        available: emisUp,
        lastError: emisLastError || null,
      },
      groq: {
        configured: keys.length > 0,
        keyCount: keys.length,
        keysResting: keys.filter(isCoolingDown).length,
      },
    },
    defaults: { groq: DEFAULT_GROQ_MODEL, emis: DEFAULT_EMIS_MODEL },
  });
});

export default aiRouter;
