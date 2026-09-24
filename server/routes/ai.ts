import { Router, Request, Response } from "express";

const aiRouter = Router();

const EMIS_BASE_URL = "https://emis.zxs-is-very.cool/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function resolveEmisKey(req?: Request): string {
  const headerKey = req ? ((req.headers?.["x-emis-api-key"] || req.headers?.["x-api-key"]) as string) : "";
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req?.body?.emisApiKey && typeof req.body.emisApiKey === "string" && req.body.emisApiKey.trim()) {
    return req.body.emisApiKey.trim();
  }
  return (process.env.EMIS_API_KEY || "").trim();
}

export function resolveGroqKey(req?: Request): string {
  const headerKey = req ? (req.headers?.["x-groq-api-key"] as string) : "";
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req?.body?.groqApiKey && typeof req.body.groqApiKey === "string" && req.body.groqApiKey.trim()) {
    return req.body.groqApiKey.trim();
  }
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  return "";
}

export function resolveGeminiKey(req?: Request): string {
  const headerKey = req ? (req.headers?.["x-gemini-api-key"] as string) : "";
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req?.body?.geminiApiKey && typeof req.body.geminiApiKey === "string" && req.body.geminiApiKey.trim()) {
    return req.body.geminiApiKey.trim();
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  return "";
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

// In-memory cache for models
let cachedEmisModels: ModelInfo[] | null = null;
let lastEmisCacheTime = 0;
let emisExhausted = false;
let emisExhaustedReason = "";

let cachedGroqModels: ModelInfo[] | null = null;
let lastGroqCacheTime = 0;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Groq Verified Chat Models Catalog
export const GROQ_FALLBACK_MODELS: ModelInfo[] = [
  { id: "groq/compound", label: "Groq Compound (Recommended)", owned_by: "groq", description: "Groq high-intelligence compound reasoning system. Ultra-fast and highly capable." },
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", owned_by: "openai", description: "Flagship 120B open weights model with chain-of-thought reasoning accelerated on Groq LPUs." },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", owned_by: "openai", description: "Fast, efficient 20B reasoning model with high throughput on Groq." },
  { id: "groq/compound-mini", label: "Groq Compound Mini", owned_by: "groq", description: "Lightweight compound AI model for snappy, instant responses." },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", owned_by: "qwen", description: "Multimodal and multilingual open model with strong analytical reasoning." },
  { id: "allam-2-7b", label: "ALLaM 2 7B", owned_by: "sdaia", description: "Bilingual Arabic and English language model." }
];

// Fallback list of popular Emis models
const DEFAULT_EMIS_MODELS: ModelInfo[] = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (Recommended)", owned_by: "anthropic", description: "Fast, creative writing and high-intelligence assistance." },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", owned_by: "anthropic", description: "Smart, nuanced, and excellent at coding." },
  { id: "claude-opus-5", label: "Claude Opus 5", owned_by: "anthropic", description: "High-capability reasoning and depth." },
  { id: "glm-5.3", label: "GLM-5.3", owned_by: "zhipu", description: "Flagship balanced powerhouse model." },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", owned_by: "openai", description: "Next-gen GPT model with sharp logic." },
  { id: "gpt-6-astra", label: "GPT-6 Astra", owned_by: "openai", description: "Ultra-fast intelligent responses." },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", owned_by: "openai", description: "Robust general-purpose assistant." },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", owned_by: "google", description: "Lightning-fast responses." },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", owned_by: "google", description: "Complex problem solving and coding." },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", owned_by: "google", description: "State-of-the-art fast multimodal logic." },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", owned_by: "deepseek", description: "Efficient and smart reasoning." },
  { id: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", owned_by: "deepseek", description: "Deep thinking and detailed code." },
  { id: "grok-4.3", label: "Grok 4.3", owned_by: "xai", description: "Witty, straightforward, and capable." },
  { id: "qwen3.8-max", label: "Qwen 3.8 Max", owned_by: "qwen", description: "Heavyweight multilingual reasoning." },
  { id: "qwen3-coder-plus", label: "Qwen 3 Coder Plus", owned_by: "qwen", description: "Specialized in software engineering." },
  { id: "minimax-m3", label: "MiniMax M3", owned_by: "minimax", description: "Rich context conversational model." }
];

