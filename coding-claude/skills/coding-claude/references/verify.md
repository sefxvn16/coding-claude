# Verification (step 7)

Run only on the merged task branch; fill the Verifier section of the handoff (`--scope` whenever the project has `.studio/modules.json`). Without `--scope` only locks and dependencies are checked, and the run is PASS-FLAGGED when `work/<task-id>/scope.json` exists for the branch. `--base` is mandatory; never pass the current HEAD as base.

Acting on the result:
- PASS: move on.
- PASS-FLAGGED: protected tests, `.studio/**` or check-config files changed, or dependency flags. You and the reviewer judge every flag; loosening or deleting needs owner approval.
- FAIL: back to build; at most 3 rounds.
- INVALID: HEAD or tracked files changed while commands ran (or skip-worktree/assume-unchanged flags on protected files). Find out why, then rerun.
- CONFIG-ERROR "config changed, needs owner approval": `.studio/project.json` `commands`, `protected_paths`, `gated_commands`, `rules` or `fail_output` differ from the merge-base. Ask the owner; if approved, commit the approved config change on the integration branch as its own commit, rebase (or re-cut) `cs/<task-id>` onto it, record that commit as the new BASE in `PLAN.md` and the handoffs, and verify with it. Never bypass.
- CONFIG-ERROR on the base (missing, invalid, equal to HEAD, no merge-base): fix the arguments.
- CONFIG-ERROR on modules (`.studio/modules.json` changed on the branch, or the registry or scope file invalid): owner decision (`modules.md`); never edit the registry on the task branch.

Command timeouts: default 900 s; `timeouts` in project.json (seconds, per command name or `default`).
