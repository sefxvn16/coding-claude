#!/usr/bin/env node
// Verifier helper: run project commands on the merged task branch, then diff against the
// recorded base and flag changes to protected paths, check config and .studio/**.
//   node run-verify.mjs --base <sha> [--out <file.json>] [--cwd <dir>]
// Exit 0 PASS / PASS-FLAGGED, 1 FAIL / INVALID, 2 CONFIG-ERROR.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { checkConfigKind, findProject, isStudioPath, matchPath } from './lib/config.mjs';

const ORDER = ['lint', 'typecheck', 'test', 'build', 'integration'];
const DEFAULT_TIMEOUT_S = 900;
const GUARDED_KEYS = ['commands', 'protected_paths', 'gated_commands'];
const PACKAGE_KEYS = ['scripts', 'jest', 'vitest', 'mocha', 'ava', 'c8', 'nyc'];
const SKIP_RE = /\.skip\(|\.only\(|\bxit\(|\bxdescribe\(|\bxtest\(|@pytest\.mark\.skip|\bpytest\.skip\(|@unittest\.skip|\bt\.Skip\(|@Disabled|\bit\.todo|\{\s*skip:\s*true\s*\}/g;
const ASSERT_RE = /\bassert|\bexpect\(/g;
const SNAPSHOT_RE = /(^|\/)__snapshots__\/|\.snap$|golden|(^|\/)snapshots?\//i;
const NOT_WORK = ':(exclude)work';

class ConfigError extends Error {}
let reportOut;

function resolveReportOut(root, out) {
  const resolved = path.resolve(root, out);
  const work = path.resolve(root, 'work') + path.sep;
  const normalize = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
  if (!normalize(resolved).startsWith(normalize(work))) {
    throw new ConfigError('--out must resolve inside the project work/ directory');
  }
  return resolved;
}

function git(args, cwd, allowFail = false) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') a.base = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--cwd') a.cwd = argv[++i];
  }
  return a;
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function tail(text, lines = 30, chars = 3000) {
  const t = text.split(/\r?\n/).slice(-lines).join('\n');
  return t.length > chars ? t.slice(-chars) : t;
}

function timeoutFor(config, name) {
  const t = config.timeouts;
  for (const v of [t?.[name], t?.default]) if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  return DEFAULT_TIMEOUT_S;
}

function runCommand(root, cmd, timeoutS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const collect = (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (e) => { out += String(e); });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }, timeoutS * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : (code ?? 1), timedOut, out, seconds: Math.round((Date.now() - started) / 100) / 10 });
    });
  });
}

async function runCommands(root, config) {
  const results = [];
  for (const name of ORDER) {
    const cmd = config.commands?.[name];
    if (typeof cmd !== 'string' || !cmd.trim()) continue;
    const timeoutS = timeoutFor(config, name);
    const r = await runCommand(root, cmd, timeoutS);
    results.push({
      name, command: cmd, exitCode: r.exitCode, ok: r.exitCode === 0, timedOut: r.timedOut, timeoutSeconds: timeoutS,
      seconds: r.seconds, outputTail: tail(r.out + (r.timedOut ? `\n[killed after ${timeoutS}s timeout]` : '')),
    });
  }
  return results;
}

/** HEAD + hash of all tracked changes (work/ ignored): detects commands that mutate the checkout. */
function snapshot(root) {
  const diff = git(['diff', 'HEAD', '--binary', '--no-ext-diff', '--', '.', NOT_WORK], root, true) ?? '';
  return {
    head: git(['rev-parse', 'HEAD'], root).trim(),
    trackedHash: crypto.createHash('sha256').update(diff).digest('hex'),
    indexFlags: new Map(git(['ls-files', '-v', '-z'], root).split('\0').filter(Boolean).map((line) => [line.slice(2), line[0]])),
  };
}

function invalidIndexFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((file) => {
    const a = before.get(file);
    const b = after.get(file);
    return [a, b].some((tag) => tag && (tag === 'S' || /^[a-z]$/.test(tag))) || a !== b;
  }).sort();
}

