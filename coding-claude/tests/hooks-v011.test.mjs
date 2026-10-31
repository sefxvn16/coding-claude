import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, makeRepo, put, runHook, PLUGIN } from './helpers.mjs';
import { DEFAULT_GATED } from '../scripts/lib/config.mjs';

const template = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'skills', 'coding-claude', 'templates', 'project.json'), 'utf8'));
const config = {
  commands: { test: 'npm test', lint: 'node scripts/check.mjs' },
  protected_paths: ['tests/**'],
  gated_commands: template.gated_commands,
};
const bash = (dir, command, extra = {}) => ({ cwd: dir, tool_name: 'Bash', tool_input: { command }, ...extra });
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;

test('template gated list equals built-in default list', () => {
  assert.deepEqual(template.gated_commands, DEFAULT_GATED);
});

test('gate: reviewer bypass list and wrappers are all asked', () => {
  const dir = makeRepo({ config });
  const bypasses = [
    'npx vercel deploy --prod', 'vercel --prod', '& vercel deploy', 'npm.cmd publish', "bash -c 'npm publish'",
    '(npm publish)', 'echo a & npm publish', '& npm publish', 'command npm publish', 'npx -y vercel deploy',
    'pnpm dlx vercel deploy', 'cmd /c npm publish', 'pwsh -c "npm publish"', 'powershell -Command "& npm publish"',
    '"C:\\Program Files\\nodejs\\npm.cmd" publish', 'CI=1 npx --yes vercel deploy', 'sh -c "cd x && npm publish"',
    'if ($true) { npm publish }', 'echo $(npm publish)', 'start "" npm publish', 'bash -lc "bash -c \'npm publish\'"',
    'cat <<EOF\nok\nEOF\nnpm publish',
  ];
  for (const command of bypasses) {
    const r = runHook('gate-commands', bash(dir, command));
    assert.equal(decision(r), 'ask', command);
  }
});

test('gate: harmless look-alikes are not asked', () => {
  const dir = makeRepo({ config });
  for (const command of ['echo "npm publish"', 'git commit -m "npm publish"', 'npm test', 'npm run publish-docs', 'ls vercel']) {
    assert.equal(runHook('gate-commands', bash(dir, command)).out, null, command);
  }
});

const ro = (agent) => ({ agent_id: 'x', agent_type: `coding-claude:${agent}` });
const READONLY = ['research', 'architect', 'reviewer', 'release-ops', 'verifier'];
const ALLOW = [
  'git status', 'git status --porcelain', 'git log --oneline -5', 'git show HEAD:src/a.js', 'git diff main...HEAD',
  'git rev-parse HEAD', 'git ls-files', 'git merge-base main HEAD', 'git branch --list', 'git branch --merged main',
  'git worktree list', 'git -C . status', 'ls -la', 'dir', 'cat README.md', 'type README.md', 'Get-Content README.md',
  'head -5 README.md', 'tail -n 3 README.md', 'grep -rn foo src', 'rg foo src', 'Select-String -Path a.txt -Pattern x',
  'find . -name "*.js"', 'wc -l README.md', 'git log --oneline | head -3', 'git diff', 'cat a.txt', 'Get-Content a.txt', 'ls src', 'git log -1 HEAD@{1}',
];
const DENY = [
  `node "${path.join(PLUGIN, 'scripts', 'run-verify.mjs')}" --base abc <<'EOF'\nquestion with $(rm -rf x) and > redirect\nEOF`,
  'git checkout main', 'git switch -c x', 'git commit -m x', 'git merge feat', 'git reset --hard', 'git stash',
  'git worktree add ../x', 'git worktree remove x', 'git branch -d x', 'git branch -D x', 'git branch newbranch',
  'git push', 'git -c core.pager=evil log', 'git diff --output=out.txt', 'git clean -fd',
  'npm install', 'npm i left-pad', 'pnpm add x', 'pip install x', 'rm -rf x', 'mv a b', 'cp a b', 'touch x',
  'echo hi > out.txt', 'echo hi >> out.txt', 'cat a > b', 'git log > log.txt', 'Out-File x', 'Set-Content a.txt hi',
  '"x" | Set-Content a.txt', 'cat a | tee b', 'Add-Content a b', 'Remove-Item x', 'New-Item x',
  'find . -delete', 'find . -exec rm {} ;', 'find . -name x -fprint o', 'rg --pre cmd foo', 'node evil.js',
  'node -e "1"', `node "${path.join(PLUGIN, 'scripts', 'other.mjs')}"`, 'echo ok && rm x', 'git status; rm x',
  'echo $(rm x)', 'FOO=1 git status', 'bash -c "git status"', 'npx foo', 'sed -i s/a/b/ f', 'curl http://x', 'cat <<EOF\nrm x\nEOF',
  'cat <<EOF > f\nx\nEOF', 'python -c "1"',
];

