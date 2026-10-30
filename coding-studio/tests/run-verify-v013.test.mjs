import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitAll, git, makeRepo, put, runVerify } from './helpers.mjs';

const OK = 'node -e "process.exit(0)"';
const WRITE_RAN = `node -e "require('fs').writeFileSync('ran.txt','1')"`;
const out = (dir) => path.join(dir, 'work', 'r.json');
const report = (dir) => JSON.parse(fs.readFileSync(out(dir), 'utf8'));

function mk(t, commands = {}, files = {}) {
  const dir = makeRepo({ config: { commands, protected_paths: ['tests/**'] }, files });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'checkout', '-q', '-b', 'feat');
  put(dir, 'src/start.js', '1');
  commitAll(dir, 'start');
  return dir;
}

function fileLink(t, target, link) {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows file symlinks require Developer Mode or symlink privilege');
      return false;
    }
    throw error;
  }
}

for (const base of ['main', 'missing-ref']) {
  for (const suffix of ['r.json', 'missing/nested/r.json']) {
    test(`rejects --out through an escaping directory link (${base}, ${suffix})`, (t) => {
      const dir = mk(t, { test: WRITE_RAN }, { 'outside/r.json': 'original' });
      fs.mkdirSync(path.join(dir, 'work'));
      fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, 'work', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      const r = runVerify(dir, '--base', base, '--out', `work/escape/${suffix}`);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /CONFIG-ERROR/);
      assert.equal(fs.readFileSync(path.join(dir, 'outside/r.json'), 'utf8'), 'original');
      assert.ok(!fs.existsSync(path.join(dir, 'outside/r.md')));
      assert.ok(!fs.existsSync(path.join(dir, 'outside/missing')));
      assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
    });
  }
}

for (const base of ['main', 'missing-ref']) {
  for (const companion of [false, true]) {
    test(`refuses a symlink ${companion ? 'Markdown companion' : 'report target'} (${base})`, (t) => {
      const dir = mk(t, { test: WRITE_RAN }, { 'outside/sentinel.txt': 'original' });
      fs.mkdirSync(path.join(dir, 'work'));
      const link = path.join(dir, 'work', companion ? 'r.md' : 'r.json');
      if (!fileLink(t, path.join(dir, 'outside/sentinel.txt'), link)) return;
      const r = runVerify(dir, '--base', base, '--out', out(dir));
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(fs.readFileSync(path.join(dir, 'outside/sentinel.txt'), 'utf8'), 'original');
      assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
      assert.ok(!fs.existsSync(path.join(dir, 'work', companion ? 'r.json' : 'r.md')));
    });
  }
}

test('refuses a dangling report symlink without creating its destination', (t) => {
  const dir = mk(t, { test: WRITE_RAN });
  fs.mkdirSync(path.join(dir, 'work'));
  const target = path.join(dir, 'outside-new.json');
  if (!fileLink(t, target, out(dir))) return;
  const r = runVerify(dir, '--base', 'missing-ref', '--out', out(dir));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(target));
  assert.ok(!fs.existsSync(path.join(dir, 'work/r.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
});

test('revalidates output after commands create an escaping directory link, including error fallback', (t) => {
  const script = [
    "import fs from 'node:fs'; import path from 'node:path';",
    "fs.mkdirSync('work', { recursive: true });",
    "fs.symlinkSync(path.resolve('outside'), path.resolve('work/link'), process.platform === 'win32' ? 'junction' : 'dir');",
  ].join('\n');
  const dir = mk(t, { test: 'node tools/link-output.mjs' }, {
    'tools/link-output.mjs': script,
    'outside/r.json': 'original',
  });
  const r = runVerify(dir, '--base', 'main', '--out', 'work/link/r.json');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /CONFIG-ERROR/);
  assert.equal(fs.readFileSync(path.join(dir, 'outside/r.json'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(dir, 'outside/r.md')));
});

test('allows a report in a nonexistent nested directory beneath real work/', (t) => {
  const dir = mk(t, { test: OK });
  const target = path.join(dir, 'work', 'new', 'nested', 'r.json');
  const r = runVerify(dir, '--base', 'main', '--out', target);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).result, 'PASS');
  assert.ok(fs.existsSync(path.join(dir, 'work/new/nested/r.md')));
});

test('allows an internal directory link whose real output stays within work/', (t) => {
  const dir = mk(t, { test: OK });
  fs.mkdirSync(path.join(dir, 'work/actual'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'work/actual'), path.join(dir, 'work/link'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = runVerify(dir, '--base', 'main', '--out', 'work/link/new/r.json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'work/actual/new/r.json'), 'utf8')).result, 'PASS');
  assert.ok(fs.existsSync(path.join(dir, 'work/actual/new/r.md')));
});

test('rejects a report symlink even when its destination is inside work/', (t) => {
  const dir = mk(t, { test: WRITE_RAN });
  put(dir, 'work/original.json', 'original');
  if (!fileLink(t, path.join(dir, 'work/original.json'), out(dir))) return;
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'work/original.json'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'work/r.md')));
});

