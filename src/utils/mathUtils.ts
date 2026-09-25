/**
 * Production-Grade Universal Math & LaTeX Preprocessor for AI Studio
 * Robust single-pass pipeline for advanced mathematics, multi-line alignments,
 * contour integrals, Dawson/Fresnel/Clausen functions, Fourier series,
 * Stirling approximations, boxed solutions, prime derivatives, and systems of equations.
 */

// LaTeX environments that should be rendered as block-level display math
const DISPLAY_ENVIRONMENTS = [
  'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
  'aligned', 'align', 'align\\*', 'gather', 'gather\\*',
  'cases', 'array', 'equation', 'equation\\*', 'split',
  'multline', 'multline\\*', 'flalign', 'flalign\\*'
];

/**
 * Normalizes all shorthand LaTeX fractions: \frac12, \tfrac34, \dfrac12, etc. into standard \frac{1}{2}
 */
export function normalizeShorthandFractions(text: string): string {
  let s = text;
  // \tfrac12 -> \tfrac{1}{2}, \frac34 -> \frac{3}{4}, \dfrac12 -> \dfrac{1}{2}
  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)([0-9a-zA-Z])([0-9a-zA-Z])/g, '\\$1{$2}{$3}');
  // \tfrac1{...} -> \tfrac{1}{...}
  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)([0-9a-zA-Z])(\{)/g, '\\$1{$2}$3');
  // \tfrac{...}3 -> \tfrac{...}{3}
  s = s.replace(/\\(frac|tfrac|dfrac|cfrac)(\{[^{}]+\})([0-9a-zA-Z])/g, '\\$1$2{$3}');
  return s;
}

/**
 * Robustly repairs and formats any LaTeX environment body (e.g. aligned, matrix, cases)
 * so KaTeX can render it flawlessly without parse errors.
 */