test('restrict-readonly: allowlist for every read-only agent', () => {
  const dir = makeRepo({ config });
  for (const agent of READONLY) {
    for (const command of ALLOW) {
      const r = runHook('restrict-readonly', bash(dir, command, ro(agent)));
      assert.equal(r.out, null, `${agent} should allow: ${command}`);
    }
    for (const command of DENY) {
      const r = runHook('restrict-readonly', bash(dir, command, ro(agent)));
      assert.equal(decision(r), 'deny', `${agent} should deny: ${command}`);
      assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /Ask Lead/);
    }
  }
});

test('restrict-readonly: exact project.json commands only for verifier and architect', () => {
  const dir = makeRepo({ config });
  for (const agent of ['verifier', 'architect']) {
    assert.equal(runHook('restrict-readonly', bash(dir, 'npm test', ro(agent))).out, null, agent);
    assert.equal(runHook('restrict-readonly', bash(dir, 'node scripts/check.mjs', ro(agent))).out, null, agent);
    assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm test && rm x', ro(agent)))), 'deny');
    assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm test > out.txt', ro(agent)))), 'deny');
    assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm install', ro(agent)))), 'deny');
  }
  for (const agent of ['research', 'reviewer', 'release-ops']) {
    assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm test', ro(agent)))), 'deny', agent);
  }
});

test('restrict-readonly: PowerShell tool is covered; main session and builder pass through', () => {
  const dir = makeRepo({ config });
  const ps = { cwd: dir, tool_name: 'PowerShell', tool_input: { command: 'Set-Content a.txt hi' } };
  assert.equal(decision(runHook('restrict-readonly', { ...ps, ...ro('reviewer') })), 'deny');
  assert.equal(runHook('restrict-readonly', ps).stdout, '');
  assert.equal(runHook('restrict-readonly', { ...ps, ...ro('builder') }).stdout, '');
  assert.equal(runHook('restrict-readonly', bash(dir, 'git commit -m x', { agent_id: 'b', agent_type: 'other:agent' })).stdout, '');
});

test('restrict-readonly: no config no-op; broken config uses default allowlist (no project commands)', () => {
  const plain = makeRepo();
  assert.equal(runHook('restrict-readonly', bash(plain, 'rm x', ro('reviewer'))).stdout, '');
  const dir = makeRepo();
  put(dir, '.studio/project.json', '{bad');
  assert.equal(decision(runHook('restrict-readonly', bash(dir, 'rm x', ro('verifier')))), 'deny');
  assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm test', ro('verifier')))), 'deny');
  assert.equal(runHook('restrict-readonly', bash(dir, 'git status', ro('verifier'))).out, null);
});

// ---- protect-checks ----

const edit = (cwd, file, extra = {}) => ({ cwd, tool_name: 'Write', tool_input: { file_path: file }, ...extra });
const builder = { agent_id: 'a1', agent_type: 'coding-claude:builder' };

function withWorktree() {
  const dir = makeRepo({ config: { ...config, protected_paths: ['tests/**'] }, files: { 'tests/a.test.js': 'x', 'src/a.js': 'x' } });
  const wt = path.join(dir, '.claude', 'worktrees', 'agent-1');
  git(dir, 'worktree', 'add', '-q', wt, '-b', 'cs/t1');
  return { dir, wt };
}

