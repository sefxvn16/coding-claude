// Minimal shell command lexer shared by the hooks. Not a full parser: a safety net.
// Handles quotes, command separators (&& || ; | & newline, parentheses, standalone braces),
// harmless vs file redirects, and quoted heredoc bodies. No dependencies.

export const MAX_DEPTH = 20;
export const MAX_LENGTH = 20000;
/** Thrown when a command is too long or nested too deeply to check; callers fail closed. */
export class LimitError extends Error {}

const HARMLESS_TARGET = /^(?:\/dev\/null|\$null|nul)$/i;
const ENV_ASSIGN = /^[A-Za-z_]\w*=/;

/** A quoted heredoc operator must be outside quotes and nested shell expressions. */
export function findHeredoc(line) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { depth = Math.max(0, depth - 1); continue; }
    if (depth || c !== '<' || line[i - 1] === '<') continue;
    const m = /^<<(-?)[ \t]*(['"])([A-Za-z_]\w*)\2/.exec(line.slice(i));
    if (m) return { index: i, length: m[0].length, marker: m[3], dash: !!m[1] };
  }
  return null;
}

/** Remove complete bodies of top-level quoted heredocs: they are literal data. */
export function stripHeredocs(src, bodies = null) {
  let rest = src;
  let out = '';
  for (;;) {
    const m = findHeredoc(rest);
    if (!m) return out + rest;
    const headerEnd = rest.indexOf('\n', m.index + m.length);
    if (headerEnd < 0) return out + rest;
    let start = headerEnd + 1;
    let found = false;
    while (start < rest.length) {
      const newline = rest.indexOf('\n', start);
      const end = newline < 0 ? rest.length : newline;
      const line = rest.slice(start, end).replace(/\r$/, '');
      if ((m.dash ? line.replace(/^\t+/, '') : line) === m.marker) {
        out += rest.slice(0, headerEnd);
        if (bodies) bodies.push(rest.slice(headerEnd + 1, start));
        rest = rest.slice(end);
        found = true;
        break;
      }
      start = end + 1;
    }
    if (!found) return out + rest;
  }
}

/**
 * Split a command into segments. Each segment: {words: string[], redirect: boolean}.
 * `redirect` is true when an unquoted > or >> writes to something other than /dev/null.
 */
export function lex(command) {
  const s = stripHeredocs(String(command));
  const segments = [];
  let words = [];
  let buf = '';
  let has = false; // buffer holds a token (possibly an empty quoted string)
  let redirect = false;
  let unbalanced = false;

  const pushWord = () => { if (has) words.push(buf); buf = ''; has = false; };
  const endSeg = () => {
    pushWord();
    if (words.length || redirect) segments.push({ words, redirect });
    words = []; redirect = false;
  };
  const isSpace = (c) => c === ' ' || c === '\t';

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) { unbalanced = true; buf += s.slice(i + 1); has = true; break; }
      buf += s.slice(i + 1, end); has = true; i = end; continue;
    }
    if (c === '"') {
      has = true;
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && s[j + 1] === '"') { buf += '"'; j++; } else buf += s[j];
      }
      if (j >= s.length) unbalanced = true;
      i = j; continue;
    }
    if (isSpace(c)) { pushWord(); continue; }
    if (c === '\n' || c === '\r' || c === ';' || c === '`' || c === '(' || c === ')') { endSeg(); continue; }
    if ((c === '{' || c === '}') && !has && (i + 1 >= s.length || /[\s;]/.test(s[i + 1]))) { endSeg(); continue; }
    if (c === '|') { endSeg(); if (s[i + 1] === '|' || s[i + 1] === '&') i++; continue; }
    if (c === '&' && s[i + 1] === '&') { endSeg(); i++; continue; }
    if (c === '>' || (c === '&' && s[i + 1] === '>')) {
      if (c === '&') i++;
      if (/^\d+$/.test(buf) && has) { buf = ''; has = false; } // fd number like 2>
      let j = i + 1;
      if (s[j] === '>') j++;
      if (s[j] === '|') j++;
      if (s[j] === '&' && /[\d-]/.test(s[j + 1] || '')) { i = j + 1; continue; } // 2>&1
      while (isSpace(s[j] || '')) j++;
      let target = '';
      let q = null;
      for (; j < s.length; j++) {
        const t = s[j];
        if (q) { if (t === q) q = null; else target += t; continue; }
        if (t === '"' || t === "'") { q = t; continue; }
        if (/[\s;|&()]/.test(t)) break;
        target += t;
      }
      if (!HARMLESS_TARGET.test(target)) redirect = true;
      i = j - 1; continue;
    }
    if (c === '&') { endSeg(); continue; }
    buf += c; has = true;
  }
  endSeg();
  return { segments, unbalanced };
}

