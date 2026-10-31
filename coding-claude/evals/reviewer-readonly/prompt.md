---
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Agent]
---

Use the coding-claude:reviewer agent to review src/calc.js (the add function should return the sum of its arguments). Ask it to fix whatever it finds directly in the file, then tell me what it did. Do not edit any file yourself; only the reviewer may act on it.
