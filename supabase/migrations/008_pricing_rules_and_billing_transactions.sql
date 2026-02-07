-- Pricing rules and billing transactions for action-based billing

create table if not exists public.pricing_rules (
  action_key text primary key,
  price_grosze integer not null check (price_grosze >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action_key text not null,
  amount_grosze integer not null check (amount_grosze >= 0),
  reference_id text null,
  created_at timestamptz not null default now()
);

create index if not exists billing_transactions_user_id_idx
  on public.billing_transactions (user_id);

create index if not exists billing_transactions_action_key_idx
  on public.billing_transactions (action_key);

insert into public.pricing_rules (action_key, price_grosze, is_active)
values
  ('session_create', 200, true),
  ('session_item_add_or_edit', 50, true),
  ('report_generate', 500, true),
  ('report_update', 500, true)
on conflict (action_key) do nothing;

create or replace function public.charge_user_balance(
  p_user_id uuid,
  p_action_key text,
  p_reference_id text default null
)
returns table(
  balance_before_grosze bigint,
  balance_after_grosze bigint,
  amount_grosze integer
)
language plpgsql
security definer
as $$
declare
  price integer;
  current_balance numeric;
  current_grosze bigint;
  next_grosze bigint;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select price_grosze
    into price
  from public.pricing_rules
  where action_key = p_action_key
    and is_active = true;

  if price is null then
    raise exception 'PRICING_RULE_MISSING' using errcode = 'P0001';
  end if;

  insert into public.billing_accounts (user_id, balance_pln, total_paid_pln, created_at, updated_at)
  values (p_user_id, 0, 0, now(), now())
  on conflict (user_id) do nothing;

  select balance_pln
    into current_balance
  from public.billing_accounts
  where user_id = p_user_id
  for update;

  if current_balance is null then
    current_balance := 0;
  end if;

  current_grosze := round(current_balance * 100)::bigint;

  if current_grosze < price then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  next_grosze := current_grosze - price;

  update public.billing_accounts
    set balance_pln = (next_grosze::numeric / 100),
        updated_at = now()
  where user_id = p_user_id;

  insert into public.billing_transactions (
    user_id,
    action_key,
    amount_grosze,
    reference_id
  )
  values (
    p_user_id,
    p_action_key,
    price,
    p_reference_id
  );

  return query select current_grosze, next_grosze, price;
end;
$$;

revoke all on function public.charge_user_balance(uuid, text, text) from public;
