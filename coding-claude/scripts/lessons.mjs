import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globToRegex } from './lib/config.mjs';

export const LESSONS_FILE = 'LESSONS.md';
export const MAX_LESSONS = 20;
export const MAX_AGE_DAYS = 180;
export const MAX_RULE = 200;
const BOM = String.fromCharCode(0xfeff);
const LINE = /^- L(\d+) \| /;
const LOOKS_LIKE = /^\s*[-*+]\s*L\d+\b|\| *evidence:/;
const FIELDS = ['when', 'files', 'evidence', 'added'];

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export function parse(text, today = new Date().toISOString().slice(0, 10)) {
  const lessons = [];
  const problems = [];
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = LINE.exec(line);
    if (!m) {
      if (LOOKS_LIKE.test(line)) problems.push(`line ${i + 1}: looks like a lesson but is not "- L<n> | ..." at the start of the line`);
      return;
    }
    const parts = line.slice(2).split(' | ');
    if (parts.length !== 6) { problems.push(`line ${i + 1} (L${m[1]}): needs exactly 6 fields separated by " | " (no " | " inside the rule)`); return; }
    const l = { id: `L${m[1]}`, n: Number(m[1]), line: i, rule: parts[1].trim() };
    for (let k = 0; k < FIELDS.length; k++) {
      const p = parts[k + 2];
      const prefix = `${FIELDS[k]}: `;
      if (!p.startsWith(prefix)) { problems.push(`line ${i + 1} (${l.id}): field ${k + 3} must start with "${prefix}"`); return; }
      l[FIELDS[k]] = p.slice(prefix.length).trim();
    }
    l.files = l.files.split(',').map((s) => s.trim()).filter(Boolean);
    if (!l.rule || !l.when || !l.evidence || !l.files.length) problems.push(`line ${i + 1} (${l.id}): empty rule, when, files or evidence`);
    if (l.files.some((g) => /[{}[\]]/.test(g))) problems.push(`line ${i + 1} (${l.id}): files may use only *, ** and ? (no braces or brackets)`);
    if (l.rule.length > MAX_RULE) problems.push(`line ${i + 1} (${l.id}): rule longer than ${MAX_RULE} characters`);
    if (!validDate(l.added)) problems.push(`line ${i + 1} (${l.id}): added must be a real date YYYY-MM-DD`);
    else if (l.added > today) problems.push(`line ${i + 1} (${l.id}): added is in the future`);
    if (lessons.some((o) => o.id === l.id)) problems.push(`line ${i + 1}: duplicate id ${l.id}`);
    lessons.push(l);
  });
  const overCap = lessons.length > MAX_LESSONS ? `${lessons.length} lessons; the limit is ${MAX_LESSONS} (run prune)` : null;
  return { lessons, problems, lines, overCap };
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

const trackedFiles = (root) => git(root, ['ls-files', '-z']).split('\0').filter(Boolean);

export function nextId(lessons, history = '') {
  let max = 0;
  for (const l of lessons) max = Math.max(max, l.n);
  for (const m of history.matchAll(/^[+-]- L(\d+) \|/gm)) max = Math.max(max, Number(m[1]));
  return `L${max + 1}`;
}

const staticPrefix = (g) => g.split(/[*?]/)[0];
const anyMatch = (globs, files) => globs.some((g) => { const re = globToRegex(g); return files.some((f) => re.test(f)); });
const globsOverlap = (a, b) => { const pa = staticPrefix(a); const pb = staticPrefix(b); return pa.startsWith(pb) || pb.startsWith(pa); };

