# Builder ended without DONE (BLOCKED, FAIL, timeout, turn limit, no reply)

Act only on evidence. Silence or a timeout does not prove nothing was committed.

1. Before any new delegation inspect its worktree (path from the builder result or `git worktree list`): `git -C <worktree> log --oneline <START>..HEAD`, `git -C <worktree> status --short`. Merge or build on commits that are there; never delete the worktree or branch to start over.
2. Claude Code removes a subagent worktree automatically when the subagent ends without changes. If it is gone, check the branch from the main checkout (`git log --oneline <START>..cs/<task-id>-<n>`, if `git branch --list cs/<task-id>-<n>` shows it). No worktree and no commits means nothing to recover: start a new builder instead of resuming.
3. BLOCKED on a question you can answer from the brief or the owner's decisions: answer it with `SendMessage` to that builder's agent id (recorded in its handoff file) so it continues with its context and worktree; start a new builder only if that resume fails.
4. A new builder gets a new handoff number `n` (so a new, unique branch) and, when the old branch has commits, START = that old builder branch tip instead of the tip of `cs/<task-id>`; say so in the handoff.
5. Answering a BLOCKED question is not a fix round; every new attempt after FAIL, timeout or turn limit is, and it counts toward the same 3-round limit for that module even with a new handoff number or task-id.
6. When several parallel builders fail, handle each one this way; the others' merges are not blocked.
