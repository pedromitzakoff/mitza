alter table public.data_sync_runs
  add column if not exists requested_since date,
  add column if not exists requested_until date;

create or replace function public.report_sync_coverage(p_source_ids uuid[], p_start date, p_end date)
returns table (source_id uuid, day date)
language sql stable set search_path = public
as $$
  select s.id, d.day::date
  from unnest(p_source_ids) as s(id)
  cross join generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as d(day)
  join lateral (
    select r.status from public.data_sync_runs r
    where r.import_source_id = s.id
      and r.requested_since <= d.day::date and r.requested_until >= d.day::date
      and r.started_at >= ((d.day + interval '1 day') at time zone 'America/Sao_Paulo')
      and r.finished_at is not null
    order by r.started_at desc, r.id desc
    limit 1
  ) latest on latest.status in ('success', 'empty');
$$;
revoke all on function public.report_sync_coverage(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.report_sync_coverage(uuid[], date, date) to service_role;
create index if not exists data_sync_runs_report_window_idx
  on public.data_sync_runs (import_source_id, started_at desc)
  where requested_since is not null and finished_at is not null;

