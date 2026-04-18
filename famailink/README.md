# Famailink

This is the clean Famailink MVP app track.

## Scope in this first slice

- local username/password login
- show/hide password on sign-in
- self-service local password reset
- signed-cookie session
- relationship-driven tree lab page
- tree-card modal editing for one-relative subscription/sharing changes
- generic relationship rules tree for broad defaults
- authenticated preferences page
- subscription defaults editor
- subscription person exception editor
- sharing defaults editor
- sharing person exception editor
- live preview that separates tree visibility, subscription, and sharing
- recompute trigger and persisted status summary
- direct OCI reads for people and relationships

## Not in scope yet

- Google sign-in
- recompute jobs
- production EFL feature surfaces

## Required env

- `OCI_DB_USER`
- `OCI_DB_PASSWORD`
- `OCI_DB_CONNECT_STRING`
- `OCI_WALLET_PASSWORD`
- `OCI_WALLET_FILES_JSON` or `TNS_ADMIN`
- `FAMAILINK_SESSION_SECRET` or `UNIT1_SESSION_SECRET`

Optional for password reset email delivery:

- `GMAIL_SENDER_EMAIL`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

## Run

```powershell
npm install --prefix famailink
npm run dev --prefix famailink
```

## Build/Lint

```powershell
npm run lint --prefix famailink
npm run build --prefix famailink
```

## Production Validation

After a production deploy, run the Famailink validation script from the repo root:

```powershell
npm run famailink:validate:prod
```

Use the write/restore mode only when the release touches preference save or recompute behavior:

```powershell
npm run famailink:validate:prod -- --write-restore
```

See [docs/deploy-runbook.md](C:/Users/steph/the-eternal-family-link/docs/deploy-runbook.md) for required session-secret inputs and pass/fail expectations.

## Production Deploy

- Vercel project: `famailink-mvp`
- Deploy from app root: `C:\Users\steph\the-eternal-family-link\famailink`

```powershell
vercel --prod --yes
```

Use [docs/deploy-runbook.md](C:/Users/steph/the-eternal-family-link/docs/deploy-runbook.md) as the canonical Famailink deploy and verification runbook.

## Current routes

- `/login`
- `/tree`
- `/rules-tree`
- `/preferences`
- `/forgot-password`
- `/reset-password/[token]`
- `/api/auth/login`
- `/api/auth/logout`
- `/api/password-reset/request`
- `/api/password-reset/[token]`
- `/api/access/catalog`
- `/api/access/subscription/defaults`
- `/api/access/subscription/exceptions/people`
- `/api/access/sharing/defaults`
- `/api/access/sharing/exceptions/people`
- `/api/access/preview`
- `/api/access/recompute`
- `/api/access/recompute/status`
