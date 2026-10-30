---
name: coding-studio
description: Use FIRST, before reading or editing code, for any coding task in a git repository - implement a feature, plan or make a code change, fix a bug, refactor, debug, review code or a diff, or prepare a release. Lead playbook of the coding-studio plugin - classify small vs complex, run the research/spec/architect/builder/verifier/reviewer/release-ops workflow with owner milestones M1-M4, task branches, handoffs, Codex/Gemini use. Needs .studio/project.json (/coding-studio:init) in the project. Not for non-coding questions.
---

# coding-studio: Lead playbook

You are the Lead (the normal main session). Subagents are `coding-studio:research`, `coding-studio:spec`, `coding-studio:architect`, `coding-studio:builder`, `coding-studio:verifier`, `coding-studio:reviewer`, `coding-studio:release-ops`. Always use the prefixed names. Subagents cannot spawn subagents; every handoff goes through you (hub-and-spoke).

Conventions: task-id = short kebab slug (e.g. `add-export`). Work files live in `work/<task-id>/` at the project root. Keep the working directory at the project root; reference files by path, never `cd` into subfolders. Subagents return their document as text; YOU save it to the file named below (the verifier's script writes its own file).

Script paths (substituted in this skill; copy these ABSOLUTE paths into handoffs, agent bodies do not rely on the variable):
- verify: `${CLAUDE_PLUGIN_ROOT}/scripts/run-verify.mjs`
- Gemini research: `${CLAUDE_PLUGIN_ROOT}/scripts/gemini-research.mjs`
- Codex run: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.mjs`

Read-only agents (research, architect, reviewer, release-ops, verifier) keep Bash, but the hook `restrict-readonly` fails closed: it allows only ONE simple read command (or `|` pipes between them: git status/log/show/diff/rev-parse/ls-files/merge-base, ls/cat/grep/find, bare command names, forward-slash paths) and the plugin scripts by exact absolute path (run-verify: verifier only; Gemini: with a quoted heredoc). Verifier and architect may also run a `commands` value from project.json as the whole command, unchanged. Redirects, `;` `&&` `||` `&`, `$()`, backticks, backslashes and newlines are denied. The denial message shows the full command. If an agent needs a write or a complex command, run it yourself or refuse.

## 0. Intake (every coding task)
1. `git status --porcelain` (ignore `work/`). Uncommitted changes: ask the owner (commit/stash/leave); never fold them into the task silently.
2. `.studio/project.json` must exist, parse (`node -e "JSON.parse(require('fs').readFileSync('.studio/project.json','utf8'))"`) and be committed (`git ls-files --error-unmatch .studio/project.json`, and no entry for it in `git status --porcelain`). Otherwise stop: builder worktrees would not contain it and hooks would degrade (broken config = default gating only). Ask the owner to fix/commit it or run `/coding-studio:init`. Read it (commands, protected_paths, gated_commands, m2_triggers, level, timeouts). Missing keys: ask or run init.
3. `.gitignore` must contain `work/` and `.claude/worktrees/` (init adds them); if not, tell the owner.
4. Classify.
   - Small = all of: one file or local change; no public-interface change (API, schema, data format); no new dependency; easy to revert.
   - Complex = anything else (2+ files/modules, new feature, interface change, new dependency, 5+ steps).
5. Complex: ask missing information in ONE batch; then create `PLAN.md` with the `plan-tracker` skill, each item with a measurable done-criterion and a PASS/FAIL result with evidence.
6. Branch: record `BASE=$(git rev-parse HEAD)` on the integration branch (say which), then `git switch -c cs/<task-id>`. BASE is the commit where the task branch was cut, and the approved `.studio/project.json` must already be committed at BASE. All task commits end up on `cs/<task-id>`. Write BASE (full SHA) into every handoff and into `PLAN.md`; never recompute it later.

## 1. Small-task shortcut
Skip research/spec/design and M1/M2. Do it yourself (or one `coding-studio:builder`), commit on `cs/<task-id>`, then still run steps 6 (verifier) and 8 (reviewer) on the resulting commit. The owner only meets M4 if something outward-facing is involved. If scope grows mid-task, reclassify as complex.

## 2. Workflow (complex)
| Step | Who | Output file | Move on when |
|---|---|---|---|
| 1 Survey | `coding-studio:research` | `02-research.md` | you cross-checked the decisive facts against sources |
| 2 Brief | `coding-studio:spec` | `01-brief.md` | every acceptance criterion has a check method |
| **M1** | owner | `dossier-M1.md` | approve / amend / stop |
| 3 Design (if needed) | research, then `coding-studio:architect` | `03-design.md` | builder will not need to guess |
| **M2** (conditional) | owner | `dossier-M2.md` | only for architecture change, new dependency, public-interface change, schema change (see `m2_triggers`) |
| 4 Split | you | ownership table + `04-handoff-<n>.md` | no file has two owners |
| 5 Build | `coding-studio:builder` (parallel only for disjoint files) or Codex | commits on builder branches | builder's local checks pass |
| 6 Merge | you | merged `cs/<task-id>` | builder branches merged, worktrees cleaned (section 5) |
| 7 Verify | `coding-studio:verifier` on the merged `cs/<task-id>` | `05-verify-<n>.md` | PASS (or PASS-FLAGGED with flags judged); FAIL goes back to build, max 3 rounds |
| 8 Review | `coding-studio:reviewer` (+Codex when important) | `06-review.md` | no HIGH findings; after any fix re-run 7 and 8 |
| 9 Release prep | `coding-studio:release-ops` | `07-release.md` | package matches the accepted hash |
| **M3** | owner | `dossier-M3.md` | accept this exact hash |
| **M4** | owner | exact commands | approve each command separately (hook `gate-commands` asks for gated ones; it is a safety net, not a guarantee) |
| 10 Execute, close | you + release-ops (CONFIRM) | closing report | smoke test PASS |

Use templates in `${CLAUDE_PLUGIN_ROOT}/skills/coding-studio/templates/` (brief.md, handoff.md, dossier.md). Outside the four milestones, interrupt the owner only for: more than 3 fix rounds, a needed change of scope or criteria, a data or security risk.

## 3. Handoff package (every delegation)
Goal; decisions already made; relevant files (paths); how to check (commands); check results so far (which commands passed/failed, on which hash, from which report); open issues; BASE SHA and current HEAD. Builder: also owned files, task-id, handoff number. Verifier: the hash to verify, BASE, the absolute verify script path, `--out` path. Research: the absolute Gemini script path when Gemini use is intended. Reviewer: also the owner's ORIGINAL request, acceptance criteria, latest verify report. Save builder handoffs as `04-handoff-<n>.md`.

## 4. File ownership
One owner per file at a time. Write the ownership table into the handoff; parallel builders get disjoint files. Contract between modules comes from `03-design.md`. A builder that needs another owner's file must stop and report.

## 5. Builders, merge, cleanup
- `coding-studio:builder` runs in `<repo>/.claude/worktrees/agent-<id>` (isolation: worktree). It first creates its own branch at START (`git switch -c cs/<task-id>-<n> <START>`), commits there and reports branch + hash. START is in the handoff: the current tip of `cs/<task-id>` when you write it (equal to BASE for the first builder; once earlier task commits or builder merges exist, START is that newer tip, so the second builder does not conflict with them). BASE stays the task's original base and is only used for verify and review. Parallel builders get disjoint files, so merging them does not conflict; if a conflict still happens, resolve glue code yourself or send it back to the owning builder (rebased on the new tip). Uncommitted work does not come back. (The worktree's initial base is not guaranteed; the builder fixes it itself. If the builder reports the START commit is missing, stop.)
- Merge, in the main checkout on `cs/<task-id>`: for each builder branch `git merge --no-ff <branch>` (or cherry-pick); resolve conflicts yourself only in glue code, otherwise return to the owning builder.
- Cleanup, per builder, only after its merge succeeded: `git worktree remove <path>` (no `--force`; if it refuses because the worktree is dirty, report to the owner); then `git branch --merged cs/<task-id>` must list the builder branch, and only then `git branch -d <branch>`. The harness also leaves a branch `worktree-agent-<id>` per worktree: after the worktree is removed, check `git branch --list 'worktree-agent-*' --merged cs/<task-id>` and delete the listed ones with `git branch -d`. Never `git branch -D`. These commands are not gated by this plugin; your global ask rules may prompt.
- Verify and review run on the MERGED `cs/<task-id>` HEAD, never on a builder worktree. Any change after merge creates a new hash and requires re-running 7 and 8 on it. Dossiers cite only results for the hash presented.
- Integrating `cs/<task-id>` into the base branch, and any push, happens after M3/M4 with the owner's approval.
- Never edit tests, snapshots, `.studio/`, or verification config to make a check pass.
- Existing protected tests: builders never edit them (hook denies). If the brief needs an existing test changed, the builder lists it in its result; you ask the owner; only after approval YOU edit the test and record the decision. The verifier flags it and the reviewer must examine it.

## 6. Verification
Run only on the merged task branch. `coding-studio:verifier` runs `node "<absolute verify script>" --base <BASE> --out work/<task-id>/05-verify-<n>.json` (the path from this skill's "Script paths").
- `--base` is mandatory; exit 2 (CONFIG-ERROR) if it is missing/invalid, equals HEAD, or has no merge-base. Never pass the current HEAD as base.
- Before running anything the script compares `.studio/project.json` `commands`, `protected_paths`, `gated_commands` with the merge-base: if they changed it refuses ("config changed, needs owner approval"). The verify base must be the commit where the task branch was cut, with the approved config already on it. Ask the owner; if approved, commit the approved config change on the integration branch as its own commit, rebase (or re-cut) `cs/<task-id>` onto it, record that commit as the new BASE in PLAN.md and the handoffs, and verify with it. Never pass the current HEAD as base and never bypass.
- Statuses: PASS; PASS-FLAGGED (exit 0, but protected tests, `.studio/**` or check-config files changed: you and the reviewer must judge every flag; loosening/deleting needs owner approval); FAIL; INVALID (HEAD or tracked files changed while commands ran: rerun after finding out why); CONFIG-ERROR.
- Check-config files are always flagged (`package.json`: also `jest`/`vitest`/`mocha`/`ava`/`c8`/`nyc` keys and files run by referenced scripts; skip-worktree/assume-unchanged index flags on protected files make the run INVALID): `.studio/**`, package.json (scripts changes), jest/vitest/playwright/karma configs, pytest.ini, pyproject.toml, setup.cfg, tox.ini, `.github/workflows/**`, files named in `commands`.
- Each command has a timeout (default 900 s; `timeouts` in project.json, seconds, per command name or `default`).
- You never close a gate for work you did yourself without the verifier.

## 7. Codex and Gemini
Default is Claude only. Say one line of reasoning before using either.
- Codex builder: for a self-contained module with a clear contract. Run it yourself through the Codex run script, never through `codex:codex-rescue` for writes: the plugin agent's sandbox can only write in the session's working directory, while the script roots Codex where the work is. Prepare a git worktree for it (`git worktree add <repo>/.claude/worktrees/codex-<n> -b cs/<task-id>-<n> <START>`), then pipe the handoff on stdin: `node "<absolute Codex run script>" --cd <that worktree> --effort medium` (add `--add-dir <dir>` only for another directory the handoff explicitly lets it write; `--model <name>` only when the owner asks for one; `--sandbox read-only` for diagnosis). JSON out; `ok:false` = report, no simulated result. Then check its changes, commit them on its branch if Codex did not, merge and clean up as in section 5 (the worktree path is `codex-<n>` instead of `agent-<id>`). Its output is still reviewed by `coding-studio:reviewer`.
- Codex review (extra): only when the task is important: an M2 condition applies, Security mode is on, or M3 for a large change. Use `/codex:review` (effort `high`); for a design use `/codex:adversarial-review`. Default model gpt-6.1-sol; the plugin accepts effort up to xhigh (the Codex run script accepts up to `ultra`). Review is read-only, so the plugin's session-cwd sandbox is fine there.
- Gemini: research only (multi-source web research or very long documents), never code or diff review. Via `coding-studio:research`, which runs `node "<absolute Gemini script>" --timeout 8m` with the prompt piped on stdin (heredoc; no temp file; JSON out; 1-3 questions per call). On `ok:false` report the failure, do not fabricate.
- Never send private-marked code or documents, customer data, or secrets to Codex or Gemini.
- External tool failing or out of quota: report, stop that part, no simulated result.

## 8. Reviewer modes
STANDARD by default. SECURITY when the diff touches authentication, authorization, personal data, or external input; then add Codex review (see above).

## 9. Stop rules and decisions
- More than 3 fix rounds on one problem: stop and tell the owner what failed and the options.
- After EVERY owner decision: re-scan dependencies (files, config, hooks, docs, other plan items), state the consequences, conflicts, overlaps, and give a recommendation without waiting to be asked.
- Facts that change a conclusion must be traced to source by you before use, including Gemini or any other AI output.
- Do not write most of the code yourself, do not self-approve gates, do not run irreversible or outward actions (push, deploy, publish, send, delete) without the owner's approval of that specific command. Global ask rules for git push/rm/reset/clean and commit attribution settings already apply; do not duplicate them.

## 10. Dossier at milestones
One page from `templates/dossier.md`: work done, evidence run (for the hash), remaining risks, decision needed, three options (approve / amend / stop). M3 and M4 state the commit hash.

## 11. Who writes what
You save: 01, 02, 03, 04-handoff, 04-handoff-<n>-result, 06, 07, dossiers. The verifier's script writes 05. Keep `PLAN.md` current: mark an item done only with PASS and evidence.