// Helper to filter out non-chat models (e.g. classification, guardrails, speech, transcription)
function isGroqChatModel(m: any): boolean {
  if (m.active === false) return false;
  const id = (m.id || "").toLowerCase();
  // Filter out classification, moderation and guard models (prevents "text classification models do not support streaming")
  if (id.includes("prompt-guard") || id.includes("safeguard") || id.includes("guard")) return false;
  // Filter out audio and speech models
  if (id.includes("whisper") || id.includes("orpheus") || id.includes("canopylabs")) return false;
  if (m.output_modalities && !m.output_modalities.includes("text")) return false;
  if (m.output_modalities && (m.output_modalities.includes("speech") || m.output_modalities.includes("transcription"))) return false;
  return true;
}

// Helper to fetch Groq models
async function getGroqModels(groqKey: string): Promise<ModelInfo[]> {
  const now = Date.now();
  if (cachedGroqModels && (now - lastGroqCacheTime < CACHE_TTL_MS)) {
    return cachedGroqModels;
  }

  if (groqKey) {
    try {
      const groqRes = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${groqKey}`
        }
      });
      if (groqRes.ok) {
        const data: any = await groqRes.json();
        if (Array.isArray(data.data) && data.data.length > 0) {
          const chatModels = data.data.filter(isGroqChatModel);
          if (chatModels.length > 0) {
            cachedGroqModels = chatModels.map((m: any) => {
              const matchingFallback = GROQ_FALLBACK_MODELS.find(f => f.id === m.id);
              return {
                id: m.id,
                label: matchingFallback?.label || m.name || m.id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                owned_by: m.owned_by || "groq",
                description: matchingFallback?.description || `Groq LPU accelerated ${m.name || m.id}`
              };
            });

            // Prioritize recommended model
            cachedGroqModels.sort((a, b) => {
              if (a.id === "groq/compound") return -1;
              if (b.id === "groq/compound") return 1;
              if (a.id === "openai/gpt-oss-120b") return -1;
              if (b.id === "openai/gpt-oss-120b") return 1;
              return a.label.localeCompare(b.label);
            });

            lastGroqCacheTime = now;
            return cachedGroqModels;
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to fetch models from Groq API:", err?.message || err);
    }
  }

  return GROQ_FALLBACK_MODELS;
}

// Helper to fetch Emis models
async function getEmisModels(userKey: string): Promise<ModelInfo[]> {
  const now = Date.now();
  if (cachedEmisModels && (now - lastEmisCacheTime < CACHE_TTL_MS) && userKey === DEFAULT_EMIS_KEY) {
    return cachedEmisModels;
  }

  try {
    const upstreamRes = await fetch(`${EMIS_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${userKey}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    if (upstreamRes.ok) {
      const data: any = await upstreamRes.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        emisExhausted = false;
        emisExhaustedReason = "";

        cachedEmisModels = data.data.map((m: any) => ({
          id: m.id,
          label: m.label || m.id,
          owned_by: m.owned_by || "ai",
          description: m.description,
          premium: m.premium,
          tools: m.tools,
          vision: m.vision,
          image: m.image,
          audio: m.audio,
          video: m.video
        }));

        cachedEmisModels.sort((a, b) => {
          if (a.id === "claude-fable-5-1") return -1;
          if (b.id === "claude-fable-5-1") return 1;
          if (a.id === "claude-sonnet-5") return -1;
          if (b.id === "claude-sonnet-5") return 1;
          return (a.label || a.id).localeCompare(b.label || b.id);
        });

        lastEmisCacheTime = now;
        return cachedEmisModels;
      }
    } else {
      const errorText = await upstreamRes.text();
      emisExhausted = true;
      emisExhaustedReason = `Emis API reached usage limit or requires verification (HTTP ${upstreamRes.status})`;
      console.warn("Emis API returned error:", upstreamRes.status, errorText.slice(0, 120));
    }
  } catch (err: any) {
    emisExhausted = true;
    emisExhaustedReason = err?.message || "Failed to reach Emis API";
    console.error("Failed to fetch models from Emis API:", err?.message || err);
  }

  return cachedEmisModels || DEFAULT_EMIS_MODELS;
}

// GET /api/ai/status - check server environment and active keys
aiRouter.get("/ai/status", (req: Request, res: Response) => {
  const serverHasGroq = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
  const serverHasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const serverHasEmis = Boolean(process.env.EMIS_API_KEY && process.env.EMIS_API_KEY.trim());

  const activeGroq = Boolean(resolveGroqKey(req));
  const activeGemini = Boolean(resolveGeminiKey(req));
  const activeEmis = Boolean(resolveEmisKey(req));

  const isCloudRun = Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.CLOUD_RUN_JOB);

  return res.json({
    isCloudRun,
    serverEnvKeys: {
      groq: serverHasGroq,
      gemini: serverHasGemini,
      emis: serverHasEmis
    },
    activeKeys: {
      hasGroqKey: activeGroq,
      hasGeminiKey: activeGemini,
      hasEmisKey: activeEmis
    }
  });
});

