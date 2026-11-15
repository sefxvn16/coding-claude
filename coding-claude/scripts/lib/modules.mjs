// Module registry (.studio/modules.json), task scope (work/<task-id>/scope.json) and
// path-based dependency checks. No dependencies. Absent modules.json = feature off.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { matchPath } from './config.mjs';

export const MODULES_REL = '.studio/modules.json';
const STATUSES = new Set(['open', 'locked']);
const DEP_MODES = new Set(['off', 'warn', 'block']);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

export class ModuleConfigError extends Error {}

/** Throws ModuleConfigError on a wrong shape. Returns the normalized registry. */
export function validateModules(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleConfigError('modules.json must be a JSON object');
  const mode = raw.dependency_check ?? 'warn';
  if (!DEP_MODES.has(mode)) throw new ModuleConfigError('"dependency_check" must be off, warn or block');
  const mods = raw.modules;
  if (!mods || typeof mods !== 'object' || Array.isArray(mods) || !Object.keys(mods).length) {
    throw new ModuleConfigError('"modules" must be a non-empty object of modules');
  }
  const modules = {};
  for (const [id, m] of Object.entries(mods)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new ModuleConfigError(`module id "${id}": use letters, digits, _ . -`);
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ModuleConfigError(`module "${id}" must be an object`);
    if (!isStrArray(m.paths) || !m.paths.length) throw new ModuleConfigError(`module "${id}": "paths" must be a non-empty array of globs`);
    for (const p of m.paths) {
      if (!/[*?]/.test(p) && !p.endsWith('/') && !/\.[^/]+$/.test(p)) {
        throw new ModuleConfigError(`module "${id}": path "${p}" looks like a directory; write "${p}/**" (a bare name matches only a file of that exact name)`);
      }
    }
    for (const k of ['public', 'depends_on']) {
      if (k in m && !isStrArray(m[k])) throw new ModuleConfigError(`module "${id}": "${k}" must be an array of strings`);
    }
    const status = m.status ?? 'open';
    if (!STATUSES.has(status)) throw new ModuleConfigError(`module "${id}": "status" must be open or locked`);
    modules[id] = { paths: m.paths, public: m.public ?? [], depends_on: m.depends_on ?? [], status };
  }
  for (const [id, m] of Object.entries(modules)) {
    for (const d of m.depends_on) if (!modules[d]) throw new ModuleConfigError(`module "${id}" depends on unknown module "${d}"`);
  }
  return { dependency_check: mode, modules };
}

/** null when the file is absent; otherwise the validated registry (throws ModuleConfigError). */
export function loadModules(root) {
  const file = path.join(root, MODULES_REL);
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ModuleConfigError(`modules.json is unparseable: ${e.message}`); }
  return validateModules(raw);
}

/** Module id owning a repo-relative path, or null. Throws when two modules claim it. */
export function moduleOf(rel, reg) {
  const hits = Object.entries(reg.modules).filter(([, m]) => matchPath(rel, m.paths)).map(([id]) => id);
  if (hits.length > 1) throw new ModuleConfigError(`"${rel}" belongs to more than one module (${hits.join(', ')}); a file may have one owner`);
  return hits[0] ?? null;
}

