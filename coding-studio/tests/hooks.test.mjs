import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, put, runHook } from './helpers.mjs';
import { globToRegex, matchPath } from '../scripts/lib/config.mjs';

const config = { protected_paths: ['tests/**', '**/__snapshots__/**'], gated_commands: ['vercel deploy*', 'npm publish*'] };

test('glob: **, *, backslashes, case', () => {
  assert.ok(matchPath('tests/a/b.js', ['tests/**']));
  assert.ok(matchPath('TESTS\\a.js', ['tests/**']));
  assert.ok(matchPath('__snapshots__/x', ['**/__snapshots__/**']));
  assert.ok(matchPath('a/b/__snapshots__/x.snap', ['**/__snapshots__/**']));
  assert.ok(!matchPath('tests/a/b.js', ['tests/*']));
  assert.ok(matchPath('src/a.test.js', ['src/*.test.js']));
  assert.ok(globToRegex('vercel deploy*', false).test('vercel deploy --prod'));
});

test('gate: allows normal command', () => {
  const dir = makeRepo({ config });
  const r = runHook('gate-commands', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
});

test('gate: asks on gated command, in segments, with env prefix', () => {
  const dir = makeRepo({ config });
  for (const command of ['vercel deploy --prod', 'cd x && npm publish --tag a', 'CI=1 npm  publish', 'echo hi; vercel deploy']) {
    const r = runHook('gate-commands', { cwd: dir, tool_name: 'Bash', tool_input: { command } });
    assert.equal(r.out.hookSpecificOutput.permissionDecision, 'ask', command);
    assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /gated pattern/);
  }
});

test('gate: no config -> silent no-op', () => {
  const dir = makeRepo();
  const r = runHook('gate-commands', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'vercel deploy' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// 0.1.1: replaces the former "bad config fails open" test. A project.json that exists but is
// unparseable no longer disables gating: built-in gated list applies and asks ("config broken").
test('gate: broken config -> built-in gated list asks "config broken", harmless command passes, error logged', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cs data '));
  const dir = makeRepo();
  put(dir, '.studio/project.json', '{bad json');
  const bad = runHook('gate-commands', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'npm publish' } }, { CLAUDE_PLUGIN_DATA: data });
  assert.equal(bad.status, 0);
  assert.equal(bad.out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(bad.out.hookSpecificOutput.permissionDecisionReason, /config broken/);
  const ok = runHook('gate-commands', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'npm test' } }, { CLAUDE_PLUGIN_DATA: data });
  assert.equal(ok.stdout, '');
  assert.match(fs.readFileSync(path.join(data, 'logs', 'hooks.jsonl'), 'utf8'), /config broken/);
});

const edit = (dir, rel, extra = {}) => ({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, ...rel.split('/')) }, ...extra });
const builder = { agent_id: 'a1', agent_type: 'coding-studio:builder' };

test('protect: main session gets warning only', () => {
  const dir = makeRepo({ config, files: { 'tests/a.test.js': 'x' } });
  const r = runHook('protect-checks', edit(dir, 'tests/a.test.js'));
  assert.ok(r.out.hookSpecificOutput.additionalContext);
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined);
});

test('protect: unprotected path -> nothing', () => {
  const dir = makeRepo({ config });
  assert.equal(runHook('protect-checks', edit(dir, 'src/a.js')).out, null);
});

test('protect: builder denied on existing protected test', () => {
  const dir = makeRepo({ config, files: { 'tests/a.test.js': 'x' } });
  const r = runHook('protect-checks', edit(dir, 'tests/a.test.js', builder));
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /report to Lead/);
});

test('protect: builder may add new test file', () => {
  const dir = makeRepo({ config });
  assert.equal(runHook('protect-checks', edit(dir, 'tests/new.test.js', builder)).out, null);
});

test('protect: builder denied on .studio, existing or new', () => {
  const dir = makeRepo({ config });
  assert.equal(runHook('protect-checks', edit(dir, '.studio/project.json', builder)).out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHook('protect-checks', edit(dir, '.studio/new.json', builder)).out.hookSpecificOutput.permissionDecision, 'deny');
});

test('protect: other agent only warned; no config is a no-op', () => {
  const dir = makeRepo({ config, files: { 'tests/a.test.js': 'x' } });
  const r = runHook('protect-checks', edit(dir, 'tests/a.test.js', { agent_id: 'z', agent_type: 'coding-studio:reviewer' }));
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined);
  const plain = makeRepo({ files: { 'tests/a.test.js': 'x' } });
  assert.equal(runHook('protect-checks', edit(plain, 'tests/a.test.js', builder)).stdout, '');
});

test('protect: finds config from subdirectory cwd', () => {
  const dir = makeRepo({ config, files: { 'tests/a.test.js': 'x' } });
  const r = runHook('protect-checks', { cwd: path.join(dir, 'tests'), tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'tests', 'a.test.js') }, ...builder });
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
});
