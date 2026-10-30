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
git add -A && git commit -qm init
