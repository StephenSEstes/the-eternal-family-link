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

## Google Sheets Access Pre-Check
- Before any live Google Sheets read/write from scripts or API tooling, confirm the workbook is closed on the user side.
- If a sheet read fails unexpectedly, include "close the workbook and retry" as an immediate diagnostic step.

## Testing and Deployment Policy
- Do not rely on local app testing as a release gate.
- Use lint/type/build checks and deployed-environment validation as the primary verification path.
