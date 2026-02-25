-- Rename assets.category to assets.equipment_type for existing databases
-- and refresh admin_upsert_asset RPC to use the new column/parameter name.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assets'
      and column_name = 'category'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assets'
      and column_name = 'equipment_type'
  ) then
    alter table public.assets rename column category to equipment_type;
  end if;
end $$;

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
      notes
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
