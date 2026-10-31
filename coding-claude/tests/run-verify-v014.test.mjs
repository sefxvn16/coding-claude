import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitAll, git, makeRepo, put, runVerify } from './helpers.mjs';

const out = (dir) => path.join(dir, 'work', 'r.json');
const report = (dir) => JSON.parse(fs.readFileSync(out(dir), 'utf8'));

function mk(t, commands, files = {}) {
  const dir = makeRepo({ config: { commands, protected_paths: ['tests/**'] }, files });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'checkout', '-q', '-b', 'feat');
  put(dir, 'src/start.js', '1');
  commitAll(dir, 'start');
  return dir;
}

const HELPER = 'tools/x.mjs';
function helperTest(name, command, scripts) {
  test(`v014 #2: helper flagged through ${name}`, (t) => {
    const dir = mk(t, { test: command }, {
      'package.json': JSON.stringify({ scripts }),
      [HELPER]: 'process.exit(0);\n',
    });
    put(dir, HELPER, 'process.exit(0); // loosened\n');
    commitAll(dir, 'change helper');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.ok([0, 1].includes(r.status), r.stdout + r.stderr); // pnpm/yarn/bun may be absent
    const j = report(dir);
    assert.deepEqual(j.flagged.map((f) => f.path), [HELPER], r.stdout);
    assert.match(j.flagged[0].reasons.join(), /file run by a package script/);
  });
}

const direct = { test: `node ${HELPER}`, check: `node ${HELPER}` };
for (const command of [
  'npm t', 'npm tst', 'npm test', 'npm run check', 'npm rum check', 'npm urn check', 'npm run-script check',
  'node --run check', 'pnpm run check', 'pnpm check', 'pnpm t', 'yarn run check', 'yarn check', 'bun run check',
]) helperTest(command, command, direct);

helperTest('nested script chain (npm run outer)', 'npm run outer', {
  outer: 'npm run inner && echo done', inner: 'npm run innermost', innermost: `node ${HELPER}`,
});
helperTest('mixed alias chain', 'pnpm check', { check: 'yarn run second', second: 'node --run third', third: `node ${HELPER}` });
helperTest('post hook', 'npm test', { test: 'echo ok', posttest: `node ${HELPER}` });
helperTest('cyclic scripts (terminates, still protects)', 'npm run a', {
  a: 'npm run b', b: `npm run a && node ${HELPER}`,
});

test('v014 #4: --out refuses a hardlinked target', (t) => {
  const dir = mk(t, { test: 'node -e "process.exit(0)"' }, { 'outside.txt': 'original' });
  fs.mkdirSync(path.join(dir, 'work'));
  try {
    fs.linkSync(path.join(dir, 'outside.txt'), out(dir));
  } catch (error) {
    t.skip(`hardlinks unavailable: ${error.code}`);
    return;
  }
  const r = runVerify(dir, '--base', 'main', '--out', 'work/r.json');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /hardlink/);
  assert.equal(fs.readFileSync(path.join(dir, 'outside.txt'), 'utf8'), 'original');
});

for (const file of ['.pnpmfile.mjs', '.pnpmfile.cjs', '.yarn/plugins/@yarnpkg/plugin-x.cjs', 'packages/a/.yarn/plugins/p.cjs']) {
  test(`v014 #4: ${file} is flagged as package-manager config`, (t) => {
    const dir = mk(t, { test: 'node -e "process.exit(0)"' });
    put(dir, file, 'module.exports = {};\n');
    commitAll(dir, 'add pm config');
    const r = runVerify(dir, '--base', 'main', '--out', out(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = report(dir);
    assert.equal(j.result, 'PASS-FLAGGED');
    assert.deepEqual(j.flagged.map((f) => f.path), [file]);
    assert.match(j.flagged[0].reasons.join(), /package-manager config/);
  });
}
