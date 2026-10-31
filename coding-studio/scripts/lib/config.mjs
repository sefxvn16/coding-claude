// Shared helpers for coding-studio hooks and scripts. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CONFIG_REL = path.join('.studio', 'project.json');

const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Throws when project.json has wrong types: schema-invalid is treated as a broken config (never fail-open). */
export function validateSchema(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('project.json must be a JSON object');
  const c = config;
  if ('level' in c && typeof c.level !== 'string') throw new Error('"level" must be a string');
  if ('commands' in c) {
    const m = c.commands;
    if (!m || typeof m !== 'object' || Array.isArray(m) || !Object.values(m).every((x) => typeof x === 'string')) {
      throw new Error('"commands" must be an object of strings');
    }
  }
  if ('timeouts' in c) {
    const t = c.timeouts;
    if (!t || typeof t !== 'object' || Array.isArray(t) || !Object.values(t).every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new Error('"timeouts" must be an object of numbers');
    }
  }
  for (const k of ['protected_paths', 'gated_commands', 'm2_triggers']) {
    if (k in c && !isStrArray(c[k])) throw new Error(`"${k}" must be an array of strings`);
  }
}

/**
 * Walk up from `start` to the git root (inclusive) looking for .studio/project.json.
 * null: no config. {root, config, broken:false}: valid.
 * {root, config:{}, broken:true, error}: file exists but is unparseable or schema-invalid.
 */
export function findProject(start) {
  if (!start) return null;
  let dir = path.resolve(start);
  for (;;) {
    const file = path.join(dir, CONFIG_REL);
    if (fs.existsSync(file)) {
      try {
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        validateSchema(config);
        return { root: dir, config, broken: false };
      } catch (err) {
        return { root: dir, config: {}, broken: true, error: String(err?.message || err) };
      }
    }
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Built-in gated list: mirrors the project.json template; used when the config is broken. */
export const DEFAULT_GATED = [
  'vercel deploy*', 'vercel*--prod*', 'npm publish*', 'pnpm publish*', 'yarn publish*', 'yarn npm publish*',
  'cargo publish*', 'twine upload*', 'gh release create*', 'netlify deploy*', 'firebase deploy*', 'docker push*',
];

/** Paths that look like tests/snapshots; used when the config is broken. */
export const TEST_LIKE = /(^|\/)(tests?|__tests__|spec|specs|e2e|__snapshots__|snapshots?)\/|\.(test|spec)\.[a-z0-9]+$|\.snap$/i;

/** Check-config files that are always protected, even outside protected_paths. */
const CHECK_CONFIG = [
  [/^(?:.*\/)?(?:\.npmrc|\.yarnrc|\.yarnrc\.yml|\.pnpmfile\.[cm]?js|pnpm-workspace\.yaml|bunfig\.toml)$/i, 'package-manager config'],
  [/^(?:.*\/)?\.yarn\/plugins\//i, 'package-manager config'],
  [/^(?:.*\/)?(?:jest|vitest|playwright|karma|cypress)\.config\.[cm]?[jt]s$/i, 'test runner config'],
  [/^(?:.*\/)?(?:jest|karma)\.conf(?:ig)?\.(?:js|cjs|mjs|json)$/i, 'test runner config'],
  [/^(?:.*\/)?(?:pytest\.ini|tox\.ini)$/i, 'test runner config'],
  [/^\.github\/workflows\//i, 'CI workflow'],
];
/** Manifests that hold check config but also dependencies: warned/flagged, not denied to builder. */
const MANIFESTS = /^(?:.*\/)?(?:package\.json|pyproject\.toml|setup\.cfg)$/i;

/** Files named inside `commands` that look like files (scripts/check.mjs, tests/run.sh). */
export function commandFiles(commands) {
  const files = new Set();
  for (const cmd of Object.values(commands || {})) {
    if (typeof cmd !== 'string') continue;
    for (const raw of cmd.split(/\s+/)) {
      const t = raw.replace(/^["']+|["']+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (!t || t.startsWith('-') || /^[a-z]+:\/\//i.test(t)) continue;
      if (t.includes('/') || /\.(?:[cm]?[jt]s|py|sh|ps1|bat|cmd|rb|php)$/i.test(t)) files.add(t);
    }
  }
  return files;
}

/**
 * Why a repo-relative path counts as check config, or null.
 * hard=true: builder may not edit it. hard=false (manifests): warn/flag only.
 */
export function checkConfigKind(rel, config) {
  const r = rel.replace(/\\/g, '/');
  if (isStudioPath(r)) return { hard: true, kind: '.studio' };
  for (const [re, kind] of CHECK_CONFIG) if (re.test(r)) return { hard: true, kind };
  if ([...commandFiles(config?.commands)].some((f) => f.toLowerCase() === r.toLowerCase())) return { hard: true, kind: 'file run by a project command' };
  if (MANIFESTS.test(r)) return { hard: false, kind: 'manifest (scripts/test config)' };
  return null;
}

/** git toplevel containing `dir` (nearest existing ancestor), real path; or null. */
export function gitTop(dir) {
  try {
    let d = path.resolve(dir);
    while (!fs.existsSync(d)) {
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return fs.realpathSync.native(r.stdout.trim());
  } catch { return null; }
}

export function samePath(a, b) {
  if (!a || !b) return false;
  const n = (x) => path.resolve(x).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

/** Convert a glob to a case-insensitive RegExp. pathMode: `*` stops at `/`. */
export function globToRegex(glob, pathMode = true) {
  let p = pathMode ? glob.replace(/\\/g, '/') : glob;
  if (pathMode && p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (pathMode && p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else re += pathMode ? '[^/]*' : '.*';
    } else if (c === '?') re += pathMode ? '[^/]' : '.';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchPath(relPath, patterns) {
  const rel = relPath.replace(/\\/g, '/');
  return (patterns || []).find((p) => globToRegex(p, true).test(rel)) ?? null;
}

/** Path relative to root with forward slashes, or null when outside root. */
export function relToRoot(root, file) {
  const rel = path.relative(root, path.resolve(root, file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

export function isStudioPath(rel) {
  return rel === '.studio' || rel.toLowerCase().startsWith('.studio/');
}

export function log(event) {
  try {
    const dir = process.env.CLAUDE_PLUGIN_DATA;
    if (!dir) return;
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'hooks.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch { /* logging must never break a hook */ }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/**
 * Run a hook handler fail-safe. handler(input, {root, config, broken}) returns an output
 * object (printed as JSON) or null. No .studio/project.json -> silent no-op.
 * A project.json that exists but is unparseable is passed with broken=true: handlers
 * must fall back to built-in defaults. Internal errors are logged and exit 0, unless the hook
 * passes `onError(input, error, project)`: its returned output (a fail-closed decision) is printed instead.
 */
export function runHook(name, handler, onError = null) {
  try {
    const raw = readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const project = findProject(input.cwd || process.cwd());
    if (!project) return process.exit(0);
    if (project.broken) log({ hook: name, error: `config broken: ${project.error}` });
    let out;
    try {
      out = handler(input, project);
    } catch (err) {
      log({ hook: name, error: String(err?.stack || err) });
      out = onError ? onError(input, err, project) : null;
    }
    if (out) {
      log({ hook: name, decision: out.hookSpecificOutput?.permissionDecision ?? 'context', tool: input.tool_name, agent: input.agent_type });
      process.stdout.write(JSON.stringify(out));
    }
  } catch (err) {
    log({ hook: name, error: String(err?.stack || err) });
  }
  process.exit(0);
}

export const preToolUse = (extra) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...extra } });
