# Deploy Runbook

## Famailink MVP (`famailink-mvp`)

This section is the canonical deployment path for the isolated Famailink MVP. Do not use the legacy app deploy path for this track.

### Target

- Vercel project: `famailink-mvp`
- App root: `C:\Users\steph\the-eternal-family-link\famailink`
- Linked project file: `famailink/.vercel/project.json`
- Active branch used for this track: `famailink-mvp`

### Required Environment Variables

- `OCI_DB_USER`
- `OCI_DB_PASSWORD`
- `OCI_DB_CONNECT_STRING`
- `OCI_WALLET_PASSWORD`
- `OCI_WALLET_FILES_JSON` or `TNS_ADMIN`
- `FAMAILINK_SESSION_SECRET` or `UNIT1_SESSION_SECRET`

Optional for self-service password reset email delivery:

- `GMAIL_SENDER_EMAIL`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

### Pre-Deploy

- From repo root:
  - `npm run lint --prefix famailink`
  - `npm run build --prefix famailink`
- Confirm you are deploying the intended branch/commit.
- Confirm the working directory for the actual deploy command is `famailink/`, not the repo root and not `efl2/`.
- Confirm no unrelated local files are staged.

### Deploy

From `C:\Users\steph\the-eternal-family-link\famailink`:

```powershell
vercel --prod --yes
```

Do not run the Famailink production deploy command from the repo root. The intended target is the linked `famailink/` app directory only.

Expected result:

- Vercel reports project `steve-estes-projects/famailink-mvp`
- production alias resolves to `https://famailink-mvp.vercel.app`

### Post-Deploy Verification

- `GET /login` returns `200`
- signed-out `/tree` resolves to the login surface
- signed-out `/preferences` resolves to the login surface
- local username/password login succeeds for a known working account
- after sign-in, `/tree` and `/preferences` both load
- if password-reset changes were part of the release:
  - `/forgot-password` loads
  - submitting a known local-account email returns the generic success message
- if access/default changes were part of the release:
  - save one preference
  - confirm `/tree` readback reflects the saved state

### Rollback

Option A (preferred):

- Open Vercel project `famailink-mvp`
- promote the previous known-good deployment

Option B (git):

- from repo root on branch `famailink-mvp`
- `git log --oneline`
- `git revert <sha>`
- `git push origin famailink-mvp`
- redeploy from `famailink/`

### Notes

- Famailink is intentionally isolated from the legacy app deployment target.
- Do not deploy this track to the existing legacy production project alias.

## Environment Variables (Vercel)

Required:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `PHOTOS_FOLDER_ID`
- `VIEWER_PIN`

Optional:

- `OPENAI_API_KEY` (required only for the in-app Help assistant and AI story import)
- `OPENAI_HELP_MODEL` (defaults to `gpt-5-mini`)
- `OPENAI_STORY_IMPORT_MODEL` (defaults to `OPENAI_HELP_MODEL`)

Verify quickly after deploy:

- `GET /api/health` => required env booleans expected true. `OPENAI_API_KEY` is true only when AI help is enabled.

## Pre-Deploy

- `npm run lint`
- Ensure no accidental local artifacts committed (`dev.log`, `dev.err`, temp reports).
- Confirm branch status and target commit hash.

## Deploy

- Push to `main`.
- Wait for Vercel production deployment completion.

## Post-Deploy API Validation

- `GET /api/health` => 200
- `GET /api/me` signed out => 401
- `GET /api/people` signed out => 401
- `GET /api/tables` signed in admin => 200 list of logical OCI tables

## Post-Deploy UI Validation

- Home page route loads for signed-in allowlisted user.
- People grid and profile pages load.
- Viewer PIN flow works.

## Vercel Logs

- Open Vercel Dashboard -> Project -> Deployments -> latest deploy -> Logs.
- Filter by route name (`api/people`, `api/tables`).
- Confirm step markers and error context if failures occur.

## Rollback

Option A (Vercel):

- Promote previous successful deployment.

Option B (Git):

- `git checkout main`
- `git log --oneline`
- Revert problematic commit(s): `git revert <sha>`
- Push revert to `main`

## Known Good Recovery Points

- Backup branch: `backup/20260218-235233`
- Safety tag: `safe-20260218-235233`
- Local zip: `backups/workspace-snapshot-20260218-235302.zip`
