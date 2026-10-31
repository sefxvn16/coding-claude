# Changelog

## 0.1.6
- gate-commands simplified to a safety net against honest mistakes: split on shell separators, drop wrappers, env assignments, executable paths and extensions, match `gated_commands` with ordered tokens; any package-manager command containing `publish` asks. Removed: heredoc and stdin extraction, recursive `$()`/backtick parsing, npm abbreviations, `node npm-cli.js` detection, PowerShell backtick handling, length and nesting caps. `scripts/lib/shell.mjs` reduced to the helpers restrict-readonly uses (333 -> 19 lines).
- run-verify: files referenced by any package.json script are flagged when changed (replaces npm alias and script-chain expansion).
- Lead skill: Branch step moved into Intake (was misnumbered inside the project gates); restrict-readonly allowlist referenced from the README instead of repeated.
- README: gate description and known limits updated; removed reference to a missing design file; `/reload-plugins` marked not verified.
- Tests for the removed bypass classes deleted (41 tests).

## 0.1.5
- Lead skill: project gates (survey existing solutions incl. GitHub/marketplaces before design, budget with 50/80% reports, protection target at M2, spec first, max 2 review rounds, Sonnet by default, one nested live run, new session per phase).
- reviewer: Sonnet by default; severity judged against the protection target; round 2 verifies fixes only.
- builder: simplicity-first rule and line budget; stop when a job looks unbounded.
- brief template: budget, existing solutions, protection target.

## 0.1.4
- Fail-closed hooks: nesting depth (20) and input length (20k chars) are capped; when the cap is hit or any exception occurs, gate-commands returns `ask` ("command too complex to check"), restrict-readonly `deny`, protect-checks a warning. `runHook` takes an optional fail-closed fallback. Fixes the `npm publish # $($(...` x2000 RangeError that exited 0 with no decision.
- run-verify: package-script expansion covers npm aliases (`t`, `tst`, `test`, `run`/`rum`/`urn`/`run-script`, `start`/`stop`/`restart`), `node --run`, `pnpm run|<script>`, `yarn run|<script>`, `bun run`, pre/post hooks, and scripts calling other scripts (depth cap 10, cycle-safe); every helper file in the chain is flagged when changed. `--out` refuses hardlinked targets (link count > 1). `.pnpmfile.mjs` and `.yarn/plugins/**` are flagged as package-manager config.
- gate-commands: npm abbreviations of publish (`pub`, `publ`, `publi`; prefix length >= 3), `corepack` as a wrapper, `node <path>/npm-cli.js|pnpm.cjs|yarn.js` treated as the package manager, and shells fed through stdin (`echo ... | bash`, `bash <<EOF`, `bash -s`, `bash <<< ...`, pwsh/powershell/cmd): content is extracted and matched; if it cannot be extracted (`curl ... | bash`, `cat f | sh`) the gate asks.
- Known unfixable classes: arbitrary scripts or programs that call publish internally (`node deploy.mjs`, make targets, CI wrappers), downloaded code, encoded commands, aliases and shell functions defined elsewhere.

## 0.1.3
- Round-3 review fixes: heredoc only when unquoted at top level (fake heredoc no longer hides commands); gate inspects $() and backtick substitutions incl. inside double quotes; deterministic npm/pnpm/yarn/bun option skipping plus ordered-token safety net; run-verify --out refuses symlink/junction escapes from work/; package-manager configs (.npmrc, .yarnrc, .yarnrc.yml, .pnpmfile.cjs, pnpm-workspace.yaml, bunfig.toml) always flagged; script resolution after options (npm --silent test, run-script, pnpm/yarn); git remote reads and in-repo git -C allowed for read-only agents; root PLAN.md ignored in dirty checks.
- init asks the owner for level (simple/medium/professional) on first creation.
- Lead must state owner answers (edit mode, no confirmation stops) in Codex handoffs.
- Known: 6 file-symlink tests skip on Windows without symlink privilege.

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
