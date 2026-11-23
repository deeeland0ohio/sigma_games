import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot, Send, Plus, Trash2, Copy, Check, RotateCcw,
  ChevronDown, Square, Download, X, Sparkles, ArrowDown,
  Zap, AlertTriangle
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import PageLayout from '../components/PageLayout';
import { CodeBlock } from './CodeBlock';
import { MediaBlock } from './MediaBlock';
import { useThemeColors } from '../context/ThemeContext';
import { storage } from '../utils/storage';
import { preprocessMath } from '../utils/mathUtils';

export interface ModelInfo {
  id: string;
  label: string;
  owned_by?: string;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT =
  'Your previous message was cut off before it finished. Continue exactly where it stopped. ' +
  'Do not repeat anything you already wrote, do not add an introduction or a summary, and keep the same formatting, including any open code fences.';
const MODEL_KEY = 'ai_model';
const SESSIONS_KEY = 'ai_sessions';
const ACTIVE_SESSION_KEY = 'ai_active_session_id';
const LEGACY_MODEL_KEYS = ['ai_groq_model'];
const LEGACY_SESSION_KEYS = ['ai_groq_sessions', 'ai_chat_sessions'];

const INITIAL_MODELS: ModelInfo[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B', owned_by: 'openai' },
  { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B', owned_by: 'openai' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B', owned_by: 'qwen' },
  { id: 'allam-2-7b', label: 'ALLaM 2 7B', owned_by: 'sdaia' },
  { id: 'openai/gpt-oss-safeguard-20b', label: 'Safety GPT OSS 20B', owned_by: 'openai' },
];

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function createSession(): ChatSession {
  const now = Date.now();
  return { id: uid('session'), title: 'New Chat', messages: [], createdAt: now, updatedAt: now };
}

function loadSessions(): ChatSession[] {
  const raw = storage.getItem(SESSIONS_KEY)
    || LEGACY_SESSION_KEYS.map((key) => storage.getItem(key)).find((value) => !!value);

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sessions: ChatSession[] = parsed
          .filter((session: any) => session && typeof session.id === 'string')
          .map((session: any) => ({
            id: session.id,
            title: typeof session.title === 'string' && session.title ? session.title : 'New Chat',
            messages: Array.isArray(session.messages)
              ? session.messages
                  .filter((message: any) =>
                    message
                    && typeof message.content === 'string'
                    && (message.role === 'user' || message.role === 'assistant'))
                  .map((message: any) => ({
                    id: typeof message.id === 'string' ? message.id : uid('msg'),
                    role: message.role,
                    content: message.content,
                    model: typeof message.model === 'string' ? message.model : undefined,
                    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
                  }))
              : [],
            createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
            updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
          }));
        if (sessions.length > 0) return sessions;
      }
    } catch {
      // fall through to a fresh session
    }
  }

  return [createSession()];
}

