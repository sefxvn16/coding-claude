#!/usr/bin/env node
// coding-claude gate v0.4.0 - quality gate for any AI or person working in this repo.
// Standalone: needs only Node 18+ and git. Copied into a project as .studio/gate.mjs by /coding-claude:init;
// the master copy lives in the coding-claude plugin (skills/coding-claude/templates/gate/gate.mjs).
//
//   node .studio/gate.mjs [--rules-only] [--base <ref>]
//
// Reads .studio/project.json:
//   commands      lint, typecheck, test, build, integration (run in that order; empty = skipped).
//                 Override one per machine with env GATE_CMD_<NAME> (e.g. GATE_CMD_TEST on CI or Linux).
//   fail_output   {"<command name>": ["text", ...]}: the command fails when its output contains any text,
//                 even with exit code 0 (e.g. Godot --import prints "SCRIPT ERROR" but exits 0).
//   rules         [{"id", "paths": [globs], "exclude": [globs], "forbid": "<regex>", "comment": "#", "message"}]:
//                 a tracked file matching paths (and not exclude) must not contain forbid on any line.
//                 Lines starting with the comment prefix (after spaces) are skipped.
//   protected_paths  with --base: changed files under these globs (and .studio/**, .githooks/**,
//                 .github/workflows/**) are listed as warnings for the owner to review.
// Exit 0 = PASS (warnings allowed), 1 = FAIL, 2 = config error.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const COMMAND_ORDER = ['lint', 'typecheck', 'test', 'build', 'integration'];
const ALWAYS_WATCHED = ['.studio/**', '.githooks/**', '.github/workflows/**'];
const DEFAULT_TIMEOUT_S = 900;

/** Glob to RegExp; same semantics as coding-claude lib/config.mjs globToRegex (path mode). */
export function globToRegex(glob) {
  let p = glob.replace(/\\/g, '/');
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const matches = (rel, globs) => (globs || []).some((g) => globToRegex(g).test(rel));
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Throws on a malformed `rules` or `fail_output` value. */
export function validateGateConfig(config) {
  if ('fail_output' in config) {
    const f = config.fail_output;
    if (!f || typeof f !== 'object' || Array.isArray(f) || !Object.values(f).every(isStrArray)) {
      throw new Error('"fail_output" must be an object of string arrays');
    }
  }
  if ('rules' in config) {
    if (!Array.isArray(config.rules)) throw new Error('"rules" must be an array');
    const ids = new Set();
    for (const r of config.rules) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) throw new Error('every rule needs a string "id"');
      if (ids.has(r.id)) throw new Error(`duplicate rule id "${r.id}"`);
      ids.add(r.id);
      if (!isStrArray(r.paths) || !r.paths.length) throw new Error(`rule "${r.id}": "paths" must be a non-empty array of globs`);
      if ('exclude' in r && !isStrArray(r.exclude)) throw new Error(`rule "${r.id}": "exclude" must be an array of globs`);
      if (typeof r.forbid !== 'string' || !r.forbid) throw new Error(`rule "${r.id}": "forbid" must be a regex string`);
      try { new RegExp(r.forbid); } catch (e) { throw new Error(`rule "${r.id}": invalid regex: ${e.message}`); }
      for (const k of ['comment', 'message']) if (k in r && typeof r[k] !== 'string') throw new Error(`rule "${r.id}": "${k}" must be a string`);
    }
  }
}

function git(args, cwd, allowFail = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  }
  return r.stdout;
}

/** Violations of config.rules in the tracked files (working-tree content). */
export function checkRules(root, config) {
  const rules = config.rules || [];
  if (!rules.length) return [];
  const files = git(['ls-files', '-z', '--cached', '--', '.'], root).split('\0').filter(Boolean);
  const found = [];
  for (const rule of rules) {
    const re = new RegExp(rule.forbid);
    for (const rel of files) {
      if (!matches(rel, rule.paths) || matches(rel, rule.exclude)) continue;
      let text;
      try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } // deleted in working tree
      if (text.includes('\0')) continue; // binary
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (rule.comment && lines[i].trimStart().startsWith(rule.comment)) continue;
        if (re.test(lines[i])) found.push({ rule: rule.id, file: rel, line: i + 1, text: lines[i].trim().slice(0, 160), message: rule.message || '' });
      }
    }
  }
  return found;
}

