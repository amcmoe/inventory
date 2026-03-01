## Remote Scanner Edge Functions

This folder contains function skeletons for desktop + shared-phone scan pairing.

### Functions
- `pairing-create` (desktop authenticated)
- `pairing-consume` (shared phone, no login)
- `scan-submit` (shared phone, no login)
- `scan-session-end` (desktop authenticated + shared phone fallback)
- `scan-session-status` (desktop/mobile status polling)
- `scan-session-control` (desktop authenticated control mode updates)
- `scan-damage-photo` (shared phone damage photo upload)

### Important Supabase Settings
You do **not** need broad project-level auth changes, but you do need:

1. Run migration:
- `supabase/migrations/004_scan_sessions.sql`
- `supabase/migrations/007_scan_session_remote_control.sql`

2. Deploy functions:
- `supabase functions deploy pairing-create`
- `supabase functions deploy pairing-consume`
- `supabase functions deploy scan-submit`
- `supabase functions deploy scan-session-end`
- `supabase functions deploy scan-session-status`
- `supabase functions deploy scan-session-control`
- `supabase functions deploy scan-damage-photo`

3. Disable JWT verification for scanner endpoints:
- `pairing-consume`
- `scan-submit`
- `scan-session-end`
- `scan-session-status`
- `scan-damage-photo`

These are designed for shared phones without user login.

If you use `supabase/config.toml`, set:

```toml
[functions.pairing-consume]
verify_jwt = false

[functions.scan-submit]
verify_jwt = false

[functions.scan-session-end]
verify_jwt = false

[functions.scan-session-status]
verify_jwt = false

[functions.scan-damage-photo]
verify_jwt = false
```

### Security note
`scan-submit` currently trusts `scan_session_id` as the bearer of authority.
For production-hardening, add a short-lived scanner token (HMAC/JWT) returned by `pairing-consume`
and require it in `scan-submit`.
