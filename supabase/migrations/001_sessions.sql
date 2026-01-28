-- Sessions + state for coach engine (Supabase Postgres)

create table if not exists sessions (
  id text primary key,
  user_id text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_group_code text,
  last_mode_code integer,
  last_category_code text,
  stuck_counter integer not null default 0,
  tokens_in_total integer not null default 0,
  tokens_out_total integer not null default 0
);

create index if not exists sessions_user_id_idx on sessions (user_id);
create index if not exists sessions_updated_at_idx on sessions (updated_at desc);

create table if not exists session_state (
  session_id text primary key references sessions (id) on delete cascade,
  depth_level integer not null default 3,
  hard_streak integer not null default 0,
  last_question_id text,
  last_difficulty integer,
  asked_count integer not null default 0,
  current_group_code text,
  current_mode_code integer,
  recent_cells text,
  visit_counts text,
  cell_pointers text,
  updated_at timestamptz not null default now()
);

create index if not exists session_state_updated_at_idx on session_state (updated_at desc);

-- If you use anon keys + RLS, enable and add policies here.
-- alter table sessions enable row level security;
-- alter table session_state enable row level security;
