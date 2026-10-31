# Plugin development on this machine

Read this before starting a new plugin in `3_Plugins\Lyna`. Facts below were verified by running them (2026-10-30/31, Windows 11, Claude Code 2.1.314, Node 24); re-check only what you change. The evidence notes (spike-hooks.md, spike-agents.md, gemini-codex.md, smoke-agents.md, trial-19.md) were deleted on 2026-10-31.

## How to build a plugin here

Build it as a coding-claude project (it is a coding project): run `/coding-claude:init` in the plugin repo, then follow the Lead skill, including its project gates:
1. Survey existing plugins first (installed marketplaces under `~/.claude/plugins/marketplaces/`, community marketplaces, GitHub). Owner decides reuse vs build before any design.
2. Budget in `PLAN.md`; report at 50% / 80%.
3. Protection target before writing hooks; prefer agent `tools` lists and `permissions.ask/deny` over parsing commands.
4. Max 2 review rounds; then "Known limits".
5. Sonnet for builders and reviewers; at most one nested live run.

Lesson from coding-claude 0.1.0-0.1.4 (then named coding-studio): four fix rounds, most of them chasing bypasses in a shell-command parser (`restrict-readonly`, `gate-commands`). Parsing shell strings to enforce policy has no natural end; treat such hooks as a safety net only.

## Layout and install

- Marketplace: `3_Plugins/Lyna/.claude-plugin/marketplace.json` (name `owner-local`, already registered). Add one entry per plugin with `"source": "./<plugin>"`.
- Directory-source marketplace plugins load in place from the source folder: edit, then start a new session (no reinstall, no version bump needed). `/reload-plugins` in a live session: not verified.
- Install per project: `claude plugin install <name>@owner-local --scope local`.
- Dev loop without installing: `claude --plugin-dir "<plugin dir>" ...`; inspect with `claude --plugin-dir "<dir>" plugin details <name>` (takes the name, not a path).
- `claude plugin validate <dir>` must pass; it also prints directory-submission notices (LICENSE, icon) that do not matter for local use.
- `.gitattributes` with `* text=auto eol=lf` in the repo (Git for Windows defaults to CRLF; shell scripts break).

## Platform facts

Hooks
- Command form `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"` works with spaces in paths; `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` (`~/.claude/plugins/data/<name>-<marketplace|inline>`) are set in hooks.
- PreToolUse output: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"ask","permissionDecisionReason":"..."}}`; `additionalContext` alone only warns.
- A hook that crashes or times out does NOT block: fail closed explicitly (catch errors, return a decision).
- Subagent tool calls carry `agent_id` and `agent_type` (`<plugin>:<agent>`); main-session calls have neither.
- `ask` in `claude -p` becomes a denial with the reason; the interactive dialog is not verified yet.
- `permissions.ask` rules still apply under `defaultMode: auto`.

Agents and skills
- Plugin agents are `<plugin>:<name>`; a bare name resolves to a project agent of that name first.
- Frontmatter honored: name, description, model, effort, tools, maxTurns, isolation. `permissionMode`, `hooks`, `mcpServers` are ignored.
- Plugin `settings.json` key `agent` REPLACES the default Claude Code system prompt; do not use it for the main session.
- `isolation: worktree`: worktree at `<repo>/.claude/worktrees/agent-<id>`, branch `worktree-agent-<id>`; uncommitted changes never come back, so the agent must commit; leftover `worktree-agent-*` branches need cleanup; add `.claude/worktrees/` to `.gitignore`.
- `${CLAUDE_PLUGIN_ROOT}` is substituted in skill text; do not rely on it in agent bodies or Bash env. Pass absolute script paths in handoffs.

Dependencies
- `dependencies: ["<plugin>@<marketplace>"]` does not enable a plugin that is explicitly disabled at a higher scope: the plugin then fails with `dependency-unsatisfied`. Enable the dependency at the same scope (`claude plugin enable <plugin>@<marketplace> --scope local`).

Evals and tests
- `claude plugin eval` refuses shell tool grants on this machine (no Windows sandbox): use `--allow-tools Write,Edit`. Its sandbox cannot satisfy `dependencies`: run evals on a copy with `dependencies` removed. Cost ~0.7 USD per 4-case run.
- `node --test tests/` fails on Node 24 (directory argument): use `node --test tests/*.test.mjs`.
- File symlinks need admin or Developer Mode; directory junctions (`New-Item -ItemType Junction`) do not.
- Nested `claude -p` runs inherit the global settings and CLAUDE.md (backup prompts, plan hooks); pipe with `</dev/null` and read the stream-json `init` event for loaded plugins.
