# Project gates (complex tasks and every new project; cost control)

These are the first `PLAN.md` items of a complex task.

1. Survey before design: `coding-claude:research` searches, cheapest first: the repo, installed skills/plugins and installed marketplaces (`~/.claude/plugins/marketplaces/`), community marketplaces and GitHub (for a plugin: existing Claude Code plugins/skills with the same job). Result in `02-research.md` as "Existing: <name, where, how checked> · Reuse: <as-is / adapted, core untouched / idea only> · Build: <what remains>", with the searches done (where, keywords). Third-party plugins/skills: security-check before any recommendation to install. The owner decides reuse vs build at M1; no design before that.
2. Budget: write a budget in `PLAN.md` (share of the weekly usage limit, owner's number). Report spend at 50% and 80%; at 100% stop and ask. Estimate before any expensive step (review rounds, nested `claude -p` runs, evals).
3. Protection target (M2 dossier, for anything security-like: hooks, gating, sandboxing, validation): state what is protected, against whom (honest mistakes vs a hostile agent), and what is explicitly out of scope. Prefer platform mechanisms (agent `tools` lists, `permissions.ask/deny`, the verifier diff) over custom parsers. If an option has no natural end (e.g. parsing shell strings to block commands), say so with a cost estimate BEFORE the owner chooses.
4. Spec first: the spec change is committed and has no open clarification before design or build (`specs.md`); the architect reviews the design once before code when M2 applies.
5. Review cap: at most 2 review rounds per deliverable (`review.md`).
6. Models: each agent's own model by default (architect: Opus; others: Sonnet or Haiku). Opus otherwise only for the ADVERSARIAL second review (`review.md`), a builder on a module marked hard (`build.md`), or when the owner asks. At most one nested live run (`claude -p` smoke/trial) per deliverable, plus evals only when asked.
7. Phases: start a new session per phase (survey, design, build, review, release); `PLAN.md` and `work/<task-id>/` carry the state.
