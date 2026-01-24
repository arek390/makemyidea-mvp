-- Supabase migration: saved engine sessions
-- Run this in the Supabase SQL editor or via migrations tooling.

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  title text,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, session_id)
);

alter table public.user_sessions enable row level security;

create policy "Users can read own sessions"
on public.user_sessions
for select
using (auth.uid() = user_id);

create policy "Users can insert own sessions"
on public.user_sessions
for insert
with check (auth.uid() = user_id);

create policy "Users can update own sessions"
on public.user_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own sessions"
on public.user_sessions
for delete
using (auth.uid() = user_id);
