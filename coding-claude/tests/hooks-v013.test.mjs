import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, put, runHook, PLUGIN } from './helpers.mjs';

const config = { commands: { test: 'npm test' }, gated_commands: ['npm publish*', 'pnpm publish*', 'yarn npm publish*', 'gh release create*', 'docker push*'] };
const input = (cwd, command, tool_name = 'Bash', agent = 'reviewer') => ({
  cwd, tool_name, tool_input: { command }, agent_type: `coding-claude:${agent}`,
});
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const script = (name) => path.join(PLUGIN, 'scripts', `${name}.mjs`);
function repo(t, options = {}) {
  const dir = makeRepo({ config, ...options });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('v013 #1: quoted/nested heredoc markers cannot hide command lines', (t) => {
  const dir = repo(t);
  for (const marker of ['"<<\'EOF\'"', "'<<\"EOF\"'", '(echo <<\'EOF\')', '`echo <<\'EOF\'`']) {
    const command = `node "${script('run-verify')}" ${marker}\nnpm publish\nEOF`;
    assert.equal(decision(runHook('restrict-readonly', input(dir, command, 'Bash', 'verifier'))), 'deny', marker);
    assert.equal(decision(runHook('gate-commands', input(dir, command))), 'ask', marker);
  }
});

test('v013 #1: heredocs and other newlines are denied', (t) => {
  const dir = repo(t, { config: { ...config, commands: { test: 'npm test', lint: 'echo "first\nsecond"' } } });
  for (const operator of ["<<'EOF'", '<<"EOF"', "<<-'EOF'"]) {
    const command = `node "${script('run-verify')}" --base abc ${operator}\nquestion $(npm publish)\n${operator.includes('-') ? '\t' : ''}EOF`;
    assert.equal(decision(runHook('restrict-readonly', input(dir, command, 'Bash', 'verifier'))), 'deny', operator);
    for (const suffix of ['\nnpm publish', '\necho harmless', '\n', '\n\n']) {
      assert.equal(decision(runHook('restrict-readonly', input(dir, command + suffix))), 'deny', operator + JSON.stringify(suffix));
    }
  }
  for (const command of ['echo "first\nsecond"', 'npm\ntest', 'npm test\n', `node "${script('run-verify')}" <<'EOF'\nmissing terminator`]) {
    assert.equal(decision(runHook('restrict-readonly', input(dir, command, 'Bash', 'verifier'))), 'deny', command);
  }
});

test('v013 #3: deterministic option skipping and ordered significant token safety net', (t) => {
  const dir = repo(t);
  const many = Array(30).fill('--color=false').join(' ');
  for (const command of [
    `npm ${many} --prefix . publish`, 'npm --unknown value publish', 'pnpm -w publish',
    'yarn --cwd x npm publish', 'bun --silent publish', 'npm run publish',
    'gh --hostname example.test release --repo owner/repo create v1', 'docker --context local push app',
  ]) assert.equal(decision(runHook('gate-commands', input(dir, command))), 'ask', command);
  for (const command of [`npm ${many} --prefix . test`, 'npm run publish-docs', 'echo "npm publish"', 'gh create release']) {
    assert.equal(runHook('gate-commands', input(dir, command)).out, null, command);
  }
});

test('v013 #7: remote reads allowed; remote writes remain denied', (t) => {
  const dir = repo(t);
  for (const command of ['git remote', 'git remote -v', 'git remote get-url origin']) {
    assert.equal(runHook('restrict-readonly', input(dir, command)).out, null, command);
  }
  for (const command of ['git remote add origin url', 'git remote remove origin', 'git remote set-url origin url', 'git remote update', 'git remote get-url origin extra']) {
    assert.equal(decision(runHook('restrict-readonly', input(dir, command))), 'deny', command);
  }
});

test('v013 #7: git -C resolves cumulatively inside repo toplevel, beyond project config root', (t) => {
  const dir = repo(t);
  put(dir, 'app/.studio/project.json', JSON.stringify(config));
  fs.mkdirSync(path.join(dir, 'app/sub'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
  const cwd = path.join(dir, 'app');
  for (const command of ['git -C .. status', 'git -C ../other diff', 'git -C sub -C ../.. status']) {
    assert.equal(runHook('restrict-readonly', input(cwd, command)).out, null, command);
  }
  for (const command of ['git -C ../.. status', 'git -C sub -C ../../.. status', 'git -C .. push', 'git -C missing status']) {
    assert.equal(decision(runHook('restrict-readonly', input(cwd, command))), 'deny', command);
  }
  const outside = repo(t);
  fs.symlinkSync(outside, path.join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(decision(runHook('restrict-readonly', input(cwd, 'git -C ../escape status'))), 'deny');
});

test('v013 #5: package-manager configs are protected by the edit hook, including new files', (t) => {
  const dir = repo(t);
  for (const name of ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', 'pnpm-workspace.yaml', 'bunfig.toml']) {
    for (const exists of [false, true]) {
      if (exists) put(dir, name, 'changed');
      const edit = { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, name) } };
      assert.equal(decision(runHook('protect-checks', { ...edit, agent_type: 'coding-claude:builder' })), 'deny', name);
      assert.match(runHook('protect-checks', edit).out.hookSpecificOutput.additionalContext, /check config/, name);
    }
  }
});
