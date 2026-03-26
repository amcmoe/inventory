-- Flip backend authorization to module access for inventory operations.
-- Keep role=admin as Super User authority for permission administration.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'module_access'
      and n.nspname = 'public'
  ) then
    create type public.module_access as enum ('none', 'view', 'edit');
  end if;
end $$;

create or replace function public.is_super_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'::public.app_role
  );
$$;

create or replace function public.require_super_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_super_user() then
    raise exception 'Super user required';
  end if;
end;
$$;

create or replace function public.current_module_access(p_module text)
returns public.module_access
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text;
  v_access public.module_access;
begin
  if auth.uid() is null then
    return 'none'::public.module_access;
  end if;

  v_key := lower(btrim(coalesce(p_module, '')));

  select case
    when v_key = 'inventory' then coalesce(p.inventory_access, 'none'::public.module_access)
    when v_key = 'applications' then coalesce(p.applications_access, 'none'::public.module_access)
    when v_key = 'infrastructure' then coalesce(p.infrastructure_access, 'none'::public.module_access)
    else 'none'::public.module_access
  end
  into v_access
  from public.profiles p
  where p.user_id = auth.uid();

  return coalesce(v_access, 'none'::public.module_access);
end;
$$;

create or replace function public.require_module_access(
  p_module text,
  p_min_access public.module_access default 'view'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual public.module_access;
  v_req_rank int;
  v_actual_rank int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_actual := public.current_module_access(p_module);
  v_req_rank := case p_min_access
    when 'none'::public.module_access then 0
    when 'view'::public.module_access then 1
    else 2
  end;
  v_actual_rank := case v_actual
    when 'none'::public.module_access then 0
    when 'view'::public.module_access then 1
    else 2
  end;

  if v_actual_rank < v_req_rank then
    raise exception 'Insufficient % module access', coalesce(nullif(btrim(p_module), ''), 'unknown');
  end if;
end;
$$;

-- User/permission management remains Super User-only.
create or replace function public.admin_list_app_users()
returns table(
  user_id uuid,
  email text,
  role public.app_role,
  inventory_access public.module_access,
  applications_access public.module_access,
  infrastructure_access public.module_access,
  display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_super_user();

  return query
  select
    p.user_id,
    u.email::text,
    p.role,
    p.inventory_access,
    p.applications_access,
    p.infrastructure_access,
    p.display_name,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.user_id
  order by lower(u.email);
end;
$$;

create or replace function public.admin_upsert_profile_by_email(
  p_email text,
  p_role public.app_role,
  p_display_name text default null,
  p_inventory_access public.module_access default null,
  p_applications_access public.module_access default null,
  p_infrastructure_access public.module_access default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile public.profiles;
begin
  perform public.require_super_user();

  if p_email is null or btrim(p_email) = '' then
    raise exception 'Email is required';
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'No auth user found for email %. Have them sign in first.', p_email;
  end if;

  insert into public.profiles (
    user_id,
    role,
    display_name,
    inventory_access,
    applications_access,
    infrastructure_access
  )
  values (
    v_user_id,
    coalesce(p_role, 'viewer'::public.app_role),
    nullif(btrim(p_display_name), ''),
    coalesce(p_inventory_access, 'view'::public.module_access),
    coalesce(p_applications_access, 'none'::public.module_access),
    coalesce(p_infrastructure_access, 'none'::public.module_access)
  )
  on conflict (user_id) do update
  set
    role = coalesce(p_role, public.profiles.role),
    display_name = coalesce(nullif(btrim(p_display_name), ''), public.profiles.display_name),
    inventory_access = coalesce(p_inventory_access, public.profiles.inventory_access),
    applications_access = coalesce(p_applications_access, public.profiles.applications_access),
    infrastructure_access = coalesce(p_infrastructure_access, public.profiles.infrastructure_access)
  returning * into v_profile;

  return v_profile;
end;
$$;

-- Inventory write paths require inventory edit access.
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
  perform public.require_module_access('inventory', 'edit'::public.module_access);

  if p_assignee_person_id is null then
    raise exception 'Assignee is required for checkout';
  end if;

  select a.*
  into v_asset
  from public.assets a
  where a.asset_tag = p_asset_tag
  for update;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  if v_asset.status <> 'available' then
    raise exception 'Asset % is not available (current status: %)', p_asset_tag, v_asset.status;
  end if;

  select p.display_name
  into v_assignee_name
  from public.people p
  where p.id = p_assignee_person_id;

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
  returning public.transactions.id into v_tx_id;

  v_history_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - OUT to ' || v_assignee_name || ' (tx ' || v_tx_id || ')';

  update public.asset_current ac
  set
    assignee_person_id = p_assignee_person_id,
    checked_out_at = now(),
    last_transaction_id = v_tx_id,
    updated_at = now()
  where ac.asset_id = v_asset.id;

  if not found then
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
    );
  end if;

  update public.assets a
  set
    status = 'checked_out',
    comments = trim(both E'\n' from concat_ws(E'\n', a.comments, v_history_entry))
  where a.id = v_asset.id;

  return query select v_tx_id as transaction_id, v_asset.id as asset_id;
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
  perform public.require_module_access('inventory', 'edit'::public.module_access);

  select a.*
  into v_asset
  from public.assets a
  where a.asset_tag = p_asset_tag
  for update;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  if v_asset.status <> 'checked_out' then
    raise exception 'Asset % is not checked out (current status: %)', p_asset_tag, v_asset.status;
  end if;

  select p.display_name
  into v_current_assignee_name
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
  returning public.transactions.id into v_tx_id;

  v_history_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - IN from ' || coalesce(v_current_assignee_name, 'Unassigned') || ' (tx ' || v_tx_id || ')';

  update public.asset_current ac
  set
    assignee_person_id = null,
    checked_out_at = null,
    last_transaction_id = v_tx_id,
    updated_at = now()
  where ac.asset_id = v_asset.id;

  if not found then
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
    );
  end if;

  update public.assets a
  set
    status = 'available',
    comments = trim(both E'\n' from concat_ws(E'\n', a.comments, v_history_entry))
  where a.id = v_asset.id;

  return query select v_tx_id as transaction_id, v_asset.id as asset_id;
end;
$$;

create or replace function public.unassign_asset(
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
  v_next_status public.asset_status;
begin
  perform public.require_module_access('inventory', 'edit'::public.module_access);

  select a.*
  into v_asset
  from public.assets a
  where a.asset_tag = p_asset_tag
  for update;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  select p.display_name
  into v_current_assignee_name
  from public.asset_current ac
  left join public.people p on p.id = ac.assignee_person_id
  where ac.asset_id = v_asset.id;

  if v_current_assignee_name is null then
    raise exception 'Asset % is already unassigned', p_asset_tag;
  end if;

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
  returning public.transactions.id into v_tx_id;

  v_history_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - IN from ' || v_current_assignee_name || ' (tx ' || v_tx_id || ')';

  update public.asset_current ac
  set
    assignee_person_id = null,
    checked_out_at = null,
    last_transaction_id = v_tx_id,
    updated_at = now()
  where ac.asset_id = v_asset.id;

  if not found then
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
    );
  end if;

  v_next_status := case
    when v_asset.status = 'checked_out' then 'available'::public.asset_status
    else v_asset.status
  end;

  update public.assets a
  set
    status = v_next_status,
    comments = trim(both E'\n' from concat_ws(E'\n', a.comments, v_history_entry))
  where a.id = v_asset.id;

  return query select v_tx_id as transaction_id, v_asset.id as asset_id;
end;
$$;

create or replace function public.append_asset_note(
  p_asset_tag text,
  p_note text
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_actor text;
  v_entry text;
begin
  perform public.require_module_access('inventory', 'edit'::public.module_access);

  if p_asset_tag is null or btrim(p_asset_tag) = '' then
    raise exception 'Asset tag is required';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Note is required';
  end if;

  select coalesce(p.display_name, 'user ' || auth.uid()::text)
  into v_actor
  from public.profiles p
  where p.user_id = auth.uid();

  v_entry := to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - ' || coalesce(v_actor, 'Unknown') || ': ' || btrim(p_note);

  update public.assets a
  set notes = trim(both E'\n' from concat_ws(E'\n', a.notes, v_entry))
  where a.asset_tag = p_asset_tag
  returning a.* into v_asset;

  if not found then
    raise exception 'Asset not found for tag %', p_asset_tag;
  end if;

  return v_asset;
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
  p_equipment_type text default null,
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
  p_notes text default null,
  p_out_for_warranty_repair boolean default null
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
  perform public.require_module_access('inventory', 'edit'::public.module_access);

  if p_status = 'checked_out' then
    raise exception 'Use checkout_asset RPC for checked_out status changes';
  end if;

  if p_asset_tag is not null and p_serial is not null and p_asset_tag <> p_serial then
    raise exception 'asset_tag and serial must be the same value';
  end if;

  v_tag_serial := coalesce(p_asset_tag, p_serial);

  if p_id is null then
    if v_tag_serial is null or p_device_name is null then
      raise exception 'asset_tag (same as serial) and device_name are required for create';
    end if;

    insert into public.assets (
      asset_tag,
      serial,
      equipment,
      device_name,
      manufacturer,
      model,
      equipment_type,
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
      notes,
      out_for_warranty_repair
    ) values (
      v_tag_serial,
      v_tag_serial,
      p_equipment,
      p_device_name,
      p_manufacturer,
      p_model,
      p_equipment_type,
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
      p_notes,
      coalesce(p_out_for_warranty_repair, false)
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
      equipment_type = p_equipment_type,
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
      notes = p_notes,
      out_for_warranty_repair = case
        when coalesce(p_status, status) <> 'repair' then false
        when p_out_for_warranty_repair is null then out_for_warranty_repair
        else p_out_for_warranty_repair
      end
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
  perform public.require_module_access('inventory', 'edit'::public.module_access);

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
  perform public.require_super_user();

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

-- RLS/policy updates to inventory module access + super user.
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_self_select on public.profiles
for select
using (auth.uid() = user_id);
create policy profiles_admin_read on public.profiles
for select
using (public.is_super_user());

drop policy if exists damage_reports_create_admin_tech on public.damage_reports;
create policy damage_reports_create_admin_tech on public.damage_reports
for insert
with check (public.current_module_access('inventory') = 'edit'::public.module_access);

drop policy if exists damage_reports_update_admin_tech on public.damage_reports;
create policy damage_reports_update_admin_tech on public.damage_reports
for update
using (public.current_module_access('inventory') = 'edit'::public.module_access)
with check (public.current_module_access('inventory') = 'edit'::public.module_access);

drop policy if exists damage_photos_create_admin_tech on public.damage_photos;
create policy damage_photos_create_admin_tech on public.damage_photos
for insert
with check (public.current_module_access('inventory') = 'edit'::public.module_access);

drop policy if exists damage_photos_update_admin_tech on public.damage_photos;
create policy damage_photos_update_admin_tech on public.damage_photos
for update
using (public.current_module_access('inventory') = 'edit'::public.module_access)
with check (public.current_module_access('inventory') = 'edit'::public.module_access);

drop policy if exists site_settings_admin_update on public.site_settings;
create policy site_settings_admin_update on public.site_settings
for update
using (public.is_super_user())
with check (public.is_super_user());

drop policy if exists "damage photos write" on storage.objects;
create policy "damage photos write" on storage.objects
for insert
with check (
  bucket_id = 'asset-damage-photos'
  and public.current_module_access('inventory') = 'edit'::public.module_access
);

drop policy if exists "damage photos update" on storage.objects;
create policy "damage photos update" on storage.objects
for update
using (
  bucket_id = 'asset-damage-photos'
  and public.current_module_access('inventory') = 'edit'::public.module_access
)
with check (
  bucket_id = 'asset-damage-photos'
  and public.current_module_access('inventory') = 'edit'::public.module_access
);

grant execute on function public.is_super_user() to authenticated;
grant execute on function public.require_super_user() to authenticated;
grant execute on function public.current_module_access(text) to authenticated;
grant execute on function public.require_module_access(text, public.module_access) to authenticated;

grant execute on function public.checkout_asset(text, uuid, date, text) to authenticated;
grant execute on function public.checkin_asset(text, text) to authenticated;
grant execute on function public.unassign_asset(text, text) to authenticated;
grant execute on function public.append_asset_note(text, text) to authenticated;
grant execute on function public.admin_create_person(text, text, text, text) to authenticated;
grant execute on function public.admin_list_app_users() to authenticated;
grant execute on function public.admin_upsert_profile_by_email(
  text,
  public.app_role,
  text,
  public.module_access,
  public.module_access,
  public.module_access
) to authenticated;
grant execute on function public.admin_upsert_site_settings(text, text, jsonb) to authenticated;
grant execute on function public.admin_upsert_asset(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  boolean,
  public.asset_ownership,
  date,
  boolean,
  public.asset_status,
  text,
  boolean
) to authenticated;
