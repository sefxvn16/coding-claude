# Review (step 8)

- Mode: STANDARD by default. SECURITY when the diff touches authentication, authorization, personal data, or external input; then add the ADVERSARIAL second review.
- Second review (ADVERSARIAL): only when the task is important: an M2 condition applies, SECURITY mode is on, or M3 for a large change. Run a second `coding-claude:reviewer` with `model: opus` and mode ADVERSARIAL, with the same inputs but NOT the first review. For a design, run it on `03-design.md` before the build. Run both reviewers in one message; merge their findings into `06-review-<round>.md`, noting which reviewer found what. Both together count as one review round.
- Cap: at most 2 review rounds per deliverable. Round 1 = full review against the brief and the protection target; round 2 = only verify the round-1 fixes. Findings outside the protection target are LOW. Anything still open after round 2 goes into "Known limits" in the README/dossier and to the owner; never open round 3 on your own.
- After any fix: new hash, rerun verify and review on it (except a DROP removal of a lesson line: `lessons.md`).
