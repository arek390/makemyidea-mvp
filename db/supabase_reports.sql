-- Reports table for Supabase (Postgres)
-- If gen_random_uuid() is unavailable, enable extension:
-- create extension if not exists "pgcrypto";
-- Alternatively use uuid_generate_v4() if uuid-ossp is enabled.

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  summary_json jsonb,
  last_summary_text_hash text,
  source_updated_at bigint default 0
);

create unique index if not exists reports_session_id_unique on reports(session_id);

-- Optional: RLS example (adjust to your auth model)
-- alter table reports enable row level security;
-- create policy "reports_read_own" on reports
--   for select using (auth.uid() is not null);
-- create policy "reports_write_own" on reports
--   for insert with check (auth.uid() is not null);
-- create policy "reports_update_own" on reports
--   for update using (auth.uid() is not null);
