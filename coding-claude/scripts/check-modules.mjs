#!/usr/bin/env node
// Audit the whole repository against .studio/modules.json (read-only).
//   node check-modules.mjs [--cwd <dir>] [--json]
// Prints: files and lines per module, tracked files in no module, dependency map, dependency
// violations, largest and most-changed files (split candidates), optional modules without off_test.
// Exit 0 = clean, 1 = violations (unless dependency_check is off), a module owning no file or a missing off_test,
// 2 = config error (missing/invalid registry, overlap).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findProject } from './lib/config.mjs';
import { ModuleConfigError, dependencyProblems, importsOf, loadModules, moduleOf } from './lib/modules.mjs';

function parseArgs(argv) {
  const a = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') a.cwd = argv[++i];
    else if (argv[i] === '--json') a.json = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = findProject(args.cwd || process.cwd());
  if (!project) throw new ModuleConfigError('.studio/project.json not found');
  const { root } = project;
  const reg = loadModules(root);
  if (!reg) throw new ModuleConfigError('.studio/modules.json not found');

  const files = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  const perModule = Object.fromEntries(Object.keys(reg.modules).map((id) => [id, 0]));
  const linesPerModule = Object.fromEntries(Object.keys(reg.modules).map((id) => [id, 0]));
  const sizes = [];
  const unowned = [];
  const edges = new Map();
  const violations = [];
  for (const rel of files) {
    const id = moduleOf(rel, reg);
    if (!id) { if (!rel.startsWith('.studio/')) unowned.push(rel); continue; }
    perModule[id]++;
    const abs = path.join(root, rel);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue; // binary
    const lines = text.split('\n').length;
    linesPerModule[id] += lines;
    sizes.push({ file: rel, module: id, lines });
    for (const target of importsOf(root, rel, text)) {
      const to = moduleOf(target, reg);
      if (to && to !== id) edges.set(`${id} -> ${to}`, (edges.get(`${id} -> ${to}`) ?? 0) + 1);
    }
    for (const p of dependencyProblems(root, rel, text, reg)) violations.push({ file: rel, ...p });
  }

  const empty = Object.keys(perModule).filter((id) => !perModule[id]);
  const tracked = new Set(files.map((f) => f.toLowerCase()));
  const missingOffTests = Object.entries(reg.modules)
    .filter(([, m]) => m.optional && !tracked.has(m.off_test.replace(/\\/g, '/').toLowerCase())).map(([id, m]) => ({ module: id, off_test: m.off_test }));
  const largest = sizes.sort((a, b) => b.lines - a.lines).slice(0, 10);
  // change frequency over the last 200 commits: files every task has to touch are split candidates
  const churn = new Map();
  const log = execFileSync('git', ['-c', 'core.quotePath=false', 'log', '-n', '200', '--name-only', '--pretty=format:%x00'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const commits = log.split('\0').map((c) => c.split('\n').filter(Boolean)).filter((c) => c.length);
  for (const c of commits) for (const f of new Set(c)) if (moduleOf(f, reg)) churn.set(f, (churn.get(f) ?? 0) + 1);
  const hot = [...churn].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([file, n]) => ({ file, module: moduleOf(file, reg), commits: n, share: Math.round((100 * n) / commits.length) }));
  const report = { root, dependency_check: reg.dependency_check, perModule, linesPerModule, empty, missingOffTests, unowned, edges: Object.fromEntries([...edges].sort()), violations, largest, hot, commitsScanned: commits.length };
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    const L = ['# Module audit', '', `dependency_check: ${reg.dependency_check}`, '', '## Modules'];
    for (const [id, m] of Object.entries(reg.modules)) {
      L.push(`- ${id} (${m.status}${m.optional ? ', optional' : ''}): ${perModule[id]} file(s), ${linesPerModule[id]} lines; depends_on: ${m.depends_on.join(', ') || '-'}${m.optional ? `; off_test: ${m.off_test}` : ''}`);
    }
    if (empty.length) L.push('', `WARNING: module(s) owning no tracked file (check their paths; a lock on them protects nothing): ${empty.join(', ')}`);
    for (const m of missingOffTests) L.push('', `WARNING: optional module "${m.module}": off_test "${m.off_test}" is not a tracked file`);
    L.push('', '## Largest files (lines)');
    for (const s of largest) L.push(`- ${s.lines} ${s.file} (${s.module})`);
    L.push('', `## Most changed files (last ${commits.length} commits)`);
    for (const h of hot) L.push(`- ${h.commits} commits (${h.share}%) ${h.file} (${h.module})`);
    L.push('', `## Tracked files in no module: ${unowned.length}`);
    for (const f of unowned.slice(0, 50)) L.push(`- ${f}`);
    if (unowned.length > 50) L.push(`- ... ${unowned.length - 50} more`);
    L.push('', '## Dependency map (imports found)');
    for (const [e, n] of [...edges].sort()) L.push(`- ${e}: ${n}`);
    L.push('', `## Violations: ${violations.length}`);
    for (const v of violations) L.push(`- ${v.file}: ${v.reason} (${v.target})`);
    L.push('', 'Not detected: GDScript class_name globals, TS path aliases, Python imports.');
    process.stdout.write(L.join('\n') + '\n');
  }
  return (violations.length && reg.dependency_check !== 'off') || empty.length || missingOffTests.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`CONFIG-ERROR: ${e instanceof ModuleConfigError ? '' : 'internal: '}${e.message}`);
  process.exitCode = 2;
}
