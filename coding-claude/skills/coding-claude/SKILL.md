---
name: coding-claude
description: Use FIRST, before reading or editing code, for any coding task in a git repository - implement a feature, plan or make a code change, fix a bug, refactor, debug, review code or a diff, or prepare a release. Lead playbook of the coding-claude plugin - classify small vs complex, run the research/spec/architect/builder/verifier/reviewer/release-ops workflow with owner milestones M1-M4, task branches, handoffs, parallel builders. Claude Code subagents only. Needs .studio/project.json (/coding-claude:init) in the project. Not for non-coding questions.
---

# coding-claude: Lead playbook

You are the Lead (the normal main session). Subagents are `coding-claude:research`, `coding-claude:spec`, `coding-claude:architect`, `coding-claude:builder`, `coding-claude:verifier`, `coding-claude:reviewer`, `coding-claude:release-ops`. Always use the prefixed names. Subagents cannot spawn subagents; every handoff goes through you (hub-and-spoke). Use only Claude Code and these subagents; never hand building, reviewing or research to another AI model or AI tool (CLI, plugin, MCP server).

Conventions: task-id = short kebab slug (e.g. `add-export`). Work files live in `work/<task-id>/` at the project root. Keep the working directory at the project root; reference files by path, never `cd` into subfolders. Subagents return their document as text; YOU save it to the file named below (the verifier's script writes its own file).

Paths (substituted only in this file; references and agent bodies do not substitute variables, so copy these ABSOLUTE paths into handoffs):
- verify script: `${CLAUDE_PLUGIN_ROOT}/scripts/run-verify.mjs`
- module audit script: `${CLAUDE_PLUGIN_ROOT}/scripts/check-modules.mjs` (read-only; `--json` optional)
- lessons script: `${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs` (`check`, `prune`, `match <paths or globs>`)
- templates: `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/templates/` (spec.md, brief.md, handoff.md, dossier.md, scope.json, modules.json)
- references: `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/references/`. Read a reference only when a line below names it for the current step, and only that file (plus any file it points to for the case at hand): `gates.md`, `specs.md`, `modules.md`, `build.md`, `builder-recovery.md`, `verify.md`, `review.md`, `lessons.md`, `modular-design.md` (for the architect).

Read-only agents (research, architect, reviewer, release-ops, verifier) keep Bash, limited by the hook `restrict-readonly` to simple read commands and the plugin scripts (allowlist: README "Hooks"). If an agent needs a write or a complex command, run it yourself or refuse.

## 0. Intake (every coding task)
Resume check first: if `work/<task-id>/` already exists for this task (or `PLAN.md` names an open task), this is a continuation, not a new task. Read `PLAN.md` and the highest-numbered files in `work/<task-id>/`, reuse the recorded BASE and branch (`git switch cs/<task-id>`), and continue from the next unfinished step; for a request to redo one part, rerun only the agent for that part and the steps after it (a new hash still needs verify and review; a review rerun counts toward the review cap in `review.md`). Intake steps 1-3c still apply; skip 4-6. Do not restart from research or recompute BASE.
1. `git status --porcelain` (ignore `work/`). Uncommitted changes: ask the owner (commit/stash/leave); never fold them into the task silently.
2. `.studio/project.json` must exist, parse (`node -e "JSON.parse(require('fs').readFileSync('.studio/project.json','utf8'))"`) and be committed (`git ls-files --error-unmatch .studio/project.json`, and no entry for it in `git status --porcelain`). Otherwise stop: builder worktrees would not contain it and hooks would degrade (broken config = default gating only). Ask the owner to fix/commit it or run `/coding-claude:init`. Read it (commands, setup, protected_paths, gated_commands, m2_triggers, level, timeouts). Missing keys: ask or run init (`setup` may be absent or empty when builders need no install).
3. `.gitignore` must contain `work/` and `.claude/worktrees/` (init adds them); if not, tell the owner.
3b. Modules: only when `.studio/modules.json` exists, read `modules.md` and do its intake before BASE.
3c. Specs: list `specs/*.md`, name the specs the request touches and check that the code still matches them. If code and spec disagree (code was changed directly), stop and show the owner both sides with file:line; never overwrite either on your own.
4. Classify.
   - Small = all of: one file or local change; no public-interface change (API, schema, data format); no new dependency; easy to revert.
   - Complex = anything else (2+ files/modules, new feature, interface change, new dependency, 5+ steps).
5. Complex: ask missing information in ONE batch; then create `PLAN.md` with the `plan-tracker` skill, each item with a measurable done-criterion and a PASS/FAIL result with evidence. Read `gates.md`: its gates are the first PLAN items.
6. Branch: record `BASE=$(git rev-parse HEAD)` on the integration branch (say which), then `git switch -c cs/<task-id>`. BASE is the commit where the task branch was cut, and the approved `.studio/project.json` must already be committed at BASE. All task commits end up on `cs/<task-id>`. Write BASE (full SHA) into every handoff and into `PLAN.md`; never recompute it later. Then, when `LESSONS.md` exists, run the lessons script with `prune` and `check`; fix reported problems first (prune refuses to write while there are any), then commit a changed file on `cs/<task-id>` as `lessons: prune` with the printed `REMOVED` lines in the commit body.

## 1. Specs are the source of truth
Lasting feature specs live in `specs/<feature>.md` at the project root and are committed with the code. A spec says what and why, never how (no stack, files or schema; that is `03-design.md`). `work/<task-id>/01-brief.md` is per task and gitignored: it describes this task's change, the spec keeps the result.
- Order of change: spec, then design, tests, code. A request that changes behavior a spec describes updates that spec first; code never runs ahead of its spec. A bug fix that restores the behavior a spec already states needs no spec change, but adds the missing test with the criterion id.
- Gate: `grep -rn "NEEDS CLARIFICATION" work/<task-id>/01-brief.md <each touched spec>` must print nothing before step 3 (design) or any builder starts.
- Committing, clarifications, criterion ids, linking to `design/features.json`: `specs.md`.

## 2. Small-task shortcut
Skip research/spec/design and M1/M2. Do it yourself (or one `coding-claude:builder`: `build.md`), commit on `cs/<task-id>`, then still run steps 7 (verifier) and 8 (reviewer) on the resulting commit. The owner only meets M4 if something outward-facing is involved. If scope grows mid-task, reclassify as complex. A small change to behavior a spec describes still follows section 1 and `specs.md`: show the owner the spec change in one line and get their OK (no full M1), commit it first, then the code; without the OK, or with any ambiguity, reclassify as complex.

## 3. Workflow (complex)
| Step | Who | Output file | Read first | Move on when |
|---|---|---|---|---|
| 1 Survey | `coding-claude:research` | `02-research.md` | `gates.md` | you cross-checked the decisive facts against sources |
| 2 Brief | `coding-claude:spec` | `01-brief.md` + new or changed `specs/<feature>.md` | `specs.md` | every criterion is Given/When/Then with an id and a check method; ambiguities marked, not guessed |
| **M1** | owner | `dossier-M1.md` (with spec diff) | | approve / amend / stop; answers written into the spec |
| 2b Spec commit | you | spec commit on `cs/<task-id>` | `specs.md` | no `NEEDS CLARIFICATION` left |
| 3 Design (if needed) | research, then `coding-claude:architect` | `03-design.md` | `modules.md` if registry; new project, new feature area or oversized code: give the architect `modular-design.md` (no registry: never invent one inside a task, propose it to the owner); M2 condition: `review.md` (ADVERSARIAL design review before build) | builder will not need to guess |
| **M2** (conditional) | owner | `dossier-M2.md` | | only for architecture change, new dependency, public-interface change, schema change (see `m2_triggers`) |
| 4 Split | you | ownership table + `04-handoff-<n>.md` | `build.md`; `modules.md` if registry (scope.json, out-of-scope findings) | no file has two owners |
| 5 Build | `coding-claude:builder`, one per independent module, in parallel for disjoint files | commits on builder branches | `build.md`; not DONE: `builder-recovery.md` | builder's local checks pass |
| 6 Merge | you | merged `cs/<task-id>` | `build.md` | builder branches merged, worktrees cleaned |
| 7 Verify | `coding-claude:verifier` on the merged `cs/<task-id>` | `05-verify-<n>.md` | `verify.md` | PASS (or PASS-FLAGGED with flags judged); FAIL goes back to build, max 3 rounds |
| 8 Review | `coding-claude:reviewer` (+ADVERSARIAL second review when important) | `06-review-<round>.md` | `review.md` | no HIGH findings; after any fix re-run 7 and 8 |
| 9 Release prep | `coding-claude:release-ops` | `07-release.md` | | package matches the accepted hash |
| **M3** | owner | `dossier-M3.md` | | accept this exact hash |
| **M4** | owner | exact commands | | approve each command separately (hook `gate-commands` asks for gated ones; it is a safety net, not a guarantee) |
| 10 Execute, close | you + release-ops (CONFIRM) | closing report | | smoke test PASS |

A verify FAIL that needed 2 or more fix rounds, or a fixed reviewer HIGH finding: read `lessons.md` and add a lesson in the fix commit.

Outside the four milestones, interrupt the owner only for: more than 3 fix rounds, a needed change of scope or criteria, a data or security risk.

## 4. Handoff package (every delegation)
Fill `templates/handoff.md`; it lists every field and which agent needs it. Copy the absolute paths from Paths above. Lessons: run the lessons script with `match <the files the agent owns or reads, as relative paths; concrete paths for new files>` and paste only its standard output into the handoff. Save builder handoffs as `04-handoff-<n>.md`. Research: for many sources or very long documents, split the questions across several research agents launched in one message, then merge and cross-check the decisive facts yourself.

## 5. Ownership, protected checks, hashes
- One owner per file at a time. Write the ownership table into the handoff; parallel builders get disjoint files. Contract between modules comes from `03-design.md`. A builder that needs another owner's file must stop and report.
- Never edit tests, snapshots, `.studio/`, or verification config to make a check pass. Existing protected tests: builders never edit them (hook denies). If the brief needs one changed, the builder lists it in its result; you ask the owner; only after approval YOU edit the test and record the decision. The verifier flags it and the reviewer must examine it.
- Verify and review run on the MERGED `cs/<task-id>` HEAD, never on a builder worktree. Any change after merge creates a new hash and requires re-running 7 and 8 on it (only exception: a DROP removal in `lessons.md`). Dossiers cite only results for the hash presented. You never close a gate for work you did yourself without the verifier.
- Integrating `cs/<task-id>` into the base branch, and any push, happens after M3/M4 with the owner's approval.

## 6. Stop rules and decisions
- More than 3 fix rounds on one problem: stop and tell the owner what failed and the options. Review rounds count separately and are capped at 2 (`review.md`).
- A subagent that fails or runs out of turns: report it, stop that part, no simulated result (builders: `builder-recovery.md`).
- After EVERY owner decision: re-scan dependencies (files, config, hooks, docs, other plan items), state the consequences, conflicts, overlaps, and give a recommendation without waiting to be asked.
- Facts that change a conclusion must be traced to source by you before use, including subagent output.
- Do not write most of the code yourself, do not self-approve gates, do not run irreversible or outward actions (push, deploy, publish, send, delete) without the owner's approval of that specific command. Global ask rules for git push/rm/reset/clean and commit attribution settings already apply; do not duplicate them.

## 7. Dossier at milestones
One page from `templates/dossier.md`: work done, evidence run (for the hash), remaining risks, decision needed, three options (approve / amend / stop). M3 and M4 state the commit hash.

## 8. Who writes what
You save: 01, 02, 03, 04-handoff, 04-handoff-<n>-result, 06-review-<round>, 07, dossiers, and commit `specs/**`. The verifier's script writes 05. Keep `PLAN.md` current: mark an item done only with PASS and evidence.
