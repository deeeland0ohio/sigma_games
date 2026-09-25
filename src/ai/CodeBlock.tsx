import React, { useState, useMemo } from 'react';
import { Copy, Check, Code2, Terminal } from 'lucide-react';
import katex from 'katex';
import { sanitizeEnvironmentBody, normalizeShorthandFractions } from '../utils/mathUtils';

interface CodeBlockProps {
  language?: string;
  code: string;
}

// Helper to determine if a block of code is actually a LaTeX / Math formula
function isMathBlock(lang: string, code: string): boolean {
  const l = (lang || '').toLowerCase().replace('language-', '').trim();
  if (l === 'latex' || l === 'math' || l === 'tex' || l === 'katex') return true;

  const trimmed = code.trim();
  if (trimmed.startsWith('\\begin{') || trimmed.startsWith('$$') || trimmed.startsWith('\\[') || trimmed.startsWith('\\boxed')) {
    return true;
  }

  // If code contains dominant LaTeX commands and does NOT contain programming keywords
  const hasCodeKeywords = /\b(const|let|var|function|def|class|import|export|return|if|else|for|while|package|public|private)\b/.test(code);
  if (!hasCodeKeywords) {
    const hasMathCommands = /\\(?:frac|tfrac|dfrac|sqrt|int|iint|iiint|oint|sum|prod|lim|infty|aligned|pmatrix|matrix|cases|partial|nabla|cos|sin|tan|cot|sinh|cosh|coth|exp|ln|log|boxed|Bigl|Bigr|left|right|Gamma|theta|pi)\b/.test(trimmed);
    if (hasMathCommands) return true;
  }

  return false;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const displayLang = (language || 'code').toLowerCase().replace('language-', '');

  const isMath = isMathBlock(displayLang, code);

  // Render KaTeX HTML if it's math
  const renderedMathHtml = useMemo(() => {
    if (!isMath) return null;
    try {
      let mathCode = code.trim();
      // Strip outer $$ or \[ \] if present
      mathCode = mathCode.replace(/^\$\$|\$\$$/g, '').replace(/^\\\[|\\\]$/g, '').trim();

      // Normalize shorthand fractions and sanitize environment body
      mathCode = normalizeShorthandFractions(mathCode);
      if (mathCode.includes('\\begin{')) {
        mathCode = mathCode.replace(/\\begin\{([^\}]+)\}([\s\S]*?)(?:\\end\{\1\}|$)/g, (_m, env, inner) => {
          const sanitized = sanitizeEnvironmentBody(inner);
          return `\\begin{${env}}\n${sanitized}\n\\end{${env}}`;
        });
      } else {
        mathCode = sanitizeEnvironmentBody(mathCode);
      }

      return katex.renderToString(mathCode, {
        displayMode: true,
        throwOnError: false,
        strict: false
      });
    } catch (e) {
      // Fallback: try rendering with basic normalization
      try {
        return katex.renderToString(code.trim(), {
          displayMode: true,
          throwOnError: false,
          strict: false
        });
      } catch (e2) {
        return null;
      }
    }
  }, [isMath, code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code', err);
    }
  };

  // If detected as a math formula block, render it as an equation card
  if (isMath && renderedMathHtml) {
    return (
      <div className="my-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-xl relative group overflow-x-auto text-center">
        <div 
          className="katex-display !m-0 !p-0 !bg-transparent !border-none"
          dangerouslySetInnerHTML={{ __html: renderedMathHtml }} 
        />
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-sans shadow"
          title="Copy LaTeX source"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy LaTeX'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-[#0d1117] overflow-hidden shadow-xl text-left font-mono">
      {/* Code Window Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800/80 select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>
          {displayLang === 'bash' || displayLang === 'sh' || displayLang === 'shell' ? (
            <Terminal size={13} className="text-emerald-400 ml-1" />
          ) : (
            <Code2 size={13} className="text-blue-400 ml-1" />
          )}
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
            {displayLang}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 hover:text-white text-[11px] font-sans font-medium transition-all cursor-pointer shadow-sm active:scale-95"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400 font-semibold">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <div className="p-4 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-800 text-[13px] leading-relaxed text-zinc-200">
        <pre className="font-mono m-0 p-0 whitespace-pre">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
};
