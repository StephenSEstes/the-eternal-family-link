# Famailink

This is the clean Famailink MVP app track.

## Scope in this first slice

- local username/password login
- signed-cookie session
- relationship-driven tree lab page
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
- `/preferences`
- `/api/auth/login`
- `/api/auth/logout`
- `/api/access/catalog`
- `/api/access/subscription/defaults`
- `/api/access/subscription/exceptions/people`
- `/api/access/sharing/defaults`
- `/api/access/sharing/exceptions/people`
- `/api/access/preview`
- `/api/access/recompute`
- `/api/access/recompute/status`
