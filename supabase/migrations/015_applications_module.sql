-- Applications module MVP schema + RLS.

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text,
  owner_contact text,
  owner_person_id uuid references public.people(id) on delete set null,
  reference_url text,
  app_store_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'deprecated')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists idx_applications_name on public.applications (lower(name));
create index if not exists idx_applications_platform on public.applications (lower(platform));

create or replace function public.set_applications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by_user_id = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_applications_updated_at on public.applications;
create trigger trg_applications_updated_at
before update on public.applications
for each row execute function public.set_applications_updated_at();

alter table public.applications enable row level security;

drop policy if exists applications_read_access on public.applications;
create policy applications_read_access on public.applications
for select
using (
  public.current_module_access('applications') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists applications_insert_access on public.applications;
create policy applications_insert_access on public.applications
for insert
with check (
  public.current_module_access('applications') = 'edit'::public.module_access
);

drop policy if exists applications_update_access on public.applications;
create policy applications_update_access on public.applications
for update
using (
  public.current_module_access('applications') = 'edit'::public.module_access
)
with check (
  public.current_module_access('applications') = 'edit'::public.module_access
);

drop policy if exists applications_delete_access on public.applications;
create policy applications_delete_access on public.applications
for delete
using (
  public.current_module_access('applications') = 'edit'::public.module_access
);

revoke all on table public.applications from authenticated;
grant select, insert, update, delete on public.applications to authenticated;

