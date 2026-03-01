-- Allow tech/admin to append timestamped notes without full asset upsert.

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
  perform public.require_role(array['admin'::public.app_role, 'tech'::public.app_role]);

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

grant execute on function public.append_asset_note(text, text) to authenticated;

