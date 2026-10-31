import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitAll, git, makeRepo, put, runVerify } from './helpers.mjs';

const OK = 'node -e "process.exit(0)"';
const WRITE_RAN = `node -e "require('fs').writeFileSync('ran.txt','1')"`;

function mk(commands, files, extra = {}) {
  const dir = makeRepo({ config: { commands, protected_paths: ['tests/**'], ...extra }, files });
  git(dir, 'checkout', '-q', '-b', 'feat');
  put(dir, 'src/start.js', '1');
  commitAll(dir, 'start');
  return dir;
}
const out = (dir) => path.join(dir, 'work', 'r.json');
const report = (dir) => JSON.parse(fs.readFileSync(out(dir), 'utf8'));

test('--base is mandatory; unknown base exits 2', () => {
  const dir = mk({ test: OK });
  const r = runVerify(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--base/);
  assert.equal(runVerify(dir, '--base', 'nope').status, 2);
});

test('base == HEAD is a config error and nothing is executed', () => {
  const dir = mk({ test: WRITE_RAN });
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  const r = runVerify(dir, '--base', head);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /base equals HEAD/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
});

test('HEAD is an ancestor of base -> exit 2', () => {
  const dir = mk({ test: OK });
  git(dir, 'checkout', '-q', 'main');
  put(dir, 'later.txt', 'x');
  commitAll(dir, 'later');
  git(dir, 'checkout', '-q', 'feat');
  git(dir, 'reset', '-q', '--hard', 'main~1'); // HEAD behind base
  const r = runVerify(dir, '--base', 'main');
  assert.equal(r.status, 2);
});

test('no merge-base (unrelated histories) -> exit 2', () => {
  const dir = mk({ test: OK });
  git(dir, 'checkout', '-q', '--orphan', 'other');
  git(dir, 'rm', '-rfq', '.');
  put(dir, 'x.txt', 'x');
  put(dir, '.studio/project.json', JSON.stringify({ commands: { test: OK } }));
  commitAll(dir, 'orphan');
  assert.equal(runVerify(dir, '--base', 'main').status, 2);
});

test('commands changed vs base: refuses to execute, exit 2, CONFIG-ERROR report', () => {
  const dir = mk({ test: OK });
  put(dir, '.studio/project.json', JSON.stringify({ commands: { test: WRITE_RAN }, protected_paths: ['tests/**'] }));
  commitAll(dir, 'neuter');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /config changed, needs owner approval/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
  assert.equal(report(dir).result, 'CONFIG-ERROR');
});

test('protected_paths or gated_commands changed vs base: refuses too', () => {
  for (const patch of [{ protected_paths: [] }, { gated_commands: ['x'] }]) {
    const dir = mk({ test: OK });
    put(dir, '.studio/project.json', JSON.stringify({ commands: { test: OK }, protected_paths: ['tests/**'], ...patch }));
    commitAll(dir, 'cfg');
    assert.equal(runVerify(dir, '--base', 'main').status, 2, JSON.stringify(patch));
  }
});

test('check-config files are flagged even outside protected_paths', () => {
  const dir = mk({ test: OK, lint: 'node scripts/check.mjs' }, {
    'scripts/check.mjs': 'process.exit(0)', 'package.json': '{"scripts":{"test":"a"}}',
    'jest.config.js': 'x', '.github/workflows/ci.yml': 'a', 'docs/a.md': 'a',
  });
  put(dir, 'scripts/check.mjs', 'process.exit(0) // neutered');
  put(dir, 'package.json', '{"scripts":{"test":"true"}}');
  put(dir, 'jest.config.js', 'y');
  put(dir, '.github/workflows/ci.yml', 'b');
  put(dir, 'docs/a.md', 'b');
  commitAll(dir, 'tamper');
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = report(dir);
  assert.equal(j.result, 'PASS-FLAGGED');
  assert.deepEqual(j.flagged.map((f) => f.path).sort(), ['.github/workflows/ci.yml', 'jest.config.js', 'package.json', 'scripts/check.mjs']);
  assert.match(j.flagged.find((f) => f.path === 'package.json').reasons.join(), /scripts changed/);
});

test('package.json change without a scripts change is not flagged', () => {
  const dir = mk({ test: OK }, { 'package.json': '{"scripts":{"test":"a"},"version":"1"}' });
  put(dir, 'package.json', '{"scripts":{"test":"a"},"version":"2"}');
  commitAll(dir);
  runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(report(dir).result, 'PASS');
});

test('command that modifies a tracked file -> INVALID, exit 1', () => {
  const dir = mk({ test: `node -e "require('fs').appendFileSync('src/start.js','tamper')"` });
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 1);
  const j = report(dir);
  assert.equal(j.result, 'INVALID');
  assert.match(j.invalidReason, /tracked files/);
});

test('command that commits -> INVALID (HEAD changed)', () => {
  const dir = mk({ test: 'git -c user.email=t@t -c user.name=t commit --allow-empty -q -m sneaky' });
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 1);
  assert.match(report(dir).invalidReason, /HEAD changed/);
});

test('writes under work/ neither invalidate nor make the tree dirty', () => {
  const dir = mk({ test: `node -e "require('fs').mkdirSync('work',{recursive:true});require('fs').writeFileSync('work/x.txt','1')"` });
  runVerify(dir, '--base', 'main', '--out', out(dir));
  const j = report(dir);
  assert.equal(j.result, 'PASS');
  assert.equal(j.dirty, false);
});

test('skip markers: .only, xdescribe, xtest, pytest.skip(, @unittest.skip, { skip: true }', () => {
  const dir = mk({}, { 'tests/a.test.js': "describe('a',()=>{ it('x',()=>{ expect(1) }) })\n" });
  put(dir, 'tests/a.test.js', "xdescribe('a',()=>{ it.only('x',()=>{ expect(1) }); test('y',{ skip: true },()=>{ expect(1) }) })\n// pytest.skip( @unittest.skip xtest(\n");
  commitAll(dir);
  runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.match(report(dir).flagged[0].reasons.join(), /added 6 skip marker/);
});

test('per-command timeout from project.json kills the command -> FAIL', () => {
  const dir = mk({ test: 'node -e "setInterval(()=>{},1000)"' }, {}, { timeouts: { test: 1 } });
  const t0 = Date.now();
  const r = runVerify(dir, '--base', 'main', '--out', out(dir));
  assert.equal(r.status, 1);
  assert.ok(Date.now() - t0 < 30000);
  const c = report(dir).commands[0];
  assert.equal(c.timedOut, true);
  assert.equal(c.exitCode, 124);
  assert.equal(report(dir).result, 'FAIL');
});

test('verifies a merged task branch using the recorded base sha', () => {
  const dir = makeRepo({ config: { commands: { test: OK }, protected_paths: ['tests/**'] } });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'cs/t1');
  put(dir, 'src/t.js', 't');
  commitAll(dir);
  const r = runVerify(dir, '--base', base, '--out', out(dir));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(report(dir).base, base);
});

test('broken project.json -> exit 2', () => {
  const dir = mk({ test: OK });
  put(dir, '.studio/project.json', '{bad');
  const r = runVerify(dir, '--base', 'main');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unparseable/);
});