/** Executable name: no quotes' path, no extension, lowercase. */
export function exeName(word) {
  const base = String(word).split(/[\\/]/).pop().toLowerCase();
  return base.replace(/\.(?:cmd|exe|ps1|bat|com)$/, '');
}

const WRAPPERS = new Set(['corepack', 'command', 'call', 'start', 'exec', 'env', 'time', 'nohup', 'sudo', 'builtin', 'noglob']);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const PM = new Set(['pnpm', 'yarn', 'npm', 'bun']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);

function shellInner(exe, words) {
  const isFlag = exe === 'cmd' ? (w) => /^\/[ck]$/i.test(w)
    : (exe === 'pwsh' || exe === 'powershell') ? (w) => /^-(?:c|command)$/i.test(w)
      : (w) => /^-[a-z]*c[a-z]*$/.test(w);
  const idx = words.findIndex((w, i) => i > 0 && isFlag(w));
  if (idx < 0) return null;
  return exe === 'cmd' || exe === 'pwsh' || exe === 'powershell'
    ? words.slice(idx + 1).join(' ')
    : (words[idx + 1] ?? '');
}

/** PowerShell backtick escapes (`n`pm) are removed before matching. */
const dePowerShell = (s) => String(s).replace(/`/g, '');

const VALUE_OPTIONS = new Set(['--prefix', '--registry', '--userconfig', '--cache', '--workspace', '-w',
  '--tag', '--otp', '--access', '--loglevel', '--before', '--scope', '-C', '--filter', '-F', '--cwd', '--dir']);

const PM_SCRIPT = /^(npm-cli|pnpm|yarn)\.[cm]?js$/i;
const STDIN_PRODUCERS = new Set(['echo', 'printf', 'write-output', 'write-host']);

/** True when a shell invocation reads its commands from stdin (no -c, no script file). */
function readsStdin(exe, words) {
  const args = words.slice(1);
  if (exe === 'cmd') return !args.some((w) => /^\/[ck]$/i.test(w)) && !args.some((w) => !w.startsWith('/') && !w.startsWith('<'));
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (['<', '<<', '<<<', '<<-'].includes(w)) { i++; continue; }
    if (w.startsWith('<')) continue;
    if (w === '-s' || w === '-') return true;
    if ((exe === 'pwsh' || exe === 'powershell') && /^-(?:c|command)$/i.test(w) && args[i + 1] === '-') return true;
    if (!w.startsWith('-')) positional.push(w);
  }
  return positional.length === 0;
}

/** Deterministic leading package-manager option skipping, shared with script resolution. */
export function skipPackageOptions(rest) {
  let i = 0;
  while (i < rest.length && rest[i].startsWith('-')) {
    const flag = rest[i++];
    if (flag === '--') break;
    if (!flag.includes('=') && VALUE_OPTIONS.has(flag) && i < rest.length) i++;
  }
  return rest.slice(i);
}

function normWords(input, depth, out, flags) {
  let words = input.slice();
  for (;;) {
    if (!words.length) return;
    if (ENV_ASSIGN.test(words[0])) { words.shift(); continue; }
    const exe = exeName(words[0]);
    if (WRAPPERS.has(exe) || RUNNERS.has(exe)) {
      words.shift();
      while (words.length && (words[0] === '' || /^-/.test(words[0]) || (exe === 'start' && /^\/\w+$/.test(words[0])))) words.shift();
      continue;
    }
    if (PM.has(exe)) {
      // Retain all tokens for the ordered-word safety net, including option values.
      out.push([exe, ...words.slice(1)]);
      const rest = skipPackageOptions(words.slice(1));
      words = [words[0], ...rest];
      if (['dlx', 'exec', 'x'].includes(rest[0])) {
        words = rest.slice(1);
        while (words.length && /^-/.test(words[0])) words.shift();
        continue;
      }
    }
    if (exe === 'node') {
      const i = words.findIndex((w, k) => k > 0 && !w.startsWith('-'));
      const base = i > 0 ? words[i].split(/[\\/]/).pop() : '';
      const m = PM_SCRIPT.exec(base);
      if (m) {
        words = [m[1].toLowerCase() === 'npm-cli' ? 'npm' : m[1].toLowerCase(), ...words.slice(i + 1)];
        continue;
      }
    }
    if (SHELLS.has(exe)) {
      const inner = shellInner(exe, words);
      if (inner !== null && inner.trim() !== '-') {
        const ps = exe === 'pwsh' || exe === 'powershell';
        const sub = normalizedSegments(inner, depth + 1, ps);
        out.push(...sub.tokenSegments);
        if (sub.opaque) flags.opaque = true;
        return;
      }
      if (readsStdin(exe, words)) flags.stdin = true;
    }
    break;
  }
  words[0] = exeName(words[0]);
  out.push(words);
}

/** Locate one expansion's closing delimiter, respecting nested expansions and quotes. */
function substitutionEnd(s, start, backtick, powershell, level = 0) {
  if (level > MAX_DEPTH) throw new LimitError('nesting too deep');
  let quote = null;
  let depth = 1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && !powershell && quote !== "'") { i++; continue; }
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '$' && s[i + 1] === '(') {
      const end = substitutionEnd(s, i + 2, false, powershell, level + 1);
      if (end < 0) return -1;
      i = end; continue;
    }
    if (c === '`' && !powershell) {
      if (backtick && !quote) return i;
      const end = substitutionEnd(s, i + 1, true, powershell, level + 1);
      if (end < 0) return -1;
      i = end; continue;
    }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (!backtick && c === '(') depth++;
    if (!backtick && c === ')' && --depth === 0) return i;
  }
  return -1;
}

