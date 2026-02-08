-- Dual-currency billing (PLN/USD) support

alter table public.pricing_rules
  add column if not exists price_cents integer;

-- TODO: populate price_cents for USD pricing once mapping is decided.

alter table public.billing_accounts
  add column if not exists balance_pln_grosze bigint;

alter table public.billing_accounts
  add column if not exists balance_usd_cents bigint;

alter table public.billing_accounts
  alter column balance_pln_grosze set default 0;

alter table public.billing_accounts
  alter column balance_usd_cents set default 0;

-- Backfill from legacy balance_pln if needed
update public.billing_accounts
  set balance_pln_grosze = round(balance_pln * 100)::bigint
where balance_pln_grosze is null
  and balance_pln is not null;

update public.billing_accounts
  set balance_usd_cents = 0
where balance_usd_cents is null;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  billing_currency text null,
  locale text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists billing_currency text;

alter table public.profiles
  add column if not exists locale text;

alter table public.profiles
  add column if not exists created_at timestamptz;

alter table public.profiles
  add column if not exists updated_at timestamptz;

alter table public.profiles enable row level security;

alter table public.billing_transactions
  add column if not exists currency text;

alter table public.billing_balance_adjustments
  add column if not exists currency text;

alter table public.billing_balance_adjustments
  add column if not exists delta_minor bigint;

alter table public.billing_balance_adjustments
  add column if not exists balance_before_minor bigint;

alter table public.billing_balance_adjustments
  add column if not exists balance_after_minor bigint;

create or replace function public.charge_user_balance(
  p_user_id uuid,
  p_action_key text,
  p_reference_id text default null,
  p_currency text default null
)
returns table(
  currency text,
  balance_before_minor bigint,
  balance_after_minor bigint,
  amount_minor integer
)
language plpgsql
security definer
as $$
declare
  billing_currency text;
  price_minor integer;
  current_minor bigint;
  next_minor bigint;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  billing_currency := upper(coalesce(
    p_currency,
    (select billing_currency from public.profiles where id = p_user_id)
  ));

  if billing_currency not in ('PLN', 'USD') then
    raise exception 'BILLING_CURRENCY_MISSING' using errcode = 'P0001';
  end if;

  if billing_currency = 'USD' then
    select pr.price_cents
      into price_minor
    from public.pricing_rules pr
    where pr.action_key = p_action_key
      and pr.is_active = true;
    if price_minor is null then
      raise exception 'PRICE_CENTS_MISSING' using errcode = 'P0001';
    end if;
  else
    select pr.price_grosze
      into price_minor
    from public.pricing_rules pr
    where pr.action_key = p_action_key
      and pr.is_active = true;
    if price_minor is null then
      raise exception 'PRICE_GROSZE_MISSING' using errcode = 'P0001';
    end if;
  end if;

  insert into public.billing_accounts (
    user_id,
    balance_pln_grosze,
    balance_usd_cents,
    total_paid_pln,
    created_at,
    updated_at
  )
  values (p_user_id, 0, 0, 0, now(), now())
  on conflict (user_id) do nothing;

  if billing_currency = 'USD' then
    select balance_usd_cents
      into current_minor
    from public.billing_accounts
    where user_id = p_user_id
    for update;
    if current_minor is null then
      current_minor := 0;
    end if;
    if current_minor < price_minor then
      raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
    end if;
    next_minor := current_minor - price_minor;
    update public.billing_accounts
      set balance_usd_cents = next_minor,
          updated_at = now()
    where user_id = p_user_id;
  else
    select balance_pln_grosze
      into current_minor
    from public.billing_accounts
    where user_id = p_user_id
    for update;
    if current_minor is null then
      current_minor := 0;
    end if;
    if current_minor < price_minor then
      raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
    end if;
    next_minor := current_minor - price_minor;
    update public.billing_accounts
      set balance_pln_grosze = next_minor,
          updated_at = now()
    where user_id = p_user_id;
  end if;

  insert into public.billing_transactions (
    user_id,
    action_key,
    amount_grosze,
    reference_id,
    currency
  )
  values (
    p_user_id,
    p_action_key,
    price_minor,
    p_reference_id,
    billing_currency
  );

  return query select billing_currency, current_minor, next_minor, price_minor;
end;
$$;

revoke all on function public.charge_user_balance(uuid, text, text, text) from public;

create or replace function public.apply_payment(order_id_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount_pln numeric(12,2);
  v_amount_grosze integer;
  v_status text;
begin
  select user_id, amount_pln, amount_pln_grosze, status
    into v_user_id, v_amount_pln, v_amount_grosze, v_status
  from public.payments
  where order_id = order_id_in
  for update;

  if not found then
    raise exception 'payment not found for order_id=%', order_id_in;
  end if;

  if v_status = 'paid' then
    return;
  end if;

  update public.payments
     set status = 'paid',
         paid_at = now(),
         updated_at = now()
   where order_id = order_id_in;

  insert into public.billing_accounts (
    user_id,
    balance_pln_grosze,
    balance_usd_cents,
    total_paid_pln,
    updated_at
  )
  values (v_user_id, v_amount_grosze, 0, v_amount_pln, now())
  on conflict (user_id) do update
    set balance_pln_grosze = coalesce(public.billing_accounts.balance_pln_grosze, 0) + excluded.balance_pln_grosze,
        total_paid_pln = coalesce(public.billing_accounts.total_paid_pln, 0) + excluded.total_paid_pln,
        updated_at = now();
end;
$$;

revoke all on function public.apply_payment(text) from public;
grant execute on function public.apply_payment(text) to service_role;