/** Validated scope {modules[], files[]} from a scope.json; throws ModuleConfigError. */
export function loadScope(file, reg) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ModuleConfigError(`scope file ${file} unreadable: ${e.message}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleConfigError('scope.json must be a JSON object');
  const modules = raw.modules ?? [];
  const files = raw.files ?? [];
  if (!isStrArray(modules) || !isStrArray(files)) throw new ModuleConfigError('scope.json "modules" and "files" must be arrays of strings');
  if (!modules.length && !files.length) throw new ModuleConfigError('scope.json names no module and no file');
  for (const id of modules) if (!reg.modules[id]) throw new ModuleConfigError(`scope.json names unknown module "${id}"`);
  return { modules, files };
}

/**
 * Why a changed path breaks the registry/scope, or null when allowed.
 * Locked modules always win, even over scope.files.
 */
export function scopeProblem(rel, reg, scope) {
  const id = moduleOf(rel, reg);
  if (id && reg.modules[id].status === 'locked') return `module "${id}" is locked (owner unlocks it in ${MODULES_REL})`;
  if (!scope) return null;
  if (id && scope.modules.includes(id)) return null;
  if (matchPath(rel, scope.files)) return null;
  return id ? `module "${id}" is outside the task scope` : 'file belongs to no module and is not listed in the task scope';
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Task scope for the checkout that contains `dir`: branch cs/<task-id> or cs/<task-id>-<n>
 * -> <main checkout>/work/<task-id>/scope.json. Returns {branch, file}; file is null when no
 * scope file was found; null when not on a cs/ branch.
 */
export function findTaskScopeFile(dir) {
  const branch = git(['branch', '--show-current'], dir);
  if (!branch || !branch.startsWith('cs/')) return null;
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
  const main = common ? path.dirname(path.resolve(dir, common)) : null;
  const id = branch.slice(3);
  for (const task of [id, id.replace(/-\d+$/, '')]) {
    if (!main || !task || task.includes('/') || task.includes('..')) continue;
    const f = path.join(main, 'work', task, 'scope.json');
    if (fs.existsSync(f)) return { branch, file: f };
  }
  return { branch, file: null };
}

const GD_EXT = /\.(?:gd|tscn|tres|gdshader)$/i;
const JS_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const GD_RE = /(?:preload|load)\(\s*["'](res:\/\/[^"']+)["']|\bpath\s*=\s*"(res:\/\/[^"]+)"|\bextends\s+["'](res:\/\/[^"']+)["']/g;
const JS_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
const JS_TRY = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

/** Repo-relative dir of the nearest project.godot at or above the file's dir (within root), or null. */
function godotBase(root, rel) {
  let d = path.posix.dirname(rel);
  for (;;) {
    if (fs.existsSync(path.join(root, d === '.' ? '' : d, 'project.godot'))) return d === '.' ? '' : d;
    if (d === '.' || d === '') return null;
    d = path.posix.dirname(d);
  }
}

/** Repo-relative targets imported by a file (GDScript/Godot resources and relative JS/TS only). */
export function importsOf(root, rel, text) {
  const out = [];
  if (GD_EXT.test(rel)) {
    const base = godotBase(root, rel);
    if (base === null) return out;
    for (const m of text.matchAll(GD_RE)) {
      const res = (m[1] || m[2] || m[3]).slice('res://'.length);
      out.push(path.posix.normalize(base ? `${base}/${res}` : res));
    }
  } else if (JS_EXT.test(rel)) {
    for (const m of text.matchAll(JS_RE)) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (target.startsWith('../')) continue;
      out.push(target);
    }
  }
  return out;
}

const isFile = (root, rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } };

/**
 * Module owning an import target. Resolves to a real file first (as written, TS-ESM `.js` -> `.ts`,
 * extension-less and directory/index forms). Unresolved: the module is still known from the path,
 * but resolved=false so the `public` list is not judged on a guessed file name.
 */
function targetModule(root, target, reg) {
  const candidates = [target, target.replace(/\.(m|c)?js$/i, '.$1ts').replace(/\.jsx$/i, '.tsx'), ...JS_TRY.map((s) => target + s)];
  const real = candidates.find((c) => isFile(root, c));
  const id = moduleOf(real ?? target, reg);
  return id ? { id, path: real ?? target, resolved: !!real } : null;
}

/** Dependency violations of one file: [{from, to, target, reason}]. */
export function dependencyProblems(root, rel, text, reg) {
  const from = moduleOf(rel, reg);
  if (!from) return [];
  const problems = [];
  const seen = new Set();
  for (const target of importsOf(root, rel, text)) {
    const hit = targetModule(root, target, reg);
    if (!hit || hit.id === from || seen.has(hit.path)) continue;
    seen.add(hit.path);
    const to = reg.modules[hit.id];
    if (!reg.modules[from].depends_on.includes(hit.id)) {
      problems.push({ from, to: hit.id, target: hit.path, reason: `"${from}" does not declare a dependency on "${hit.id}"` });
    } else if (hit.resolved && to.public.length && !matchPath(hit.path, to.public)) {
      problems.push({ from, to: hit.id, target: hit.path, reason: `"${hit.path}" is internal to "${hit.id}" (not in its public list)` });
    }
  }
  return problems;
}
