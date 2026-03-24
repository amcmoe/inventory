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
  perform public.require_role(array['admin'::public.app_role, 'tech'::public.app_role]);

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

grant execute on function public.unassign_asset(text, text) to authenticated;