// POST /api/ai/verify-key - test whether an API key works
aiRouter.post("/ai/verify-key", async (req: Request, res: Response) => {
  const { provider, key } = req.body || {};
  if (!key || typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ valid: false, message: "No API key was provided." });
  }

  const cleanKey = key.trim();

  if (provider === "groq") {
    try {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${cleanKey}` }
      });
      if (response.ok) {
        return res.json({ valid: true, message: "Groq API key is valid and connected!" });
      }
      const data: any = await response.json().catch(() => ({}));
      return res.json({ valid: false, message: data?.error?.message || `Groq returned HTTP ${response.status}` });
    } catch (e: any) {
      return res.json({ valid: false, message: e?.message || "Failed to contact Groq API." });
    }
  }

  if (provider === "gemini") {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`
      );
      if (response.ok) {
        return res.json({ valid: true, message: "Google Gemini API key is valid and connected!" });
      }
      const data: any = await response.json().catch(() => ({}));
      return res.json({ valid: false, message: data?.error?.message || `Google returned HTTP ${response.status}` });
    } catch (e: any) {
      return res.json({ valid: false, message: e?.message || "Failed to contact Google Gemini API." });
    }
  }

  if (provider === "emis") {
    try {
      const response = await fetch(`${EMIS_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      });
      if (response.ok) {
        return res.json({ valid: true, message: "Emis API key is valid and connected!" });
      }
      return res.json({ valid: false, message: `Emis returned HTTP ${response.status}` });
    } catch (e: any) {
      return res.json({ valid: false, message: e?.message || "Failed to contact Emis API." });
    }
  }

  return res.status(400).json({ valid: false, message: `Unknown provider: ${provider}` });
});

// GET /api/ai/models - fetch available models by provider
aiRouter.get("/ai/models", async (req: Request, res: Response) => {
  const provider = ((req.query.provider as string) || "all").toLowerCase();
  const userEmisKey = resolveEmisKey(req);
  const groqKey = resolveGroqKey(req);
  const geminiKey = resolveGeminiKey(req);

  if (provider === "groq") {
    const models = await getGroqModels(groqKey);
    return res.json({
      provider: "groq",
      hasKey: Boolean(groqKey),
      hasGeminiKey: Boolean(geminiKey),
      models
    });
  }

  if (provider === "emis") {
    const models = await getEmisModels(userEmisKey);
    return res.json({
      provider: "emis",
      hasKey: Boolean(userEmisKey),
      emisExhausted,
      emisExhaustedReason,
      models
    });
  }

  // Return full overview
  const [groqModels, emisModels] = await Promise.all([
    getGroqModels(groqKey),
    getEmisModels(userEmisKey)
  ]);

  return res.json({
    hasGroqKey: Boolean(groqKey),
    hasEmisKey: Boolean(userEmisKey),
    hasGeminiKey: Boolean(geminiKey),
    emisExhausted,
    emisExhaustedReason,
    groq: groqModels,
    emis: emisModels,
    models: groqModels
  });
});

interface GroqChatOptions {
  model: string;
  formattedMessages: any[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  isFailover?: boolean;
  originalProvider?: string;
  originalModel?: string;
  failoverReason?: string;
}

async function handleGeminiFallback(res: Response, options: { messages: any[]; stream: boolean }, req?: Request) {
  const geminiKey = resolveGeminiKey(req);
  if (!geminiKey) {
    return res.status(503).json({
      error: "All AI services are temporarily reaching their capacity. Please add a GROQ_API_KEY or GEMINI_API_KEY in Settings > API Keys, or in your Google Cloud Run environment variables."
    });
  }

  const { messages, stream } = options;
  const contents = messages
    .filter((m: any) => m.role !== "system")
    .map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }]
    }));

  const systemMessage = messages.find((m: any) => m.role === "system");
  const body: any = {
    contents,
    ...(systemMessage ? { systemInstruction: { parts: [{ text: String(systemMessage.content) }] } } : {})
  };

  const endpoint = stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse&key=${geminiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`;

  const geminiRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return res.status(geminiRes.status).json({ error: `AI error: ${errText}` });
  }

  res.setHeader("Access-Control-Expose-Headers", "x-switched-provider, x-switched-model");
  res.setHeader("x-switched-provider", "groq");
  res.setHeader("x-switched-model", "gemini-3.6-flash");

  if (stream && geminiRes.body) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          try {
            const dataObj = JSON.parse(trimmed.slice(5).trim());
            const textChunk = dataObj.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              const openAiChunk = {
                choices: [{ delta: { content: textChunk } }]
              };
              res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
            }
          } catch (e) {}
        }
      }
      res.write("data: [DONE]\n\n");
    } catch (e) {
      console.error("Gemini stream error:", e);
    } finally {
      res.end();
    }
  } else {
    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.json({
      choices: [{
        message: {
          role: "assistant",
          content: text
        }
      }]
    });
  }
}

