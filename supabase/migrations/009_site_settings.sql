create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  site_name text not null default 'IT Asset Management',
  company_name text not null default 'SMSD Tech Team',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.site_settings
  add column if not exists settings jsonb not null default '{}'::jsonb;

insert into public.site_settings (id, site_name, company_name)
values (1, 'IT Asset Management', 'SMSD Tech Team')
on conflict (id) do nothing;

create or replace function public.get_site_settings()
returns table (
  site_name text,
  company_name text,
  settings jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.site_name, s.company_name, s.settings, s.updated_at
  from public.site_settings s
  where s.id = 1
  limit 1;
$$;

create or replace function public.admin_upsert_site_settings(
  p_site_name text default null,
  p_company_name text default null,
  p_settings_patch jsonb default '{}'::jsonb
)
returns public.site_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_settings;
begin
  perform public.require_role(array['admin'::public.app_role]);

  update public.site_settings
  set
    site_name = coalesce(nullif(btrim(p_site_name), ''), site_name),
    company_name = coalesce(nullif(btrim(p_company_name), ''), company_name),
    settings = coalesce(settings, '{}'::jsonb) || coalesce(p_settings_patch, '{}'::jsonb),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into v_row;

  if not found then
    insert into public.site_settings (id, site_name, company_name, settings, updated_by)
    values (
      1,
      coalesce(nullif(btrim(p_site_name), ''), 'IT Asset Management'),
      coalesce(nullif(btrim(p_company_name), ''), 'SMSD Tech Team'),
      coalesce(p_settings_patch, '{}'::jsonb),
      auth.uid()
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

alter table public.site_settings enable row level security;

drop policy if exists site_settings_read_all on public.site_settings;
create policy site_settings_read_all on public.site_settings
for select
using (true);

drop policy if exists site_settings_admin_update on public.site_settings;
create policy site_settings_admin_update on public.site_settings
for update
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

revoke all on table public.site_settings from authenticated;
grant select on public.site_settings to authenticated;

grant execute on function public.get_site_settings() to authenticated;
grant execute on function public.admin_upsert_site_settings(text, text, jsonb) to authenticated;
