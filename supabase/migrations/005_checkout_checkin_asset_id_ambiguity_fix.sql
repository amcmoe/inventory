-- Fix ambiguous asset_id references that can surface in some environments
-- during checkout/checkin RPC execution.

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
  perform public.require_role(array['admin'::public.app_role, 'tech'::public.app_role]);

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
