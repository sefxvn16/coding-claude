// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): guard protected_paths, check-config files and .studio/**.
// Builder: denied on existing protected files and anything outside its own worktree.
import fs from 'node:fs';
import path from 'node:path';
import {
  TEST_LIKE, checkConfigKind, findProject, gitTop, isStudioPath, matchPath, preToolUse, relToRoot, runHook, samePath,
} from '../scripts/lib/config.mjs';

const BUILDER = 'coding-claude:builder';

function nearestDir(p) {
  let d = path.dirname(p);
  while (!fs.existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return d;
}

runHook('protect-checks', (input, { root }) => {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (typeof file !== 'string') return null;
  const cwd = input.cwd || root;
  const abs = path.resolve(cwd, file);
  const isBuilder = input.agent_type === BUILDER;

  if (isBuilder) {
    const mine = gitTop(cwd);
    const theirs = gitTop(nearestDir(abs));
    if (!samePath(mine, theirs)) {
      return preToolUse({
        permissionDecision: 'deny',
        permissionDecisionReason: `builder may write only inside its own worktree (${mine ?? 'unknown'}); "${abs}" is outside. Report to Lead.`,
      });
    }
  }

  // Config and root come from the file's own repository (worktree vs main, `..` paths).
  const project = findProject(nearestDir(abs));
  if (!project) return null;
  const rel = relToRoot(project.root, abs);
  if (rel === null) return null;
  const { config, broken } = project;

  const studio = isStudioPath(rel);
  const cfg = checkConfigKind(rel, config);
  let pattern = studio ? '.studio/**' : matchPath(rel, config.protected_paths);
  if (!pattern && broken && TEST_LIKE.test(rel)) pattern = 'test-like path (config broken)';
  if (!pattern && cfg) pattern = `check config: ${cfg.kind}`;
  if (!pattern) return null;
  const note = broken ? ' [.studio/project.json is unparseable: fix it first; defaults applied]' : '';

  if (isBuilder) {
    const exists = fs.existsSync(abs);
    const hard = studio || !cfg || cfg.hard; // manifests (package.json ...) are warned, not denied
    if (hard && (studio || exists || (cfg && cfg.hard))) {
      return preToolUse({
        permissionDecision: 'deny',
        permissionDecisionReason: `builder may not modify protected checks ("${rel}", ${pattern}); report to Lead and list the needed change in your handoff${note}`,
      });
    }
    if (!exists && !cfg) return null; // builder may add new files under protected paths (e.g. new tests)
  }
  return preToolUse({
    additionalContext: `coding-claude WARNING: "${rel}" is a protected check path (${pattern}). Loosening, skipping or deleting tests needs reviewer and owner approval; verifier will flag this change.${note}`,
  });
}, () => preToolUse({
  additionalContext: 'coding-claude WARNING: protect-checks hit an internal error and could not check this edit; treat the file as possibly protected (tests, check config, .studio/**). Verifier will flag the change.',
}));
