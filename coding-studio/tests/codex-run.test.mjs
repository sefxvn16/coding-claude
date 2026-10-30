import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../scripts/codex-run.mjs';

// Fake codex: records argv + stdin, writes the -o file according to FAKE_MODE.
const FAKE = `
import fs from 'node:fs';
const argv = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', d => (stdin += d));
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, stdin }));
  const mode = process.env.FAKE_MODE || 'ok';
  const o = argv[argv.indexOf('-o') + 1];
  if (mode === 'ok') fs.writeFileSync(o, 'done: ' + stdin.trim());
  if (mode === 'empty') fs.writeFileSync(o, '');
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(3); }
  if (mode === 'hang') setTimeout(() => {}, 60000);
});
`;

function setup(mode = 'ok') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex run test '));
  const bin = path.join(dir, 'fake-codex.mjs');
  fs.writeFileSync(bin, FAKE);
  const work = path.join(dir, 'work dir');
  const extra = path.join(dir, 'extra dir');
  fs.mkdirSync(work); fs.mkdirSync(extra);
  const log = path.join(dir, 'log.json');
  const env = { ...process.env, CODING_STUDIO_CODEX_BIN: bin, FAKE_LOG: log, FAKE_MODE: mode };
  return { work, extra, log, env, readLog: () => JSON.parse(fs.readFileSync(log, 'utf8')) };
}

test('runs codex rooted at --cd with extra writable dirs, prompt via stdin', async () => {
  const s = setup();
  const r = await run(['--cd', s.work, '--add-dir', s.extra, '--model', 'gpt-6-astra', '--effort', 'high'], s.env, async () => 'do it');
  assert.equal(r.ok, true);
  assert.equal(r.response, 'done: do it');
  const { argv, stdin } = s.readLog();
  assert.equal(stdin, 'do it');
  assert.equal(argv[argv.indexOf('-C') + 1], path.resolve(s.work));
  assert.equal(argv[argv.indexOf('--add-dir') + 1], path.resolve(s.extra));
  assert.equal(argv[argv.indexOf('-s') + 1], 'workspace-write');
  assert.equal(argv[argv.indexOf('-m') + 1], 'gpt-6-astra');
  assert.ok(argv.includes('model_reasoning_effort="high"'));
  assert.equal(argv.at(-1), '-');
});

test('defaults: account model, effort medium, workspace-write', async () => {
  const s = setup();
  const r = await run(['--cd', s.work], s.env, async () => 'x');
  assert.equal(r.ok, true);
  const { argv } = s.readLog();
  assert.ok(!argv.includes('-m'));
  assert.ok(argv.includes('model_reasoning_effort="medium"'));
});

test('--cd is required and must exist', async () => {
  const s = setup();
  assert.match((await run([], s.env, async () => 'x')).error, /--cd/);
  assert.match((await run(['--cd', path.join(s.work, 'nope')], s.env, async () => 'x')).error, /Not a directory/);
  assert.equal(fs.existsSync(s.log), false);
});

test('rejects bad effort and sandbox', async () => {
  const s = setup();
  assert.match((await run(['--cd', s.work, '--effort', 'huge'], s.env, async () => 'x')).error, /Invalid --effort/);
  assert.match((await run(['--cd', s.work, '--sandbox', 'danger-full-access'], s.env, async () => 'x')).error, /Invalid --sandbox/);
});

test('non-zero exit, empty answer, timeout and missing binary are failures', async () => {
  let s = setup('fail');
  let r = await run(['--cd', s.work], s.env, async () => 'x');
  assert.equal(r.ok, false); assert.match(r.error, /code 3/); assert.match(r.stderr, /boom/);
  s = setup('empty');
  r = await run(['--cd', s.work], s.env, async () => 'x');
  assert.equal(r.ok, false); assert.match(r.error, /Empty final message/);
  s = setup('hang');
  r = await run(['--cd', s.work, '--timeout', '1s'], s.env, async () => 'x');
  assert.equal(r.ok, false); assert.match(r.error, /Timed out/);
  r = await run(['--cd', s.work], { ...s.env, CODING_STUDIO_CODEX_BIN: path.join(s.work, 'missing.mjs') }, async () => 'x');
  assert.equal(r.ok, false); assert.match(r.error, /codex not found/);
});

test('empty prompt is rejected before running', async () => {
  const s = setup();
  const r = await run(['--cd', s.work], s.env, async () => '  ');
  assert.equal(r.ok, false); assert.match(r.error, /Empty prompt/);
  assert.equal(fs.existsSync(s.log), false);
});
