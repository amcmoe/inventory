-- inventory schema + RLS + RPCs
-- Run in Supabase SQL editor as a single migration

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type public.app_role as enum ('admin', 'tech', 'viewer');
create type public.asset_status as enum ('available', 'checked_out', 'repair', 'retired');
create type public.transaction_action as enum ('out', 'in');
create type public.damage_status as enum ('open', 'in_repair', 'resolved');
create type public.asset_ownership as enum ('owned', 'leased');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'viewer',
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, role, display_name)
  values (new.id, 'viewer', coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger trg_new_auth_user_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create table public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text,
  employee_id text,
  department text,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null unique,
  serial text not null unique,
  equipment text,
  device_name text not null,
  manufacturer text,
  model text,
  category text,
  location text,
  building text,
  room text,
  service_start_date date,
  asset_condition text,
  comments text,
  staff_device boolean not null default false,
  ownership public.asset_ownership,
  warranty_expiration_date date,
  obsolete boolean not null default false,
  status public.asset_status not null default 'available',
  notes text,
  constraint assets_tag_matches_serial check (asset_tag = serial),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id bigserial primary key,
  asset_id uuid not null references public.assets(id) on delete restrict,
  action public.transaction_action not null,
  assignee_person_id uuid references public.people(id) on delete set null,
  performed_by_user_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now(),
  notes text,
  due_date date
);

