// Minimal shell command lexer shared by the hooks. Not a full parser: a safety net.
// Handles quotes, command separators (&& || ; | & newline, parentheses, standalone braces),
// harmless vs file redirects, and quoted heredoc bodies. No dependencies.

const HARMLESS_TARGET = /^(?:\/dev\/null|\$null|nul)$/i;
const ENV_ASSIGN = /^[A-Za-z_]\w*=/;

/** Remove bodies of quoted heredocs (<<'EOF'): they are data for the command. */
export function stripHeredocs(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = /<<-?\s*(['"])([A-Za-z_]\w*)\1/.exec(line);
    if (!m) continue;
    const dash = line.includes('<<-');
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j].replace(/\r$/, '');
      if ((dash ? l.replace(/^\t+/, '') : l) === m[2]) break;
      j++;
    }
    i = j; // skip body and terminator
  }
  return out.join('\n');
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

const WRAPPERS = new Set(['command', 'call', 'start', 'exec', 'env', 'time', 'nohup', 'sudo', 'builtin', 'noglob']);
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

/**
 * Variants of `rest` (args after a package manager) with leading options skipped, each starting
 * at the first positional. `--flag=v` and `-x` skip one token; `--flag v` is ambiguous (value or
 * boolean), so both readings are produced.
 */
function optionVariants(rest, branches = 5) {
  if (!rest.length || !/^-/.test(rest[0])) return [rest];
  const one = rest.slice(1);
  if (rest[0].includes('=') || rest.length < 2 || /^-[^-]/.test(rest[0]) && rest[0].length > 2 || branches <= 0) {
    return optionVariants(one, branches - 1);
  }
  return [...optionVariants(one, branches - 1), ...optionVariants(rest.slice(2), branches - 1)];
}

function normWords(input, depth, out) {
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
      const rest = words.slice(1);
      if (rest.length && /^-/.test(rest[0])) {
        for (const v of optionVariants(rest)) normWords([words[0], ...v], depth, out);
        return;
      }
      if (['dlx', 'exec', 'x'].includes(rest[0])) {
        words = rest.slice(1);
        while (words.length && /^-/.test(words[0])) words.shift();
        continue;
      }
    }
    if (SHELLS.has(exe) && depth < 5) {
      const inner = shellInner(exe, words);
      if (inner !== null) {
        const ps = exe === 'pwsh' || exe === 'powershell';
        out.push(...normalizedSegments(ps ? dePowerShell(inner) : inner, depth + 1).segments);
        return;
      }
    }
    break;
  }
  words[0] = exeName(words[0]);
  out.push(words.join(' '));
}

/**
 * Normalized command strings for gating: wrappers, env assignments, paths and
 * extensions removed; package-manager global options skipped; inner strings of
 * shell -c / cmd /c expanded recursively. `powershell: true` removes backtick escapes first.
 */
export function normalizedSegments(command, depth = 0, powershell = false) {
  const { segments, unbalanced } = lex(powershell ? dePowerShell(command) : command);
  const out = [];
  for (const seg of segments) normWords(seg.words, depth, out);
  return { segments: out, unbalanced };
}

export const collapse = (s) => String(s).trim().replace(/\s+/g, ' ');
