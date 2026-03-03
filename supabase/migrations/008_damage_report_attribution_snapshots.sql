-- Snapshot assignee + technician identity on each damage report
alter table public.damage_reports
  add column if not exists assignee_person_id uuid references public.people(id) on delete set null,
  add column if not exists assignee_name text,
  add column if not exists reported_by_name text;

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

  if new.assignee_person_id is null and new.related_transaction_id is not null then
    select t.assignee_person_id into new.assignee_person_id
    from public.transactions t
    where t.id = new.related_transaction_id
    limit 1;
  end if;

  if new.assignee_person_id is null then
    select ac.assignee_person_id into new.assignee_person_id
    from public.asset_current ac
    where ac.asset_id = new.asset_id
    limit 1;
  end if;

  if new.assignee_name is null then
    if new.assignee_person_id is null then
      new.assignee_name = 'Unassigned';
    else
      select p.display_name into new.assignee_name
      from public.people p
      where p.id = new.assignee_person_id
      limit 1;
      if new.assignee_name is null then
        new.assignee_name = 'Unknown';
      end if;
    end if;
  end if;

  if new.reported_by_name is null then
    select p.display_name into new.reported_by_name
    from public.profiles p
    where p.user_id = new.reported_by_user_id
    limit 1;
    if new.reported_by_name is null then
      new.reported_by_name = 'Unknown';
    end if;
  end if;

  return new;
end;
$$;

-- Backfill older reports so history is immediately useful
update public.damage_reports dr
set
  assignee_person_id = coalesce(
    dr.assignee_person_id,
    (
      select t.assignee_person_id
      from public.transactions t
      where t.id = dr.related_transaction_id
      limit 1
    ),
    (
      select ac.assignee_person_id
      from public.asset_current ac
      where ac.asset_id = dr.asset_id
      limit 1
    )
  ),
  assignee_name = coalesce(
    dr.assignee_name,
    (
      select p.display_name
      from public.people p
      where p.id = coalesce(
        dr.assignee_person_id,
        (
          select t.assignee_person_id
          from public.transactions t
          where t.id = dr.related_transaction_id
          limit 1
        ),
        (
          select ac.assignee_person_id
          from public.asset_current ac
          where ac.asset_id = dr.asset_id
          limit 1
        )
      )
      limit 1
    ),
    'Unassigned'
  ),
  reported_by_name = coalesce(
    dr.reported_by_name,
    (
      select p.display_name
      from public.profiles p
      where p.user_id = dr.reported_by_user_id
      limit 1
    ),
    'Unknown'
  )
where dr.assignee_person_id is null
   or dr.assignee_name is null
   or dr.reported_by_name is null;
