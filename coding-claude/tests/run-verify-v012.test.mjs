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

for (const target of ['tests/a.test.js', 'work/../tests/a.test.js', 'work-other/r.json', 'absolute']) {
  test(`rejects --out outside work/: ${target}, without writing or executing`, (t) => {
    const dir = mk(t, { test: WRITE_RAN }, { 'tests/a.test.js': 'original\n' });
    const destination = target === 'absolute' ? path.join(dir, 'tests/a.test.js') : target;
    const r = runVerify(dir, '--base', 'main', '--out', destination);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /CONFIG-ERROR.*--out.*work\//);
    assert.equal(fs.readFileSync(path.join(dir, 'tests/a.test.js'), 'utf8'), 'original\n');
    assert.equal(git(dir, 'status', '--porcelain').trim(), '');
    assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
    assert.ok(!fs.existsSync(path.join(dir, 'work')));
    assert.ok(!fs.existsSync(path.join(dir, 'work-other')));
  });
}

for (const absolute of [false, true]) {
  test(`allows ${absolute ? 'absolute' : 'relative'} --out inside work/`, (t) => {
    const dir = mk(t, { test: OK });
    const r = runVerify(dir, '--base', 'main', '--out', absolute ? out(dir) : 'work/r.json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(report(dir).result, 'PASS');
    assert.ok(fs.existsSync(path.join(dir, 'work', 'r.md')));
  });
}

test('Windows --out containment is case-insensitive', { skip: process.platform !== 'win32' }, (t) => {
  const dir = mk(t);
  const r = runVerify(dir, '--base', 'main', '--out', out(dir).toUpperCase());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(report(dir).result, 'PASS');
});

test('invalid --out is not written by the CONFIG-ERROR fallback', (t) => {
  const dir = mk(t, {}, { 'tests/a.test.js': 'original' });
  const r = runVerify(dir, '--base', 'missing-ref', '--out', 'tests/a.test.js');
  assert.equal(r.status, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'tests/a.test.js'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(dir, 'tests/a.test.js.md')));
});

for (const key of ['scripts', 'jest', 'vitest', 'mocha', 'ava', 'c8', 'nyc']) {
  test(`flags package.json ${key} changes with a reason`, (t) => {
    const dir = mk(t, { test: OK }, { 'package.json': JSON.stringify({ [key]: { old: true } }) });
    put(dir, 'package.json', JSON.stringify({ [key]: { updated: true } }));
    commitAll(dir, 'config change');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = report(dir);
    assert.equal(j.result, 'PASS-FLAGGED');
    assert.equal(j.flagged[0].path, 'package.json');
    assert.ok(j.flagged[0].reasons.includes(`package.json ${key} changed`));
  });
}

for (const broken of ['base', 'HEAD']) {
  test(`flags package.json parse errors at ${broken}`, (t) => {
    const dir = mk(t, {}, { 'package.json': broken === 'base' ? '{bad' : '{}' });
    put(dir, 'package.json', broken === 'HEAD' ? '{bad' : '{}');
    commitAll(dir);
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(report(dir).result, 'PASS-FLAGGED');
    assert.match(report(dir).flagged[0].reasons.join(), /could not parse/);
  });
}

test('compares HEAD package.json even when the working copy restores base', (t) => {
  const dir = mk(t, {}, { 'package.json': '{"jest":{"testMatch":["old"]}}' });
  put(dir, 'package.json', '{"jest":{"testMatch":["new"]}}');
  commitAll(dir);
  put(dir, 'package.json', '{"jest":{"testMatch":["old"]}}');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(report(dir).result, 'PASS-FLAGGED');
  assert.match(report(dir).flagged[0].reasons.join(), /jest changed/);
});

for (const command of ['npm test', 'npm run check', 'pnpm check', 'yarn check']) {
  test(`flags a file referenced by scripts through ${command}`, (t) => {
    const dir = mk(t, { test: command }, {
      'package.json': JSON.stringify({ scripts: { test: 'node "tools/check file.mjs"', check: 'node "tools/check file.mjs"' } }),
      'tools/check file.mjs': 'process.exit(0);\n',
    });
    put(dir, 'tools/check file.mjs', 'process.exit(0); // changed\n');
    commitAll(dir);
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    const j = report(dir);
    // pnpm/yarn need not be installed: flag detection must also run after command failure.
    if (command.startsWith('npm ')) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(j.result, 'PASS-FLAGGED');
    } else {
      assert.equal(r.status, j.commands[0].ok ? 0 : 1, r.stdout + r.stderr);
      assert.equal(j.result, j.commands[0].ok ? 'PASS-FLAGGED' : 'FAIL');
    }
    assert.deepEqual(j.flagged.map((f) => f.path), ['tools/check file.mjs']);
    assert.match(j.flagged[0].reasons.join(), /file run by a package script/);
  });
}

for (const flag of ['skip-worktree', 'assume-unchanged']) {
  test(`${flag} on a test file makes verification INVALID`, (t) => {
    const dir = mk(t, { test: OK }, { 'tests/a.test.js': 'original' });
    git(dir, 'update-index', `--${flag}`, 'tests/a.test.js');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(report(dir).result, 'INVALID');
    assert.match(report(dir).invalidReason, /index flags.*tests\/a\.test\.js/);
  });
}

for (const remove of [false, true]) {
  test(`index flag ${remove ? 'cleared' : 'set'} during commands makes verification INVALID`, (t) => {
    const dir = mk(t, { test: `git update-index --${remove ? 'no-' : ''}skip-worktree tests/a.test.js` }, {
      'tests/a.test.js': 'original',
    });
    if (remove) git(dir, 'update-index', '--skip-worktree', 'tests/a.test.js');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(report(dir).result, 'INVALID');
    assert.match(report(dir).invalidReason, /index flags.*tests\/a\.test\.js/);
  });
}
