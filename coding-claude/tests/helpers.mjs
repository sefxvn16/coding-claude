import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
}

/** Temp git repo (path has a space) on branch main with an initial commit. */
export function makeRepo({ config, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs repo '));
  git(dir, 'init', '-q', '-b', 'main');
  if (config) put(dir, '.studio/project.json', JSON.stringify(config));
  for (const [f, c] of Object.entries(files)) put(dir, f, c);
  put(dir, 'README.md', 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

export function commitAll(dir, msg = 'c') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

/** Pipe JSON into a hook; returns {status, out (parsed or null), stdout}. */
export function runHook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', `${name}.mjs`)], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

export function runVerify(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'run-verify.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