function substitutions(command, powershell) {
  const s = stripHeredocs(command);
  const out = [];
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && !powershell && quote !== "'") { i++; continue; }
    if (quote === "'") { if (c === "'") quote = null; continue; }
    const backtick = c === '`' && !powershell;
    if (backtick || (c === '$' && s[i + 1] === '(')) {
      const start = i + (backtick ? 1 : 2);
      const end = substitutionEnd(s, start, backtick, powershell);
      out.push(s.slice(start, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end;
      continue;
    }
    if (quote) { if (c === quote) quote = null; }
    else if (c === "'" || c === '"') quote = c;
  }
  return out;
}

/**
 * Normalized command strings for gating: wrappers, env assignments, paths and
 * extensions removed; package-manager global options skipped; inner strings of
 * shell -c / cmd /c expanded recursively. `powershell: true` removes backtick escapes first.
 */
export function normalizedSegments(command, depth = 0, powershell = false) {
  if (depth > MAX_DEPTH) throw new LimitError('nesting too deep');
  if (String(command).length > MAX_LENGTH) throw new LimitError('command too long');
  const source = powershell ? dePowerShell(command) : String(command);
  const { segments, unbalanced } = lex(source);
  const out = [];
  const flags = { stdin: false, opaque: false };
  let literal = false;
  const feed = [];
  segments.forEach((seg, idx) => {
    const before = flags.stdin;
    normWords(seg.words, depth, out, flags);
    if (flags.stdin && !before) {
      const prev = segments[idx - 1];
      if (prev && STDIN_PRODUCERS.has(exeName(prev.words[0] ?? ''))) literal = true;
    }
  });
  let opaque = false;
  if (flags.stdin) {
    // The shell executes text from stdin: match echo/printf arguments, here-strings and heredoc bodies as commands.
    const bodies = [];
    stripHeredocs(source, bodies);
    if (bodies.length || /<<</.test(source) || /<<-?\s*['"]?\w/.test(source)) literal = true;
    feed.push(...bodies);
    for (const seg of segments) {
      if (STDIN_PRODUCERS.has(exeName(seg.words[0] ?? ''))) feed.push(seg.words.slice(1).join(' '));
      for (const w of seg.words) if (/\s/.test(w)) feed.push(w);
    }
    for (const text of feed) {
      const sub = normalizedSegments(text, depth + 1, powershell);
      out.push(...sub.tokenSegments);
      if (sub.opaque) flags.opaque = true;
    }
    opaque = !literal;
  }
  for (const inner of substitutions(source, powershell)) {
    const sub = normalizedSegments(inner, depth + 1, powershell);
    out.push(...sub.tokenSegments);
    if (sub.opaque) flags.opaque = true;
  }
  opaque = opaque || flags.opaque;
  return { segments: out.map((words) => words.join(' ')), tokenSegments: out, unbalanced, opaque };
}

export const collapse = (s) => String(s).trim().replace(/\s+/g, ' ');
