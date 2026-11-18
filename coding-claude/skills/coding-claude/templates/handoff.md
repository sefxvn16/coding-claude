# Handoff <n>: <module> (<task-id>)

To: coding-claude:<agent>
BASE (full sha, recorded before the task started): <hash>
START (builder only: tip of cs/<task-id> when this handoff was written; = BASE for the first builder; for a retry of a builder whose branch has commits, that builder branch tip): <hash>
Agent id (Lead fills after delegating; used to resume a BLOCKED builder with SendMessage): <id>
Design (reviewer: contracts to check on both sides): work/<task-id>/03-design.md | none
Spec (source of truth; never edit): specs/<feature>.md at commit <hash>
Task branch: cs/<task-id>   Current HEAD: <hash>

## Goal
<what this delegate must deliver>

## Decisions already made
-

## Acceptance ids for you
- <feature>/A<n> -- test-first: yes | no

## Relevant files
- <path> -- <why>

## Files you own (edit only these)
- <path>

## Task scope (only when .studio/modules.json exists; copy of work/<task-id>/scope.json)
Modules: <ids>   Extra files: <globs>
Edits outside this scope or inside a locked module are denied (builder) and FAIL verification. Found a problem outside it: report it, do not fix it.

## Not yours (do not edit)
- <path> -- owner: <who>

## How to check
- <command from .studio/project.json>

## Check results so far
| Check | Result | Hash | Source |
|---|---|---|---|
| <lint/typecheck/test/build/integration> | PASS / FAIL / not run | <hash> | <builder / verifier report path> |

## Verifier only
Hash to verify: <hash>   run-verify: <absolute path>   Run: `--base <BASE> --out work/<task-id>/05-verify-<n>.json` (+ `--scope work/<task-id>/scope.json` when modules exist)

## Reviewer only
Owner's ORIGINAL request (verbatim): <text>
Acceptance criteria: <ids>   Approved spec commits: <hashes>
Builder results: work/<task-id>/04-handoff-<n>-result.md   Latest verify: work/<task-id>/05-verify-<n>.md   New lesson ids: <ids | none> (+ `lessons.mjs check` output)
Mode: STANDARD | SECURITY | ADVERSARIAL   Round: 1 | 2   Protection target / out of scope: <text | none>
Module audit script (when modules exist): <absolute path>

## Architect only
Mode: DESIGN | DEBUG   Module audit script and modular-design guide (when they apply): <absolute paths>

## Lessons (advisory; the spec, project.json and this handoff win)
<output of `lessons.mjs match`, or "none">

## Open issues
-

## Report back
Status, branch, commit hash, files changed, tests added, acceptance tests (id -> test, red output for test-first ids), existing tests needing change, local checks, deviations.
