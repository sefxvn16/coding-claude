# Changelog

## 0.2.0
- Renamed `coding-studio` -> `coding-claude` (folder, plugin name, agents `coding-claude:*`, `/coding-claude:init`, CLAUDE.md block markers). `.studio/project.json` and `cs/` branches unchanged. Migration steps in the README.
- Claude Code subagents only: removed the `codex@openai-codex` dependency, `scripts/codex-run.mjs`, `scripts/gemini-research.mjs` and their tests, and the init step that enabled the codex plugin.
- Lead skill section 7: parallel `builder` subagents replace Codex builders (one per independent module, launched in one message; Opus for modules marked hard); an ADVERSARIAL second `reviewer` on Opus replaces Codex review; long web research is split across parallel `research` agents (WebSearch/WebFetch) instead of Gemini.
- reviewer: ADVERSARIAL mode (independent, does not see the first review; also for design review).
- restrict-readonly: the Gemini heredoc exception is gone; every multiline command, heredocs included, is denied. `findHeredoc` removed from `scripts/lib/shell.mjs`. Three tests changed from "Gemini heredoc allowed" to "heredoc denied".
- init: an existing old `coding-studio` CLAUDE.md block is reported instead of adding a second block.
- Marketplace path fixed to `3_Plugins\Lyna`.

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

## Archived plan (0.1.6)

### PLAN: coding-studio 0.1.6 – tối ưu theo karpathy-guidelines (phương án B)

Cập nhật: 2026-10-31 · Phiên: 1
Mục tiêu: sửa lỗi tài liệu, bỏ trùng lặp, thu gọn bộ parse shell của gate-commands và phần dò chuỗi script npm của run-verify; mục tiêu bảo vệ = sai sót vô ý, không chống agent cố tình lách.
Phạm vi: được sửa trong `coding-studio/` và `PLUGIN-DEV.md`. Không làm: restrict-readonly (giữ nguyên logic), tách lại test theo chức năng, push/commit.

#### Các mục

- [x] 1. Prototype trong scratchpad, liệt kê test bị ảnh hưởng
  - Tiêu chí xong: bản sao ở scratchpad chạy `node --test tests/*.test.mjs`; danh sách test FAIL được phân loại (chỉ nhắm dạng lách → xóa / hồi quy thật → sửa code)
  - Kết quả: PASS: prototype 186 pass / 32 fail / 6 skip; cả 32 fail đều thuộc dạng lách (viết tắt npm pub, node npm-cli.js, shell đọc stdin, backtick PowerShell, $() lồng, lệnh quá dài). Hồi quy thật phát hiện qua probe (đường dẫn "C:\Program Files\...\npm.cmd", `bun --silent publish`) đã sửa code. Đã gỡ 2 test + 2 dòng assert chỉ kiểm hàm nội bộ đã xóa (lex, stripHeredocs, skipPackageOptions).
  - Kiểm bởi: tôi

- [x] 2. Chốt chế độ sửa (a/b) và danh sách test xóa
  - Tiêu chí xong: người dùng trả lời
  - Kết quả: PASS: người dùng chọn (a) sửa trực tiếp, không ghi bình luận trong code; xóa test theo danh sách đã trình
  - Kiểm bởi: người dùng

- [x] 3. Sửa SKILL.md (bước Branch về Intake, bỏ đoạn allowlist trùng), README (3 chỗ lệch), agent/README chỗ trùng
  - Tiêu chí xong: grep không còn "6. Branch" trong 0b; README không còn `org-proposal-v4.md`; lệnh reload ghi đúng như PLUGIN-DEV
  - Kết quả: PASS: SKILL.md bước "6. Branch" nằm cuối mục 0 (dòng 27), 0b còn 1–7; đoạn allowlist thay bằng 1 dòng trỏ README; README bỏ org-proposal-v4.md, sửa "third command", /reload-plugins ghi chưa kiểm chứng, mô tả gate viết lại
  - Kiểm bởi: tôi

- [x] 4. Thu gọn gate-commands + shell.mjs
  - Tiêu chí xong: gate vẫn hỏi với các dạng thường gặp (`npm publish`, `npx vercel deploy --prod`, `bash -c "npm publish"`, `a && npm --registry x publish`, `FOO=1 npm publish`, config broken); số dòng giảm, báo trước/sau
  - Kết quả: PASS: shell.mjs 333 -> 19 dòng, gate-commands 57 -> 55 dòng, không bình luận; test "reviewer bypass list" (22 dạng gồm npx vercel deploy --prod, bash -c, cmd /c, C:\Program Files\...
pm.cmd, CI=1 npx) và v013 #3 option skipping pass
  - Kiểm bởi: tôi

- [x] 5. Thu gọn run-verify (bỏ dò alias/chuỗi script)
  - Tiêu chí xong: file được script trong package.json gọi tới vẫn bị flag khi đổi; run-verify không còn import shell.mjs
  - Kết quả: PASS: run-verify 399 -> 349 dòng, không còn import shell.mjs; test run-verify (kể cả v014 chuỗi script) pass
  - Kiểm bởi: tôi

- [x] 6. Kiểm tra cuối + CHANGELOG 0.1.6, version bump
  - Tiêu chí xong: test còn lại 0 fail; `claude plugin validate coding-studio` pass; CHANGELOG/plugin.json = 0.1.6
  - Kết quả: PASS: `node --test tests/*.test.mjs` 185 tests, 179 pass, 0 fail, 6 skip; `claude plugin validate coding-studio` -> Validation passed; CHANGELOG 0.1.6, plugin.json 0.1.6
  - Kiểm bởi: tôi