/** Expand a configured package-manager command through scripts at HEAD once. */
function packageCommandFiles(root, commands) {
  let pkg;
  try { pkg = JSON.parse(git(['show', 'HEAD:./package.json'], root, true)); } catch { return new Set(); }
  const expanded = {};
  for (const [name, command] of Object.entries(commands || {})) {
    const tokens = command.match(/"[^"]*"|'[^']*'|[^\s;&|]+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) || [];
    const manager = tokens[0]?.replace(/\.cmd$/i, '').toLowerCase();
    let script;
    if (manager === 'npm') script = tokens[1] === 'run' ? tokens[2] : tokens[1] === 'test' ? 'test' : null;
    else if (manager === 'pnpm' || manager === 'yarn') script = tokens[1] === 'run' ? tokens[2] : tokens[1];
    if (script && typeof pkg?.scripts?.[script] === 'string') {
      const parts = pkg.scripts[script].match(/"[^"]*"|'[^']*'|[^\s;&|]+/g) || [];
      expanded[name] = parts;
    }
  }
  const files = new Set();
  for (const parts of Object.values(expanded)) {
    for (const raw of parts) {
      const token = raw.replace(/^["']|["']$/g, '');
      if (token.startsWith('-') || /^[a-z]+:\/\//i.test(token)) continue;
      if (!/[\\/]/.test(token) && !/\.(?:[cm]?js|ts|py|sh|ps1)$/i.test(token)) continue;
      const rel = path.relative(root, path.resolve(root, token.replace(/\\/g, '/'))).replace(/\\/g, '/');
      files.add(rel.toLowerCase());
    }
  }
  return files;
}

/** Changed files: committed (mergeBase...HEAD), uncommitted tracked, and untracked. work/ ignored. */
function collectChanges(root, mergeBase) {
  const changes = new Map();
  const add = (out, source) => {
    for (const line of (out || '').split('\n')) {
      const [st, ...rest] = line.split('\t');
      if (st && rest.length) changes.set(rest.join('\t'), { status: st[0], source });
    }
  };
  add(git(['diff', '--no-renames', '--relative', '--name-status', `${mergeBase}...HEAD`, '--', '.', NOT_WORK], root), 'committed');
  add(git(['diff', '--no-renames', '--relative', '--name-status', 'HEAD', '--', '.', NOT_WORK], root, true), 'uncommitted');
  for (const f of git(['ls-files', '--others', '--exclude-standard', '--', '.', NOT_WORK], root).split('\n').filter(Boolean)) {
    changes.set(f, { status: 'A', source: 'untracked' });
  }
  return changes;
}

const count = (text, re) => (text.match(re) || []).length;

function analyze(root, rel, change, mergeBase) {
  const reasons = [];
  if (change.status === 'D') reasons.push('file deleted');
  if (SNAPSHOT_RE.test(rel) && change.status !== 'A') reasons.push('snapshot/golden file changed');
  if (change.status === 'M') {
    const before = git(['show', `${mergeBase}:./${rel}`], root, true) ?? '';
    const after = fs.readFileSync(path.join(root, rel), 'utf8');
    const skips = count(after, SKIP_RE) - count(before, SKIP_RE);
    if (skips > 0) reasons.push(`added ${skips} skip marker(s) (skip/only/todo/disabled)`);
    const a0 = count(before, ASSERT_RE);
    const a1 = count(after, ASSERT_RE);
    if (a1 < a0) reasons.push(`assertion-like lines ${a0} -> ${a1}`);
  }
  if (change.status === 'A' && !reasons.length) reasons.push('new file in protected path');
  if (change.status === 'M' && !reasons.length) reasons.push('modified (no loosening heuristic hit)');
  return reasons;
}

/** Manifest (package.json, pyproject.toml, setup.cfg): reasons, or null when nothing check-relevant changed. */
function analyzeManifest(root, rel, change, base) {
  if (!/(^|\/)package\.json$/i.test(rel)) return [`manifest changed (${change.status}): test config may live here`];
  if (change.status !== 'M') return [`package.json ${change.status === 'A' ? 'added' : 'deleted'}`];
  try {
    const before = JSON.parse(git(['show', `${base}:./${rel}`], root));
    const head = JSON.parse(git(['show', `HEAD:./${rel}`], root));
    const working = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    const changed = PACKAGE_KEYS.filter((key) => [head, working].some((pkg) =>
      Object.hasOwn(before, key) !== Object.hasOwn(pkg, key) || stable(before[key]) !== stable(pkg[key])));
    return changed.length ? changed.map((key) => `package.json ${key} changed`) : null;
  } catch {
    return ['package.json changed (could not parse base/HEAD/working tree to compare scripts/test config)'];
  }
}

function toMarkdown(r) {
  const L = [
    `# Verify: ${r.result}${r.result === 'PASS-FLAGGED' ? ' (needs reviewer/Lead review of flags)' : ''}`, '',
    `- HEAD: ${r.head}${r.dirty ? ' (working tree has uncommitted changes outside work/)' : ''}`,
    `- Base: ${r.base}  Merge-base: ${r.mergeBase}`,
  ];
  if (r.invalidReason) L.push(`- INVALID: ${r.invalidReason}`);
  L.push('', '## Commands');
  if (!r.commands.length) L.push('- (none configured)');
  for (const c of r.commands) L.push(`- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: \`${c.command}\` (exit ${c.exitCode}${c.timedOut ? ', TIMED OUT' : ''}, ${c.seconds}s)`);
  for (const c of r.commands.filter((x) => !x.ok)) L.push('', `### ${c.name} output (tail)`, '```', c.outputTail, '```');
  L.push('', `## Changes: ${r.changedFiles.length} file(s), ${r.flagged.length} flagged`);
  for (const f of r.flagged) L.push(`- FLAGGED ${f.status} ${f.path} [${f.source}] (${f.scope}): ${f.reasons.join('; ')}`);
  return L.join('\n') + '\n';
}

function writeReport(out, report, md) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  fs.writeFileSync(out.replace(/\.json$/i, '') + '.md', md);
}

function guardedConfigDiff(root, mergeBase, config) {
  const baseRaw = git(['show', `${mergeBase}:./.studio/project.json`], root, true);
  if (baseRaw === null) return ['.studio/project.json does not exist at the merge-base'];
  let baseCfg;
  try { baseCfg = JSON.parse(baseRaw); } catch { return ['.studio/project.json at the merge-base is unparseable']; }
  return GUARDED_KEYS.filter((k) => stable(baseCfg?.[k]) !== stable(config[k]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = findProject(args.cwd || process.cwd());
  if (!project) throw new ConfigError('.studio/project.json not found');
  if (args.out) reportOut = resolveReportOut(project.root, args.out);
  if (project.broken) throw new ConfigError(`.studio/project.json is unparseable: ${project.error}`);
  const { root, config } = project;

  if (!args.base) throw new ConfigError('--base <sha> is required (the base SHA Lead recorded in the handoff)');
  const base = git(['rev-parse', '--verify', `${args.base}^{commit}`], root, true)?.trim();
  if (!base) throw new ConfigError(`base ref not found: ${args.base}`);
  const head = git(['rev-parse', 'HEAD'], root).trim();
  if (base === head) throw new ConfigError(`base equals HEAD (${head.slice(0, 12)}): nothing to verify. Verify the merged task branch with the base recorded BEFORE the task started`);
  const mergeBase = git(['merge-base', base, 'HEAD'], root, true)?.trim();
  if (!mergeBase) throw new ConfigError('no merge-base between base and HEAD');
  if (mergeBase === head) throw new ConfigError('HEAD is an ancestor of base: wrong branch checked out or wrong base');

  const changedKeys = guardedConfigDiff(root, mergeBase, config);
  if (changedKeys.length) {
    throw new ConfigError(`config changed, needs owner approval; nothing was executed (${changedKeys.join(', ')} differ from the merge-base ${mergeBase.slice(0, 12)})`);
  }

  const before = snapshot(root);
  const scriptFiles = packageCommandFiles(root, config.commands);
  const commands = await runCommands(root, config);
  const after = snapshot(root);
  let invalidReason = null;
  if (after.head !== before.head) invalidReason = `HEAD changed during the run (${before.head.slice(0, 12)} -> ${after.head.slice(0, 12)})`;
  else if (after.trackedHash !== before.trackedHash) invalidReason = 'tracked files were modified by the commands';
  const indexFiles = invalidIndexFiles(before.indexFlags, after.indexFlags);
  if (indexFiles.length) {
    invalidReason = [invalidReason, `index flags (skip-worktree, assume-unchanged, or changed during the run): ${indexFiles.join(', ')}`].filter(Boolean).join('; ');
  }

  const changes = collectChanges(root, mergeBase);
  const flagged = [];
  for (const [rel, change] of [...changes].sort()) {
    const studio = isStudioPath(rel);
    const pattern = studio ? '.studio/**' : matchPath(rel, config.protected_paths);
    const cfg = scriptFiles.has(rel.toLowerCase()) ? { hard: true, kind: 'file run by a package script' } : checkConfigKind(rel, config);
    if (!pattern && !cfg) continue;
    let reasons = studio || pattern ? analyze(root, rel, change, mergeBase) : [];
    if (studio) reasons.unshift(`.studio change (${change.status})`);
    else if (cfg) {
      const extra = cfg.hard ? [`check-config file changed (${cfg.kind}, ${change.status})`] : analyzeManifest(root, rel, change, base);
      if (extra === null && !pattern) continue;
      reasons = [...(extra ?? []), ...reasons];
    }
    flagged.push({ path: rel, status: change.status, source: change.source, scope: studio ? '.studio' : pattern ?? `check-config: ${cfg.kind}`, reasons });
  }

  const allOk = commands.every((c) => c.ok);
  const result = invalidReason ? 'INVALID' : !allOk ? 'FAIL' : flagged.length ? 'PASS-FLAGGED' : 'PASS';
  const report = {
    result, invalidReason, head: after.head,
    dirty: git(['status', '--porcelain', '--', '.', NOT_WORK], root).trim().length > 0,
    base, mergeBase, commands,
    changedFiles: [...changes].map(([p, c]) => ({ path: p, ...c })),
    flagged, generatedAt: new Date().toISOString(),
  };
  const md = toMarkdown(report);
  if (reportOut) writeReport(reportOut, report, md);
  process.stdout.write(md);
  return result === 'PASS' || result === 'PASS-FLAGGED' ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (e) {
  const msg = `CONFIG-ERROR: config error: ${e.message}`;
  console.error(msg);
  try {
    if (reportOut) writeReport(reportOut, { result: 'CONFIG-ERROR', error: e.message, generatedAt: new Date().toISOString() }, `# Verify: CONFIG-ERROR\n\n${e.message}\n`);
  } catch { /* report is best effort */ }
  process.exitCode = 2;
}
