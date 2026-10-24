-- Optional performance migration for an existing M1 database. Safe to re-run.
-- No complaints, columns, existing indexes, RLS rules, or grants are changed.
create index if not exists issues_unresolved_location_idx
  on public.issues (category, latitude, longitude)
  where status <> 'resolved';
