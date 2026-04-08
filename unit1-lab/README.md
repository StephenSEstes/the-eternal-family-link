# Unit 1 Lab (Greenfield)

This app is the isolated Unit 1 build track.

## Scope

- Login/session
- Subscription preference administration
- Sharing preference administration
- Access preview and resync

## Out of scope

- People, media, calendars, shares, stories, household editors, and all legacy EFL feature surfaces.

## Required env

- `OCI_DB_USER`
- `OCI_DB_PASSWORD`
- `OCI_DB_CONNECT_STRING`
- `OCI_WALLET_PASSWORD`
- `OCI_WALLET_FILES_JSON` (or chunked `OCI_WALLET_FILES_JSON_PART_*` variables)
- `UNIT1_SESSION_SECRET`

## Run

```powershell
npm install --prefix unit1-lab
npm run dev --prefix unit1-lab
```

## Build/Lint

```powershell
npm run lint --prefix unit1-lab
npm run build --prefix unit1-lab
```

## Deploy isolation

- Deploy this folder as a separate Vercel project with root directory `unit1-lab/`.
- Do not deploy this app to the existing production alias for the legacy EFL app.

