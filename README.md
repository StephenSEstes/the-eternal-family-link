# The Eternal Family Link (MVP)

Next.js 15 App Router MVP for a family memory support app.

## Tech stack

- Next.js 15 (App Router, TypeScript)
- NextAuth (Google provider)
- Google Sheets + Drive APIs (service account)
- Tailwind CSS
- Zod validation

## Features included

- Auth via Google using NextAuth App Router route handlers
- Route protection for all routes except `/viewer`
- Allowlist authorization from Google Sheet tab `UserAccess`
- Session token enrichment with `role` and `person_id`
- Typed Google data layer in `src/lib/google/` for Sheets and Drive
- Pages:
  - `/` dashboard (People, Family Tree, Today, Games)
  - `/people` list with photo + name
  - `/people/[personId]` profile with permissioned editing
  - `/tree` placeholder + relationship list
  - `/games` placeholder
  - `/viewer` read-only public mode with PIN gate and 30-day cookie
- API routes:
  - `GET /api/people`
  - `GET /api/people/[personId]`
  - `POST /api/people/[personId]` (strict Zod + permission checks)

## Required environment variables

Create `.env.local` with:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-long-random-secret

GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret

GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
SHEET_ID=1mDcmyYDYCTkFFT2k_AtnavuvZlF3qPshErxVs0ByzpQ
PHOTOS_FOLDER_ID=14-SWEGBIog3RFxQG2kPenzdOZamBL4r-

VIEWER_PIN=1234
```

Notes:
- `GOOGLE_SERVICE_ACCOUNT_JSON` must be a single-line stringified JSON object.
- Share the target Google Sheet and Photos Drive folder with the service account email.

## Google OAuth setup

1. Go to Google Cloud Console.
2. Create or select a project.
3. Configure OAuth consent screen.
4. Create OAuth 2.0 Client ID (Web application).
5. Add redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-vercel-domain>/api/auth/callback/google`
6. Copy Client ID and Client Secret into env vars.

## Sheet structure expectations

### `UserAccess` tab
Headers expected:
- `user_email`
- `is_enabled` (`TRUE`/`FALSE`)
- `role` (`ADMIN` or `USER`)
- `person_id`

### `People` tab
Headers expected at minimum:
- `person_id`
- `display_name`
- `phones`
- `address`
- `hobbies`
- `notes`
- `photo_file_id`
- `is_pinned` or `is_pinned_viewer`
- `relationships` (comma/semicolon-separated)

## Local development

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import project into Vercel.
3. In Vercel project settings, add all env vars listed above.
4. Set `NEXTAUTH_URL` to your production URL.
5. Redeploy.

## Security notes

- Auth is required for app routes except `/viewer`.
- Editing a person profile is allowed only if:
  - `session.user.person_id === [personId]`, or
  - `session.user.role === ADMIN`.
- Viewer access uses PIN + secure HTTP-only cookie for 30 days.