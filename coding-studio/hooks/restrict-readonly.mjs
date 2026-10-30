// PreToolUse (Bash|PowerShell): allowlist of read-only commands for the read-only agents
// (research, architect, reviewer, release-ops, verifier). Main session and builder are not affected.
// Design: FAIL CLOSED on complexity. The command is not interpreted as shell; anything that could
// hide a second command or a write is denied outright:
//   $( ${ ` \ <( >( ; & && || > >> < newline ( ) { } (except @{n}) :: [IO. @' @" iex Invoke-Expression -EncodedCommand
// Only simple commands joined by | are allowed. Each command's executable must be a BARE allowlisted
// name (no path, no extension). Use forward slashes in paths (backslash is denied, except inside the
// exact absolute path of a plugin script). A quoted heredoc is allowed only for gemini-research.
// Project commands (verifier, architect): only an exact whole-string match with .studio/project.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitTop, preToolUse, relToRoot, runHook } from '../scripts/lib/config.mjs';
import { collapse, findHeredoc } from '../scripts/lib/shell.mjs';

const READONLY_AGENTS = new Set(['research', 'architect', 'reviewer', 'release-ops', 'verifier'].map((n) => `coding-studio:${n}`));
const MAY_RUN_PROJECT_COMMANDS = new Set(['coding-studio:verifier', 'coding-studio:architect']);
const MAY_RUN_VERIFY = new Set(['coding-studio:verifier']);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(PLUGIN_ROOT, 'scripts', 'run-verify.mjs');
const GEMINI = path.join(PLUGIN_ROOT, 'scripts', 'gemini-research.mjs');

const SIMPLE = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'pwd', 'cd', 'echo',
  'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'select-object', 'where-object',
  'measure-object', 'sort-object', 'write-output', 'test-path', 'get-location', 'split-path', 'resolve-path',
]);
const GREPS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const FIND_DENY = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
const GIT_READ = new Set(['status', 'log', 'show', 'diff', 'rev-parse', 'ls-files', 'merge-base']);
const GIT_GLOBAL_OK = new Set(['--no-pager', '-P', '--no-optional-locks']);
const GIT_DENY_LONG = ['--output', '--ext-diff', '--textconv'];
const BRANCH_FLAGS = new Set(['--list', '-l', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--show-current',
  '--merged', '--no-merged', '--contains', '--no-contains', '--points-at', '--no-color', '--color']);
