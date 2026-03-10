# The Eternal Family Link (MVP)

Next.js 15 App Router MVP for a family memory support app.

## Tech stack

- Next.js 15 (App Router, TypeScript)
- NextAuth (Google provider)
- OCI + Google Drive APIs (service account)
- Tailwind CSS
- Zod validation

## Features included

- Auth via Google using NextAuth App Router route handlers
- Route protection for all routes except `/viewer`
- Allowlist authorization from runtime `UserAccess`
- Session token enrichment with `role` and `person_id`
- Neutral runtime data layer in `src/lib/data/` with Google Drive helpers in `src/lib/google/`
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
PHOTOS_FOLDER_ID=14-SWEGBIog3RFxQG2kPenzdOZamBL4r-

VIEWER_PIN=1234
```

Notes:
- `GOOGLE_SERVICE_ACCOUNT_JSON` must be a single-line stringified JSON object.
- Share the target Photos Drive folder with the service account email.
- `OPENAI_API_KEY` is optional. Set it to enable the in-app Help assistant.
- `OPENAI_HELP_MODEL` is optional. Default is `gpt-5-mini`.

## Google OAuth setup

1. Go to Google Cloud Console.
2. Create or select a project.
3. Configure OAuth consent screen.
4. Create OAuth 2.0 Client ID (Web application).
5. Add redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-vercel-domain>/api/auth/callback/google`
6. Copy Client ID and Client Secret into env vars.

## Favicons and app icons

- Generated icon assets live in `/public`:
  - `favicon.ico`
  - `favicon-16x16.png`
  - `favicon-32x32.png`
  - `apple-touch-icon.png`
  - `android-chrome-192x192.png`
  - `android-chrome-512x512.png`
  - `site.webmanifest`
- Source logo is `public/brand/logo-arch-tree.png`.
- To regenerate icons after replacing the source logo, run:
  - `node scripts/generate-favicons.mjs`

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
