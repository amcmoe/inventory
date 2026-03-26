-- Add module-level access controls for inventory, applications, and infrastructure.

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

alter table public.profiles
  add column if not exists inventory_access public.module_access not null default 'view',
  add column if not exists applications_access public.module_access not null default 'none',
  add column if not exists infrastructure_access public.module_access not null default 'none';

-- Preserve current inventory power levels from global role.
update public.profiles
set inventory_access = case
  when role in ('admin', 'tech') then 'edit'::public.module_access
  else 'view'::public.module_access
end;

-- Existing functions must be dropped before changing OUT columns/signatures.
drop function if exists public.admin_list_app_users();
drop function if exists public.admin_upsert_profile_by_email(text, public.app_role, text);
drop function if exists public.admin_upsert_profile_by_email(
  text,
  public.app_role,
  text,
  public.module_access,
  public.module_access,
  public.module_access
);

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
  perform public.require_role(array['admin'::public.app_role]);

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
  perform public.require_role(array['admin'::public.app_role]);

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

grant execute on function public.admin_list_app_users() to authenticated;
grant execute on function public.admin_upsert_profile_by_email(
  text,
  public.app_role,
  text,
  public.module_access,
  public.module_access,
  public.module_access
) to authenticated;