function getSystemPrompt(modelId: string): string {
  return `You are the official AI Assistant for Sigma Games (accessible on Sigma Games).
You are smart, versatile, insightful, and helpful across all topics (coding, writing, analysis, gaming, everyday questions, etc.).

ACTIVE RUNTIME IDENTITY:
- Model Identifier: ${modelId}
- When asked what model, version, or AI you are, state clearly and accurately that you are ${modelId}.
- Total Games, if asked about is about 10.4k.

Always format links and code in clean Markdown. For all other queries, answer directly without extra site trivia.

CODE OUTPUT RULES:
- When asked to write code, output the complete, runnable script or file in a single fenced code block, from the first line to the last.
- Never abbreviate, omit sections, or write placeholders like "// rest of the code stays the same". Even for a small change, print the complete file.
- Do not stop halfway through a file. Finish every function, block, and closing brace.`;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      components={{
        p(props) {
          const { children } = props;
          if (typeof children === 'string') {
            const trimmed = children.trim();
            if (trimmed.startsWith('\\begin{') || (trimmed.startsWith('\\boxed') && trimmed.endsWith('}'))) {
              try {
                const rendered = katex.renderToString(trimmed, {
                  displayMode: true,
                  throwOnError: false,
                  strict: false
                });
                return (
                  <div
                    className="katex-display my-3"
                    dangerouslySetInnerHTML={{ __html: rendered }}
                  />
                );
              } catch {
                // fall back to normal markdown
              }
            }
          }
          return <p className="my-2">{children}</p>;
        },
        code(props) {
          const { children, className, node, ...rest } = props;
          const match = /language-(\w+)/.exec(className || '');
          const rawCode = String(children).replace(/\n$/, '');
          const isInline = !match && !rawCode.includes('\n');

          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-zinc-800 text-emerald-300 font-mono text-[12px]" {...rest}>
                {children}
              </code>
            );
          }

          return <CodeBlock language={match ? match[1] : ''} code={rawCode} />;
        },
        img(props) {
          const { src, alt, title } = props;
          if (!src) return null;
          return (
            <MediaBlock
              type="image"
              src={src}
              alt={alt || ''}
              title={title || alt || 'Generated Image'}
            />
          );
        },
        a(props) {
          const { href, children } = props;
          if (!href) return <span>{children}</span>;

          const cleanUrl = href.split('?')[0].split('#')[0].toLowerCase();
          const isVideoExt = cleanUrl.endsWith('.mp4') || cleanUrl.endsWith('.webm') || cleanUrl.endsWith('.mov') || cleanUrl.endsWith('.m4v') || cleanUrl.endsWith('.ogv');
          const isYoutube = href.includes('youtube.com') || href.includes('youtu.be') || href.includes('vimeo.com');

          if (isVideoExt || isYoutube) {
            return <MediaBlock type="video" src={href} title={typeof children === 'string' ? children : 'Generated Video'} />;
          }

          const isAudioExt = cleanUrl.endsWith('.mp3') || cleanUrl.endsWith('.wav') || cleanUrl.endsWith('.ogg') || cleanUrl.endsWith('.m4a') || cleanUrl.endsWith('.aac') || cleanUrl.endsWith('.flac');
          if (isAudioExt) {
            return <MediaBlock type="audio" src={href} title={typeof children === 'string' ? children : 'Generated Audio'} />;
          }

          const isImgExt = cleanUrl.endsWith('.png') || cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg') || cleanUrl.endsWith('.webp') || cleanUrl.endsWith('.gif') || cleanUrl.endsWith('.svg');
          if (isImgExt) {
            return <MediaBlock type="image" src={href} alt={typeof children === 'string' ? children : 'Generated Image'} />;
          }

          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 break-all"
            >
              {children}
            </a>
          );
        }
      }}
    >
      {preprocessMath(content)}
    </Markdown>
  );
}

