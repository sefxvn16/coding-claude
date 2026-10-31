# coding-studio

Claude Code plugin that turns the main session into a Lead orchestrating seven specialist subagents (`research`, `spec`, `architect`, `builder`, `verifier`, `reviewer`, `release-ops`) with owner approval at four milestones (M1 brief, M2 design, M3 acceptance, M4 outward actions).

Requirements: Claude Code 2.1.x, Node 20+, a git repo, plugin `codex@openai-codex` (declared dependency). Optional: `agy` (Antigravity CLI) for Gemini research.

## Install (local marketplace)

The plugin lives in the marketplace directory `3_Plugins` (marketplace name `owner-local`).

```
claude plugin marketplace add "D:\OneDrive\AI Relax\1_llm_configs\Claude\3_Plugins" --scope local
claude plugin install coding-studio@owner-local --scope local
claude plugin enable codex@openai-codex --scope local
```

The third command is needed when `codex@openai-codex` is disabled at a higher scope (e.g. globally): a plugin dependency does not auto-enable a plugin that is explicitly disabled there, and coding-studio then fails to load with `dependency-unsatisfied`. Equivalent: the project's `.claude/settings.local.json` `enabledPlugins` must contain both `"coding-studio@owner-local": true` and `"codex@openai-codex": true`; `/coding-studio:init` merges the codex key in idempotently.

`--scope local` writes to the project's `.claude/settings.local.json`, so the plugin is enabled only in that project. Run the commands from the project root. Directory marketplaces load plugins in place: after editing the plugin, start a new session (`/reload-plugins` in a live session: not verified); no reinstall or version bump.

Then in the project: `/coding-studio:init`.

## Per-project setup: `/coding-studio:init`

Creates `.studio/project.json` (commands detected from package.json, pyproject, Makefile, Cargo, go.mod), appends a block between `<!-- coding-studio:begin -->` and `<!-- coding-studio:end -->` to the project `CLAUDE.md`, adds `work/` and `.claude/worktrees/` to `.gitignore`, and merges `"codex@openai-codex": true` into `.claude/settings.local.json` `enabledPlugins` (other keys untouched). Rerunning only fills missing keys and skips an existing block. Review and commit the result yourself: `.studio/project.json` must be committed (builder worktrees and the verifier only see committed config).

### `.studio/project.json`

| Key | Meaning |
|---|---|
| `level` | `simple`, `medium`, or `professional`: how much testing/docs the project expects |
| `commands` | `lint`, `typecheck`, `test`, `build`, `integration`; run by the verifier in this order, empty = skipped |
| `protected_paths` | globs (tests, snapshots, ...) whose changes are flagged by the verifier and warned by the hook. `.studio/**` and check-config files (package.json scripts, jest/vitest/playwright/karma configs, pytest.ini, pyproject.toml, setup.cfg, tox.ini, `.github/workflows/**`, files named in `commands`, files referenced by any package.json script) are always protected |
| `gated_commands` | command globs (e.g. `vercel deploy*`, `npm publish*`) that always trigger an approval prompt; matched after normalizing wrappers (see Hooks) |
| `timeouts` | optional, seconds: `{"default": 900, "test": 1800}`; per-command limit for the verifier (default 900) |
| `m2_triggers` | conditions that require the M2 design approval |

## Usage

Work normally in the project; the `coding-studio` skill triggers on coding tasks (implement, fix, refactor, review, release) in a git project; the init CLAUDE.md block tells the main session to use it. Every task works on branch `cs/<task-id>` cut from a base SHA that Lead records; verification runs on the merged task branch with `--base <sha>`. Small tasks skip research/spec/design and M1/M2 but still get verification and review. Work files go to `work/<task-id>/`. Agents are addressed as `coding-studio:<name>`. Codex reviews use the codex plugin (`/codex:review`, `/codex:adversarial-review`); Codex as builder runs through `scripts/codex-run.mjs --cd <worktree>`, which calls `codex exec -C <dir>` so Codex can write exactly where the work is (the plugin rescue agent can only write in the session working directory); Gemini only for research via `scripts/gemini-research.mjs`.

## Hooks

