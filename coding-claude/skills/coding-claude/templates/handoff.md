# Handoff <n>: <module> (<task-id>)

To: coding-claude:<agent>
BASE (full sha, recorded before the task started): <hash>
START (builder only: tip of cs/<task-id> when this handoff was written; = BASE for the first builder): <hash>
Task branch: cs/<task-id>   Current HEAD: <hash>

## Goal
<what this delegate must deliver>

## Decisions already made
-

## Relevant files
- <path> -- <why>

## Files you own (edit only these)
- <path>

## Not yours (do not edit)
- <path> -- owner: <who>

## How to check
- <command from .studio/project.json>

## Check results so far
| Check | Result | Hash | Source |
|---|---|---|---|
| <lint/typecheck/test/build/integration> | PASS / FAIL / not run | <hash> | <builder / verifier report path> |

## Script (absolute path; verifier only)
- run-verify: <absolute path>   Run: `--base <BASE> --out work/<task-id>/05-verify-<n>.json`

## Test rules
You may add NEW test files. Never edit, delete or loosen an existing protected test, snapshot or golden file, and never touch .studio/, test-runner config, CI workflows or scripts run by project commands. If the brief needs an existing test changed, list it in your report (path, what, why); Lead asks the owner and edits it.

## Open issues
-

## Report back
Status, branch, commit hash, files changed, tests added, existing tests needing change, local checks, deviations.
