# coding-claude

Claude Code plugin that turns the main session into a Lead orchestrating seven specialist subagents (`research`, `spec`, `architect`, `builder`, `verifier`, `reviewer`, `release-ops`) with owner approval at four milestones (M1 brief, M2 design, M3 acceptance, M4 outward actions). It uses only Claude Code and its subagents: no other AI model, CLI or plugin is called. Builders run in parallel worktrees; important changes get a second, adversarial reviewer on Opus.

License: [MIT](LICENSE) · Requirements: Claude Code 2.1.x, Node 20+, a git repo. No plugin dependencies.

Renamed from `coding-studio` in 0.2.0 (Codex and Gemini support removed). Migrating a project: `claude plugin uninstall coding-studio@owner-local --scope local`, install `coding-claude` as below, rename the `<!-- coding-studio:begin/end -->` CLAUDE.md block to `coding-claude` and `coding-studio:` agent names inside it to `coding-claude:`. The `codex@openai-codex` key that the old init added to `.claude/settings.local.json` is no longer needed. `.studio/project.json` and `cs/` branches are unchanged.

## Install

### From GitHub

In Claude Code:

```bash
claude plugin marketplace add sefxvn16/coding-claude
claude plugin install coding-claude@lyna --scope local
```

### From Local Marketplace

The plugin lives in the marketplace directory `3_Plugins\Lyna` (marketplace name `lyna`).

```bash
claude plugin marketplace add "D:\OneDrive\AI Relax\1_llm_configs\Claude\3_Plugins\Lyna" --scope local
claude plugin install coding-claude@lyna --scope local
```

`--scope local` writes to the project's `.claude/settings.local.json`, so the plugin is enabled only in that project. Run the commands from the project root. Directory marketplaces load plugins in place: after editing the plugin, start a new session (`/reload-plugins` in a live session: not verified); no reinstall or version bump.

Then in the project: `/coding-claude:init`.

## Per-project setup: `/coding-claude:init`

Creates `.studio/project.json` (commands detected from package.json, pyproject, Makefile, Cargo, go.mod), appends a block between `<!-- coding-claude:begin -->` and `<!-- coding-claude:end -->` to the project `CLAUDE.md`, and adds `work/` and `.claude/worktrees/` to `.gitignore`. Rerunning only fills missing keys and skips an existing block. Review and commit the result yourself: `.studio/project.json` must be committed (builder worktrees and the verifier only see committed config).

### `.studio/project.json`

| Key | Meaning |
|---|---|
| `level` | `simple`, `medium`, or `professional`: how much testing/docs the project expects |
| `setup` | top-level, optional: command each builder runs first in its fresh worktree (e.g. `npm ci`); init detects it from the lockfile. Not run by the verifier and not allowed for read-only agents (it is not in `commands`) |
| `commands` | `lint`, `typecheck`, `test`, `build`, `integration`; run by the verifier in this order, empty = skipped |
| `protected_paths` | globs (tests, snapshots, ...) whose changes are flagged by the verifier and warned by the hook. `.studio/**` and check-config files (package.json scripts, jest/vitest/playwright/karma configs, pytest.ini, pyproject.toml, setup.cfg, tox.ini, `.github/workflows/**`, files named in `commands`, files referenced by any package.json script) are always protected |
| `gated_commands` | command globs (e.g. `vercel deploy*`, `npm publish*`) that always trigger an approval prompt; matched after normalizing wrappers (see Hooks) |
| `timeouts` | optional, seconds: `{"default": 900, "test": 1800}`; per-command limit for the verifier (default 900) |
| `m2_triggers` | conditions that require the M2 design approval |
| `rules` | `[{"id", "paths": [globs], "exclude": [globs], "forbid": "<regex>", "comment": "#", "message"}]`: tracked files matching `paths` must not contain `forbid` on any line (lines starting with `comment` skipped). Checked by the gate and the verifier (FAIL) |
| `fail_output` | `{"<command>": ["text"]}`: the command fails when its output contains a text even with exit 0 (e.g. Godot `--import` printing `SCRIPT ERROR`) |

### `.studio/modules.json` (optional: modules, locks, task scope)

Absent = no module checks, behavior as before. Template: `skills/coding-claude/templates/modules.json`; `/coding-claude:init` can draft one.

