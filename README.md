# Inventory App

Inventory checkout/check-in app built with plain HTML/CSS/JS and Supabase.

## Repository Layout

- `docs/` static frontend (GitHub Pages-compatible)
- `docs/js/` app modules
- `supabase/migrations/` database schema and RPC migrations
- `supabase/functions/` Edge Functions for remote scanner/session workflows

## Core Features

- Magic-link authentication
- Role-based access (`admin`, `tech`, `viewer`)
- Asset search, filters, and detail views
- Checkout/check-in via RPC-only state transitions
- Damage reports with private storage uploads
- Admin asset management + bulk create
- User/assignee management
- Remote phone scanner pairing for desktop workflows

## Security Notes

- Do not commit secrets (service role keys, personal tokens).
- `SUPABASE_ANON_KEY` is publishable client config, but keep all privileged logic in RPCs/Edge Functions.
- Keep `verify_jwt = false` only on scanner functions that are intentionally public and perform their own authorization checks.

## Local Development

1. Configure frontend runtime values in `docs/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
```

2. Apply migrations (via Supabase SQL editor or CLI) in order:
- `001_inventory.sql`
- `002_equipment_type_rename.sql`
- `003_user_management_app_users.sql`
- `004_scan_sessions.sql`
- `005_checkout_checkin_asset_id_ambiguity_fix.sql`
- `006_append_asset_note.sql`
- `007_scan_session_remote_control.sql`

3. Deploy/update scanner Edge Functions as needed:

```powershell
npx.cmd supabase functions deploy pairing-create
npx.cmd supabase functions deploy pairing-consume --no-verify-jwt
npx.cmd supabase functions deploy scan-submit --no-verify-jwt
npx.cmd supabase functions deploy scan-session-end --no-verify-jwt
npx.cmd supabase functions deploy scan-session-status --no-verify-jwt
npx.cmd supabase functions deploy scan-session-control
npx.cmd supabase functions deploy scan-damage-photo --no-verify-jwt
npx.cmd supabase functions deploy scan-damage-delete
```

4. Scanner function JWT settings:
- `verify_jwt = false`: `pairing-consume`, `scan-submit`, `scan-session-end`, `scan-session-status`, `scan-damage-photo`
- `verify_jwt = true` (default): `pairing-create`, `scan-session-control`, `scan-damage-delete`

## Remote Scanner Notes

- When phone `End Session` is pressed, `scan-session-end` now emits a `remote_session_end` event so desktop UI disconnects immediately without manual refresh.
- Remote damage photo `X` delete in desktop drawer calls `scan-damage-delete`, which removes the `remote-temp/...` storage file and matching `scan_events` entries.

## Deployment

- Frontend: publish `docs/` (GitHub Pages or equivalent static host).
- Backend: deploy migrations + Edge Functions through Supabase.

## Hardening

- Recommended headers:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy`
- This repo includes:
  - CSP/referrer meta tags in app pages
  - `docs/_headers` for hosts that support static header rules