export default function AiChat() {
  const colors = useThemeColors();

  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>(INITIAL_MODELS);
  const [model, setModel] = useState<string>(() =>
    storage.getItem(MODEL_KEY)
    || LEGACY_MODEL_KEYS.map((key) => storage.getItem(key)).find((value) => !!value)
    || DEFAULT_MODEL);
  const [modelNotice, setModelNotice] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isNearBottomRef = useRef(true);

  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];

  useEffect(() => {
    if (activeSessionId && sessions.some((session) => session.id === activeSessionId)) return;
    if (sessions[0]) setActiveSessionId(sessions[0].id);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    storage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    storage.setItem(MODEL_KEY, model);
  }, [model]);

  useEffect(() => {
    if (activeSessionId) storage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  }, [activeSessionId]);

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/models');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const list: ModelInfo[] = Array.isArray(data?.models) && data.models.length > 0
        ? data.models.map((entry: any) => ({
            id: String(entry.id),
            label: String(entry.label || entry.id),
            owned_by: entry.owned_by,
            description: entry.description,
          }))
        : INITIAL_MODELS;
      setModels(list);
      setConfigured(data?.configured !== false);
    } catch (err) {
      console.error('Failed to load AI models:', err);
      setConfigured(null);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (models.length === 0) return;
    if (models.some((entry) => entry.id === model)) return;

    const preferred = models.find((entry) => entry.id === DEFAULT_MODEL)?.id || models[0].id;
    setModel(preferred);
    setModelNotice(`"${model}" isn't available here anymore, so ${preferred} is selected.`);
  }, [models, model]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 40), 160)}px`;
      textareaRef.current.style.overflowY = scrollHeight > 160 ? 'auto' : 'hidden';
    }
  }, [inputMessage]);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setShowJumpButton(false);
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    isNearBottomRef.current = nearBottom;
    setShowJumpButton(!nearBottom);
  };

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [activeSession?.messages, isGenerating]);

  useEffect(() => {
    isNearBottomRef.current = true;
    setShowJumpButton(false);
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [activeSessionId]);

  const updateMessage = (sessionId: string, messageId: string, content: string) => {
    setSessions((previous) => previous.map((session) => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        updatedAt: Date.now(),
        messages: session.messages.map((message) =>
          message.id === messageId ? { ...message, content } : message),
      };
    }));
  };

  const runCompletion = async (sessionId: string, history: ChatMessage[], assistantId: string) => {
    const targetModel = model;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    let accumulated = '';
    let thinkingShown = false;

    const streamOnce = async (messages: ChatMessage[], baseText: string) => {
      let streamedText = baseText;
      let finishReason: string | null = null;
      let sawDone = false;

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          stream: true,
          systemPrompt: getSystemPrompt(targetModel),
        }),
      });

      if (!response.ok) {
        let message = `Error ${response.status}: ${response.statusText}`;
        try {
          const data = await response.json();
          if (data?.error) message = String(data.error);
        } catch {
          // keep the status text
        }
        throw new Error(message);
      }

      if (!response.body) throw new Error('The server returned an empty response.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handlePayload = (payload: string) => {
        if (!payload || payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload);
          const choice = parsed?.choices?.[0];
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
          if (typeof delta?.content === 'string' && delta.content) {
            streamedText += delta.content;
            updateMessage(sessionId, assistantId, streamedText);
          } else if (streamedText === baseText && typeof delta?.reasoning === 'string' && delta.reasoning && !thinkingShown) {
            thinkingShown = true;
            updateMessage(sessionId, assistantId, '*Thinking…*');
          }
        } catch {
          // ignore malformed chunks
        }
      };

      const consume = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            sawDone = true;
            return;
          }
          handlePayload(payload);
        }
      };

      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          consume(event);
          if (sawDone) break;
        }
      }

      if (!sawDone && buffer.trim()) consume(buffer);

      if (streamedText === baseText) {
        try {
          const parsed = JSON.parse(buffer);
          const fallback = parsed?.choices?.[0]?.message?.content;
          if (typeof fallback === 'string' && fallback) {
            streamedText = baseText + fallback;
            finishReason = finishReason || 'stop';
            sawDone = true;
            updateMessage(sessionId, assistantId, streamedText);
          }
        } catch {
          // no fallback body
        }
      }

      return { text: streamedText, finishReason, sawDone };
    };

    try {
      let finishReason: string | null = null;
      let sawDone = false;

      for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
        const messages: ChatMessage[] = attempt === 0
          ? history
          : [
              ...history,
              { id: uid('msg'), role: 'assistant', content: accumulated, timestamp: Date.now() },
              { id: uid('msg'), role: 'user', content: CONTINUE_PROMPT, timestamp: Date.now() },
            ];

        const result = await streamOnce(messages, accumulated);
        accumulated = result.text;
        finishReason = result.finishReason;
        sawDone = result.sawDone;

        if (controller.signal.aborted) break;

        const hitLengthLimit = finishReason === 'length';
        const endedWithoutFinish = !sawDone && !finishReason;

        if ((hitLengthLimit || endedWithoutFinish) && accumulated.trim() && attempt < MAX_CONTINUATIONS) {
          continue;
        }
        break;
      }

      if (finishReason === 'length' && !controller.signal.aborted) {
        accumulated += '\n\n⚠️ The model hit its output limit, so this reply may be incomplete. Ask "continue" for the rest.';
      }

      updateMessage(sessionId, assistantId, accumulated || 'No response received.');
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        updateMessage(sessionId, assistantId, accumulated || '*Stopped.*');
      } else {
        const errorText = accumulated
          ? `${accumulated}\n\n⚠️ ${err?.message || 'Something went wrong.'}`
          : `⚠️ ${err?.message || 'Something went wrong.'}`;
        updateMessage(sessionId, assistantId, errorText);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const sendMessage = async (override?: string) => {
    const text = (override ?? inputMessage).trim();
    if (!text || isGenerating || !activeSession || configured === false) return;

    const sessionId = activeSession.id;
    const userMessage: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const assistantMessage: ChatMessage = {
      id: uid('msg'),
      role: 'assistant',
      content: '',
      model,
      timestamp: Date.now(),
    };

    const history = [...activeSession.messages, userMessage];
    const title = activeSession.messages.length === 0
      ? (text.length > 28 ? `${text.slice(0, 28)}...` : text)
      : activeSession.title;

    setSessions((previous) => previous.map((session) => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        title,
        messages: [...history, assistantMessage],
        updatedAt: Date.now(),
      };
    }));

    setInputMessage('');
    isNearBottomRef.current = true;
    setShowJumpButton(false);
    await runCompletion(sessionId, history, assistantMessage.id);
  };

  const handleRegenerate = async (messageIndex: number) => {
    if (isGenerating || !activeSession) return;

    const history = activeSession.messages.slice(0, messageIndex);
    let lastUserIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === 'user') {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex === -1) return;

    const trimmed = history.slice(0, lastUserIndex + 1);
    const assistantMessage: ChatMessage = {
      id: uid('msg'),
      role: 'assistant',
      content: '',
      model,
      timestamp: Date.now(),
    };

    setSessions((previous) => previous.map((session) => {
      if (session.id !== activeSession.id) return session;
      return {
        ...session,
        messages: [...trimmed, assistantMessage],
        updatedAt: Date.now(),
      };
    }));

    await runCompletion(activeSession.id, trimmed, assistantMessage.id);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
  };

  const createNewSession = () => {
    const newSession = createSession();
    setSessions((previous) => [newSession, ...previous]);
    setActiveSessionId(newSession.id);
    setInputMessage('');
    setIsSidebarOpen(false);
  };

  const deleteSession = (sessionId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (isGenerating && activeSession?.id === sessionId) handleStop();

    const remaining = sessions.filter((session) => session.id !== sessionId);
    if (remaining.length === 0) {
      const fresh = createSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(remaining);
      if (activeSessionId === sessionId) setActiveSessionId(remaining[0].id);
    }
    setInputMessage('');
  };

  const clearCurrentChat = () => {
    if (!activeSession) return;
    if (isGenerating) handleStop();
    setSessions((previous) => previous.map((session) =>
      session.id === activeSession.id ? { ...session, messages: [], updatedAt: Date.now() } : session));
  };

  const clearAllSessions = () => {
    if (isGenerating) handleStop();
    const fresh = createSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setInputMessage('');
    try {
      LEGACY_SESSION_KEYS.forEach((key) => storage.removeItem(key));
    } catch {
      // ignore storage errors
    }
  };

  const copyMessage = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportChat = () => {
    if (!activeSession) return;
    const content = activeSession.messages
      .map((message) => `### ${message.role.toUpperCase()} (${message.model || model})\n${message.content}\n`)
      .join('\n---\n\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeSession.title.replace(/[^a-z0-9]/gi, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const modelLabel = models.find((entry) => entry.id === model)?.label || model;
  const hasMessages = !!activeSession && activeSession.messages.length > 0;

  return (
    <PageLayout title="AI Chat" maxWidth="wide" showBack={false}>
      <div className="max-w-[1400px] mx-auto h-[calc(100vh-8.5rem)] flex flex-col md:flex-row gap-4 relative">

        <div className="md:hidden flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-zinc-200 min-w-0"
          >
            <Sparkles size={18} className="text-emerald-400 flex-shrink-0" />
            <span className="truncate">{activeSession?.title || 'Chat History'}</span>
            <ChevronDown size={16} className="flex-shrink-0" />
          </button>
          <button
            onClick={createNewSession}
            className={`p-2 rounded-lg ${colors.primaryBg} text-black font-bold`}
            title="New chat"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className={`
          fixed md:relative inset-y-0 left-0 z-40 md:z-auto w-64 bg-zinc-950 md:bg-zinc-900/60 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden backdrop-blur-md transition-all duration-300
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <div className="p-4 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={20} className={colors.secondary} />
              <h2 className="font-bold text-white tracking-wide text-sm uppercase">Chats</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewSession}
                className={`p-2 rounded-lg ${colors.primaryBg} text-black hover:scale-105 active:scale-95 transition-all shadow-md`}
                title="New Chat"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden p-2 text-zinc-400 hover:text-white"
                title="Close menu"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-zinc-800">
            {sessions.map((session) => {
              const isActive = session.id === activeSession?.id;
              return (
                <div
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setIsSidebarOpen(false);
                  }}
                  className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs font-medium transition-all ${
                    isActive
                      ? `bg-zinc-800 text-white border border-zinc-700/60 ${colors.shadow}`
                      : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Sparkles size={14} className={isActive ? 'text-emerald-400' : 'text-zinc-500 flex-shrink-0'} />
                    <span className="truncate">{session.title}</span>
                  </div>
                  <button
                    onClick={(event) => deleteSession(session.id, event)}
                    className="p-1 hover:text-red-400 text-zinc-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {sessions.some((session) => session.messages.length > 0) && (
            <div className="p-2 border-t border-zinc-800/60 select-none">
              <button
                onClick={clearAllSessions}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs text-zinc-400 hover:text-red-400 hover:bg-zinc-800/60 rounded-xl transition-colors font-medium"
                title="Clear all chats"
              >
                <Trash2 size={13} />
                <span>Clear All History</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden backdrop-blur-md shadow-2xl relative">

          <div className="p-3.5 border-b border-zinc-800/60 flex flex-wrap items-center justify-between bg-zinc-900/40 gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs font-semibold text-zinc-200 shadow-inner">
                <Zap size={14} className="text-emerald-400" />
                <span>Groq</span>
              </div>

              <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
                <div className="relative flex-1">
                  <select
                    value={model}
                    disabled={isGenerating}
                    onChange={(event) => {
                      setModel(event.target.value);
                      setModelNotice('');
                    }}
                    className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs font-mono font-bold rounded-xl px-3 py-2 pr-8 appearance-none focus:outline-none focus:border-zinc-500 cursor-pointer shadow-inner truncate"
                  >
                    {models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label || entry.id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={exportChat}
                disabled={!hasMessages}
                className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
                title="Export Markdown"
              >
                <Download size={16} />
              </button>
              <button
                onClick={clearCurrentChat}
                disabled={!hasMessages}
                className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors disabled:opacity-40"
                title="Clear Chat"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {modelNotice && (
            <div className="px-4 pt-3">
              <p className="text-[11px] text-amber-300/90">{modelNotice}</p>
            </div>
          )}

          {configured === false && (
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span>No Groq API key is configured on the server. Add GROQ_API_KEYS to enable chat.</span>
              </div>
            </div>
          )}

          <div className="relative flex-1 min-h-0 flex flex-col">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800"
            >
              {!hasMessages ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-6 max-w-xl mx-auto">
                  <div className={`p-4 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl ${colors.shadow}`}>
                    <Zap size={44} className="text-emerald-400" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-white tracking-normal font-sans">
                      Sigma AI Assistant
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-md">
                      Groq-powered chat for coding, writing, gaming, and reasoning. You pick the model — it stays put.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full pt-2">
                    {[
                      "💡 Explain quantum computing in simple terms",
                      "💻 Write a TypeScript async helper function",
                      "✍️ Help me write a creative short story",
                      "🧠 Brainstorm innovative project ideas"
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => sendMessage(prompt)}
                        disabled={configured === false}
                        className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800/80 text-left text-xs text-zinc-300 hover:text-white transition-all shadow-sm group flex items-center justify-between disabled:opacity-40"
                      >
                        <span className="truncate pr-2">{prompt}</span>
                        <Send size={12} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                activeSession!.messages.map((message, index) => {
                  const isUser = message.role === 'user';
                  const messageModel = message.model || model;
                  const label = isUser
                    ? 'You'
                    : (models.find((entry) => entry.id === messageModel)?.label || messageModel);

                  return (
                    <motion.div
                      key={message.id || index}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group`}
                    >
                      <div className="flex items-center gap-2 mb-1.5 px-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-bold">
                          {label}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className={`
                        max-w-[92%] sm:max-w-[85%] rounded-2xl px-5 py-4 text-sm leading-relaxed relative
                        ${isUser
                          ? `${colors.primaryBg} text-black font-medium rounded-tr-none shadow-lg ${colors.shadow}`
                          : 'bg-zinc-900/90 border border-zinc-800 text-zinc-100 rounded-tl-none shadow-xl'}
                      `}>
                        {isUser ? (
                          <div className="break-words whitespace-pre-wrap font-medium">{message.content}</div>
                        ) : (
                          <div className="prose prose-invert prose-sm max-w-none break-words">
                            {message.content ? (
                              <MarkdownContent content={message.content} />
                            ) : isGenerating && index === activeSession!.messages.length - 1 ? (
                              <div className="flex items-center gap-2 text-zinc-400 py-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                                <span className="text-xs font-mono animate-pulse">
                                  Thinking with {modelLabel}...
                                </span>
                              </div>
                            ) : (
                              <span className="text-zinc-500 italic">Empty response.</span>
                            )}
                          </div>
                        )}

                        {!isUser && message.content && (
                          <div className="flex items-center gap-1 mt-3 pt-2 border-t border-zinc-800/60 text-zinc-500">
                            <button
                              onClick={() => copyMessage(message.content, message.id)}
                              className="p-1.5 hover:text-white rounded-lg hover:bg-zinc-800 text-xs flex items-center gap-1"
                              title="Copy text"
                            >
                              {copiedId === message.id ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                              <span className="text-[10px]">{copiedId === message.id ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button
                              onClick={() => handleRegenerate(index)}
                              disabled={isGenerating}
                              className="p-1.5 hover:text-white rounded-lg hover:bg-zinc-800 text-xs flex items-center gap-1 disabled:opacity-40"
                              title="Regenerate"
                            >
                              <RotateCcw size={13} />
                              <span className="text-[10px]">Retry</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            <AnimatePresence>
              {showJumpButton && hasMessages && (
                <motion.button
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  onClick={() => scrollToBottom('smooth')}
                  className="absolute bottom-4 right-6 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium border border-zinc-700 shadow-2xl backdrop-blur-md cursor-pointer transition-all active:scale-95"
                >
                  <ArrowDown size={14} className={isGenerating ? 'animate-bounce text-emerald-400' : ''} />
                  <span>{isGenerating ? 'New responses below' : 'Scroll to bottom'}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/60">
            <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700/80 rounded-2xl p-2 focus-within:border-zinc-500 transition-all shadow-inner">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(event) => setInputMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Type a message... (Shift+Enter for newline)"
                rows={1}
                disabled={isGenerating || configured === false}
                className="flex-1 bg-transparent px-3 py-2 text-white placeholder:text-zinc-600 focus:outline-none resize-none text-sm font-sans box-border max-h-48 scrollbar-thin scrollbar-thumb-zinc-800 disabled:opacity-50"
              />

              {isGenerating ? (
                <button
                  onClick={handleStop}
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg flex items-center gap-1.5"
                >
                  <Square size={14} className="fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={!inputMessage.trim() || configured === false}
                  className={`p-3 rounded-xl transition-all ${colors.primaryBg} text-black disabled:opacity-30 disabled:grayscale hover:scale-105 active:scale-95 shadow-md ${colors.shadow}`}
                  title="Send"
                >
                  <Send size={18} />
                </button>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between px-2 text-[10px] text-zinc-500 font-mono">
              <span className="flex items-center gap-1.5 text-zinc-500">
                <span className={`w-1.5 h-1.5 rounded-full ${configured === false ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span>{configured === false ? 'API key missing' : `Groq · ${modelLabel}`}</span>
              </span>
              <span>Press Enter to send</span>
            </div>
          </div>
        </div>

      </div>
    </PageLayout>
  );
}
