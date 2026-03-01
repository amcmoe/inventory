alter table public.scan_sessions
  add column if not exists remote_mode text not null default 'scan'
    check (remote_mode in ('scan', 'damage')),
  add column if not exists remote_asset_tag text;

create index if not exists idx_scan_sessions_remote_mode
  on public.scan_sessions(remote_mode);
