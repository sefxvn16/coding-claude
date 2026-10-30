#!/usr/bin/env node
// Run a Codex task with its sandbox rooted where the work actually happens.
// Usage: node codex-run.mjs --cd <dir> [--add-dir <dir>]... [--model M] [--effort E]
//          [--sandbox workspace-write|read-only] [--timeout 30m] [promptFile|-]
// --cd is required: the project root or the builder's worktree. Codex can write only
// inside --cd and each --add-dir (the plugin Codex agent writes only in the session cwd).
// Prompt comes from the file argument, or stdin when omitted or "-".
// Output: one JSON object on stdout. Exit 0 only when ok:true.
// Env: CODING_STUDIO_CODEX_MODEL, CODING_STUDIO_CODEX_BIN (testing/override).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseDuration } from './gemini-research.mjs';

const DEFAULT_TIMEOUT = '30m';
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const SANDBOXES = ['workspace-write', 'read-only'];

// codex is an npm shim (codex.cmd) on Windows; spawn its JS entry with node to avoid shell:true.
export function findCodex(env = process.env) {
  if (env.CODING_STUDIO_CODEX_BIN) {
    return fs.existsSync(env.CODING_STUDIO_CODEX_BIN) ? env.CODING_STUDIO_CODEX_BIN : null;
  }
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    if (process.platform !== 'win32') candidates.push(path.join(dir, 'codex'));
    else candidates.push(path.join(dir, 'codex.exe'));
  }
  return candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

function parseArgs(argv, env) {
  const o = { file: null, cd: null, addDirs: [], model: env.CODING_STUDIO_CODEX_MODEL || null,
    effort: 'medium', sandbox: 'workspace-write', timeout: DEFAULT_TIMEOUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`); return argv[++i]; };
    if (a === '--cd') o.cd = val();
    else if (a === '--add-dir') o.addDirs.push(val());
    else if (a === '--model') o.model = val();
    else if (a === '--effort') o.effort = val();
    else if (a === '--sandbox') o.sandbox = val();
    else if (a === '--timeout') o.timeout = val();
    else if (a === '-') o.file = '-';
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (o.file === null) o.file = a;
    else throw new Error('Only one prompt file allowed');
  }
  if (!o.cd) throw new Error('--cd <dir> is required (project root or builder worktree)');
  for (const d of [o.cd, ...o.addDirs]) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error(`Not a directory: ${d}`);
  }
  if (!EFFORTS.includes(o.effort)) throw new Error(`Invalid --effort "${o.effort}" (${EFFORTS.join('|')})`);
  if (!SANDBOXES.includes(o.sandbox)) throw new Error(`Invalid --sandbox "${o.sandbox}" (${SANDBOXES.join('|')})`);
  o.timeoutMs = parseDuration(o.timeout);
  return o;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

export function buildArgs(o, lastMessageFile) {
  const args = ['exec', '-C', path.resolve(o.cd), '-s', o.sandbox, '--skip-git-repo-check',
    '-c', `model_reasoning_effort="${o.effort}"`, '-o', lastMessageFile];
  if (o.model) args.push('-m', o.model);
  for (const d of o.addDirs) args.push('--add-dir', path.resolve(d));
  args.push('-');
  return args;
}

function runCodex(bin, args, prompt, timeoutMs, env) {
  return new Promise(resolve => {
    const isScript = /\.(mjs|js|cjs)$/i.test(bin);
    const cmd = isScript ? process.execPath : bin;
    const full = isScript ? [bin, ...args] : args;
    let out = '', err = '', done = false, timedOut = false, child;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs);
    try {
      child = spawn(cmd, full, { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return finish({ spawnError: e.message }); }
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => finish({ spawnError: e.message }));
    child.on('close', code => finish({ out, err, code, timedOut }));
    child.stdin.end(prompt);
  });
}

export async function run(argv, env = process.env, readPrompt = readStdin) {
  const t0 = Date.now();
  const fail = (error, extra = {}) => ({ ok: false, response: '', error, elapsed_ms: Date.now() - t0, ...extra });
  let o;
  try { o = parseArgs(argv, env); } catch (e) { return fail(e.message); }
  let prompt;
  try {
    prompt = o.file && o.file !== '-' ? fs.readFileSync(path.resolve(o.file), 'utf8') : await readPrompt();
  } catch (e) { return fail(`Cannot read prompt: ${e.message}`); }
  prompt = prompt.replace(/^﻿/, '');
  if (!prompt.trim()) return fail('Empty prompt');
  const bin = findCodex(env);
  if (!bin) return fail('codex not found (looked for the npm package under %APPDATA%\\npm and PATH)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-'));
  const lastFile = path.join(tmp, 'last-message.txt');
  const meta = { cd: path.resolve(o.cd), add_dirs: o.addDirs.map(d => path.resolve(d)),
    model: o.model || '(account default)', effort: o.effort, sandbox: o.sandbox };
  try {
    const r = await runCodex(bin, buildArgs(o, lastFile), prompt, o.timeoutMs, env);
    const stderr = (r.err || '').trim().slice(-2000);
    if (r.spawnError) return fail(`Cannot run codex: ${r.spawnError}`, meta);
    if (r.timedOut) return fail(`Timed out after ${o.timeout}`, { ...meta, stderr });
    const response = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
    if (r.code !== 0) return fail(`codex exited with code ${r.code}`, { ...meta, response, stderr });
    if (!response) return fail('Empty final message from codex', { ...meta, stderr });
    return { ok: true, response, error: null, elapsed_ms: Date.now() - t0, ...meta };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}
