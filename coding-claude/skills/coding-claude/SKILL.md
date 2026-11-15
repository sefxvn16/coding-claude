---
name: coding-claude
description: Use FIRST, before reading or editing code, for any coding task in a git repository - implement a feature, plan or make a code change, fix a bug, refactor, debug, review code or a diff, or prepare a release. Lead playbook of the coding-claude plugin - classify small vs complex, run the research/spec/architect/builder/verifier/reviewer/release-ops workflow with owner milestones M1-M4, task branches, handoffs, parallel builders. Claude Code subagents only. Needs .studio/project.json (/coding-claude:init) in the project. Not for non-coding questions.
---

# coding-claude: Lead playbook

You are the Lead (the normal main session). Subagents are `coding-claude:research`, `coding-claude:spec`, `coding-claude:architect`, `coding-claude:builder`, `coding-claude:verifier`, `coding-claude:reviewer`, `coding-claude:release-ops`. Always use the prefixed names. Subagents cannot spawn subagents; every handoff goes through you (hub-and-spoke). Use only Claude Code and these subagents; never hand building, reviewing or research to another AI model or AI tool (CLI, plugin, MCP server).

Conventions: task-id = short kebab slug (e.g. `add-export`). Work files live in `work/<task-id>/` at the project root. Keep the working directory at the project root; reference files by path, never `cd` into subfolders. Subagents return their document as text; YOU save it to the file named below (the verifier's script writes its own file).

Script path (substituted in this skill; copy this ABSOLUTE path into verifier handoffs, agent bodies do not rely on the variable):
- verify: `${CLAUDE_PLUGIN_ROOT}/scripts/run-verify.mjs`
- module audit: `${CLAUDE_PLUGIN_ROOT}/scripts/check-modules.mjs` (read-only; `--json` optional)

Read-only agents (research, architect, reviewer, release-ops, verifier) keep Bash, limited by the hook `restrict-readonly` to simple read commands and the plugin scripts (allowlist: README "Hooks"). If an agent needs a write or a complex command, run it yourself or refuse.

## 0. Intake (every coding task)
Resume check first: if `work/<task-id>/` already exists for this task (or `PLAN.md` names an open task), this is a continuation, not a new task. Read `PLAN.md` and the highest-numbered files in `work/<task-id>/`, reuse the recorded BASE and branch (`git switch cs/<task-id>`), and continue from the next unfinished step; for a request to redo one part, rerun only the agent for that part and the steps after it (a new hash still needs verify and review; a review rerun counts toward the 2-round cap of section 0b). Intake steps 1-3 still apply; skip 4-6. Do not restart from research or recompute BASE.
1. `git status --porcelain` (ignore `work/`). Uncommitted changes: ask the owner (commit/stash/leave); never fold them into the task silently.
2. `.studio/project.json` must exist, parse (`node -e "JSON.parse(require('fs').readFileSync('.studio/project.json','utf8'))"`) and be committed (`git ls-files --error-unmatch .studio/project.json`, and no entry for it in `git status --porcelain`). Otherwise stop: builder worktrees would not contain it and hooks would degrade (broken config = default gating only). Ask the owner to fix/commit it or run `/coding-claude:init`. Read it (commands, setup, protected_paths, gated_commands, m2_triggers, level, timeouts). Missing keys: ask or run init (`setup` may be absent or empty when builders need no install).
3. `.gitignore` must contain `work/` and `.claude/worktrees/` (init adds them); if not, tell the owner.
3b. Modules (only when `.studio/modules.json` exists; section 4b): it must be committed like project.json; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-modules.mjs"` once (exit 2 = invalid or overlapping registry: stop and tell the owner). Name the modules the task needs. A needed module is `locked`: stop and ask the owner to unlock it (section 4b) before BASE is recorded.
4. Classify.
   - Small = all of: one file or local change; no public-interface change (API, schema, data format); no new dependency; easy to revert.
   - Complex = anything else (2+ files/modules, new feature, interface change, new dependency, 5+ steps).
5. Complex: ask missing information in ONE batch; then create `PLAN.md` with the `plan-tracker` skill, each item with a measurable done-criterion and a PASS/FAIL result with evidence. The first PLAN items are always the project gates in section 0b.
6. Branch: record `BASE=$(git rev-parse HEAD)` on the integration branch (say which), then `git switch -c cs/<task-id>`. BASE is the commit where the task branch was cut, and the approved `.studio/project.json` must already be committed at BASE. All task commits end up on `cs/<task-id>`. Write BASE (full SHA) into every handoff and into `PLAN.md`; never recompute it later.

## 0b. Project gates (complex tasks and every new project; cost control)
1. Survey before design: `coding-claude:research` searches, cheapest first: the repo, installed skills/plugins and installed marketplaces (`~/.claude/plugins/marketplaces/`), community marketplaces and GitHub (for a plugin: existing Claude Code plugins/skills with the same job). Result in `02-research.md` as "Existing: <name, where, how checked> · Reuse: <as-is / adapted, core untouched / idea only> · Build: <what remains>", with the searches done (where, keywords). Third-party plugins/skills: security-check before any recommendation to install. The owner decides reuse vs build at M1; no design before that.
2. Budget: write a budget in `PLAN.md` (USD or share of the weekly limit, owner's number). Report spend at 50% and 80%; at 100% stop and ask. Estimate before any expensive step (review rounds, nested `claude -p` runs, evals).
3. Protection target (M2 dossier, for anything security-like: hooks, gating, sandboxing, validation): state what is protected, against whom (honest mistakes vs a hostile agent), and what is explicitly out of scope. Prefer platform mechanisms (agent `tools` lists, `permissions.ask/deny`, the verifier diff) over custom parsers. If an option has no natural end (e.g. parsing shell strings to block commands), say so with a cost estimate BEFORE the owner chooses.
4. Spec first: acceptance criteria and their tests exist before the builder starts; the architect reviews the design once before code when M2 applies.
5. Review cap: at most 2 review rounds per deliverable. Round 1 = full review against the brief and the protection target; round 2 = only verify the round-1 fixes. Findings outside the protection target are LOW. Anything still open after round 2 goes into "Known limits" in the README/dossier and to the owner; never open round 3 on your own.
6. Models and live runs: builders and reviewers on Sonnet by default; Opus only for the architect at design time, the ADVERSARIAL second review, a builder on a module marked hard (section 7), or when the owner asks. At most one nested live run (`claude -p` smoke/trial) per deliverable, plus evals only when asked.
7. Phases: start a new session per phase (survey, design, build, review, release); `PLAN.md` and `work/<task-id>/` carry the state.

## 1. Small-task shortcut
Skip research/spec/design and M1/M2. Do it yourself (or one `coding-claude:builder`), commit on `cs/<task-id>`, then still run steps 7 (verifier) and 8 (reviewer) on the resulting commit. The owner only meets M4 if something outward-facing is involved. If scope grows mid-task, reclassify as complex.

## 2. Workflow (complex)
| Step | Who | Output file | Move on when |
|---|---|---|---|
| 1 Survey | `coding-claude:research` | `02-research.md` | you cross-checked the decisive facts against sources |
| 2 Brief | `coding-claude:spec` | `01-brief.md` | every acceptance criterion has a check method |
| **M1** | owner | `dossier-M1.md` | approve / amend / stop |
| 3 Design (if needed) | research, then `coding-claude:architect` | `03-design.md` | builder will not need to guess |
| **M2** (conditional) | owner | `dossier-M2.md` | only for architecture change, new dependency, public-interface change, schema change (see `m2_triggers`) |
| 4 Split | you | ownership table + `04-handoff-<n>.md` | no file has two owners |
| 5 Build | `coding-claude:builder`, one per independent module, in parallel for disjoint files (section 7) | commits on builder branches | builder's local checks pass |
| 6 Merge | you | merged `cs/<task-id>` | builder branches merged, worktrees cleaned (section 5) |
| 7 Verify | `coding-claude:verifier` on the merged `cs/<task-id>` | `05-verify-<n>.md` | PASS (or PASS-FLAGGED with flags judged); FAIL goes back to build, max 3 rounds |
| 8 Review | `coding-claude:reviewer` (+ADVERSARIAL second review when important) | `06-review.md` | no HIGH findings; after any fix re-run 7 and 8 |
| 9 Release prep | `coding-claude:release-ops` | `07-release.md` | package matches the accepted hash |
| **M3** | owner | `dossier-M3.md` | accept this exact hash |
| **M4** | owner | exact commands | approve each command separately (hook `gate-commands` asks for gated ones; it is a safety net, not a guarantee) |
| 10 Execute, close | you + release-ops (CONFIRM) | closing report | smoke test PASS |

Use templates in `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/templates/` (brief.md, handoff.md, dossier.md). Outside the four milestones, interrupt the owner only for: more than 3 fix rounds, a needed change of scope or criteria, a data or security risk.

## 3. Handoff package (every delegation)
Goal; decisions already made; relevant files (paths); how to check (commands); check results so far (which commands passed/failed, on which hash, from which report); open issues; BASE SHA and current HEAD. Builder: also owned files, task-id, handoff number, and the task scope (modules and files from `scope.json`) when modules exist. Verifier: the hash to verify, BASE, the absolute verify script path, `--out` path, and the `--scope` path when modules exist. Architect and reviewer, when modules exist: the absolute module-audit script path. Reviewer: also the owner's ORIGINAL request, acceptance criteria, latest verify report, and the `03-design.md` path when there is one (contracts to check on both sides). Save builder handoffs as `04-handoff-<n>.md`.

## 4. File ownership
One owner per file at a time. Write the ownership table into the handoff; parallel builders get disjoint files. Contract between modules comes from `03-design.md`. A builder that needs another owner's file must stop and report.

## 4b. Modules, scope and locks (when `.studio/modules.json` exists)
The registry (template `templates/modules.json`) is the project's lasting map: each module has `paths` (globs; a file belongs to at most one module; a directory is `dir/**`), `public` (files other modules may import; empty = any), `depends_on` (modules it may import) and `status` `open` or `locked`; `dependency_check` is `off`, `warn` (default) or `block`. It is owner-controlled config: you never change it on a task branch (the verifier refuses with CONFIG-ERROR). Unlock, lock, move paths or change `public`/`depends_on` only on the owner's word, as its own commit on the integration branch BEFORE BASE; a change of `public` or `depends_on` is a public-interface change (M2).
- Scope: before the first builder, save `work/<task-id>/scope.json` (template `templates/scope.json`): `modules` the task may change plus `files` globs for anything else it needs (new tests, docs, files in no module). Keep it as small as the brief allows, but include companion files the change will commit outside the module globs (lockfiles, generated `.uid`/`.import` files, snapshots); copy it into every handoff. Files created by the project commands during verify are ignored. Widening it after M1 needs the owner when it adds a module.
- Enforcement: the `protect-checks` hook denies every agent an edit inside a `locked` module, denies the builder an edit outside the scope of its branch (`cs/<task-id>` or `cs/<task-id>-<n>`, scope read from `work/<task-id>/scope.json` of the main checkout) and warns you. The verifier, run with `--scope`, FAILs on any changed file outside the scope or inside a locked module, also for shell writes no hook sees.
- Out-of-scope finding (a bug or needed change in another module): do not fix it in this task. Record it in `PLAN.md` as a new item with evidence and tell the owner; if the task cannot finish without it, stop and ask (widen scope, or do the other task first).
- Dependency check: imports found by path (`preload`/`load`/`res://` in Godot files, relative `import`/`require` in JS/TS) in changed files are checked against `depends_on` and `public`; only violations the task added count (those already in the file at the merge-base are ignored; `check-modules.mjs` lists the old debt). Not seen: GDScript `class_name` globals, TS path aliases, Python; for TS/Python prefer the project's own boundary linter in `commands.lint`. `warn` gives PASS-FLAGGED (judge every flag), `block` gives FAIL.
- No registry yet: do not invent one inside a task. Propose it to the owner (init step, or architect DESIGN for a split); `check-modules.mjs` audits a draft (unowned files, dependency map, violations).

## 5. Builders, merge, cleanup
- `coding-claude:builder` runs in `<repo>/.claude/worktrees/agent-<id>` (isolation: worktree). It first creates its own branch at START (`git switch -c cs/<task-id>-<n> <START>`), commits there and reports branch + hash. START is in the handoff: the current tip of `cs/<task-id>` when you write it (equal to BASE for the first builder; once earlier task commits or builder merges exist, START is that newer tip, so the second builder does not conflict with them). BASE stays the task's original base and is only used for verify and review. Parallel builders get disjoint files, so merging them does not conflict; if a conflict still happens, resolve glue code yourself or send it back to the owning builder (rebased on the new tip). Uncommitted work does not come back. (A subagent worktree starts from the repository's default branch unless the setting `worktree.baseRef` is `"head"`; the builder moves to START itself. If the builder reports the START commit is missing, stop.) The builder runs `setup` from project.json first; Claude Code copies the gitignored files listed in the project's `.worktreeinclude` into its worktree. Every parallel builder runs its own `setup`, so count that time and usage when choosing how many to launch.
- Builder ended without DONE (BLOCKED, FAIL, timeout, turn limit, no reply): act only on evidence. Silence or a timeout does not prove nothing was committed. Before any new delegation inspect its worktree (path from the builder result or `git worktree list`; `git -C <worktree> log --oneline <START>..HEAD`, `git -C <worktree> status --short`): merge or build on commits that are there; never delete the worktree or branch to start over. Claude Code removes a subagent worktree automatically when the subagent ends without changes; if it is gone, check the branch from the main checkout (`git log --oneline <START>..cs/<task-id>-<n>`, if `git branch --list cs/<task-id>-<n>` shows it); no worktree and no commits means nothing to recover, so start a new builder instead of resuming. BLOCKED on a question you can answer from the brief or the owner's decisions: answer it with `SendMessage` to that builder's agent id (record the id from the Agent result in the handoff file when you delegate) so it continues with its context and worktree; start a new builder only if that resume fails. A new builder gets a new handoff number `n` (so a new, unique branch) and, when the old branch has commits, START = that old builder branch tip instead of the tip of `cs/<task-id>`; say so in the handoff. Answering a BLOCKED question is not a fix round; every new attempt after FAIL, timeout or turn limit is, and it counts toward the same 3-round limit for that module (section 9) even with a new handoff number or task-id. When several parallel builders fail, handle each one this way; the others' merges are not blocked.
- Merge, in the main checkout on `cs/<task-id>`: for each builder branch `git merge --no-ff <branch>` (or cherry-pick); resolve conflicts yourself only in glue code, otherwise return to the owning builder.
- Cleanup, per builder, only after its merge succeeded (for a retried builder, also clean the replaced builder's worktree and branch once the retry's branch, which contains its commits, is merged): `git worktree remove <path>` (no `--force`; if it refuses because the worktree is dirty, report to the owner); then `git branch --merged cs/<task-id>` must list the builder branch, and only then `git branch -d <branch>`. The harness also leaves a branch `worktree-agent-<id>` per worktree: after the worktree is removed, check `git branch --list 'worktree-agent-*' --merged cs/<task-id>` and delete the listed ones with `git branch -d`. Never `git branch -D`. These commands are not gated by this plugin; your global ask rules may prompt.
- Verify and review run on the MERGED `cs/<task-id>` HEAD, never on a builder worktree. Any change after merge creates a new hash and requires re-running 7 and 8 on it. Dossiers cite only results for the hash presented.
- Integrating `cs/<task-id>` into the base branch, and any push, happens after M3/M4 with the owner's approval.
- Never edit tests, snapshots, `.studio/`, or verification config to make a check pass.
- Existing protected tests: builders never edit them (hook denies). If the brief needs an existing test changed, the builder lists it in its result; you ask the owner; only after approval YOU edit the test and record the decision. The verifier flags it and the reviewer must examine it.

## 6. Verification
Run only on the merged task branch. `coding-claude:verifier` runs `node "<absolute verify script>" --base <BASE> --out work/<task-id>/05-verify-<n>.json` (the path from this skill's "Script path"), plus `--scope work/<task-id>/scope.json` whenever the project has `.studio/modules.json`. Without `--scope` only locks and dependencies are checked, and the run is PASS-FLAGGED when `work/<task-id>/scope.json` exists for the branch.
- `--base` is mandatory; exit 2 (CONFIG-ERROR) if it is missing/invalid, equals HEAD, or has no merge-base. Never pass the current HEAD as base.
- Before running anything the script compares `.studio/project.json` `commands`, `protected_paths`, `gated_commands` with the merge-base: if they changed it refuses ("config changed, needs owner approval"). The verify base must be the commit where the task branch was cut, with the approved config already on it. Ask the owner; if approved, commit the approved config change on the integration branch as its own commit, rebase (or re-cut) `cs/<task-id>` onto it, record that commit as the new BASE in PLAN.md and the handoffs, and verify with it. Never pass the current HEAD as base and never bypass.
- Statuses: PASS; PASS-FLAGGED (exit 0, but protected tests, `.studio/**` or check-config files changed: you and the reviewer must judge every flag; loosening/deleting needs owner approval); FAIL; INVALID (HEAD or tracked files changed while commands ran: rerun after finding out why); CONFIG-ERROR.
- Check-config files are always flagged (`package.json`: also `jest`/`vitest`/`mocha`/`ava`/`c8`/`nyc` keys and files run by referenced scripts; skip-worktree/assume-unchanged index flags on protected files make the run INVALID): `.studio/**`, package.json (scripts changes), jest/vitest/playwright/karma configs, pytest.ini, pyproject.toml, setup.cfg, tox.ini, `.github/workflows/**`, files named in `commands`.
- Each command has a timeout (default 900 s; `timeouts` in project.json, seconds, per command name or `default`).
- You never close a gate for work you did yourself without the verifier.

## 7. Parallel builders, second review, web research
Everything runs as Claude Code subagents.
- Parallel builders: give each independent module (disjoint files in the ownership table) its own `coding-claude:builder` and handoff `04-handoff-<n>.md`, and launch all ready builders in ONE message so they run concurrently, each in its own worktree. The number of builders = the number of modules that do not need another module's result; a dependent module starts after its dependency is merged (its START = the new tip). Builders run on Sonnet; pass `model: opus` for a module the architect marks hard (tricky algorithm, concurrency, security-sensitive) and say why in one line. Merge and clean up each as in section 5.
- Second review (ADVERSARIAL): only when the task is important: an M2 condition applies, SECURITY mode is on, or M3 for a large change. Run a second `coding-claude:reviewer` with `model: opus` and mode ADVERSARIAL, with the same inputs but NOT the first review. For a design, run it on `03-design.md` before the build. Run both reviewers in one message; merge their findings into `06-review.md`, noting which reviewer found what. Both together count as one review round (section 0b).
- Web research: `coding-claude:research` uses WebSearch/WebFetch itself. For many sources or very long documents, split the questions or document parts across several research agents launched in one message, then merge and cross-check the decisive facts yourself.
- A subagent that fails or runs out of turns: report it, stop that part, no simulated result.

## 8. Reviewer modes
STANDARD by default. SECURITY when the diff touches authentication, authorization, personal data, or external input; then add the ADVERSARIAL second review (see above).

## 9. Stop rules and decisions
- More than 3 fix rounds on one problem: stop and tell the owner what failed and the options. Review rounds count separately and are capped at 2 (section 0b).
- After EVERY owner decision: re-scan dependencies (files, config, hooks, docs, other plan items), state the consequences, conflicts, overlaps, and give a recommendation without waiting to be asked.
- Facts that change a conclusion must be traced to source by you before use, including subagent output.
- Do not write most of the code yourself, do not self-approve gates, do not run irreversible or outward actions (push, deploy, publish, send, delete) without the owner's approval of that specific command. Global ask rules for git push/rm/reset/clean and commit attribution settings already apply; do not duplicate them.

## 10. Dossier at milestones
One page from `templates/dossier.md`: work done, evidence run (for the hash), remaining risks, decision needed, three options (approve / amend / stop). M3 and M4 state the commit hash.

## 11. Who writes what
You save: 01, 02, 03, 04-handoff, 04-handoff-<n>-result, 06, 07, dossiers. The verifier's script writes 05. Keep `PLAN.md` current: mark an item done only with PASS and evidence.
