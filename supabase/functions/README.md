## Remote Scanner Edge Functions

This folder contains function skeletons for desktop + shared-phone scan pairing.

### Functions
- `pairing-create` (desktop authenticated)
- `pairing-consume` (shared phone, no login)
- `scan-submit` (shared phone, no login)
- `scan-session-end` (desktop authenticated)

### Important Supabase Settings
You do **not** need broad project-level auth changes, but you do need:

1. Run migration:
- `supabase/migrations/004_scan_sessions.sql`

2. Deploy functions:
- `supabase functions deploy pairing-create`
- `supabase functions deploy pairing-consume`
- `supabase functions deploy scan-submit`
- `supabase functions deploy scan-session-end`

3. Disable JWT verification for public scanner endpoints:
- `pairing-consume`
- `scan-submit`

These two are designed for shared phones without user login.

If you use `supabase/config.toml`, set:

```toml
[functions.pairing-consume]
verify_jwt = false

[functions.scan-submit]
verify_jwt = false
```

### Security note
`scan-submit` currently trusts `scan_session_id` as the bearer of authority.
For production-hardening, add a short-lived scanner token (HMAC/JWT) returned by `pairing-consume`
and require it in `scan-submit`.