/** Texts from fail_output[name] found in a command's output. */
export function outputFailures(config, name, output) {
  return (config.fail_output?.[name] || []).filter((t) => output.includes(t));
}

function timeoutFor(config, name) {
  for (const v of [config.timeouts?.[name], config.timeouts?.default]) if (typeof v === 'number' && v > 0) return v;
  return DEFAULT_TIMEOUT_S;
}

function runCommand(root, cmd, timeoutS) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const collect = (d) => { out += d; if (out.length > 4e6) out = out.slice(-2e6); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (e) => { out += String(e); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
    }, timeoutS * 1000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? 1), out, timedOut }); });
  });
}

/** Changed paths between base and the working tree that the owner should review; null when base is unknown. */
export function watchedChanges(root, config, base) {
  if (!git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], root, true)) return null;
  const out = git(['diff', '--name-only', base, '--'], root);
  const globs = [...ALWAYS_WATCHED, ...(config.protected_paths || [])];
  return out.split('\n').filter(Boolean).filter((rel) => matches(rel, globs));
}

function parseArgs(argv) {
  const a = { rulesOnly: false, base: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules-only') a.rulesOnly = true;
    else if (argv[i] === '--base') a.base = argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const top = git(['rev-parse', '--show-toplevel'], process.cwd(), true);
  if (!top) throw new Error('not inside a git repository');
  const root = top.trim();
  const file = path.join(root, '.studio', 'project.json');
  if (!fs.existsSync(file)) throw new Error('.studio/project.json not found');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateGateConfig(config);
  const ci = !!process.env.GITHUB_ACTIONS;
  let failed = false;
  const say = (s) => process.stdout.write(s + '\n');

  const violations = checkRules(root, config);
  say(`# Gate\n\n## Rules: ${(config.rules || []).length} rule(s), ${violations.length} violation(s)`);
  for (const v of violations) {
    say(`- FAIL [${v.rule}] ${v.file}:${v.line}: ${v.text}${v.message ? `  -> ${v.message}` : ''}`);
    if (ci) say(`::error file=${v.file},line=${v.line}::[${v.rule}] ${v.message || v.text}`);
  }
  if (violations.length) failed = true;

  if (!args.rulesOnly) {
    for (const name of COMMAND_ORDER) {
      const cmd = process.env[`GATE_CMD_${name.toUpperCase()}`] ?? config.commands?.[name];
      if (typeof cmd !== 'string' || !cmd.trim()) continue;
      const t = timeoutFor(config, name);
      say(`\n## ${name}: ${cmd}`);
      const r = await runCommand(root, cmd, t);
      const hits = outputFailures(config, name, r.out);
      const ok = r.code === 0 && !hits.length;
      if (!ok) {
        failed = true;
        say(r.out.split(/\r?\n/).slice(-40).join('\n'));
        if (ci) say(`::error::${name} failed (exit ${r.code}${r.timedOut ? `, timeout ${t}s` : ''}${hits.length ? `, output contains: ${hits.join(', ')}` : ''})`);
      }
      say(`- ${ok ? 'PASS' : 'FAIL'} (exit ${r.code}${r.timedOut ? `, killed after ${t}s` : ''}${hits.length ? `; output contains: ${hits.join(', ')}` : ''})`);
    }
  }

  if (args.base) {
    const watched = watchedChanges(root, config, args.base);
    if (watched === null) say(`\n## Watched files: base ${args.base.slice(0, 12)} not found locally, skipped`);
    else say(`\n## Watched files changed since ${args.base.slice(0, 12)}: ${watched.length}`);
    for (const rel of watched || []) {
      say(`- WARN ${rel} (tests or check config: owner should review this change)`);
      if (ci) say(`::warning file=${rel}::tests or check config changed; owner should review`);
    }
  }

  say(`\nResult: ${failed ? 'FAIL' : 'PASS'}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(`Gate CONFIG-ERROR: ${e.message}`);
    process.exitCode = 2;
  }
}
