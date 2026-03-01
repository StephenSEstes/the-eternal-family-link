# Change History (Alias)

This file is a quick release-log entry point.

- Canonical release notes: `docs/change-summary.md`
- Keep this file updated in each deploy cycle with a short pointer to the newest entry.

## Latest

- 2026-03-01: Added quota hotfix for People/Tree routes (TTL read caching + graceful fallback diagnostics) and switched post-save refreshes to router refresh to reduce read bursts. See `docs/change-summary.md`.
