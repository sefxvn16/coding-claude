#!/usr/bin/env bash
set -e
git init -q
git config user.email eval@example.com
git config user.name eval
cat > package.json <<'EOF'
{"name":"demo","version":"1.0.0","scripts":{"lint":"eslint .","test":"node --test","build":"node build.js"}}
EOF
echo "# demo" > CLAUDE.md
git add -A && git commit -qm init
