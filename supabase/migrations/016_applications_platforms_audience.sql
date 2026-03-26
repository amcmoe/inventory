-- Applications module enhancements: platform chip-picker support + audience classification.

alter table public.applications
  add column if not exists platforms text[] not null default '{}'::text[];

alter table public.applications
  add column if not exists audience text not null default 'both';

with parsed as (
  select
    a.id,
    regexp_replace(lower(trim(token)), '[^a-z0-9]+', '', 'g') as token
  from public.applications a
  cross join lateral unnest(regexp_split_to_array(coalesce(a.platform, ''), '[;,|/]+')) as token
), normalized as (
  select
    id,
    case
      when token in ('win', 'windows') then 'windows'
      when token in ('mac', 'macos', 'osx') then 'macos'
      when token in ('chrome', 'chromeos') then 'chromeos'
      when token in ('ios', 'iphone') then 'ios'
      when token in ('ipad', 'ipados') then 'ipados'
      when token = 'android' then 'android'
      when token in ('web', 'browser', 'saas') then 'web'
      when token = 'linux' then 'linux'
      else null
    end as platform
  from parsed
), rolled as (
  select
    id,
    array_agg(distinct platform) filter (where platform is not null) as platforms
  from normalized
  group by id
)
update public.applications a
set platforms = coalesce(r.platforms, '{}'::text[])
from rolled r
where a.id = r.id
  and (a.platforms is null or cardinality(a.platforms) = 0)
  and nullif(trim(a.platform), '') is not null;

update public.applications
set audience = 'both'
where audience is null
   or audience not in ('staff', 'students', 'both');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'applications_audience_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_audience_check
      check (audience in ('staff', 'students', 'both'));
  end if;
end
$$;

create index if not exists idx_applications_platforms_gin on public.applications using gin (platforms);
create index if not exists idx_applications_audience on public.applications (audience);
