create table if not exists public.session_ai_cost_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  report_id uuid null references public.reports(id) on delete set null,
  user_id uuid null,
  event_kind text not null check (event_kind in ('ai_response', 'billing')),
  action_key text null,
  source_task text null,
  model_used text null,
  reference_id text null,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  usage_cost_usd numeric(12, 6) not null default 0,
  usage_cost_pln numeric(12, 6) not null default 0,
  billed_cost_grosze integer not null default 0,
  billed_currency text null check (billed_currency in ('PLN', 'USD'))
);

create index if not exists session_ai_cost_events_session_id_idx
  on public.session_ai_cost_events (session_id, created_at desc);

create index if not exists session_ai_cost_events_action_key_idx
  on public.session_ai_cost_events (action_key, created_at desc);

create index if not exists session_ai_cost_events_report_id_idx
  on public.session_ai_cost_events (report_id);

alter table public.session_ai_cost_events enable row level security;

create or replace view public.session_ai_cost_summary as
with base as (
  select
    s.user_id,
    au.email as user_email,
    s.id as session_id,
    s.name as session_name,
    s.created_at as session_created_at,
    coalesce(bi.board_items_count, 0) as board_items_count,
    (r.id is not null) as report_created,
    coalesce(r.updated_at > r.created_at, false) as report_updated,
    coalesce(ba.balance_pln_grosze, 0) as balance_pln_grosze,
    coalesce(ba.balance_usd_cents, 0) as balance_usd_cents,
    coalesce(p.billing_currency, 'PLN') as billing_currency,
    coalesce(ba.total_paid_pln, 0) as total_paid_pln
  from public.sessions s
  left join auth.users au on au.id = s.user_id
  left join lateral (
    select count(*)::int as board_items_count
    from public.board_items bi
    where bi.session_id = s.id
  ) bi on true
  left join public.reports r on r.session_id = s.id
  left join public.billing_accounts ba on ba.user_id = s.user_id
  left join public.profiles p on p.id = s.user_id
),
aggregated as (
  select
    e.session_id,
    coalesce(sum(e.tokens_input), 0)::bigint as tokens_input_total,
    coalesce(sum(e.tokens_output), 0)::bigint as tokens_output_total,
    coalesce(sum(e.tokens_input + e.tokens_output), 0)::bigint as tokens_total,
    coalesce(sum(e.usage_cost_usd), 0)::numeric(12, 6) as usage_cost_usd,
    coalesce(sum(e.usage_cost_pln), 0)::numeric(12, 6) as usage_cost_pln
  from public.session_ai_cost_events e
  group by e.session_id
),
last_image as (
  select distinct on (e.session_id)
    e.session_id,
    e.billed_cost_grosze as last_image_cost_minor,
    e.billed_currency as last_image_cost_currency,
    e.created_at as last_image_cost_at
  from public.session_ai_cost_events e
  where e.event_kind = 'billing'
    and e.action_key in ('image_generate', 'image_regenerate')
  order by e.session_id, e.created_at desc
),
last_report_update as (
  select distinct on (e.session_id)
    e.session_id,
    e.billed_cost_grosze as last_report_update_cost_minor,
    e.billed_currency as last_report_update_cost_currency,
    e.created_at as last_report_update_cost_at
  from public.session_ai_cost_events e
  where e.event_kind = 'billing'
    and e.action_key = 'report_update'
  order by e.session_id, e.created_at desc
),
last_report_generate as (
  select distinct on (e.session_id)
    e.session_id,
    e.billed_cost_grosze as last_report_generate_cost_minor,
    e.billed_currency as last_report_generate_cost_currency,
    e.created_at as last_report_generate_cost_at
  from public.session_ai_cost_events e
  where e.event_kind = 'billing'
    and e.action_key = 'report_generate'
  order by e.session_id, e.created_at desc
),
total_billed as (
  select
    b.session_id,
    coalesce(
      sum(e.billed_cost_grosze) filter (
        where e.event_kind = 'billing'
          and e.billed_currency = b.billing_currency
      ),
      0
    )::bigint as total_cost_session_minor
  from base b
  left join public.session_ai_cost_events e
    on e.session_id = b.session_id
  group by b.session_id, b.billing_currency
)
select
  b.user_id,
  b.user_email,
  b.session_id,
  b.session_name,
  b.session_created_at,
  b.board_items_count,
  b.report_created,
  b.report_updated,
  b.balance_pln_grosze,
  b.balance_usd_cents,
  b.billing_currency,
  b.total_paid_pln,
  coalesce(a.tokens_input_total, 0) as tokens_input_total,
  coalesce(a.tokens_output_total, 0) as tokens_output_total,
  coalesce(a.tokens_total, 0) as tokens_total,
  coalesce(a.usage_cost_usd, 0) as usage_cost_usd,
  coalesce(a.usage_cost_pln, 0) as usage_cost_pln,
  coalesce(tb.total_cost_session_minor, 0) as total_cost_session_minor,
  li.last_image_cost_minor,
  li.last_image_cost_currency,
  li.last_image_cost_at,
  lru.last_report_update_cost_minor,
  lru.last_report_update_cost_currency,
  lru.last_report_update_cost_at,
  lrg.last_report_generate_cost_minor,
  lrg.last_report_generate_cost_currency,
  lrg.last_report_generate_cost_at
from base b
left join aggregated a on a.session_id = b.session_id
left join total_billed tb on tb.session_id = b.session_id
left join last_image li on li.session_id = b.session_id
left join last_report_update lru on lru.session_id = b.session_id
left join last_report_generate lrg on lrg.session_id = b.session_id;
