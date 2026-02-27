-- Remote scanner pairing/session tables for desktop + shared phone workflows

create table if not exists public.scanner_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pairing_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.scanner_devices(id) on delete set null,
  context text not null check (context in ('search', 'bulk')),
  context_ref text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.scanner_devices(id) on delete set null,
  pairing_challenge_id uuid not null references public.pairing_challenges(id) on delete restrict,
  context text not null check (context in ('search', 'bulk')),
  context_ref text,
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_events (
  id bigserial primary key,
  scan_session_id uuid not null references public.scan_sessions(id) on delete cascade,
  barcode text not null,
  source text not null default 'remote_phone',
  created_at timestamptz not null default now()
);

create index if not exists idx_pairing_challenges_expires on public.pairing_challenges(expires_at);
create index if not exists idx_pairing_challenges_creator_time on public.pairing_challenges(created_by_user_id, created_at desc);
create index if not exists idx_scan_sessions_owner_status_expires on public.scan_sessions(created_by_user_id, status, expires_at);
create index if not exists idx_scan_sessions_expires on public.scan_sessions(expires_at);
create index if not exists idx_scan_events_session_time on public.scan_events(scan_session_id, created_at desc);

alter table public.scanner_devices enable row level security;
alter table public.pairing_challenges enable row level security;
alter table public.scan_sessions enable row level security;
alter table public.scan_events enable row level security;

-- Admins can manage scanner device catalog.
create policy scanner_devices_admin_all on public.scanner_devices
for all
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

-- Pairing/session/event write paths should go through Edge Functions (service role),
-- so direct authenticated writes are intentionally blocked by policy.
create policy pairing_challenges_owner_read on public.pairing_challenges
for select
using (auth.uid() = created_by_user_id);

create policy scan_sessions_owner_read on public.scan_sessions
for select
using (auth.uid() = created_by_user_id);

create policy scan_events_owner_read on public.scan_events
for select
using (
  exists (
    select 1
    from public.scan_sessions ss
    where ss.id = scan_events.scan_session_id
      and ss.created_by_user_id = auth.uid()
  )
);

revoke all on table public.scanner_devices from authenticated;
revoke all on table public.pairing_challenges from authenticated;
revoke all on table public.scan_sessions from authenticated;
revoke all on table public.scan_events from authenticated;

grant select on public.scanner_devices to authenticated;
grant select on public.pairing_challenges to authenticated;
grant select on public.scan_sessions to authenticated;
grant select on public.scan_events to authenticated;

-- Stream remote scans to desktop subscribers.
alter publication supabase_realtime add table public.scan_events;
