import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeRepo, runHook, PLUGIN } from './helpers.mjs';

const config = {
  commands: { test: 'npm test', lint: 'node scripts/check.mjs' },
  protected_paths: ['tests/**'],
  gated_commands: ['npm publish*', 'yarn npm publish*', 'pnpm publish*'],
};
const bash = (dir, command, extra = {}, tool = 'Bash') => ({ cwd: dir, tool_name: tool, tool_input: { command }, ...extra });
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const ro = (agent) => ({ agent_id: 'x', agent_type: `coding-studio:${agent}` });
const VERIFY = path.join(PLUGIN, 'scripts', 'run-verify.mjs');
const GEMINI = path.join(PLUGIN, 'scripts', 'gemini-research.mjs');

test('restrict-readonly v0.1.2: complexity bypasses are denied for every read-only agent', () => {
  const dir = makeRepo({ config });
  const DENY = [
    'Write-Output "$([IO.File]::WriteAllText(\'v\',\'x\'))"', '.\\cat.ps1', './cat', 'cat.ps1', 'cat.exe a', '/bin/cat a', 'C:/x/cat a',
    'find . -ex\\ec touch v \\;', 'find . -exec touch v ;', 'find . -execdir touch v ;', 'find . -ok rm {} ;', 'find . -fprint o', 'find . -delete',
    'git diff --textconv', 'git diff --text', 'git diff --ext-diff', 'git diff --ext', 'git diff --output=o', 'git diff --out=o', 'git log --output o',
    'git -c core.pager=x log', 'git --exec-path=/x log', 'git -C .. status', 'git -C / status', 'git --git-dir=x status', 'git alias status', 'git config -l',
    'echo `touch v`', 'echo $(touch v)', 'echo ${IFS}', 'echo a; touch v', 'echo a && touch v', 'echo a || touch v', 'echo a & touch v',
    'echo a\ntouch v', 'cat <(touch v)', 'echo hi > v', 'echo hi 2>v', 'cat a 2>&1', 'cat < a', 'cat a | Set-Content v',
    'Write-Output @\'\nx\n\'@', 'echo x | iex', 'Invoke-Expression "ls"', 'pwsh -EncodedCommand AAAA', '[IO.File]::Delete("x")',
    'ls | Where-Object { Remove-Item $_ }', '(Remove-Item x)', 'echo {a,b}', 'echo "a" |', '| cat a',
    'cat a | node evil.js', 'node -e "1"', `node ${VERIFY}x`, 'node PLUGINVERIFY00', 'git status | rm x',
    'cat C:\\Users\\a\\b.txt',
  ];
  for (const agent of ['research', 'architect', 'reviewer', 'release-ops', 'verifier']) {
    for (const command of DENY) {
      const r = runHook('restrict-readonly', bash(dir, command, ro(agent)));
      assert.equal(decision(r), 'deny', `${agent} should deny: ${JSON.stringify(command)}`);
    }
  }
});

test('restrict-readonly v0.1.2: simple reads and pipes still allowed', () => {
  const dir = makeRepo({ config });
  for (const command of ['git status', 'git log --oneline | head -3', 'cat README.md | wc -l', 'git -C . diff --stat', 'git diff --no-color main...HEAD',
    'rg "a|b" src', 'git log --format="%an <%ae>" -3', 'Get-ChildItem src | Select-Object -First 3', 'git log -1 HEAD@{1}']) {
    assert.equal(runHook('restrict-readonly', bash(dir, command, ro('reviewer'))).out, null, command);
  }
});

test('restrict-readonly v0.1.2: deny message contains the full offending command', () => {
  const dir = makeRepo({ config });
  const command = 'echo x > f.txt';
  const r = runHook('restrict-readonly', bash(dir, command, ro('reviewer')));
  assert.equal(decision(r), 'deny');
  assert.ok(r.out.hookSpecificOutput.permissionDecisionReason.includes(command));
});

test('restrict-readonly v0.1.2: configured commands only as exact whole string, verifier/architect only', () => {
  const dir = makeRepo({ config });
  for (const agent of ['verifier', 'architect']) {
    assert.equal(runHook('restrict-readonly', bash(dir, 'npm test', ro(agent))).out, null);
    assert.equal(runHook('restrict-readonly', bash(dir, '  npm   test ', ro(agent))).out, null);
    for (const c of ['npm test --foo', 'npm test; rm x', 'npm test | cat', 'npm tes', 'node scripts/check.mjs --x', 'npm test\nrm x']) {
      assert.equal(decision(runHook('restrict-readonly', bash(dir, c, ro(agent)))), 'deny', c);
    }
  }
});

