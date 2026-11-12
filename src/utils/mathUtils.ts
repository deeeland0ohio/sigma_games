const DISPLAY_ENVIRONMENTS = [
  'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
  'aligned', 'align', 'align\\*', 'gather', 'gather\\*',
  'cases', 'array', 'equation', 'equation\\*', 'split',
  'multline', 'multline\\*', 'flalign', 'flalign\\*'
];

export function normalizeShorthandFractions(text: string): string {
  let s = text;

  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)([0-9a-zA-Z])([0-9a-zA-Z])/g, '\\$1{$2}{$3}');

  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)([0-9a-zA-Z])(\{)/g, '\\$1{$2}$3');

  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)(\{[^{}]+\})([0-9a-zA-Z])/g, '\\$1$2{$3}');
  return s;
}

export function sanitizeEnvironmentBody(body: string): string {
  if (!body) return '';

  let clean = normalizeShorthandFractions(body);

  clean = clean.replace(/(?:\\\\|\\[\s]*|(?<=[^\\])\s*)\[\s*(\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?)\s*\]/g, ' \\\\[$1] ');

  clean = clean.replace(/\\?(Gamma|F|f|g|h|S|I|A|B)!\s*\\left/g, '\\$1\\!\\left');

  clean = clean.replace(/([a-zA-Z])_(\{[0-9a-zA-Z\+\-]+\}|[0-9a-zA-Z])('{1,3})/g, '{$1_$2}$3');

  clean = clean.replace(/=;+\s*&/g, '&=');
  clean = clean.replace(/;+\s*-\s*;+/g, ' - ');
  clean = clean.replace(/;+\s*\+\s*;+/g, ' + ');
  clean = clean.replace(/;+\s*\\frac/g, ' \\frac');
  clean = clean.replace(/\\boxed\{\s*;+/g, '\\boxed{');
  clean = clean.replace(/;+\s*\}/g, '}');

  clean = clean.replace(/,\s*\\?d([a-zA-Z]|theta|phi|psi|omega|tau|mu|nu|rho)\b/g, '\\,d$1');

  clean = clean.replace(/[\,\.]\s*\\(?:\s+|\s*\n)\s*(\\?(?:Gamma|alpha|beta|theta|pi|F|f|g|h|I|S|A|B|[a-zA-Z0-9_\(\)]+)\b)/g, ' \\\\ $1');
  clean = clean.replace(/,\s*\\(?:\s+|\s*\n)\s*(\\?(?:frac|tfrac|dfrac|ln|log|exp|sin|cos|tan|cot|sec|csc)\b)/g, ' \\\\ $1');

  clean = clean.replace(/(^|[^\\])\\\s*&/g, '$1 \\\\ &');
  clean = clean.replace(/(^|[^\\])\\\s*\n/g, '$1 \\\\\n');

  clean = clean.replace(/(?<=\})\s*\\(?:\s+|\s*\n)\s*(?=\\?(?:Gamma|alpha|beta|theta|pi|F|f|g|h|I|S|A|B|text)\b)/g, ' \\\\ ');

  clean = clean.replace(/\\\\+\s*&/g, ' \\\\ &');

  clean = clean.replace(/\\\s*[\,\.]?\s*$/g, '');
  clean = clean.replace(/[\,\.]\s*$/g, '');

  return clean.trim();
}

function wrapProseMathExpressions(text: string): string {
  if (!text || text.includes('___')) return text;

  const mathSequenceRegex = /(?:\\(?:displaystyle|textstyle|frac|dfrac|tfrac|sqrt|int|iint|iiint|oint|sum|prod|lim|limsup|liminf|infty|partial|nabla|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|pm|mp|times|div|cdot|approx|sim|simeq|cong|equiv|ne|neq|le|leq|ge|geq|subset|supset|subseteq|supseteq|in|notin|ni|cup|cap|setminus|forall|exists|ln|log|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|operatorname|left|right|Bigl|Bigr|biggl|biggr|Biggl|Biggr|bigl|bigr|binom|dbinom|tbinom|boxed|Cl|erf|El))\b(?:[^{}\n]*?\{[^{}\n]*?\})*?(?:[A-Za-z0-9_\^\+\-\*\/\=\(\)\[\]\{\}\\\,\.\:\;\|\!\s]|\\(?:frac|tfrac|dfrac|sqrt|int|sum|prod|lim|infty|alpha|beta|gamma|delta|epsilon|varepsilon|theta|pi|sigma|omega|ln|log|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|left|right|Bigl|Bigr|bigl|bigr|quad|qquad|text|mathrm|mathbf|mathbb|mathcal|operatorname|partial|nabla|\,|\;|\!|\:))*?(?=[A-Z][a-z]{3,}|\b(?:is|are|was|were|then|where|with|and|or|for|if|when|so|we|let|from|to|as|by|which|that|satisfies|satisfy|yielding|yields|evaluating|evaluate|integrating|integrate|substituting|substitute|gives|giving)\b|[\.\,\;\:]\s+[A-Z]|$)/g;

  let result = text.replace(mathSequenceRegex, (match) => {
    let m = match.trim();
    if (!m || m.startsWith('___')) return match;

    let trailingPunct = '';
    const punctMatch = /^(.*?)([\.\,\;\:])$/.exec(m);
    if (punctMatch && !punctMatch[1].endsWith('\\')) {
      m = punctMatch[1].trim();
      trailingPunct = punctMatch[2];
    }

    if (!m) return match;

    m = m.replace(/([a-zA-Z])_(\{[0-9a-zA-Z\+\-]+\}|[0-9a-zA-Z])('{1,3})/g, '{$1_$2}$3');

    const openBraces = (m.match(/\{/g) || []).length;
    const closeBraces = (m.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      m += '}'.repeat(openBraces - closeBraces);
    }

    const openBrackets = (m.match(/\[/g) || []).length;
    const closeBrackets = (m.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      m += ']'.repeat(openBrackets - closeBrackets);
    }

    const openParens = (m.match(/\(/g) || []).length;
    const closeParens = (m.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      m += ')'.repeat(openParens - closeParens);
    }

    return `$${m}$${trailingPunct}`;
  });

  return result;
}

export function preprocessMath(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText;

  text = text.replace(/```(?:latex|math|tex|katex)\s*([\s\S]*?)```/gi, (_m, inner) => {
    return `\n\n$$\n${inner.trim()}\n$$\n\n`;
  });

  const codeBlocks: string[] = [];
  text = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
    codeBlocks.push(match);
    return placeholder;
  });

  text = text.replace(/\\boxed\{\s*(\\begin\{(?:matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|align|align\*|gather|gather\*|cases|array|equation|equation\*|split|multline|multline\*|flalign|flalign\*)\}[\s\S]*?\\end\{[^\}]+\})\s*\}/g, (_m, innerEnv) => {
    return innerEnv;
  });

  text = text.replace(/(?:\\\\|\\[\s]*|(?<=[^\\])\s*)\[\s*(\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?)\s*\]/g, ' \\\\[$1] ');

  text = text.split('\n').map((line) => {
    if (/^\s{2,8}\\(?:begin|int|sum|prod|lim|frac|tfrac|dfrac|sqrt|left|boxed|oint|partial|nabla)\b/.test(line)) {
      return line.trimStart();
    }
    return line;
  }).join('\n');

  const displayMathBlocks: string[] = [];

  const storeDisplayMath = (content: string): string => {
    const placeholder = `___DISPLAY_MATH_${displayMathBlocks.length}___`;
    let cleaned = content.trim();

    cleaned = cleaned.replace(/\\begin\{([^\}]+)\}([\s\S]*?)(?:\\end\{\1\}|$)/g, (_m, env, inner) => {
      const sanitized = sanitizeEnvironmentBody(inner);
      return `\\begin{${env}}\n${sanitized}\n\\end{${env}}`;
    });

    cleaned = sanitizeEnvironmentBody(cleaned);
    displayMathBlocks.push(`\n\n$$\n${cleaned}\n$$\n\n`);
    return placeholder;
  };

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });

  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => {
    const trimmed = inner.trim();
    if (/^\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?$/.test(trimmed)) {
      return ` \\\\[${trimmed}] `;
    }
    return storeDisplayMath(inner);
  });

  text = text.replace(/(?:^|\n)\s*\[\s*(\\boxed\{[\s\S]*?)(?:\]|\n\s*\]|\s*$)/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });
  text = text.replace(/\[\s*(\\boxed\{[^\n\]]+)\s*\]/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });

  const envRegex = new RegExp(`\\\\begin\\{(${DISPLAY_ENVIRONMENTS.join('|')})\\}([\\s\\S]*?)(?:\\\\end\\{\\1\\}|$)`, 'g');
  text = text.replace(envRegex, (_m, env, inner) => {
    const sanitizedInner = sanitizeEnvironmentBody(inner);
    return storeDisplayMath(`\\begin{${env}}\n${sanitizedInner}\n\\end{${env}}`);
  });

  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, math) => {
    return `$${math.trim()}$`;
  });

  const inlineMathBlocks: string[] = [];
  text = text.replace(/(?<!\\|\$)\$(?!\$)([^\$\n]+?)(?<!\\|\$)\$/g, (match, inner) => {
    if (/^\s*\d+(\.\d{2})?\s*$/.test(inner) && !inner.includes('\\')) {
      return match;
    }
    const placeholder = `___INLINE_MATH_${inlineMathBlocks.length}___`;
    inlineMathBlocks.push(`$${inner.trim()}$`);
    return placeholder;
  });

  text = normalizeShorthandFractions(text);

  const lines = text.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('___CODE_BLOCK_') || trimmed.includes('___DISPLAY_MATH_')) {
      return line;
    }

    const isStandaloneFormula = (
      /^\s*\\(?:int|sum|prod|lim|iint|iiint|oint|frac|tfrac|dfrac|sqrt|partial|nabla|Gamma|Cl|El)\b/.test(trimmed) ||
      /^\s*[A-Za-z](?:'|''|\([a-z0-9]\)|_[0-9a-zA-Z]+)?\s*=\s*\\(?:int|sum|prod|lim|iint|iiint|oint|frac|tfrac|dfrac|sqrt|Gamma|Cl|El|-|e\^)\b/.test(trimmed) ||
      /^\s*\\(?:text\{Res\}|Res|boxed)\b/.test(trimmed)
    ) && !trimmed.includes('___INLINE_MATH_');

    if (isStandaloneFormula) {
      return storeDisplayMath(trimmed);
    }

    let lineText = wrapProseMathExpressions(line);

    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([A-Za-z]_[0-9a-zA-Z]+)(?![a-zA-Z0-9_\$\\])/g, '$$1$');
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([a-zA-Z]'_[0-9a-zA-Z]+)(?![a-zA-Z0-9_\$\\])/g, '$$1$');
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])(Cl_[0-9]+)(?![a-zA-Z0-9_\$\\])/g, '$\\mathrm{$1}$');

    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([a-zA-Z]'{1,3}\([a-zA-Z0-9\+\-\/\s]+\))(?![a-zA-Z0-9_\$\\])/g, '$$1$');

    lineText = lineText.replace(/(?<![\$\\])([a-zA-Z0-9\(\)]+\s*!\s*\\sim\s*[^,\n\.]+)(?![\$\\])/g, '$$1$');

    lineText = lineText.replace(/(?<![\$\\])(\|[a-zA-Z0-9\+\-]+?\|\s*\\[a-zA-Z]+\s*[0-9a-zA-Z\.\-]+)(?![\$\\])/g, '$$1$');

    return lineText;
  });

  text = processedLines.join('\n');

  text = text.replace(/___INLINE_MATH_(\d+)___/g, (_m, index) => {
    return inlineMathBlocks[parseInt(index, 10)] || '';
  });

  text = text.replace(/___DISPLAY_MATH_(\d+)___/g, (_m, index) => {
    return displayMathBlocks[parseInt(index, 10)] || '';
  });

  text = text.replace(/___CODE_BLOCK_(\d+)___/g, (_m, index) => {
    return codeBlocks[parseInt(index, 10)] || '';
  });

  text = text.replace(/\$\$\s*\$([^\$]+)\$\s*\$\$/g, '$$\n$1\n$$');
  text = text.replace(/\$\$\$+/g, '$$');

  return text;
}
