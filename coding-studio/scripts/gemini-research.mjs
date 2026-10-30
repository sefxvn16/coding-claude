#!/usr/bin/env node
// Send a research prompt to Gemini through the Antigravity CLI (`agy`).
// Usage: node gemini-research.mjs [promptFile|-] [--model M] [--effort E] [--timeout 8m]
// Prompt comes from the file argument, or stdin when omitted or "-".
// Output: one JSON object on stdout. Exit 0 only when ok:true.
// Env: CODING_STUDIO_GEMINI_MODEL, CODING_STUDIO_GEMINI_TIMEOUT, CODING_STUDIO_AGY_BIN (testing/override).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_MODEL = 'gemini-3.8-flash-high';
const DEFAULT_TIMEOUT = '8m';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Windows command line limit is ~32k chars; the prompt is passed as an argument.
const MAX_PROMPT_CHARS = 28000;

export function parseDuration(v) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(String(v).trim());
  if (!m) throw new Error(`Invalid timeout "${v}" (use e.g. 90s, 8m, 480000)`);
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[(m[2] || 'ms').toLowerCase()];
  const ms = Math.round(parseFloat(m[1]) * mult);
  if (ms <= 0) throw new Error('Timeout must be > 0');
  return ms;
}

export function findAgy(env = process.env) {
  if (env.CODING_STUDIO_AGY_BIN) {
    return fs.existsSync(env.CODING_STUDIO_AGY_BIN) ? env.CODING_STUDIO_AGY_BIN : null;
  }
  const home = env.USERPROFILE || os.homedir();
  const local = path.join(home, '.local', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
  if (fs.existsSync(local)) return local;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, 'agy' + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

function parseArgs(argv, env) {
  const o = {
    file: null,
    model: env.CODING_STUDIO_GEMINI_MODEL || DEFAULT_MODEL,
    effort: null,
    timeout: env.CODING_STUDIO_GEMINI_TIMEOUT || DEFAULT_TIMEOUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`); return argv[++i]; };
    if (a === '--model') o.model = val();
    else if (a === '--effort') o.effort = val();
    else if (a === '--timeout') o.timeout = val();
    else if (a === '-') o.file = '-';
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (o.file === null) o.file = a;
    else throw new Error('Only one prompt file allowed');
  }
  if (o.effort && !EFFORTS.includes(o.effort)) throw new Error(`Invalid --effort "${o.effort}" (${EFFORTS.join('|')})`);
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

function runAgy(bin, args, timeoutMs, env) {
  return new Promise(resolve => {
    const isScript = /\.(mjs|js|cjs)$/i.test(bin);
    const cmd = isScript ? process.execPath : bin;
    const full = isScript ? [bin, ...args] : args;
    let out = '', err = '', done = false, timedOut = false, child;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs);
    try {
      child = spawn(cmd, full, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return finish({ spawnError: e.message }); }
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => finish({ spawnError: e.message }));
    child.on('close', (code, signal) => finish({ out, err, code, signal, timedOut }));
  });
}

export async function run(argv, env = process.env, readPrompt = readStdin) {
  const t0 = Date.now();
  let model = env.CODING_STUDIO_GEMINI_MODEL || DEFAULT_MODEL;
  const fail = (error, extra = {}) => ({ ok: false, model, response: '', error, elapsed_ms: Date.now() - t0, ...extra });
  let o;
  try { o = parseArgs(argv, env); } catch (e) { return fail(e.message); }
  model = o.model;
  let prompt;
  try {
    prompt = o.file && o.file !== '-' ? fs.readFileSync(path.resolve(o.file), 'utf8') : await readPrompt();
  } catch (e) { return fail(`Cannot read prompt: ${e.message}`); }
  prompt = prompt.replace(/^﻿/, '');
  if (!prompt.trim()) return fail('Empty prompt');
  if (prompt.length > MAX_PROMPT_CHARS) return fail(`Prompt too long (${prompt.length} chars > ${MAX_PROMPT_CHARS}); shorten it`);
  const bin = findAgy(env);
  if (!bin) return fail('agy not found (looked at %USERPROFILE%\\.local\\bin\\agy.exe and PATH)');
  // No --print-timeout: it caused an empty first run; the helper enforces its own timeout.
  const args = ['--mode', 'plan', '--output-format', 'json', '--model', o.model];
  if (o.effort) args.push('--effort', o.effort);
  args.push('-p', prompt);
  // agy sometimes answers with nothing (it tries a tool that headless mode denies); retry once on empty.
  const MAX_ATTEMPTS = 2;
  let res;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await attemptOnce(bin, args, o, env);
    res.attempts = attempt;
    if (res.ok || !res.retryable) break;
  }
  const { retryable, ...out } = res;
  return { ...out, elapsed_ms: Date.now() - t0 };

  async function attemptOnce(bin, args, o, env) {
    const bad = (error, extra = {}, retryable = false) => ({ ok: false, model, response: '', error, retryable, ...extra });
    const r = await runAgy(bin, args, o.timeoutMs, env);
    const stderr = (r.err || '').trim().slice(0, 1000);
    if (r.spawnError) return bad(`Cannot run agy: ${r.spawnError}`);
    if (r.timedOut) return bad(`Timed out after ${o.timeout}`, { stderr });
    let j = null;
    try { j = JSON.parse(r.out.trim()); } catch {}
    if (r.code !== 0 || !j) {
      return bad(`agy exited with code ${r.code}${j ? '' : ' with non-JSON output'}`,
        { stderr, stdout: j ? undefined : r.out.trim().slice(0, 1000) });
    }
    const response = typeof j.response === 'string' ? j.response.trim() : '';
    if (j.status && j.status !== 'SUCCESS') return bad(`agy status ${j.status}`, { response, stderr });
    if (!response) {
      const denied = Array.isArray(j.denied_actions) && j.denied_actions.length ? { denied_actions: j.denied_actions } : {};
      return bad('Empty response from agy', { stderr, ...denied }, true);
    }
    return { ok: true, model: o.model, response, error: null };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}