export function pruneLessons(lessons, tracked, today) {
  const now = Date.parse(today);
  const removed = [];
  let keep = [];
  for (const l of lessons) {
    const age = (now - Date.parse(l.added)) / 864e5;
    if (!anyMatch(l.files, tracked)) removed.push({ id: l.id, line: l.line, reason: 'no tracked file matches its files' });
    else if (age > MAX_AGE_DAYS) removed.push({ id: l.id, line: l.line, reason: `older than ${MAX_AGE_DAYS} days` });
    else keep.push(l);
  }
  if (keep.length > MAX_LESSONS) {
    const sorted = [...keep].sort((a, b) => b.added.localeCompare(a.added) || b.n - a.n);
    const cut = new Set(sorted.slice(MAX_LESSONS).map((l) => l.line));
    for (const l of keep) if (cut.has(l.line)) removed.push({ id: l.id, line: l.line, reason: `over the limit of ${MAX_LESSONS} (oldest first)` });
    keep = keep.filter((l) => !cut.has(l.line));
  }
  return { keep, removed };
}

export function matchLessons(lessons, targets, tracked, root = '') {
  const files = new Set();
  const patterns = [];
  for (const t of targets) {
    let norm = t.replace(/\\/g, '/');
    if (root && path.isAbsolute(t)) norm = path.relative(root, t).replace(/\\/g, '/');
    norm = norm.replace(/^\.\//, '');
    if (/[*?]/.test(norm)) {
      patterns.push(norm);
      const re = globToRegex(norm);
      for (const f of tracked) if (re.test(f)) files.add(f);
    } else files.add(norm);
  }
  const list = [...files];
  return lessons.filter((l) => anyMatch(l.files, list) || l.files.some((g) => patterns.some((p) => globsOverlap(g, p))));
}

function main(argv) {
  let cwd = process.cwd();
  let today = new Date().toISOString().slice(0, 10);
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') cwd = argv[++i];
    else if (argv[i] === '--today') today = argv[++i];
    else rest.push(argv[i]);
  }
  const [cmd, ...args] = rest;
  const file = path.join(cwd, LESSONS_FILE);
  if (!['check', 'prune', 'match'].includes(cmd)) {
    console.error('usage: lessons.mjs check | prune [--today YYYY-MM-DD] | match <path-or-glob>... [--cwd <dir>]');
    return 2;
  }
  if (!validDate(today)) { console.error('--today must be YYYY-MM-DD'); return 2; }
  if (!fs.existsSync(file)) { console.log(`no ${LESSONS_FILE}; next id: L1`); return 0; }
  const text = fs.readFileSync(file, 'utf8');
  const { lessons, problems, lines, overCap } = parse(text, today);
  if (cmd === 'check') {
    let history = '';
    try { history = git(cwd, ['log', '--format=', '-p', '--', LESSONS_FILE]); } catch { history = ''; }
    const all = overCap ? [...problems, overCap] : problems;
    for (const p of all) console.log(`PROBLEM ${p}`);
    console.log(`${LESSONS_FILE}: ${lessons.length} lessons, ${all.length ? 'PROBLEMS' : 'OK'}; next id: ${nextId(lessons, history)}`);
    return all.length ? 1 : 0;
  }
  if (cmd === 'match') {
    if (!args.length) { console.error('match needs at least one path or glob'); return 2; }
    const hits = matchLessons(lessons, args, trackedFiles(cwd), cwd);
    if (!hits.length) console.log('no matching lessons');
    for (const l of hits) console.log(`${l.id}: ${l.rule} (when: ${l.when})`);
    for (const p of problems) console.error(`PROBLEM ${p}`);
    return 0;
  }
  if (problems.length) {
    for (const p of problems) console.log(`PROBLEM ${p}`);
    console.log('prune refused: fix the problems first (check)');
    return 1;
  }
  const { removed } = pruneLessons(lessons, trackedFiles(cwd), today);
  if (!removed.length) { console.log('nothing to prune'); return 0; }
  const drop = new Set(removed.map((r) => r.line));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, (text.startsWith(BOM) ? BOM : '') + lines.filter((_, i) => !drop.has(i)).join(eol));
  for (const r of removed) console.log(`REMOVED ${r.id}: ${r.reason}`);
  return 0;
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