test('protect: builder in worktree - existing test denied, new test allowed, src allowed', () => {
  const { wt } = withWorktree();
  assert.equal(decision(runHook('protect-checks', edit(wt, path.join(wt, 'tests', 'a.test.js'), builder))), 'deny');
  assert.equal(runHook('protect-checks', edit(wt, path.join(wt, 'tests', 'new.test.js'), builder)).out, null);
  assert.equal(runHook('protect-checks', edit(wt, path.join(wt, 'src', 'a.js'), builder)).out, null);
});

test('protect: builder writes outside its own worktree are denied (main repo, .. paths, outside git)', () => {
  const { dir, wt } = withWorktree();
  const r1 = runHook('protect-checks', edit(wt, path.join(dir, 'src', 'a.js'), builder));
  assert.equal(decision(r1), 'deny');
  assert.match(r1.out.hookSpecificOutput.permissionDecisionReason, /own worktree/);
  const viaDots = path.join(wt, 'src', '..', '..', '..', '..', 'tests', 'a.test.js');
  assert.equal(decision(runHook('protect-checks', edit(wt, viaDots, builder))), 'deny');
  const outside = path.join(path.dirname(dir), 'elsewhere.txt');
  assert.equal(decision(runHook('protect-checks', edit(wt, outside, builder))), 'deny');
  // builder with main-repo cwd cannot write into a worktree path either
  assert.equal(decision(runHook('protect-checks', edit(dir, path.join(wt, 'src', 'a.js'), builder))), 'deny');
});

test('protect: main session editing a worktree file uses that worktree config (warn only)', () => {
  const { dir, wt } = withWorktree();
  const r = runHook('protect-checks', edit(dir, path.join(wt, 'tests', 'a.test.js')));
  assert.ok(r.out.hookSpecificOutput.additionalContext);
});

test('protect: check-config files are protected even outside protected_paths', () => {
  const dir = makeRepo({ config, files: { 'jest.config.js': 'x', 'package.json': '{}', 'scripts/check.mjs': 'x', '.github/workflows/ci.yml': 'x', 'src/a.js': 'x' } });
  for (const f of ['jest.config.js', 'scripts/check.mjs', '.github/workflows/ci.yml']) {
    assert.equal(decision(runHook('protect-checks', edit(dir, path.join(dir, f), builder))), 'deny', f);
    assert.ok(runHook('protect-checks', edit(dir, path.join(dir, f))).out.hookSpecificOutput.additionalContext, f);
  }
  // manifests: builder warned, not denied
  const pj = runHook('protect-checks', edit(dir, path.join(dir, 'package.json'), builder));
  assert.equal(decision(pj), undefined);
  assert.ok(pj.out.hookSpecificOutput.additionalContext);
  assert.equal(runHook('protect-checks', edit(dir, path.join(dir, 'src', 'a.js'), builder)).out, null);
});

test('protect: broken config warns on .studio and test-like paths, denies builder on existing ones', () => {
  const dir = makeRepo({ files: { 'tests/a.test.js': 'x', 'src/a.js': 'x', 'src/b.spec.ts': 'x' } });
  put(dir, '.studio/project.json', '{bad');
  for (const f of ['.studio/project.json', 'tests/a.test.js', 'src/b.spec.ts']) {
    const w = runHook('protect-checks', edit(dir, path.join(dir, f)));
    assert.match(w.out.hookSpecificOutput.additionalContext, /unparseable/, f);
    assert.equal(decision(runHook('protect-checks', edit(dir, path.join(dir, f), builder))), 'deny', f);
  }
  assert.equal(runHook('protect-checks', edit(dir, path.join(dir, 'src', 'a.js'))).out, null);
  assert.equal(runHook('protect-checks', edit(dir, path.join(dir, 'tests', 'new.test.js'), builder)).out, null);
});

test('hooks.json registers all three hooks', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  const cmds = JSON.stringify(h);
  for (const n of ['gate-commands', 'restrict-readonly', 'protect-checks']) assert.match(cmds, new RegExp(n));
});
