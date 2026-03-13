# Engineering Operating Rules

## Root Cause First
- Always perform root-cause analysis before applying any fix.
- Do not patch symptoms before identifying and stating the underlying cause.
- For each issue, document:
  - Reproduction path
  - Failing data/query/code path
  - Root cause
  - Why the chosen fix addresses the root cause

## Data vs Code Decision Rule
- If the schema and code are correct, fix data only.
- Do not change code to compensate for bad data unless explicitly approved.
- When data is the issue, provide exact row/column-level remediation steps.

## OCI Direct Access
- For any direct OCI query or repair script, use the same wallet decoding and connection pattern as `src/lib/oci/tables.ts`.
- Do not hand-roll wallet extraction differently; this repo stores wallet files in env payload form and expects the same base64 decode logic the app uses.
- When diagnosing live OCI data, prefer reusing the app's connection assumptions first before writing ad hoc scripts.

## Minimal Safe Change
- Apply the smallest change that resolves the confirmed root cause.
- Avoid broad refactors while resolving active incidents.
- Preserve existing login/auth behavior unless the issue is explicitly auth-related.

## Verification Before/After
- Before fixing: capture evidence of failure (query output, row mismatch, API result, or UI behavior).
- After fixing: verify with the same checks and confirm expected behavior.
- State any residual risk or follow-up checks.

## Communication
- Clearly state whether the issue is:
  - Data issue
  - Code issue
  - Mixed issue
- Ask for confirmation before code changes when evidence indicates a pure data issue.
- If uncertain, gather more evidence first; do not guess.
- If the user interrupts with a side question, answer briefly and continue the active implementation unless the user explicitly says to stop or change scope.

## Testing and Deployment Policy
- Do not rely on local app testing as a release gate.
- Use lint/type/build checks and deployed-environment validation as the primary verification path.
- Do not use localhost/manual local UI testing as the primary test environment.
- After completing local code changes, explicitly ask:
  - "Do you want to continue making changes or deploy now?"
- If user chooses deploy:
  - Commit all approved changes.
  - Push/deploy.
  - Update `changeHistory.md` in the local repo in the same release cycle.

## Documentation Discipline
- For any code/data/schema change that is committed, update docs in the same commit:
  - `docs/design-decisions.md` when a design or architecture choice changed.
  - `docs/change-summary.md` with a concise release entry (what changed, why, verify).
- Keep `designchoices.md` aligned with `docs/design-decisions.md` (same intent, naming compatibility).
- Keep `changeHistory.md` aligned with `docs/change-summary.md` (quick release log entry + link/reference).
- If no design decision changed, explicitly note "No design decision change" in the change summary entry.
- Before making changes, check design rules in `docs/design-decisions.md` (and `designchoices.md`).
- If a requested change may deviate from design rules:
  - pause and ask Steve for confirmation before implementation,
  - ask whether to update design decisions,
  - if approved, update decision docs with date and reason in the same commit.

## Session Startup Behavior
- At the start of each new repo session, read `TODO.md`, `docs/design-decisions.md`, and `designchoices.md`.
- List current `Priority: High` items first.
- Prompt the user: "Do you want to work on one of these now?"
- If the user chooses one, prioritize that task before lower-priority work unless the user explicitly changes scope.

## Post-Commit TODO Hygiene
- After each commit, review `TODO.md` for tasks that may now be complete.
- Propose specific completed task updates and ask Steve for confirmation before marking them done.

## Multi-Agent Safety Rule
- Never run more than one Codex agent in the same repo/worktree at the same time.
- If another Codex session is active, stop and wait until that session is fully ended before starting a new one.
- If unexpected file changes appear during the session, stop immediately, report the file(s), and ask Steve how to proceed.

## Investigation-Only Mode Rule
- If Steve asks for investigation/debugging only, do not modify files.
- In investigation-only mode, limit actions to reading files, running non-mutating commands, and reporting evidence/root cause.
- Before any file edit in that mode, ask Steve for explicit approval to switch from investigation to implementation.