export function sanitizeEnvironmentBody(body: string): string {
  if (!body) return '';

  let clean = normalizeShorthandFractions(body);

  // 1. Fix line-spacing brackets like `\[4pt]`, `\ [4pt]`, `\\[4pt]` -> `\\[4pt]`
  clean = clean.replace(/(?:\\\\|\\[\s]*|(?<=[^\\])\s*)\[\s*(\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?)\s*\]/g, ' \\\\[$1] ');

  // 2. Fix model exclamation notation like `\Gamma!\left` or `F!\left` -> `\Gamma\!\left`
  clean = clean.replace(/\\?(Gamma|F|f|g|h|S|I|A|B)!\s*\\left/g, '\\$1\\!\\left');

  // 3. Fix subscript + prime collision like `u_{1}'` -> `{u_{1}}'` to avoid double-script KaTeX error
  clean = clean.replace(/([a-zA-Z])_(\{[0-9a-zA-Z\+\-]+\}|[0-9a-zA-Z])('{1,3})/g, '{$1_$2}$3');

  // 4. Fix model garbage characters and rogue semicolons
  clean = clean.replace(/=;+\s*&/g, '&=');
  clean = clean.replace(/;+\s*-\s*;+/g, ' - ');
  clean = clean.replace(/;+\s*\+\s*;+/g, ' + ');
  clean = clean.replace(/;+\s*\\frac/g, ' \\frac');
  clean = clean.replace(/\\boxed\{\s*;+/g, '\\boxed{');
  clean = clean.replace(/;+\s*\}/g, '}');

  // 5. Fix typos like `,d\theta` -> `\,d\theta` or `,dx` -> `\,dx`
  clean = clean.replace(/,\s*\\?d([a-zA-Z]|theta|phi|psi|omega|tau|mu|nu|rho)\b/g, '\\,d$1');

  // 6. Fix inter-equation line breaks inside aligned / cases environment
  clean = clean.replace(/[\,\.]\s*\\(?:\s+|\s*\n)\s*(\\?(?:Gamma|alpha|beta|theta|pi|F|f|g|h|I|S|A|B|[a-zA-Z0-9_\(\)]+)\b)/g, ' \\\\ $1');
  clean = clean.replace(/,\s*\\(?:\s+|\s*\n)\s*(\\?(?:frac|tfrac|dfrac|ln|log|exp|sin|cos|tan|cot|sec|csc)\b)/g, ' \\\\ $1');

  // 7. Fix single backslash line-breaks before '&' or line endings
  clean = clean.replace(/(^|[^\\])\\\s*&/g, '$1 \\\\ &');
  clean = clean.replace(/(^|[^\\])\\\s*\n/g, '$1 \\\\\n');

  // 8. Fix `}\ \Gamma` or `}\ \text` transitions inside aligned
  clean = clean.replace(/(?<=\})\s*\\(?:\s+|\s*\n)\s*(?=\\?(?:Gamma|alpha|beta|theta|pi|F|f|g|h|I|S|A|B|text)\b)/g, ' \\\\ ');

  // 9. Normalize multiple consecutive backslashes before '&' to clean double backslash
  clean = clean.replace(/\\\\+\s*&/g, ' \\\\ &');

  // 10. Clean trailing backslashes, periods, or commas before \end
  clean = clean.replace(/\\\s*[\,\.]?\s*$/g, '');
  clean = clean.replace(/[\,\.]\s*$/g, '');

  return clean.trim();
}

/**
 * Scans a string and converts contiguous LaTeX math expressions into unified $...$ blocks
 * without cutting off exponents, subscripts, brackets, or math operators.
 */
function wrapProseMathExpressions(text: string): string {
  if (!text || text.includes('___')) return text;

  const mathSequenceRegex = /(?:\\(?:displaystyle|textstyle|frac|dfrac|tfrac|sqrt|int|iint|iiint|oint|sum|prod|lim|limsup|liminf|infty|partial|nabla|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|pm|mp|times|div|cdot|approx|sim|simeq|cong|equiv|ne|neq|le|leq|ge|geq|subset|supset|subseteq|supseteq|in|notin|ni|cup|cap|setminus|forall|exists|ln|log|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|operatorname|left|right|Bigl|Bigr|biggl|biggr|Biggl|Biggr|bigl|bigr|binom|dbinom|tbinom|boxed|Cl|erf|El))\b(?:[^{}\n]*?\{[^{}\n]*?\})*?(?:[A-Za-z0-9_\^\+\-\*\/\=\(\)\[\]\{\}\\\,\.\:\;\|\!\s]|\\(?:frac|tfrac|dfrac|sqrt|int|sum|prod|lim|infty|alpha|beta|gamma|delta|epsilon|varepsilon|theta|pi|sigma|omega|ln|log|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|left|right|Bigl|Bigr|bigl|bigr|quad|qquad|text|mathrm|mathbf|mathbb|mathcal|operatorname|partial|nabla|\,|\;|\!|\:))*?(?=[A-Z][a-z]{3,}|\b(?:is|are|was|were|then|where|with|and|or|for|if|when|so|we|let|from|to|as|by|which|that|satisfies|satisfy|yielding|yields|evaluating|evaluate|integrating|integrate|substituting|substitute|gives|giving)\b|[\.\,\;\:]\s+[A-Z]|$)/g;

  let result = text.replace(mathSequenceRegex, (match) => {
    let m = match.trim();
    if (!m || m.startsWith('___')) return match;

    // Separate trailing sentence punctuation (e.g. "." or "," or ":")
    let trailingPunct = '';
    const punctMatch = /^(.*?)([\.\,\;\:])$/.exec(m);
    if (punctMatch && !punctMatch[1].endsWith('\\')) {
      m = punctMatch[1].trim();
      trailingPunct = punctMatch[2];
    }

    if (!m) return match;

    // Fix subscript + prime collision like `u_{1}'` -> `{u_{1}}'`
    m = m.replace(/([a-zA-Z])_(\{[0-9a-zA-Z\+\-]+\}|[0-9a-zA-Z])('{1,3})/g, '{$1_$2}$3');

    // Check brace balance
    const openBraces = (m.match(/\{/g) || []).length;
    const closeBraces = (m.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      m += '}'.repeat(openBraces - closeBraces);
    }

    // Check bracket balance
    const openBrackets = (m.match(/\[/g) || []).length;
    const closeBrackets = (m.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      m += ']'.repeat(openBrackets - closeBrackets);
    }

    // Check parenthesis balance
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

  // 1. Unwrap markdown code blocks tagged with math/latex/tex into $$ display equations
  text = text.replace(/```(?:latex|math|tex|katex)\s*([\s\S]*?)```/gi, (_m, inner) => {
    return `\n\n$$\n${inner.trim()}\n$$\n\n`;
  });

  // 2. Protect genuine programming code blocks (```...``` and `...`)
  const codeBlocks: string[] = [];
  text = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
    codeBlocks.push(match);
    return placeholder;
  });

  // 3. Pre-emptively de-nest outer `\boxed{\begin{aligned}...}` so delimiters are not split
  text = text.replace(/\\boxed\{\s*(\\begin\{(?:matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|align|align\*|gather|gather\*|cases|array|equation|equation\*|split|multline|multline\*|flalign|flalign\*)\}[\s\S]*?\\end\{[^\}]+\})\s*\}/g, (_m, innerEnv) => {
    return innerEnv;
  });

  // 4. Pre-emptively fix line-spacing brackets `\[4pt]` everywhere so they never trigger display math delimiters
  text = text.replace(/(?:\\\\|\\[\s]*|(?<=[^\\])\s*)\[\s*(\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?)\s*\]/g, ' \\\\[$1] ');

  // 5. Strip 4-space/tab indents on lines containing LaTeX formulas so CommonMark doesn't turn them into <pre><code>
  text = text.split('\n').map((line) => {
    if (/^\s{2,8}\\(?:begin|int|sum|prod|lim|frac|tfrac|dfrac|sqrt|left|boxed|oint|partial|nabla)\b/.test(line)) {
      return line.trimStart();
    }
    return line;
  }).join('\n');

  // Unified Display Math Storage to eliminate any nested-placeholder collisions
  const displayMathBlocks: string[] = [];

  // Helper to store clean display math
  const storeDisplayMath = (content: string): string => {
    const placeholder = `___DISPLAY_MATH_${displayMathBlocks.length}___`;
    let cleaned = content.trim();

    // If it's an environment, ensure it is sanitized
    cleaned = cleaned.replace(/\\begin\{([^\}]+)\}([\s\S]*?)(?:\\end\{\1\}|$)/g, (_m, env, inner) => {
      const sanitized = sanitizeEnvironmentBody(inner);
      return `\\begin{${env}}\n${sanitized}\n\\end{${env}}`;
    });

    cleaned = sanitizeEnvironmentBody(cleaned);
    displayMathBlocks.push(`\n\n$$\n${cleaned}\n$$\n\n`);
    return placeholder;
  };

  // 6. Extract existing $$ ... $$ blocks FIRST
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });

  // 7. Extract existing \[ ... \] blocks NEXT
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => {
    const trimmed = inner.trim();
    if (/^\d+(?:\.\d+)?\s*(?:pt|em|ex|px)?$/.test(trimmed)) {
      return ` \\\\[${trimmed}] `;
    }
    return storeDisplayMath(inner);
  });

  // 8. Extract bracket-wrapped boxed formulas: [ \boxed{...} ]
  text = text.replace(/(?:^|\n)\s*\[\s*(\\boxed\{[\s\S]*?)(?:\]|\n\s*\]|\s*$)/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });
  text = text.replace(/\[\s*(\\boxed\{[^\n\]]+)\s*\]/g, (_m, inner) => {
    return storeDisplayMath(inner);
  });

  // 9. Extract all remaining LaTeX environments (\begin{aligned}...\end{aligned})
  const envRegex = new RegExp(`\\\\begin\\{(${DISPLAY_ENVIRONMENTS.join('|')})\\}([\\s\\S]*?)(?:\\\\end\\{\\1\\}|$)`, 'g');
  text = text.replace(envRegex, (_m, env, inner) => {
    const sanitizedInner = sanitizeEnvironmentBody(inner);
    return storeDisplayMath(`\\begin{${env}}\n${sanitizedInner}\n\\end{${env}}`);
  });

  // 10. Standardize inline math delimiters: \( ... \) -> $ ... $
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, math) => {
    return `$${math.trim()}$`;
  });

  // 11. Extract existing inline math ($ ... $) to protect them
  const inlineMathBlocks: string[] = [];
  text = text.replace(/(?<!\\|\$)\$(?!\$)([^\$\n]+?)(?<!\\|\$)\$/g, (match, inner) => {
    // Check if it's plain currency (e.g. $50, $100.00)
    if (/^\s*\d+(\.\d{2})?\s*$/.test(inner) && !inner.includes('\\')) {
      return match;
    }
    const placeholder = `___INLINE_MATH_${inlineMathBlocks.length}___`;
    inlineMathBlocks.push(`$${inner.trim()}$`);
    return placeholder;
  });

  // 12. Normalize shorthand fractions in remaining plain text
  text = normalizeShorthandFractions(text);

  // 13. Process plain text lines for standalone formulas and raw LaTeX expressions
  const lines = text.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('___CODE_BLOCK_') || trimmed.includes('___DISPLAY_MATH_')) {
      return line;
    }

    // Check if whole line is a standalone formula without delimiters (e.g. I = \int_0^1 ... or f'(x) = ...)
    const isStandaloneFormula = (
      /^\s*\\(?:int|sum|prod|lim|iint|iiint|oint|frac|tfrac|dfrac|sqrt|partial|nabla|Gamma|Cl|El)\b/.test(trimmed) ||
      /^\s*[A-Za-z](?:'|''|\([a-z0-9]\)|_[0-9a-zA-Z]+)?\s*=\s*\\(?:int|sum|prod|lim|iint|iiint|oint|frac|tfrac|dfrac|sqrt|Gamma|Cl|El|-|e\^)\b/.test(trimmed) ||
      /^\s*\\(?:text\{Res\}|Res|boxed)\b/.test(trimmed)
    ) && !trimmed.includes('___INLINE_MATH_');

    if (isStandaloneFormula) {
      return storeDisplayMath(trimmed);
    }

    // Scan prose for continuous LaTeX expressions
    let lineText = wrapProseMathExpressions(line);

    // Convert variable subscripts like A_n, B_n, S_1, S_2, z_k, z_1, z_2, x_i, a_n, Cl_2, u'_1 if not wrapped
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([A-Za-z]_[0-9a-zA-Z]+)(?![a-zA-Z0-9_\$\\])/g, '$$1$');
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([a-zA-Z]'_[0-9a-zA-Z]+)(?![a-zA-Z0-9_\$\\])/g, '$$1$');
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])(Cl_[0-9]+)(?![a-zA-Z0-9_\$\\])/g, '$\\mathrm{$1}$');

    // Convert prime derivative notations like f'(x), g'(x), h'(x), f''(x) if in math context
    lineText = lineText.replace(/(?<![a-zA-Z0-9_\$\\])([a-zA-Z]'{1,3}\([a-zA-Z0-9\+\-\/\s]+\))(?![a-zA-Z0-9_\$\\])/g, '$$1$');

    // Convert asymptotic expressions like n! \sim \sqrt{...}
    lineText = lineText.replace(/(?<![\$\\])([a-zA-Z0-9\(\)]+\s*!\s*\\sim\s*[^,\n\.]+)(?![\$\\])/g, '$$1$');

    // Convert absolute values with math relations like |x| \le 1
    lineText = lineText.replace(/(?<![\$\\])(\|[a-zA-Z0-9\+\-]+?\|\s*\\[a-zA-Z]+\s*[0-9a-zA-Z\.\-]+)(?![\$\\])/g, '$$1$');

    return lineText;
  });

  text = processedLines.join('\n');

  // 14. Restore protected inline math blocks
  text = text.replace(/___INLINE_MATH_(\d+)___/g, (_m, index) => {
    return inlineMathBlocks[parseInt(index, 10)] || '';
  });

  // 15. Restore protected display math blocks
  text = text.replace(/___DISPLAY_MATH_(\d+)___/g, (_m, index) => {
    return displayMathBlocks[parseInt(index, 10)] || '';
  });

  // 16. Restore protected code blocks
  text = text.replace(/___CODE_BLOCK_(\d+)___/g, (_m, index) => {
    return codeBlocks[parseInt(index, 10)] || '';
  });

  // 17. Clean up any accidental quadruple or nested dollar signs
  text = text.replace(/\$\$\s*\$([^\$]+)\$\s*\$\$/g, '$$\n$1\n$$');
  text = text.replace(/\$\$\$+/g, '$$');

  return text;
}
