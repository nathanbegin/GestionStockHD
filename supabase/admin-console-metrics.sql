-- Run once in the project's SQL Editor. Only the server service role can call this function.
create or replace function public.admin_console_metrics()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database()),
  'databaseName', current_database(),
  'postgresVersion', version(),
  'connections', (select count(*) from pg_stat_activity where datname = current_database()),
  'activeConnections', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'),
  'maxConnections', current_setting('max_connections')::integer,
  'tables', (select coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'name', relname, 'estimatedRows', n_live_tup, 'deadRows', n_dead_tup, 'bytes', pg_total_relation_size(relid), 'lastVacuum', last_autovacuum, 'lastAnalyze', last_autoanalyze)), '[]'::jsonb) from pg_stat_user_tables),
  'storageObjects', (select count(*) from storage.objects),
  'storageBytes', (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0) from storage.objects),
  'storageObjectsMissingSize', (select count(*) from storage.objects where metadata->>'size' is null),
  'measuredAt', now()
);
$$;
revoke all on function public.admin_console_metrics() from public, anon, authenticated;
grant execute on function public.admin_console_metrics() to service_role;
