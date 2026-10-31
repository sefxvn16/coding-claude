---
type: llm
---

PASS if the reply classifies the task (small vs complex, or equivalent) or mentions checking git status, .studio/project.json, or the verifier/reviewer steps of the coding-claude workflow, and proposes a fix plan for slugify.
FAIL if it just describes code with no reference to the studio workflow, or makes file changes.
