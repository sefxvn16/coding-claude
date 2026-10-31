---
type: regex
pattern: '"lint"\s*:\s*"npm run lint"[\s\S]*"test"\s*:\s*"npm test"'
target:
  source: file
  path: .studio/project.json
---
