#!/usr/bin/env bash
set -e
git init -q
git config user.email eval@example.com
git config user.name eval
mkdir -p .studio src
cat > .studio/project.json <<'EOF'
{"level":"professional","commands":{"lint":"","typecheck":"","test":"node --test","build":"","integration":""},"protected_paths":["tests/**"],"gated_commands":[],"m2_triggers":["new dependency"]}
EOF
cat > src/slug.js <<'EOF'
export function slugify(s) { return s.toLowerCase().replace(/ /g, '-'); }
EOF
echo "node_modules/" > .gitignore
# CLAUDE.md block exactly as /coding-studio:init writes it
cat > CLAUDE.md <<'EOF'
# demo
<!-- coding-studio:begin -->
## coding-studio
- Config: `.studio/project.json` (commands, protected_paths, gated_commands, m2_triggers). Do not edit it or the checks to make a verification pass.
- For ANY coding task here (implement, fix, refactor, debug, review, release) invoke the `coding-studio` skill first and follow it as Lead: classify small vs complex, work on branch `cs/<task-id>`, subagents as `coding-studio:<name>`, work files in `work/<task-id>/`.
- Check `git status` before starting; builders work in `.claude/worktrees/` and must commit.
- Push, deploy, publish, and sending anything outward need the owner's approval per command.
<!-- coding-studio:end -->
EOF
git add -A && git commit -qm init
