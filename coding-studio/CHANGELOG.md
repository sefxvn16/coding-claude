# Changelog

## 0.1.2
- Add `scripts/codex-run.mjs` (codex exec rooted at `--cd`, optional `--add-dir`); Lead runs Codex builders through it in their own worktree, so Codex writes where the project is. Tests: `tests/codex-run.test.mjs`.

Fixes from the round-2 Codex review and the live smoke test.
- restrict-readonly redesigned to fail closed on complexity: no shell interpretation; denies `$(` `${` backticks, backslashes, `; & && ||`, all redirects, `<`, newlines, parentheses/braces, `::`, `[IO.`, here-strings, iex/EncodedCommand; executable must be a bare allowlisted name; `node` only with the exact absolute plugin script path (run-verify: verifier only; gemini: quoted heredoc); configured project commands only as an exact whole-string match (verifier/architect); git: no `-c`, `--exec-path`, `-C` outside the repo, `--output`/`--ext-diff`/`--textconv` (abbreviations included); the deny message shows the full command. Intentionally no longer allowed: `2>&1`, `2>/dev/null`, `2>$null`, `a && b`.
- gate-commands: PowerShell backtick escapes removed before matching; npm/pnpm/yarn/bun global options before the subcommand are skipped (`npm --registry X publish`, `pnpm -w publish`, `yarn --cwd x npm publish`).
- Config schema validated (commands object of strings, arrays of strings, numeric timeouts); schema-invalid is treated as broken config (defaults + ask), not fail-open.
- Workflow: builder branches from START (current task-branch tip), BASE stays the task base; verify base must be where the task branch was cut with approved config on it; cleanup also deletes `worktree-agent-<id>` branches.
- Agents: spec uses `##` headings and knows protected tests/** do not block NEW test files; release-ops rolls back with `git revert` only; init final report is an explicit checklist.
- init/README: `codex@openai-codex` must be enabled at local scope when disabled at a higher scope; init merges the key into `.claude/settings.local.json`. Docs use `node --test tests/*.test.mjs`.
- run-verify items of this round (`--out` inside `work/`, package.json test-config keys and referenced scripts, skip-worktree/assume-unchanged INVALID) are tracked separately.

## 0.1.1

Fixes from two independent reviews (Codex, Claude).
- gate-commands: normalizes wrappers, paths, extensions and `bash -c`/`cmd /c`/`pwsh -c` strings before matching; splits on `&` and parentheses; wider default gated list. Documented as a safety net.
- New hook restrict-readonly: command allowlist for research, architect, reviewer, release-ops, verifier (main session and builder unaffected).
- Broken .studio/project.json no longer fails open (default gated list, test-like path warnings, default allowlist). Distinct from "no config" (still a no-op). The test that pinned fail-open was replaced.
- protect-checks: check-config files always protected; builder path resolved from the file's own git toplevel, writes outside the builder worktree denied; builder never edits existing protected tests (Lead edits after owner approval).
- run-verify: mandatory `--base <sha>` (no auto guessing; exit 2 for missing/invalid/base==HEAD/no merge-base); refuses to run when commands/protected_paths/gated_commands changed since the merge-base; flags check-config files; INVALID when HEAD or tracked files change during the run; per-command timeouts; statuses PASS-FLAGGED/INVALID/CONFIG-ERROR; `work/` ignored; more skip markers (.only, xdescribe, xtest, pytest.skip, @unittest.skip, { skip: true }).
- Workflow: task branch `cs/<task-id>`, verify on the merged branch only, explicit worktree cleanup (`git branch -d` after `--merged`), absolute script paths in handoffs, Gemini prompt via stdin heredoc, intake checks project.json parses and is committed.
- init: adds `work/` and `.claude/worktrees/` to .gitignore; CLAUDE.md block tells Lead to use the coding-studio skill. Skill description rewritten to trigger on coding tasks.
- Evals: cases no longer grant Bash; skill-fires scaffold carries the init CLAUDE.md block; reviewer-readonly tells Lead not to edit; init-flow gains work/ and skill-reference graders. Evals must run on a copy without the `codex@openai-codex` dependency (see README).
- Handoff template gains "check results"; README corrected; evals/results/ git-ignored.

## 0.1.0

- Seven agents: research, spec, architect, builder (isolation: worktree), verifier, reviewer, release-ops.
- Skill `coding-studio` (Lead playbook) with templates: brief, handoff, dossier, project.json.
- Skill `init` (`/coding-studio:init`): idempotent project setup.
- Hooks `gate-commands`, `protect-checks`; scripts `run-verify.mjs`, `gemini-research.mjs`.
- Eval suite (4 cases) under `evals/`.
