create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.openai_model_price_snapshots (
  id bigserial primary key,
  model text not null,
  modality text not null default 'text',
  input_price_per_1m_usd numeric(18,6),
  cached_input_price_per_1m_usd numeric(18,6),
  output_price_per_1m_usd numeric(18,6),
  source_url text not null,
  source_label text not null default 'openai_api_pricing',
  fetched_at timestamptz not null default now(),
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  is_active boolean not null default true,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists openai_model_price_snapshots_active_unique_idx
  on public.openai_model_price_snapshots (model, modality)
  where is_active = true;

create index if not exists openai_model_price_snapshots_model_active_idx
  on public.openai_model_price_snapshots (model, is_active);

create index if not exists openai_model_price_snapshots_effective_from_idx
  on public.openai_model_price_snapshots (effective_from desc);

drop trigger if exists set_openai_model_price_snapshots_updated_at on public.openai_model_price_snapshots;
create trigger set_openai_model_price_snapshots_updated_at
before update on public.openai_model_price_snapshots
for each row
execute function public.set_row_updated_at();

create table if not exists public.openai_model_price_sync_log (
  id bigserial primary key,
  sync_started_at timestamptz not null default now(),
  sync_finished_at timestamptz null,
  status text not null check (status in ('running', 'success', 'partial_success', 'failed')),
  source_url text not null,
  source_label text not null default 'openai_api_pricing',
  models_found_count integer not null default 0,
  models_updated_count integer not null default 0,
  models_inserted_count integer not null default 0,
  error_message text null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.session_ai_cost_events
  add column if not exists model text,
  add column if not exists modality text,
  add column if not exists tokens_cached_input integer not null default 0,
  add column if not exists price_input_per_1m_usd_used numeric(18,6),
  add column if not exists price_cached_input_per_1m_usd_used numeric(18,6),
  add column if not exists price_output_per_1m_usd_used numeric(18,6),
  add column if not exists pricing_snapshot_id bigint,
  add column if not exists pricing_source text,
  add column if not exists fx_usd_pln numeric(18,6);

alter table public.session_ai_cost_events
  drop constraint if exists session_ai_cost_events_pricing_snapshot_id_fkey;

alter table public.session_ai_cost_events
  add constraint session_ai_cost_events_pricing_snapshot_id_fkey
  foreign key (pricing_snapshot_id)
  references public.openai_model_price_snapshots (id)
  on delete set null;
