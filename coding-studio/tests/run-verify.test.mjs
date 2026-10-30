import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitAll, git, makeRepo, put, runVerify } from './helpers.mjs';

const OK = 'node -e "process.exit(0)"';
const NO = 'node -e "console.log(123456);process.exit(3)"';

function mk(commands, files) {
  const dir = makeRepo({ config: { commands, protected_paths: ['tests/**'] }, files });
  git(dir, 'checkout', '-q', '-b', 'feat');
  put(dir, 'src/start.js', '1'); // task branch always has >= 1 commit beyond base
  commitAll(dir, 'start');
  return dir;
}
const out = (dir) => path.join(dir, 'work', 'r.json');
const report = (dir) => JSON.parse(fs.readFileSync(out(dir), 'utf8'));

test('PASS with clean diff', () => {
  const dir = mk({ lint: OK, test: OK, build: '' });
  put(dir, 'src/a.js', 'x');
  commitAll(dir);
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'PASS');
  assert.deepEqual(j.commands.map((c) => c.name), ['lint', 'test']);
  assert.equal(j.head, git(dir, 'rev-parse', 'HEAD').trim());
  assert.equal(j.flagged.length, 0);
  assert.ok(fs.existsSync(out(dir).replace('.json', '.md')));
});

test('FAIL when a command fails, with output tail', () => {
  const dir = mk({ lint: OK, test: NO });
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /123456/);
  assert.equal(report(dir).commands[1].exitCode, 3);
});

test('flags deletion of a test', () => {
  const dir = mk({}, { 'tests/a.test.js': 'assert(1)\n' });
  fs.rmSync(path.join(dir, 'tests/a.test.js'));
  commitAll(dir);
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0);
  assert.match(report(dir).flagged[0].reasons.join(), /deleted/);
});

test('flags skip insertion and assertion drop', () => {
  const dir = mk({}, { 'tests/a.test.js': "it('a',()=>{\n expect(1).toBe(1)\n expect(2).toBe(2)\n})\n" });
  put(dir, 'tests/a.test.js', "it.skip('a',()=>{\n expect(1).toBe(1)\n})\n");
  commitAll(dir);
  runVerify(dir, '--base', 'main', '--out', out(dir));
  const reasons = report(dir).flagged[0].reasons.join();
  assert.match(reasons, /skip marker/);
  assert.match(reasons, /assertion-like lines 2 -> 1/);
});

test('flags snapshot change', () => {
  const dir = mk({}, { 'tests/__snapshots__/a.snap': 'old' });
  put(dir, 'tests/__snapshots__/a.snap', 'new');
  commitAll(dir);
  runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.match(report(dir).flagged[0].reasons.join(), /snapshot/);
});

test('flags .studio change', () => {
  const dir = mk({});
  put(dir, '.studio/project.json', JSON.stringify({ commands: {}, protected_paths: ['tests/**'], level: 'simple' }));
  commitAll(dir);
  runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(report(dir).flagged[0].scope, '.studio');
});

test('flags changes made by plain shell write (uncommitted and untracked)', () => {
  const dir = mk({}, { 'tests/a.test.js': 'expect(1)\n' });
  fs.writeFileSync(path.join(dir, 'tests/a.test.js'), 'xit("a")\n');
  put(dir, 'tests/b.test.js', 'expect(1)\n');
  runVerify(dir, '--base', 'main', '--out', out(dir));
  const j = report(dir);
  assert.equal(j.dirty, true);
  const byPath = Object.fromEntries(j.flagged.map((f) => [f.path, f]));
  assert.match(byPath['tests/a.test.js'].reasons.join(), /skip marker/);
  assert.equal(byPath['tests/b.test.js'].source, 'untracked');
});

test('no config exits 2', () => {
  const dir = makeRepo();
  const r = runVerify(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /project\.json/);
});