| Key | Meaning |
|---|---|
| `modules.<id>.paths` | globs owned by the module; a file belongs to at most one module (overlap = config error); a directory is `dir/**` (a bare `src/ai` is a config error) |
| `modules.<id>.public` | files other modules may import; empty = any file |
| `modules.<id>.depends_on` | modules this one may import |
| `modules.<id>.status` | `open` or `locked`; a locked module cannot be edited by any agent |
| `modules.<id>.optional` | `true` = can be switched off while the rest runs; needs `off_test`; a non-optional module may not list it in `depends_on` |
| `modules.<id>.off_test` | test file that runs the main flow with the module switched off (part of the project's test command); the audit warns when it is missing |
| `dependency_check` | `off`, `warn` (default: PASS-FLAGGED) or `block` (FAIL) for new cross-module imports that break `depends_on`/`public` |

Design guide for core + replaceable modules, switch-off, replacement and splitting oversized code: `skills/coding-claude/references/modular-design.md`. The plugin enforces the registry; the switch itself (registry of enabled features, fallback) is code in each project.

The file is owner config: the verifier refuses (CONFIG-ERROR) when it differs from the merge-base, so unlocking is a commit on the integration branch before the task's BASE. Per task, Lead writes `work/<task-id>/scope.json` (`{"modules": [...], "files": [globs]}`, template `templates/scope.json`).

Imports are found by path only: Godot `preload`/`load`/`extends "res://..."` and `path="res://..."` in `.gd/.tscn/.tres/.gdshader` (resolved from the nearest `project.godot`), relative `import`/`require`/`from` in JS/TS/Vue/Svelte (resolved to a real file: extension-less, `index.*`, TS-ESM `.js`). Not detected: GDScript `class_name` globals, TS path aliases, packages, Python; use the project's own boundary linter (e.g. eslint-plugin-boundaries, import-linter) in `commands.lint` for those.

`node "<plugin root>/scripts/check-modules.mjs" [--json]` (read-only agents must use the exact absolute path) audits the whole repo: files and lines per module, largest files, most-changed files over the last 200 commits (split candidates), optional modules whose off_test is missing, modules owning no file, tracked files in no module, the cross-module import map, violations. Exit 0 clean, 1 violations (unless `dependency_check` is `off`), an empty module or a missing off_test, 2 config error.

The verifier counts only dependency violations the task added (compared with the file at the merge-base), ignores untracked files created by the project commands, and is PASS-FLAGGED when `work/<task-id>/scope.json` exists for the branch but `--scope` was not given. The hook warns when the branch is `cs/*` and no scope file is found.

## Quality gate for every AI (`.studio/gate.mjs`)

The hooks and the verifier run only when Claude leads. Codex, Gemini, Muse, web chats and people bypass them. The gate puts the same checks in the repo: `/coding-claude:init` copies `templates/gate/gate.mjs` to `.studio/gate.mjs` (standalone: Node 18+ and git, no plugin import), `templates/gate/pre-push` to `.githooks/pre-push` (`git config core.hooksPath .githooks`, once per clone), adds a block to `AGENTS.md`, and on GitHub optionally `templates/gate/gate.yml` to `.github/workflows/gate.yml`.

`node .studio/gate.mjs [--rules-only] [--base <ref>]`: checks `rules`, runs `commands` in order with `fail_output`, and with `--base` warns about changed `protected_paths`, `.studio/**`, `.githooks/**`, `.github/workflows/**`. Per machine, `GATE_CMD_<NAME>` replaces one command (Linux CI, another OS). Exit 0 PASS, 1 FAIL, 2 config error; on GitHub Actions it prints error/warning annotations. The verifier imports `checkRules`/`outputFailures` from the template, so both apply the same rules. Bypass: `git push --no-verify` locally; CI still runs. The gate trusts the repo it runs in: an agent that edits `.studio/gate.mjs` or the workflow shows up as a watched-file warning, not a block.

## Specs: the source of truth

Each feature has a lasting spec in `specs/<feature>.md` (template `skills/coding-claude/templates/spec.md`), committed with the code: what and why, business rules, Given / When / Then acceptance criteria with stable ids (`<feature>/A<n>`), decisions with dates. The per-task brief in `work/<task-id>/` (gitignored) only describes the change. Rules: change order in SKILL.md section 1; intake drift check in SKILL.md intake step 3c; clarification markers, test ids, test-first in `skills/coding-claude/references/specs.md`; review drift in `agents/reviewer.md` step 3b.

## Lessons (`LESSONS.md`)

Rules learned from real failures (a verify FAIL that needed 2 or more fix rounds, or a fixed reviewer HIGH), one line each in `LESSONS.md` at the project root, committed with the fix. Lead writes them with evidence (task-id, report, hashes), the reviewer checks each new line (KEEP/DROP), `scripts/lessons.mjs` validates (`check`), drops stale ones (`prune`: files gone, older than 180 days, over 20) and prints only the lines that match a handoff's files (`match`). Lessons are advisory: they never skip or loosen a check and lose to the spec, project.json and CLAUDE.md. The builder may not edit the file (hook); the verifier flags every change to it (never out of scope) so the reviewer checks it. Rules: `skills/coding-claude/references/lessons.md`.

## Usage

Work normally in the project; the `coding-claude` skill triggers on coding tasks (implement, fix, refactor, review, release) in a git project; the init CLAUDE.md block tells the main session to use it. Every task works on branch `cs/<task-id>` cut from a base SHA that Lead records; verification runs on the merged task branch with `--base <sha>`. Small tasks skip research/spec/design and M1/M2 but still get verification and review. Work files go to `work/<task-id>/`. Agents are addressed as `coding-claude:<name>`. Independent modules (disjoint files) each get their own `builder`, launched together so they run in parallel worktrees (Sonnet; Opus for a module marked hard). Important changes (M2 condition, SECURITY mode, large M3) get a second `reviewer` run on Opus in ADVERSARIAL mode that does not see the first review. Long web research is split across parallel `research` agents (WebSearch/WebFetch).

The skill keeps its core rules in `skills/coding-claude/SKILL.md`; step-specific detail lives in small files under `skills/coding-claude/references/` (`gates`, `specs`, `modules`, `build`, `builder-recovery`, `verify`, `review`, `modular-design`) that Lead reads only at the step that names them. Each rule lives in one place: Lead-side rules in SKILL.md or a reference, agent-side rules in the agent file, per-delegation fields in `templates/handoff.md`.

## Hooks

All hooks exit immediately when `.studio/project.json` is absent. If it exists but cannot be parsed ("config broken"), the hooks fall back to built-in defaults instead of failing open: `gate-commands` applies the default gated list and asks, `protect-checks` warns on every edit under `.studio/` and test-like paths (builder is denied on existing ones), `restrict-readonly` uses the default allowlist.
- `gate-commands` (PreToolUse, Bash/PowerShell): returns `ask` for commands matching `gated_commands`, so Claude Code shows its native prompt. The command is split on `&& || ; | &`, newlines, parentheses, braces, backticks and `$(`; env assignments, wrappers (`env`, `command`, `call`, `start`, `exec`, `sudo`, `corepack`, `npx`/`bunx`/`pnpx`, `pnpm dlx`/`yarn dlx`, `bash -c`/`sh -c`/`cmd /c`/`pwsh -c` with their inner string), executable paths and `.cmd/.exe/.ps1/.bat` are dropped; options between pattern words are skipped (`npm --registry X publish`); any npm/pnpm/yarn/bun command containing `publish` asks. Protection target: honest mistakes, not a hostile agent. Not detected: scripts or programs that publish internally (`node deploy.mjs`, make targets, CI wrappers), npm abbreviations (`npm pub`), commands fed to a shell via stdin, PowerShell backtick escapes, aliases/functions, encoded or downloaded commands. A literal `$(...)` inside single quotes may ask unnecessarily. Headless runs treat `ask` as deny. On an internal error `gate-commands` asks, `restrict-readonly` denies and `protect-checks` warns.
- `restrict-readonly` (PreToolUse, Bash/PowerShell): for the agents `research`, `architect`, `reviewer`, `release-ops`, `verifier` only (main session and builder are unaffected). It does not interpret shell; it fails closed on complexity. Allowed: ONE simple command or `|` pipes between simple commands, each a bare allowlisted name (no path, `./`, extension): read-only git (status/log/show/diff/rev-parse/ls-files/merge-base, `branch --list`, `worktree list`; no `-c`, `--exec-path`, `-C` outside the repo, `--output`, `--ext-diff`, `--textconv`), ls/dir/cat/type/Get-Content, head/tail, grep/rg/Select-String, find without `-exec*`/`-delete`/`-ok*`/`-fprint*`, wc, `echo`; `node` only with the exact absolute path of `run-verify.mjs` (verifier only) or `check-modules.mjs` (optionally `--json`); verifier and architect may also run a `commands` value from project.json, as the whole command, unchanged. Denied anywhere in the command: `$(` `${` backticks, backslashes (use forward slashes; exception: the exact plugin script path), `;` `&` `&&` `||`, any redirect `>` `>>` `<` `2>&1`, newlines (so no heredocs), `( ) { }`, `<(` `>(`, `::`, `[IO.`, here-strings, `iex`/`Invoke-Expression`/`-EncodedCommand`. The deny message shows the full command.
- `protect-checks` (PreToolUse, Edit/Write/MultiEdit/NotebookEdit): warns when touching protected paths, check-config files and `.studio/**`. The builder is denied on existing protected files and check-config files (manifests such as package.json only warn), may add new test files, and is denied any write outside its own worktree (path resolved from the git toplevel of the file itself, so `..` and main-repo paths are caught). Shell writes by the builder bypass it: the verifier diff check is the backstop. With `.studio/modules.json`: an edit inside a `locked` module is denied for every agent including the main session; an edit outside the task scope (branch `cs/<task-id>` or `cs/<task-id>-<n>`, scope from `work/<task-id>/scope.json` of the main checkout) is denied for the builder and warned for others. `work/`, root `PLAN.md` and `.studio/` are not scope-checked. `LESSONS.md` is denied for the builder and not scope-checked for others.

Log: `${CLAUDE_PLUGIN_DATA}/logs/hooks.jsonl` (typically `~/.claude/plugins/data/coding-claude-<marketplace>/logs/hooks.jsonl`).

## Verifier (`scripts/run-verify.mjs`)

`node run-verify.mjs --base <sha> [--scope work/<task-id>/scope.json] [--out file.json] [--cwd dir]`. Also FAIL on a `rules` violation or a `fail_output` text. Statuses: PASS, PASS-FLAGGED (exit 0; protected or check-config changes, or `warn` dependency violations, need review), FAIL (also: a changed file outside `--scope` or inside a locked module; `block` dependency violations), INVALID (exit 1; HEAD or tracked files changed while commands ran), CONFIG-ERROR (exit 2: `--base` missing/invalid, base equals HEAD, no merge-base, unparseable project.json, or `commands`/`protected_paths`/`gated_commands`/`rules`/`fail_output` or `.studio/modules.json` changed since the merge-base, invalid modules.json or scope file, `--scope` without modules.json; nothing is executed). `work/` is ignored in dirty checks. Each command has a timeout (default 900 s, `timeouts` in project.json).

## Uninstall

```bash
claude plugin uninstall coding-claude@lyna --scope local
claude plugin marketplace remove lyna   # only if no other plugin uses it
```

`.studio/`, the CLAUDE.md block, and `work/` stay in the project; delete them by hand if wanted.

## Known limits

- Plugin settings cannot ship permission rules; push/rm/reset/clean gating and commit attribution come from the user's global settings.
- Plugin agents ignore `permissionMode`, `hooks`, `mcpServers`. The `research`, `architect`, `reviewer`, `release-ops`, `verifier` agents keep `Bash`; their read-only behavior is enforced by the `restrict-readonly` hook allowlist (a safety net: it does nothing if node or the plugin is unavailable) plus instructions. `spec` has no Bash.
- Builder worktrees (`isolation: worktree`) lose uncommitted work; builders must commit and Lead merges. A subagent worktree starts from the repository's default branch (on the remote; local HEAD when there is no remote) unless the setting `worktree.baseRef` is `"head"`, and is removed automatically when the subagent ends without changes, so the builder creates its own branch at the recorded START sha. A fresh worktree has no dependencies or gitignored files: builders run `setup`, and only files listed in `.worktreeinclude` are copied in. Resuming a BLOCKED builder with `SendMessage` is documented but not yet tried in a live run. `${CLAUDE_PLUGIN_ROOT}` is verified only in skill content, so agents receive absolute script paths in the handoff.
- A user or project agent named `reviewer` would win over a bare name; always use the `coding-claude:` prefix.
- A hook that runs past its timeout is cancelled and the tool call goes ahead, so the hook protects nothing in that moment. Hooks normally finish in about 50 ms; timeouts seen in practice came from whole-machine stalls (several hooks cancelled in the same second, up to about 36 s), so `hooks.json` sets 60 s.
- Hooks cannot be relied on to block every shell write; deleting `.studio/` disables the hooks (the verifier diff still flags it and refuses changed commands).
- Interactive behavior of the `ask` prompt and `/reload-plugins` was verified from docs and headless runs only.
- Git repositories inside OneDrive can corrupt `.git` when synced from several machines.
- Cloud sessions do not load locally installed plugins.
