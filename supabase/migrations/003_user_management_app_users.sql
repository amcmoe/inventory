-- Admin app-user management helpers for User Management page

create or replace function public.admin_list_app_users()
returns table(
  user_id uuid,
  email text,
  role public.app_role,
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
  p_display_name text default null
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

  insert into public.profiles (user_id, role, display_name)
  values (
    v_user_id,
    coalesce(p_role, 'viewer'::public.app_role),
    nullif(btrim(p_display_name), '')
  )
  on conflict (user_id) do update
  set
    role = coalesce(p_role, public.profiles.role),
    display_name = coalesce(nullif(btrim(p_display_name), ''), public.profiles.display_name)
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.admin_list_app_users() to authenticated;
grant execute on function public.admin_upsert_profile_by_email(text, public.app_role, text) to authenticated;
