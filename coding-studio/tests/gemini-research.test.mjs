import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gemini-research.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gr test '));

function fake(name, body) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
}
function runHelper(args, env = {}, input) {
  const r = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...env }, input, encoding: 'utf8', timeout: 30000,
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, json, raw: r.stdout };
}

// Fake agy: echoes the args it received inside the response.
const okAgy = fake('ok.mjs', `
const a = process.argv.slice(2);
const get = f => a[a.indexOf(f) + 1];
console.log(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify({
  model: get('--model'), effort: a.includes('--effort') ? get('--effort') : null,
  prompt: get('-p'), noTimeoutFlag: !a.includes('--print-timeout') }) + '\\n' }));
`);
const emptyAgy = fake('empty.mjs', `console.log(JSON.stringify({ status: 'SUCCESS', response: '' }));`);
const hangAgy = fake('hang.mjs', `setTimeout(() => {}, 60000);`);
const errAgy = fake('err.mjs', `console.error('quota exceeded'); process.exit(3);`);
const promptFile = fake('p.txt', 'hello world');

test('success: passes prompt, default model, no --effort, no --print-timeout', () => {
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: okAgy, CODING_STUDIO_GEMINI_MODEL: '' });
  assert.equal(r.code, 0);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.model, 'gemini-3.8-flash-high');
  const seen = JSON.parse(r.json.response);
  assert.equal(seen.prompt, 'hello world');
  assert.equal(seen.effort, null);
  assert.equal(seen.noTimeoutFlag, true);
});

test('success: options, env override, stdin prompt', () => {
  const r = runHelper(['--effort', 'high', '--timeout', '30s'], { CODING_STUDIO_AGY_BIN: okAgy, CODING_STUDIO_GEMINI_MODEL: 'gemini-x' }, 'from stdin');
  assert.equal(r.code, 0);
  assert.equal(r.json.model, 'gemini-x');
  const seen = JSON.parse(r.json.response);
  assert.equal(seen.effort, 'high');
  assert.equal(seen.prompt, 'from stdin');
  const r2 = runHelper(['--model', 'cli-model', promptFile], { CODING_STUDIO_AGY_BIN: okAgy, CODING_STUDIO_GEMINI_MODEL: 'env-model' });
  assert.equal(r2.json.model, 'cli-model');
});

test('empty response -> ok:false, non-zero exit', () => {
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: emptyAgy });
  assert.notEqual(r.code, 0);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.response, '');
  assert.match(r.json.error, /Empty response/);
});

test('timeout -> ok:false', () => {
  const r = runHelper(['--timeout', '1s', promptFile], { CODING_STUDIO_AGY_BIN: hangAgy });
  assert.notEqual(r.code, 0);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /Timed out/);
});

test('timeout via env var', () => {
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: hangAgy, CODING_STUDIO_GEMINI_TIMEOUT: '1s' });
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /Timed out after 1s/);
});

test('agy error exit -> ok:false with stderr', () => {
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: errAgy });
  assert.notEqual(r.code, 0);
  assert.equal(r.json.ok, false);
  assert.match(r.json.stderr, /quota exceeded/);
});

test('missing agy -> ok:false', () => {
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: path.join(tmp, 'nope.exe') });
  assert.notEqual(r.code, 0);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /agy not found/);
});

test('invalid effort and empty prompt rejected', () => {
  assert.equal(runHelper(['--effort', 'bogus', promptFile], { CODING_STUDIO_AGY_BIN: okAgy }).json.ok, false);
  const empty = fake('e.txt', '  \n');
  assert.equal(runHelper([empty], { CODING_STUDIO_AGY_BIN: okAgy }).json.ok, false);
});

test('empty first answer is retried once, then succeeds', () => {
  const counter = path.join(tmp, 'counter.txt');
  fs.rmSync(counter, { force: true });
  const flaky = fake('flaky.mjs', `
import fs from 'node:fs';
const c = ${JSON.stringify(counter)};
const n = fs.existsSync(c) ? Number(fs.readFileSync(c, 'utf8')) : 0;
fs.writeFileSync(c, String(n + 1));
console.log(JSON.stringify({ status: 'SUCCESS', response: n === 0 ? '' : 'pong\\n' }));
`);
  const r = runHelper([promptFile], { CODING_STUDIO_AGY_BIN: flaky });
  assert.equal(r.code, 0);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.response, 'pong');
  assert.equal(r.json.attempts, 2);
});
