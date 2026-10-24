-- Run once in a NEW Supabase project's SQL Editor. No existing tables are dropped.
begin;

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  category text not null check (category in ('pothole', 'garbage', 'streetlight', 'water_leak')),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  severity integer not null check (severity between 1 and 5),
  status text not null default 'reported'
    check (status in ('reported', 'assigned', 'in_progress', 'resolved')),
  confirmations integer not null default 0 check (confirmations >= 0),
  -- Legacy initial snapshot. Express calculates current scores from live inputs.
  priority_score integer not null check (priority_score >= 0),
  created_at timestamptz not null default now()
);

create index issues_priority_idx on public.issues (priority_score desc, created_at desc, id);
create index issues_category_status_idx on public.issues (category, status);
create index issues_status_idx on public.issues (status);
create index issues_unresolved_location_idx on public.issues (category, latitude, longitude)
  where status <> 'resolved';

alter table public.issues enable row level security;

-- No RLS policies: direct browser users must never read or write this table.
-- Revoke table grants as an additional barrier, including signed-in browser users.
revoke all privileges on table public.issues from public, anon, authenticated;
grant select, insert on table public.issues to service_role;
-- Supabase's backend secret key uses service_role and bypasses RLS.

commit;