test('rejects an escaping work/ directory link before execution', (t) => {
  const dir = mk(t, { test: WRITE_RAN }, { 'outside/r.json': 'original' });
  fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, 'work'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = runVerify(dir, '--base', 'missing-ref', '--out', out(dir));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'outside/r.json'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(dir, 'outside/r.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
});

const PACKAGE_CONFIGS = ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', 'pnpm-workspace.yaml', 'bunfig.toml'];
for (const file of PACKAGE_CONFIGS) {
  for (const added of [false, true]) {
    test(`flags ${added ? 'new' : 'modified'} package-manager config ${file}`, (t) => {
      const dir = mk(t, { test: OK }, added ? {} : { [file]: '# original\n' });
      put(dir, file, '# changed\n');
      if (!added) commitAll(dir, 'change package-manager config');
      const r = runVerify(dir, '--base', 'main', '--out', out(dir));
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const j = report(dir);
      assert.equal(j.result, 'PASS-FLAGGED');
      assert.deepEqual(j.flagged.map((f) => f.path), [file]);
      assert.equal(j.flagged[0].status, added ? 'A' : 'M');
      assert.equal(j.flagged[0].source, added ? 'untracked' : 'committed');
      assert.match(j.flagged[0].reasons.join(), /check-config file changed/);
    });
  }
}

test('flags deleted nested package-manager config', (t) => {
  const dir = mk(t, { test: OK }, { 'packages/app/.npmrc': 'ignore-scripts=false\n' });
  fs.unlinkSync(path.join(dir, 'packages/app/.npmrc'));
  commitAll(dir, 'remove package-manager config');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'PASS-FLAGGED');
  assert.deepEqual(j.flagged.map((f) => f.path), ['packages/app/.npmrc']);
  assert.equal(j.flagged[0].status, 'D');
  assert.match(j.flagged[0].reasons.join(), /check-config file changed/);
});

for (const command of [
  'npm --silent test', 'npm -s run check', 'npm run-script check',
  'pnpm --silent check', 'yarn --silent check',
  'npm --color=false --prefix . --silent run-script check',
]) {
  test(`protects the helper resolved through ${command}`, (t) => {
    const dir = mk(t, { test: command }, {
      'package.json': JSON.stringify({ scripts: { test: 'node "tools/check file.mjs"', check: 'node "tools/check file.mjs"' } }),
      'tools/check file.mjs': 'process.exit(0);\n',
    });
    put(dir, 'tools/check file.mjs', 'process.exit(0); // changed\n');
    commitAll(dir, 'change script helper');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    const j = report(dir);
    if (command.startsWith('npm ')) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(j.result, 'PASS-FLAGGED');
    } else {
      // Flag detection must still run when pnpm/yarn are unavailable.
      assert.equal(r.status, j.commands[0].ok ? 0 : 1, r.stdout + r.stderr);
      assert.equal(j.result, j.commands[0].ok ? 'PASS-FLAGGED' : 'FAIL');
    }
    assert.deepEqual(j.flagged.map((f) => f.path), ['tools/check file.mjs']);
    assert.match(j.flagged[0].reasons.join(), /file run by a package script/);
  });
}

test('untracked root PLAN.md is ignored like work/', (t) => {
  const dir = mk(t, { test: OK });
  put(dir, 'PLAN.md', 'Lead tracking\n');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'PASS');
  assert.equal(j.dirty, false);
  assert.ok(!j.changedFiles.some((f) => f.path === 'PLAN.md'));
});

test('a command may update tracked root PLAN.md without invalidating or dirtying verification', (t) => {
  const dir = mk(t, { test: `node -e "require('fs').appendFileSync('PLAN.md','updated')"` }, { 'PLAN.md': 'Lead tracking\n' });
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'PASS');
  assert.equal(j.dirty, false);
  assert.ok(!j.changedFiles.some((f) => f.path === 'PLAN.md'));
  assert.match(fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8'), /updated/);
});

test('nested PLAN.md remains visible to dirty-tree checks', (t) => {
  const dir = mk(t, { test: OK });
  put(dir, 'docs/PLAN.md', 'nested plan\n');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.dirty, true);
  assert.ok(j.changedFiles.some((f) => f.path === 'docs/PLAN.md'));
});

test('a command modifying tracked nested PLAN.md still invalidates verification', (t) => {
  const dir = mk(t, { test: `node -e "require('fs').appendFileSync('docs/PLAN.md','changed')"` }, { 'docs/PLAN.md': 'nested plan\n' });
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'INVALID');
  assert.equal(j.dirty, true);
  assert.match(j.invalidReason, /tracked files/);
  assert.ok(j.changedFiles.some((f) => f.path === 'docs/PLAN.md'));
});
