# Inventory Checkout / Check-In App

Mobile-first inventory app built with plain HTML/CSS/JS and Supabase.

## Project Structure

- `public/` static frontend files for GitHub Pages/Netlify
- `supabase/migrations/001_inventory.sql` full schema + RPC + RLS + storage policies

## 1) Create Supabase Project

1. Create a new project at https://supabase.com.
2. Open **SQL Editor**.
3. Run the full migration file from `supabase/migrations/001_inventory.sql`.

## 2) Create User Profiles + Roles

Users must have a row in `public.profiles` after first sign in.

Example SQL (replace with real auth user IDs):

```sql
insert into public.profiles (user_id, role, display_name)
values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'Admin User'),
  ('00000000-0000-0000-0000-000000000002', 'tech', 'Tech User'),
  ('00000000-0000-0000-0000-000000000003', 'viewer', 'Viewer User');
```

## 3) Storage Bucket + RLS

The migration already creates private bucket `asset-damage-photos` and storage policies:

- authenticated users can read (via signed URLs)
- admin/tech can upload/update

No extra SQL is required unless you customize policies.

## 4) Configure Auth Redirect URLs

In Supabase **Authentication -> URL Configuration**:

- Set **Site URL** to your deployed app URL.
- Add **Redirect URLs** for each environment.

Examples:

- GitHub Pages:
  - `https://YOUR_GH_USERNAME.github.io/YOUR_REPO/inventory/public/index.html`
- Netlify:
  - `https://YOUR_SITE.netlify.app/index.html`
- Local:
  - `http://localhost:8080/index.html`

Magic-link login returns users to the same page they launched from.

## 5) Configure Frontend Supabase Keys

1. Edit `public/config.js`.
2. Set:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
```

## 6) Deploy Static Files

Deploy `public/` contents as your static site root.

### GitHub Pages option

- Publish from a branch/folder containing `inventory/public` files.
- Ensure `index.html` is at the published root.

### Netlify option

- Set publish directory to `inventory/public`.

## App Features Included

- Auth via Supabase magic link
- Role-based UI (`admin`, `tech`, `viewer`)
- Asset search + filters (status/category/location)
- Asset detail view with current status + assignee
- Extended asset details: equipment, manufacturer, model, serial, building, room, in-service date, condition, assignment history, condition notes, owned/leased, warranty expiration, obsolete flag
- Checkout/check-in via SECURITY DEFINER RPC functions only
- Transaction history
- Damage reports + photo uploads to private Supabase Storage
- Signed URL thumbnail viewing
- Assignee autocomplete + admin-only create person
- QR helper page for asset deep links
- Bulk checkout page (tech/admin)

## Integrity Model

Checkout/check-in integrity is enforced by RPC:

- `checkout_asset(asset_tag, assignee_person_id, due_date?, notes?)`
- `checkin_asset(asset_tag, notes?)`

Direct client writes to `assets`, `transactions`, and `asset_current` are blocked; checkout/check-in state transitions occur inside RPCs.

`asset_tag` and `serial` are enforced as the same value by DB constraint (`assets_tag_matches_serial`) and admin RPC validation.

## Notes

- Phones are first-class (large touch targets, simple forms, camera-friendly uploads).
- Keep `public/config.js` out of public repos if desired (or use deploy-time replacement).