const BRANCH_FILTERS = new Set(['--list', '-l', '--merged', '--no-merged', '--contains', '--no-contains', '--points-at']);
const RAW_DENY = [
  [/\$\(|\$\{/, '$( or ${ substitution'], [/`/, 'backtick'], [/<\(|>\(/, 'process substitution'], [/::/, '"::" static member access'],
  [/@['"]/, 'here-string'], [/\[\s*(?:system\.)?io\./i, '[IO.] type access'],
  [/\b(?:iex|invoke-expression|invoke-command)\b|-encodedcommand\b/i, 'iex / Invoke-Expression / -EncodedCommand'],
];

/** Tokenize without interpreting shell. {segments: string[][]} (split on single |) or {error}. */
function scan(s) {
  const segments = [];
  let words = [];
  let buf = '';
  let has = false;
  const push = () => { if (has) words.push(buf); buf = ''; has = false; };
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; else buf += c; continue; }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === ' ' || c === '\t') { push(); continue; }
    if (c === '\n' || c === '\r') return { error: 'newline' };
    if (';&><()\\}'.includes(c)) return { error: `"${c}"` };
    if (c === '{') {
      const m = /^\{[\w-]+\}/.exec(s.slice(i));
      if (buf.endsWith('@') && m) { buf += m[0]; has = true; i += m[0].length - 1; continue; }
      return { error: '"{"' };
    }
    if (c === '|') {
      if (s[i + 1] === '|' || s[i + 1] === '&') return { error: '"||"' };
      push();
      if (!words.length) return { error: 'empty pipe segment' };
      segments.push(words); words = [];
      continue;
    }
    buf += c; has = true;
  }
  if (quote) return { error: 'unbalanced quote' };
  push();
  if (!words.length) return { error: 'empty command or pipe segment' };
  segments.push(words);
  return { segments };
}

const forms = (p) => [...new Set([p, p.replace(/\\/g, '/')])];

function gitAllowed(args, cwd, root) {
  let i = 0;
  let directory = cwd;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C' && args[i + 1] !== undefined) {
      try {
        directory = fs.realpathSync(path.resolve(directory, args[i + 1]));
        if (!fs.statSync(directory).isDirectory() || relToRoot(gitTop(cwd) || fs.realpathSync(root), directory) === null) return false;
      } catch { return false; }
      i += 2; continue;
    }
    if (GIT_GLOBAL_OK.has(args[i])) { i++; continue; }
    return false;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === 'remote') {
    return rest.length === 0 || (rest.length === 1 && rest[0] === '-v') ||
      (rest.length === 2 && rest[0] === 'get-url' && !!rest[1] && !rest[1].startsWith('-'));
  }
  if (GIT_READ.has(sub)) {
    return !rest.some((a) => {
      if (!a.startsWith('--')) return false;
      const name = a.split('=')[0];
      return name.length >= 3 && GIT_DENY_LONG.some((d) => d.startsWith(name));
    });
  }
  if (sub === 'worktree') return rest[0] === 'list' && rest.length <= 2 && rest.slice(1).every((a) => a.startsWith('--'));
  if (sub === 'branch') {
    const flags = rest.filter((a) => a.startsWith('-'));
    const pos = rest.filter((a) => !a.startsWith('-'));
    if (!flags.every((a) => BRANCH_FLAGS.has(a) || /^--(?:format|sort|abbrev)=/.test(a))) return false;
    return !pos.length || flags.some((a) => BRANCH_FILTERS.has(a));
  }
  return false;
}

/** null when the simple command is allowed, else a short reason. */
function segmentCheck(words, ctx) {
  const name = words[0];
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) return 'executable must be a bare allowlisted name (no path, extension, assignment or ./)';
  const exe = name.toLowerCase();
  const args = words.slice(1);
  if (SIMPLE.has(exe)) return null;
  if (GREPS.has(exe)) return args.some((a) => a === '--pre' || a.startsWith('--pre=') || a === '--hostname-bin') ? 'grep/rg exec option' : null;
  if (exe === 'find') return args.some((a) => FIND_DENY.has(a)) ? 'find action that executes or writes' : null;
  if (exe === 'git') return gitAllowed(args, ctx.cwd, ctx.root) ? null : 'git subcommand/option not on the read-only list';
  if (name === 'node') {
    if (args[0] === ctx.marks.verify) return ctx.mayVerify ? null : 'run-verify is for the verifier only';
    if (args[0] === ctx.marks.gemini) return null;
    return 'node may run only the plugin scripts (exact absolute path as first argument)';
  }
  return 'not on the allowlist';
}

function evaluate(command, ctx) {
  let s = String(command);
  let heredoc = false;
  if (/[\r\n]/.test(s)) {
    const lines = s.split(/\r?\n/);
    const hm = findHeredoc(lines[0]);
    if (!hm || lines[0].slice(hm.index + hm.length).trim()) return 'multiline input is allowed only for a complete Gemini heredoc';
    const end = lines.findIndex((line, i) => i > 0 && (hm.dash ? line.replace(/^\t+/, '') : line) === hm.marker);
    if (end < 0 || end !== lines.length - 1) return 'missing heredoc terminator or content after terminator';
    heredoc = true;
    s = lines[0].slice(0, hm.index).trimEnd();
  }
  // exact plugin script paths (the only place a backslash is allowed) become unforgeable markers
  for (const [key, file] of [['verify', VERIFY], ['gemini', GEMINI]]) {
    for (const f of forms(file)) {
      const re = new RegExp(`(?<=^|[\\s"'])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s"'])`, 'gi');
      s = s.replace(re, ctx.marks[key]);
    }
  }
  if (s.includes('\\')) return 'backslash (use forward slashes in paths)';
  for (const [re, why] of RAW_DENY) if (re.test(s)) return why;
  const r = scan(s);
  if (r.error) return `unsupported shell syntax: ${r.error}`;
  if (heredoc && !(r.segments.length === 1 && r.segments[0][0] === 'node' && r.segments[0][1] === ctx.marks.gemini)) {
    return 'heredoc is allowed only for gemini-research';
  }
  for (const w of r.segments) {
    const why = segmentCheck(w, ctx);
    if (why) return why;
  }
  return null;
}

runHook('restrict-readonly', (input, { config, root }) => {
  const agent = input.agent_type;
  const command = input.tool_input?.command;
  if (!READONLY_AGENTS.has(agent) || typeof command !== 'string') return null;

  if (MAY_RUN_PROJECT_COMMANDS.has(agent) && !/[\r\n]/.test(command)) {
    const want = collapse(command);
    if (Object.values(config.commands || {}).some((c) => typeof c === 'string' && c.trim() && collapse(c) === want)) return null;
  }
  const nonce = crypto.randomBytes(8).toString('hex');
  const ctx = {
    cwd: input.cwd || process.cwd(), root, mayVerify: MAY_RUN_VERIFY.has(agent),
    marks: { verify: `PLUGINVERIFY${nonce}`, gemini: `PLUGINGEMINI${nonce}` },
  };
  const why = evaluate(command, ctx);
  if (!why) return null;
  const shown = command.length > 2000 ? command.slice(0, 2000) + '...' : command;
  return preToolUse({
    permissionDecision: 'deny',
    permissionDecisionReason: `coding-studio: ${agent.split(':')[1]} is read-only; denied (${why}). Full command: ${shown}\nAllowed: one simple read-only command, or | pipes between them (git status/log/show/diff/rev-parse/ls-files/merge-base, ls/cat/grep/rg/find/head/tail/wc/Get-Content; forward-slash paths; no redirects, ; && || & $() backticks or backslashes), the plugin scripts by exact absolute path (run-verify: verifier only), and for verifier/architect the exact project.json commands as the whole command. Ask Lead to run it or do the change.`,
  });
});