All hooks exit immediately when `.studio/project.json` is absent. If it exists but cannot be parsed ("config broken"), the hooks fall back to built-in defaults instead of failing open: `gate-commands` applies the default gated list and asks, `protect-checks` warns on every edit under `.studio/` and test-like paths (builder is denied on existing ones), `restrict-readonly` uses the default allowlist.
- `gate-commands` (PreToolUse, Bash/PowerShell): returns `ask` for commands matching `gated_commands`, so Claude Code shows its native prompt. The command is split on `&& || ; | &`, newlines, parentheses, braces, backticks and `$(`; env assignments, wrappers (`env`, `command`, `call`, `start`, `exec`, `sudo`, `corepack`, `npx`/`bunx`/`pnpx`, `pnpm dlx`/`yarn dlx`, `bash -c`/`sh -c`/`cmd /c`/`pwsh -c` with their inner string), executable paths and `.cmd/.exe/.ps1/.bat` are dropped; options between pattern words are skipped (`npm --registry X publish`); any npm/pnpm/yarn/bun command containing `publish` asks. Protection target: honest mistakes, not a hostile agent. Not detected: scripts or programs that publish internally (`node deploy.mjs`, make targets, CI wrappers), npm abbreviations (`npm pub`), commands fed to a shell via stdin, PowerShell backtick escapes, aliases/functions, encoded or downloaded commands. A literal `$(...)` inside single quotes may ask unnecessarily. Headless runs treat `ask` as deny. On an internal error `gate-commands` asks, `restrict-readonly` denies and `protect-checks` warns.
- `restrict-readonly` (PreToolUse, Bash/PowerShell): for the agents `research`, `architect`, `reviewer`, `release-ops`, `verifier` only (main session and builder are unaffected). It does not interpret shell; it fails closed on complexity. Allowed: ONE simple command or `|` pipes between simple commands, each a bare allowlisted name (no path, `./`, extension): read-only git (status/log/show/diff/rev-parse/ls-files/merge-base, `branch --list`, `worktree list`; no `-c`, `--exec-path`, `-C` outside the repo, `--output`, `--ext-diff`, `--textconv`), ls/dir/cat/type/Get-Content, head/tail, grep/rg/Select-String, find without `-exec*`/`-delete`/`-ok*`/`-fprint*`, wc, `echo`; `node` only with the exact absolute path of `run-verify.mjs` (verifier only) or `gemini-research.mjs` (with a quoted heredoc); verifier and architect may also run a `commands` value from project.json, as the whole command, unchanged. Denied anywhere in the command: `$(` `${` backticks, backslashes (use forward slashes; exception: the exact plugin script path), `;` `&` `&&` `||`, any redirect `>` `>>` `<` `2>&1`, newlines, `( ) { }`, `<(` `>(`, `::`, `[IO.`, here-strings, `iex`/`Invoke-Expression`/`-EncodedCommand`. The deny message shows the full command.
- `protect-checks` (PreToolUse, Edit/Write/MultiEdit/NotebookEdit): warns when touching protected paths, check-config files and `.studio/**`. The builder is denied on existing protected files and check-config files (manifests such as package.json only warn), may add new test files, and is denied any write outside its own worktree (path resolved from the git toplevel of the file itself, so `..` and main-repo paths are caught). Shell writes by the builder bypass it: the verifier diff check is the backstop.

Log: `${CLAUDE_PLUGIN_DATA}/logs/hooks.jsonl` (typically `~/.claude/plugins/data/coding-studio-<marketplace>/logs/hooks.jsonl`).

## Verifier (`scripts/run-verify.mjs`)

`node run-verify.mjs --base <sha> [--out file.json] [--cwd dir]`. Statuses: PASS, PASS-FLAGGED (exit 0; protected or check-config changes need review), FAIL, INVALID (exit 1; HEAD or tracked files changed while commands ran), CONFIG-ERROR (exit 2: `--base` missing/invalid, base equals HEAD, no merge-base, unparseable project.json, or `commands`/`protected_paths`/`gated_commands` changed since the merge-base; nothing is executed). `work/` is ignored in dirty checks. Each command has a timeout (default 900 s, `timeouts` in project.json).

## Tests

`node --test tests/*.test.mjs` (explicit glob; `node --test tests/` fails on Node 24 because it treats `tests` as a module path). Projects using this plugin should likewise set `"test": "node --test"` or an explicit glob, not `node --test tests/`.

## Evals

`evals/` holds four cases (skill triggers, skill does not trigger, init flow, reviewer read-only). They call the model and cost tokens; run deliberately:
`claude plugin eval . --scaffold --allow-tools Write,Edit --max-cost-usd 3 --trust-plugin` (shell grants are refused on machines without a sandbox backend, so the cases use no Bash; results go to `evals/results/`, which is git-ignored). The eval sandbox has no `codex@openai-codex`, so with the declared dependency the plugin does not load there (`dependency-unsatisfied`) and every case fails; run the evals on a copy of the plugin with `dependencies` removed from plugin.json

## Uninstall

```
claude plugin uninstall coding-studio@owner-local --scope local
claude plugin marketplace remove owner-local   # only if no other plugin uses it
```
`.studio/`, the CLAUDE.md block, and `work/` stay in the project; delete them by hand if wanted.

## Known limits

- Plugin settings cannot ship permission rules; push/rm/reset/clean gating and commit attribution come from the user's global settings.
- Plugin agents ignore `permissionMode`, `hooks`, `mcpServers`. The `research`, `architect`, `reviewer`, `release-ops`, `verifier` agents keep `Bash`; their read-only behavior is enforced by the `restrict-readonly` hook allowlist (a safety net: it does nothing if node or the plugin is unavailable) plus instructions. `spec` has no Bash.
- Builder worktrees (`isolation: worktree`) lose uncommitted work; builders must commit and Lead merges. The base of a new worktree is not verified: the builder creates its own branch at the recorded BASE sha. `${CLAUDE_PLUGIN_ROOT}` is verified only in skill content, so agents receive absolute script paths in the handoff.
- A user or project agent named `reviewer` would win over a bare name; always use the `coding-studio:` prefix.
- Hooks cannot be relied on to block every shell write; deleting `.studio/` disables the hooks (the verifier diff still flags it and refuses changed commands).
- Interactive behavior of the `ask` prompt and `/reload-plugins` was verified from docs and headless runs only.
- Git repositories inside OneDrive can corrupt `.git` when synced from several machines.
- Cloud sessions do not load locally installed plugins.