test('restrict-readonly v0.1.2: run-verify is verifier-only (exact absolute path); gemini heredoc ok, other heredoc denied', () => {
  const dir = makeRepo({ config });
  const verify = `node "${VERIFY}" --base abc --out work/t/05-verify-1.json`;
  const verifyFwd = `node '${VERIFY.replace(/\\/g, '/')}' --base abc`;
  for (const c of [verify, verifyFwd]) {
    assert.equal(runHook('restrict-readonly', bash(dir, c, ro('verifier'))).out, null, c);
    for (const agent of ['research', 'architect', 'reviewer', 'release-ops']) {
      assert.equal(decision(runHook('restrict-readonly', bash(dir, c, ro(agent)))), 'deny', `${agent} ${c}`);
    }
  }
  const gem = `node "${GEMINI}" --timeout 8m <<'EOF'\nquestion $(rm x) > y\nEOF`;
  for (const agent of ['research', 'architect', 'reviewer', 'release-ops', 'verifier']) {
    assert.equal(runHook('restrict-readonly', bash(dir, gem, ro(agent))).out, null, agent);
  }
  assert.equal(decision(runHook('restrict-readonly', bash(dir, "cat <<'EOF'\nx\nEOF", ro('research')))), 'deny');
  assert.equal(decision(runHook('restrict-readonly', bash(dir, `${gem}\nrm x`, ro('research')))), 'deny');
  assert.equal(decision(runHook('restrict-readonly', bash(dir, `node "${GEMINI}" && rm x`, ro('research')))), 'deny');
});

test('restrict-readonly v0.1.2: schema-invalid config is broken (no project commands)', () => {
  const dir = makeRepo({ config: { ...config, commands: { test: 5 } } });
  assert.equal(decision(runHook('restrict-readonly', bash(dir, 'npm test', ro('verifier')))), 'deny');
});

test('gate v0.1.2: PowerShell backtick escapes are normalized', () => {
  const dir = makeRepo({ config });
  for (const c of ['n`pm publish', 'npm` publish', 'pwsh -c "n`pm publish"', '& n`pm.cmd publish']) {
    assert.equal(decision(runHook('gate-commands', bash(dir, c, {}, 'PowerShell'))), 'ask', c);
  }
  assert.equal(runHook('gate-commands', bash(dir, 'echo `n`pm test', {}, 'PowerShell')).out, null);
});

test('gate v0.1.2: package-manager global options before the subcommand', () => {
  const dir = makeRepo({ config });
  const cmds = ['npm --registry https://r publish', 'npm --registry=https://r publish', 'npm --dry-run publish', 'npm -w pkg publish',
    'pnpm -w publish', 'pnpm --filter x publish', 'yarn npm publish', 'yarn --cwd x npm publish', 'npm --registry https://r --tag next publish',
    'npm.cmd --registry https://r publish', 'CI=1 npm -s publish'];
  for (const c of cmds) assert.equal(decision(runHook('gate-commands', bash(dir, c))), 'ask', c);
  for (const c of ['npm --registry https://r test', 'npm run publish-docs', 'npm -s test', 'pnpm -w test']) {
    assert.equal(runHook('gate-commands', bash(dir, c)).out, null, c);
  }
});

test('config schema: wrong types are broken config (fallback defaults, not fail-open)', () => {
  const invalid = [
    { ...config, gated_commands: 'npm publish*' }, { ...config, protected_paths: 'tests/**' }, { ...config, m2_triggers: [1] },
    { ...config, commands: ['npm test'] }, { ...config, timeouts: { default: '900' } }, { ...config, commands: { test: ['npm', 'test'] } },
  ];
  for (const bad of invalid) {
    const dir = makeRepo({ config: bad });
    const r = runHook('gate-commands', bash(dir, 'npm publish'));
    assert.equal(decision(r), 'ask');
    assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /config broken/);
    assert.equal(runHook('gate-commands', bash(dir, 'echo hi')).out, null);
  }
  const ok = makeRepo({ config: { ...config, timeouts: { default: 900 } } });
  assert.equal(runHook('gate-commands', bash(ok, 'echo hi')).out, null);
  assert.equal(decision(runHook('gate-commands', bash(ok, 'npm publish'))), 'ask');
});
