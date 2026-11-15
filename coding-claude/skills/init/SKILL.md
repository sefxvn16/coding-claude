---
name: init
description: Set up coding-claude in the current git project (/coding-claude:init). Creates .studio/project.json from detected project commands, appends a marked coding-claude block to the project CLAUDE.md, and adds work/ and .claude/worktrees/ to .gitignore. Safe to rerun; never overwrites owner edits.
disable-model-invocation: true
---

# /coding-claude:init

Run from the project root. Idempotent: every step only adds what is missing.

## 1. Preconditions
- `git rev-parse --show-toplevel` must succeed and equal the current directory. If not a git repo, stop and say plugin needs git (worktrees, diffs, hashes); do not run `git init` without the owner's yes.
- Record `git status --porcelain` before starting, so the final diff summary shows only what init changed.

## 2. `.studio/project.json`
Template: `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/templates/project.json`.
1. Detect commands (only from files that exist; first match per key; never invent):
   - `package.json` scripts: `lint`, `typecheck` (or `tsc`/`check-types`), `test`, `build`, `test:integration`/`integration`/`e2e`; command = `npm run <name>` (use `pnpm`/`yarn`/`bun` if the matching lockfile exists; `npm test` for `test`).
   - `pyproject.toml`/`setup.cfg`/`tox.ini`: `ruff check .` or `flake8` if configured, `mypy .` if configured, `pytest` if configured or a `tests/` dir exists.
   - `Makefile` targets named lint/typecheck/test/build: `make <target>`.
   - `Cargo.toml`: `cargo clippy`, `cargo check`, `cargo test`, `cargo build`. `go.mod`: `go vet ./...`, `go test ./...`, `go build ./...`.
   Leave a key as `""` when nothing is detected. Detect `setup` now too (step 5).
2. If `.studio/project.json` does not exist: write the template with detected commands and `setup` filled in.
   If it exists: parse it, add only keys that are missing (including missing `commands` subkeys; a missing `setup` gets the detected value), never change or remove an existing value, and keep formatting. Invalid JSON: stop and report; do not rewrite.
3. `level` (first creation only): propose `simple` (script, prototype, one-off or single user), `medium` (reused, a few files) or `professional` (many users, real data, long maintenance) from what the repo shows, and ask the owner once; write their answer. Never change an existing `level`.
4. Set `protected_paths` additions only if the project has other obvious test or snapshot dirs (e.g. `test/**`, `__tests__/**`, `spec/**`) and only on first creation.
5. `setup` (top-level key, not inside `commands`): the command that prepares a fresh checkout, because every builder worktree starts without dependencies. Detect from the lockfile only: `package-lock.json` -> `npm ci`, `pnpm-lock.yaml` -> `pnpm install --frozen-lockfile`, `yarn.lock` -> `yarn install --immutable` when `.yarnrc.yml` exists (Yarn 2+), otherwise `yarn install --frozen-lockfile`, `bun.lockb`/`bun.lock` -> `bun install --frozen-lockfile`, `uv.lock` -> `uv sync --frozen`, `poetry.lock` -> `poetry install`. Nothing detected: `""`. Written in step 2; an existing `setup` value is never changed.
6. `.worktreeinclude`: if gitignored local files a check needs exist at the root (e.g. `.env`, `.env.local`), list them for the owner and suggest a `.worktreeinclude` file with those names (Claude Code copies matching gitignored files into the worktrees it creates for subagents). Do not create it yourself; it may carry secrets into every worktree.

## 2b. `.studio/modules.json` (optional; first creation only, never overwrite)
Ask the owner once whether to set up modules (lockable areas, per-task scope). Skip if they decline or the file exists. Otherwise draft a registry from the source tree (template `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/templates/modules.json`): one module per top-level source area that already exists (e.g. `src/core`, `src/ui`, `game/src/ai`), written as `dir/**`, every module `open`, `dependency_check` `warn`, `public` empty unless an obvious entry file exists (`index.ts`, a single API script), `depends_on` filled from what the code imports today, no module `optional` (mark one optional only after it really runs switched off; see `${CLAUDE_PLUGIN_ROOT}/skills/coding-claude/references/modular-design.md`). Write it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-modules.mjs"`, and show the owner the audit (files per module, empty modules, files in no module, dependency map, violations). Adjust only on their answers; existing violations are facts to report, not to fix here.

## 3. Project `CLAUDE.md` block
Create `CLAUDE.md` if absent. If it already contains `<!-- coding-claude:begin -->`, skip (the owner may have edited it). If it contains the old `<!-- coding-studio:begin -->` block, do not append; tell the owner to replace that block with the one below. Otherwise append at the end:

```
<!-- coding-claude:begin -->
## coding-claude
- Config: `.studio/project.json` (commands, protected_paths, gated_commands, m2_triggers) and, if present, `.studio/modules.json` (modules, locks). Do not edit them or the checks to make a verification pass; only the owner locks or unlocks a module.
- For ANY coding task here (implement, fix, refactor, debug, review, release) invoke the `coding-claude` skill first and follow it as Lead: classify small vs complex, work on branch `cs/<task-id>`, subagents as `coding-claude:<name>`, work files in `work/<task-id>/`.
- Check `git status` before starting; builders work in `.claude/worktrees/` and must commit.
- Push, deploy, publish, and sending anything outward need the owner's approval per command.
<!-- coding-claude:end -->
```

## 4. `.gitignore`
Ensure the lines `work/` and `.claude/worktrees/` exist (create the file if needed; append only the ones with no equivalent line present). `work/` holds task artifacts and must not dirty the tree.

## 5. Report
Your final message MUST contain these items (a one-line summary is not enough): the output of `git status --short`; `git diff --stat`; the full content of each untracked file init created (limited to `.studio/`, `CLAUDE.md`, `.gitignore`); the module audit when step 2b ran; and three lists: created / filled missing keys / skipped (already present). Tell the owner to review and commit these files (`.studio/project.json` and `.studio/modules.json` MUST be committed: builder worktrees and the verifier only see committed config); do not commit for them. Remind: enable the plugin per project (`--scope local`) if it is not enabled yet, and fill any empty `commands` they want verified and `setup` if builders need dependencies installed.