async function handleGroqChat(req: Request, res: Response, options: GroqChatOptions) {
  const { model, formattedMessages, stream, temperature, max_tokens, isFailover, originalProvider, originalModel, failoverReason } = options;
  const groqKey = resolveGroqKey(req);
  const geminiKey = resolveGeminiKey(req);

  if (!groqKey) {
    if (geminiKey) {
      return handleGeminiFallback(res, { messages: formattedMessages, stream: !!stream }, req);
    }
    return res.status(400).json({
      error: "Groq API key is missing. Please configure GROQ_API_KEY in Settings > API Keys or in your Google Cloud Run environment variables."
    });
  }

  const availableGroqModels = await getGroqModels(groqKey);
  const validModelIds = new Set(availableGroqModels.map(m => m.id));

  // Determine requested model or default
  let requestedModel = model;
  if (!requestedModel || !validModelIds.has(requestedModel)) {
    requestedModel = availableGroqModels[0]?.id || "groq/compound";
  }

  const priorityFallbackOrder = [
    "groq/compound",
    "openai/gpt-oss-120b",
    "groq/compound-mini",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "allam-2-7b"
  ];

  const candidateModels: string[] = [
    requestedModel,
    ...priorityFallbackOrder.filter(id => id !== requestedModel && validModelIds.has(id)),
    ...availableGroqModels.map(m => m.id).filter(id => id !== requestedModel && !priorityFallbackOrder.includes(id))
  ];

  try {
    let upstreamRes: any = null;
    let successfulModel = requestedModel;
    let wasFallbackSwitched = Boolean(isFailover);
    let activeFallbackReason = failoverReason || "";
    let lastErrorMessage = "";

    for (const candidate of candidateModels) {
      try {
        const fetchRes = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`
          },
          body: JSON.stringify({
            model: candidate,
            messages: formattedMessages,
            stream: !!stream,
            ...(temperature !== undefined ? { temperature: Number(temperature) } : {}),
            ...(max_tokens !== undefined ? { max_tokens: Number(max_tokens) } : {})
          })
        });

        if (fetchRes.ok) {
          upstreamRes = fetchRes;
          successfulModel = candidate;
          if (candidate !== requestedModel) {
            wasFallbackSwitched = true;
          }
          break;
        }

        const errorText = await fetchRes.text();
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(errorText);
        } catch (e) {}

        const errMsg = errorJson?.error?.message || errorJson?.message || `HTTP ${fetchRes.status}: ${fetchRes.statusText}`;
        lastErrorMessage = errMsg;

        const isQuotaOrLimitError =
          fetchRes.status === 429 ||
          fetchRes.status === 402 ||
          fetchRes.status === 404 ||
          fetchRes.status === 503 ||
          errMsg.toLowerCase().includes("rate limit") ||
          errMsg.toLowerCase().includes("quota") ||
          errMsg.toLowerCase().includes("tpd") ||
          errMsg.toLowerCase().includes("rpd") ||
          errMsg.toLowerCase().includes("tpm") ||
          errMsg.toLowerCase().includes("rpm") ||
          errMsg.toLowerCase().includes("tokens per") ||
          errMsg.toLowerCase().includes("requests per") ||
          errMsg.toLowerCase().includes("capacity") ||
          errMsg.toLowerCase().includes("overloaded") ||
          errMsg.toLowerCase().includes("too many requests") ||
          errMsg.toLowerCase().includes("does not exist") ||
          errMsg.toLowerCase().includes("do not have access") ||
          errMsg.toLowerCase().includes("classification");

        if (isQuotaOrLimitError) {
          console.warn(`Groq model ${candidate} exhausted or unavailable (${errMsg}). Trying next model...`);
          activeFallbackReason = errMsg;
          continue;
        } else {
          return res.status(fetchRes.status).json({ error: errMsg });
        }
      } catch (callErr: any) {
        lastErrorMessage = callErr?.message || "Network error reaching Groq API";
        continue;
      }
    }

    if (!upstreamRes) {
      if (geminiKey) {
        console.warn("All Groq candidates exhausted. Falling back to Gemini API...");
        return handleGeminiFallback(res, { messages: formattedMessages, stream: !!stream }, req);
      }
      return res.status(429).json({
        error: `All available AI models have temporarily reached their rate or quota limits (${lastErrorMessage}). Please try again in a few moments.`,
        allExhausted: true
      });
    }

    res.setHeader("Access-Control-Expose-Headers", "x-switched-provider, x-switched-model, x-original-provider, x-original-model, x-fallback-reason");
    if (isFailover) {
      res.setHeader("x-switched-provider", "groq");
      res.setHeader("x-original-provider", originalProvider || "emis");
      res.setHeader("x-original-model", originalModel || "");
    }
    if (wasFallbackSwitched) {
      res.setHeader("x-switched-model", successfulModel);
      res.setHeader("x-original-model", requestedModel);
      res.setHeader("x-fallback-reason", activeFallbackReason);
    }

    if (stream && upstreamRes.body) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch (streamErr) {
        console.error("Groq stream reading error:", streamErr);
      } finally {
        res.end();
      }
    } else {
      const data = await upstreamRes.json();
      if (wasFallbackSwitched) {
        data.switchedModel = successfulModel;
        data.originalModel = requestedModel;
        data.fallbackReason = activeFallbackReason;
      }
      if (isFailover) {
        data.switchedProvider = "groq";
        data.originalProvider = originalProvider || "emis";
      }
      return res.json(data);
    }
  } catch (err: any) {
    console.error("Groq chat completion error:", err);
    return res.status(500).json({ error: err?.message || "Internal error communicating with Groq API." });
  }
}

// POST /api/ai/chat - proxy chat completions for Groq or Emis
aiRouter.post("/ai/chat", async (req: Request, res: Response) => {
  const requestedProvider = ((req.body.provider as string) || "").toLowerCase();
  const { model, messages, stream = true, temperature, max_tokens, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'messages' array." });
  }

  // Identify whether request should go to Groq or Emis
  const isGroqModel = GROQ_FALLBACK_MODELS.some(m => m.id === model) || 
    (model && (
      model.startsWith("groq/") || 
      model.startsWith("openai/gpt-oss") || 
      model.startsWith("qwen/") || 
      model.startsWith("allam-") || 
      model.startsWith("llama-") || 
      model.startsWith("deepseek-r1-distill") || 
      model.startsWith("gemma2-") || 
      model.startsWith("mixtral-")
    ));

  const provider = requestedProvider === "groq" || (requestedProvider !== "emis" && isGroqModel) ? "groq" : "emis";

  const formattedMessages = [...messages];
  if (systemPrompt && (!formattedMessages[0] || formattedMessages[0].role !== "system")) {
    formattedMessages.unshift({
      role: "system",
      content: systemPrompt
    });
  }

  if (provider === "groq") {
    return handleGroqChat(req, res, {
      model,
      formattedMessages,
      stream: !!stream,
      temperature,
      max_tokens
    });
  } else {
    // Emis Provider with resilient automatic failover to Groq
    const userEmisKey = resolveEmisKey(req);
    const selectedModel = (!model || model === "glm-5.3") ? "claude-fable-5-1" : model;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout to avoid hanging if upstream WebSocket stalls

      const upstreamRes = await fetch(`${EMIS_BASE_URL}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userEmisKey}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: formattedMessages,
          stream: !!stream,
          ...(temperature !== undefined ? { temperature: Number(temperature) } : {}),
          ...(max_tokens !== undefined ? { max_tokens: Number(max_tokens) } : {})
        })
      });

      clearTimeout(timeoutId);

      if (!upstreamRes.ok) {
        const errorText = await upstreamRes.text();
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(errorText);
        } catch (e) {}

        const errMsg = errorJson?.error?.message || errorJson?.message || `Emis API returned HTTP ${upstreamRes.status} (${upstreamRes.statusText})`;
        
        emisExhausted = true;
        emisExhaustedReason = errMsg;
        console.warn(`[AI Server] Emis returned error (${errMsg}). Automatically failing over to Groq LPU...`);

        // Transparently failover to Groq so chat NEVER fails on any PC!
        return handleGroqChat(req, res, {
          model: "groq/compound",
          formattedMessages,
          stream: !!stream,
          temperature,
          max_tokens,
          isFailover: true,
          originalProvider: "emis",
          originalModel: selectedModel,
          failoverReason: errMsg
        });
      }

      if (stream && upstreamRes.body) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
        } catch (streamErr) {
          console.error("Emis stream reading error:", streamErr);
        } finally {
          res.end();
        }
      } else {
        const data = await upstreamRes.json();
        return res.json(data);
      }
    } catch (err: any) {
      console.warn(`[AI Server] Emis fetch failed (${err?.message || err}). Automatically failing over to Groq LPU...`);
      emisExhausted = true;
      emisExhaustedReason = err?.message || "Emis connection failed";

      // Transparently failover to Groq so chat NEVER fails on any PC!
      return handleGroqChat(req, res, {
        model: "groq/compound",
        formattedMessages,
        stream: !!stream,
        temperature,
        max_tokens,
        isFailover: true,
        originalProvider: "emis",
        originalModel: selectedModel,
        failoverReason: err?.message || "Emis connection failed"
      });
    }
  }
});

export default aiRouter;

