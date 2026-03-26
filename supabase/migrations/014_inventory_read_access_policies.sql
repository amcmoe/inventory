-- Enforce inventory module view/edit access for inventory read policies.
-- Super User does not bypass this automatically.

drop policy if exists people_read_all on public.people;
create policy people_read_all on public.people
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists assets_read_all on public.assets;
create policy assets_read_all on public.assets
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists transactions_read_all on public.transactions;
create policy transactions_read_all on public.transactions
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists asset_current_read_all on public.asset_current;
create policy asset_current_read_all on public.asset_current
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists damage_reports_read_all on public.damage_reports;
create policy damage_reports_read_all on public.damage_reports
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists damage_photos_read_all on public.damage_photos;
create policy damage_photos_read_all on public.damage_photos
for select
using (
  public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

drop policy if exists "damage photos read" on storage.objects;
create policy "damage photos read" on storage.objects
for select
using (
  bucket_id = 'asset-damage-photos'
  and public.current_module_access('inventory') in ('view'::public.module_access, 'edit'::public.module_access)
);

