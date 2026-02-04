-- Admin billing accounts + admin session report view

create table if not exists public.billing_accounts (
  user_id uuid primary key,
  balance_pln numeric not null default 0,
  total_paid_pln numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_accounts'
      and policyname = 'billing_accounts_read_own'
  ) then
    create policy billing_accounts_read_own
      on public.billing_accounts
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

create or replace view public.admin_session_report as
select
  s.user_id,
  au.email as user_email,
  s.id as session_id,
  s.name as session_name,
  s.created_at as session_created_at,
  coalesce(bi.board_items_count, 0) as board_items_count,
  (r.id is not null) as report_created,
  coalesce(r.updated_at > r.created_at, false) as report_updated,
  coalesce(s.tokens_in_total, 0) + coalesce(s.tokens_out_total, 0) as tokens_total,
  coalesce(ba.balance_pln, 0) as balance_pln,
  coalesce(ba.total_paid_pln, 0) as total_paid_pln
from public.sessions s
left join auth.users au on au.id = s.user_id
left join lateral (
  select count(*)::int as board_items_count
  from public.board_items bi
  where bi.session_id = s.id
) bi on true
left join public.reports r on r.session_id = s.id
left join public.billing_accounts ba on ba.user_id = s.user_id;
