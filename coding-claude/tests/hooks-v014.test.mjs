import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRepo, runHook, PLUGIN } from './helpers.mjs';

const config = { commands: { test: 'npm test' }, gated_commands: ['npm publish*', 'pnpm publish*', 'yarn npm publish*', 'docker push*'] };
const input = (cwd, command, tool_name = 'Bash', agent = 'reviewer') => ({
  cwd, tool_name, tool_input: { command }, agent_type: `coding-claude:${agent}`,
});
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
function repo(t) {
  const dir = makeRepo({ config });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const gate = (dir, command, tool = 'Bash') => runHook('gate-commands', input(dir, command, tool));

test('v014 #1: read-only agents are denied on an over-deep command', (t) => {
  const dir = repo(t);
  assert.equal(decision(runHook('restrict-readonly', input(dir, 'cat ' + '$('.repeat(2000), 'Bash', 'verifier'))), 'deny');
});

test('v014 #1: runHook supports a per-hook fail-closed fallback', (t) => {
  const dir = repo(t);
  const lib = path.join(PLUGIN, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/');
  const code = `import { runHook, preToolUse } from 'file:///${lib}';
    runHook('x', () => { throw new Error('boom'); }, () => preToolUse({ permissionDecision: 'deny', permissionDecisionReason: 'fallback' }));`;
  const plainCode = `import { runHook } from 'file:///${lib}';
    runHook('x', () => { throw new Error('boom'); });`;
  const run = (src) => spawnSync(process.execPath, ['--input-type=module', '-e', src], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' });
  const r = run(code);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const plain = run(plainCode);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, '');
});

test('v014 #1: every hook passes a fallback to runHook', () => {
  for (const [name, re] of [['gate-commands', /too complex/], ['restrict-readonly', /failed to check/], ['protect-checks', /internal error and could not check/]]) {
    assert.match(fs.readFileSync(path.join(PLUGIN, 'hooks', `${name}.mjs`), 'utf8'), re, name);
  }
});

for (const command of [
  'npm install', 'npm test', 'npm run publish-docs', 'npm pack', 'npm ping', 'npm pu', 'npm p', 'echo hi | cat',
  'echo "npm test" | bash', 'bash script.sh', 'bash -c "echo hi"', 'sh ./run.sh arg', 'pwsh -File x.ps1', 'pwsh -NoProfile -Command "echo hi"',
  'corepack enable', 'node scripts/build.js', 'node ./node_modules/.bin/eslint .', 'cmd /c echo hi', 'git status',
]) {
  test(`v014: no false positive for ${command}`, (t) => {
    assert.equal(gate(repo(t), command).out, null);
  });
}