create table public.asset_current (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  assignee_person_id uuid references public.people(id) on delete set null,
  checked_out_at timestamptz,
  last_transaction_id bigint references public.transactions(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.damage_reports (
  id bigserial primary key,
  asset_id uuid not null references public.assets(id) on delete cascade,
  reported_by_user_id uuid not null references auth.users(id),
  status public.damage_status not null default 'open',
  summary text not null,
  notes text,
  related_transaction_id bigint references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.damage_photos (
  id bigserial primary key,
  damage_report_id bigint not null references public.damage_reports(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now(),
  unique(damage_report_id, storage_path)
);

create index idx_people_display_name on public.people using gin (display_name gin_trgm_ops);
create index idx_assets_search on public.assets (asset_tag, serial, equipment, device_name, manufacturer, model, category, location, building, room, asset_condition, status);
create index idx_transactions_asset_time on public.transactions(asset_id, occurred_at desc);
create index idx_damage_reports_asset_time on public.damage_reports(asset_id, created_at desc);
create index idx_damage_photos_report on public.damage_photos(damage_report_id);

create or replace function public.set_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_assets_updated_at
before update on public.assets
for each row execute function public.set_assets_updated_at();

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.require_role(allowed public.app_role[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = any(allowed)
  ) then
    raise exception 'Insufficient role';
  end if;
end;
$$;

create or replace function public.checkout_asset(
  p_asset_tag text,
  p_assignee_person_id uuid,
  p_due_date date default null,
  p_notes text default null
)
returns table(transaction_id bigint, asset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_tx_id bigint;
  v_assignee_name text;
  v_history_entry text;
begin
  perform public.require_role(array['admin'::public.app_role, 'tech'::public.app_role]);

  if p_assignee_person_id is null then
    raise exception 'Assignee is required for checkout';
  end if;

  select * into v_asset
  from public.assets
  where asset_tag = p_asset_tag
  for update;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  if v_asset.status <> 'available' then
    raise exception 'Asset % is not available (current status: %)', p_asset_tag, v_asset.status;
  end if;

  select display_name into v_assignee_name
  from public.people
  where id = p_assignee_person_id;

  if v_assignee_name is null then
    raise exception 'Assignee person not found';
  end if;

  insert into public.transactions (
    asset_id,
    action,
    assignee_person_id,
    performed_by_user_id,
    notes,
    due_date
  ) values (
    v_asset.id,
    'out',
    p_assignee_person_id,
    auth.uid(),
    p_notes,
    p_due_date
  )
  returning id into v_tx_id;

  v_history_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - OUT to ' || v_assignee_name || ' (tx ' || v_tx_id || ')';

  insert into public.asset_current (
    asset_id,
    assignee_person_id,
    checked_out_at,
    last_transaction_id,
    updated_at
  ) values (
    v_asset.id,
    p_assignee_person_id,
    now(),
    v_tx_id,
    now()
  )
  on conflict (asset_id)
  do update set
    assignee_person_id = excluded.assignee_person_id,
    checked_out_at = excluded.checked_out_at,
    last_transaction_id = excluded.last_transaction_id,
    updated_at = now();

  update public.assets
  set
    status = 'checked_out',
    comments = trim(both E'\n' from concat_ws(E'\n', comments, v_history_entry))
  where id = v_asset.id;

  return query select v_tx_id, v_asset.id;
end;
$$;

create or replace function public.checkin_asset(
  p_asset_tag text,
  p_notes text default null
)
returns table(transaction_id bigint, asset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_tx_id bigint;
  v_current_assignee_name text;
  v_history_entry text;
begin
  perform public.require_role(array['admin'::public.app_role, 'tech'::public.app_role]);

  select * into v_asset
  from public.assets
  where asset_tag = p_asset_tag
  for update;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  if v_asset.status <> 'checked_out' then
    raise exception 'Asset % is not checked out (current status: %)', p_asset_tag, v_asset.status;
  end if;

  select p.display_name into v_current_assignee_name
  from public.asset_current ac
  left join public.people p on p.id = ac.assignee_person_id
  where ac.asset_id = v_asset.id;

  insert into public.transactions (
    asset_id,
    action,
    assignee_person_id,
    performed_by_user_id,
    notes
  ) values (
    v_asset.id,
    'in',
    null,
    auth.uid(),
    p_notes
  )
  returning id into v_tx_id;

  v_history_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - IN from ' || coalesce(v_current_assignee_name, 'Unassigned') || ' (tx ' || v_tx_id || ')';

  insert into public.asset_current (
    asset_id,
    assignee_person_id,
    checked_out_at,
    last_transaction_id,
    updated_at
  ) values (
    v_asset.id,
    null,
    null,
    v_tx_id,
    now()
  )
  on conflict (asset_id)
  do update set
    assignee_person_id = null,
    checked_out_at = null,
    last_transaction_id = excluded.last_transaction_id,
    updated_at = now();

  update public.assets
  set
    status = 'available',
    comments = trim(both E'\n' from concat_ws(E'\n', comments, v_history_entry))
  where id = v_asset.id;

  return query select v_tx_id, v_asset.id;
end;
$$;

create or replace function public.admin_upsert_asset(
  p_id uuid default null,
  p_asset_tag text default null,
  p_serial text default null,
  p_equipment text default null,
  p_device_name text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_category text default null,
  p_location text default null,
  p_building text default null,
  p_room text default null,
  p_service_start_date date default null,
  p_asset_condition text default null,
  p_comments text default null,
  p_staff_device boolean default false,
  p_ownership public.asset_ownership default null,
  p_warranty_expiration_date date default null,
  p_obsolete boolean default false,
  p_status public.asset_status default 'available',
  p_notes text default null
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_tag_serial text;
begin
  perform public.require_role(array['admin'::public.app_role]);

  if p_status = 'checked_out' then
    raise exception 'Use checkout_asset RPC for checked_out status changes';
  end if;

  if p_asset_tag is not null and p_serial is not null and p_asset_tag <> p_serial then
    raise exception 'asset_tag and serial must be the same value';
  end if;

  if p_device_name is null then
    p_device_name := coalesce(p_equipment, p_model, coalesce(p_asset_tag, p_serial));
  end if;

  v_tag_serial := coalesce(p_asset_tag, p_serial);

  if p_id is null then
    if v_tag_serial is null then
      raise exception 'asset_tag (same as serial) is required for create';
    end if;

    insert into public.assets (
      asset_tag,
      serial,
      equipment,
      device_name,
      manufacturer,
      model,
      category,
      location,
      building,
      room,
      service_start_date,
      asset_condition,
      comments,
      staff_device,
      ownership,
      warranty_expiration_date,
      obsolete,
      status,
      notes
    ) values (
      v_tag_serial,
      v_tag_serial,
      p_equipment,
      p_device_name,
      p_manufacturer,
      p_model,
      p_category,
      p_location,
      p_building,
      p_room,
      p_service_start_date,
      p_asset_condition,
      p_comments,
      coalesce(p_staff_device, false),
      p_ownership,
      p_warranty_expiration_date,
      coalesce(p_obsolete, false),
      coalesce(p_status, 'available'),
      p_notes
    ) returning * into v_asset;
  else
    update public.assets
    set
      asset_tag = coalesce(v_tag_serial, asset_tag),
      serial = coalesce(v_tag_serial, serial),
      equipment = p_equipment,
      device_name = coalesce(p_device_name, device_name),
      manufacturer = p_manufacturer,
      model = p_model,
      category = p_category,
      location = p_location,
      building = p_building,
      room = p_room,
      service_start_date = p_service_start_date,
      asset_condition = p_asset_condition,
      comments = p_comments,
      staff_device = coalesce(p_staff_device, staff_device),
      ownership = p_ownership,
      warranty_expiration_date = p_warranty_expiration_date,
      obsolete = coalesce(p_obsolete, obsolete),
      status = coalesce(p_status, status),
      notes = p_notes
    where id = p_id
    returning * into v_asset;

    if not found then
      raise exception 'Asset not found';
    end if;
  end if;

  return v_asset;
end;
$$;

create or replace function public.admin_create_person(
  p_display_name text,
  p_email text default null,
  p_employee_id text default null,
  p_department text default null
)
returns public.people
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person public.people;
begin
  perform public.require_role(array['admin'::public.app_role]);

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display_name is required';
  end if;

  insert into public.people(
    display_name,
    email,
    employee_id,
    department,
    created_by_user_id
  ) values (
    trim(p_display_name),
    p_email,
    p_employee_id,
    p_department,
    auth.uid()
  )
  returning * into v_person;

  return v_person;
end;
$$;

create or replace function public.set_damage_report_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_by_user_id is null then
    new.reported_by_user_id = auth.uid();
  end if;

  if new.related_transaction_id is null then
    select t.id into new.related_transaction_id
    from public.transactions t
    where t.asset_id = new.asset_id
      and t.action = 'out'
    order by t.occurred_at desc
    limit 1;
  end if;

  return new;
end;
$$;

create trigger trg_damage_report_defaults
before insert on public.damage_reports
for each row execute function public.set_damage_report_defaults();

alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.assets enable row level security;
alter table public.transactions enable row level security;
alter table public.asset_current enable row level security;
alter table public.damage_reports enable row level security;
alter table public.damage_photos enable row level security;

create policy profiles_self_select on public.profiles
for select
using (auth.uid() = user_id);

create policy profiles_admin_read on public.profiles
for select
using (public.current_role() = 'admin');

create policy people_read_all on public.people
for select
using (auth.uid() is not null);

create policy people_admin_create on public.people
for insert
with check (public.current_role() = 'admin');

create policy people_admin_update on public.people
for update
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

create policy assets_read_all on public.assets
for select
using (auth.uid() is not null);

create policy transactions_read_all on public.transactions
for select
using (auth.uid() is not null);

create policy asset_current_read_all on public.asset_current
for select
using (auth.uid() is not null);

create policy damage_reports_read_all on public.damage_reports
for select
using (auth.uid() is not null);

create policy damage_reports_create_admin_tech on public.damage_reports
for insert
with check (public.current_role() in ('admin', 'tech'));

create policy damage_reports_update_admin_tech on public.damage_reports
for update
using (public.current_role() in ('admin', 'tech'))
with check (public.current_role() in ('admin', 'tech'));

create policy damage_photos_read_all on public.damage_photos
for select
using (auth.uid() is not null);

create policy damage_photos_create_admin_tech on public.damage_photos
for insert
with check (public.current_role() in ('admin', 'tech'));

create policy damage_photos_update_admin_tech on public.damage_photos
for update
using (public.current_role() in ('admin', 'tech'))
with check (public.current_role() in ('admin', 'tech'));

revoke all on table public.assets from authenticated;
revoke all on table public.transactions from authenticated;
revoke all on table public.asset_current from authenticated;
revoke all on table public.damage_reports from authenticated;
revoke all on table public.damage_photos from authenticated;
revoke all on table public.people from authenticated;
revoke all on table public.profiles from authenticated;

grant select on public.assets to authenticated;
grant select on public.transactions to authenticated;
grant select on public.asset_current to authenticated;
grant select, insert, update on public.damage_reports to authenticated;
grant select, insert, update on public.damage_photos to authenticated;
grant select, insert, update on public.people to authenticated;
grant select on public.profiles to authenticated;

grant execute on function public.checkout_asset(text, uuid, date, text) to authenticated;
grant execute on function public.checkin_asset(text, text) to authenticated;
grant execute on function public.admin_upsert_asset(uuid, text, text, text, text, text, text, text, text, text, date, text, text, boolean, public.asset_ownership, date, boolean, public.asset_status, text) to authenticated;
grant execute on function public.admin_create_person(text, text, text, text) to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.require_role(public.app_role[]) to authenticated;

insert into storage.buckets (id, name, public)
values ('asset-damage-photos', 'asset-damage-photos', false)
on conflict (id) do nothing;

create policy "damage photos read" on storage.objects
for select
using (
  bucket_id = 'asset-damage-photos'
  and auth.uid() is not null
);

create policy "damage photos write" on storage.objects
for insert
with check (
  bucket_id = 'asset-damage-photos'
  and public.current_role() in ('admin', 'tech')
);

create policy "damage photos update" on storage.objects
for update
using (
  bucket_id = 'asset-damage-photos'
  and public.current_role() in ('admin', 'tech')
)
with check (
  bucket_id = 'asset-damage-photos'
  and public.current_role() in ('admin', 'tech')
);
