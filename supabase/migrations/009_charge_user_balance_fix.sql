-- Fix charge_user_balance to handle grosze->PLN conversion and atomic update

create or replace function public.charge_user_balance(
  p_user_id uuid,
  p_action_key text,
  p_reference_id text default null
)
returns table(
  balance_before_pln numeric,
  balance_after_pln numeric,
  amount_pln numeric,
  amount_grosze integer
)
language plpgsql
security definer
as $$
declare
  price_grosze integer;
  price_pln numeric;
  next_balance numeric;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select pr.price_grosze
    into price_grosze
  from public.pricing_rules pr
  where pr.action_key = p_action_key
    and pr.is_active = true;

  if price_grosze is null then
    raise exception 'PRICING_RULE_MISSING' using errcode = 'P0001';
  end if;

  price_pln := price_grosze::numeric / 100;

  insert into public.billing_accounts (user_id, balance_pln, total_paid_pln, created_at, updated_at)
  values (p_user_id, 0, 0, now(), now())
  on conflict (user_id) do nothing;

  update public.billing_accounts
    set balance_pln = balance_pln - price_pln,
        total_paid_pln = coalesce(total_paid_pln, 0) + price_pln,
        updated_at = now()
  where user_id = p_user_id
    and balance_pln >= price_pln
  returning balance_pln into next_balance;

  if next_balance is null then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  insert into public.billing_transactions (
    user_id,
    action_key,
    amount_grosze,
    reference_id
  )
  values (
    p_user_id,
    p_action_key,
    price_grosze,
    p_reference_id
  );

  return query select next_balance + price_pln, next_balance, price_pln, price_grosze;
end;
$$;

revoke all on function public.charge_user_balance(uuid, text, text) from public;
