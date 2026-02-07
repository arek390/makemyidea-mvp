-- Welcome balance support

alter table public.pricing_rules
  add column if not exists welcome_balance_pln numeric(12,2);

alter table public.billing_accounts
  add column if not exists welcome_granted boolean not null default false;

create or replace function public.grant_welcome_balance(
  p_user_id uuid
)
returns table(
  amount_pln numeric,
  balance_after_pln numeric
)
language plpgsql
security definer
as $$
declare
  amount numeric;
  current_balance numeric;
  next_balance numeric;
  already_granted boolean;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.billing_accounts (
    user_id,
    balance_pln,
    total_paid_pln,
    created_at,
    updated_at,
    welcome_granted
  )
  values (p_user_id, 0, 0, now(), now(), false)
  on conflict (user_id) do nothing;

  select balance_pln, welcome_granted
    into current_balance, already_granted
  from public.billing_accounts
  where user_id = p_user_id
  for update;

  if already_granted then
    return query select 0::numeric, current_balance;
  end if;

  select welcome_balance_pln
    into amount
  from public.pricing_rules
  where action_key = 'welcome'
    and is_active = true;

  if amount is null or amount <= 0 then
    return query select 0::numeric, current_balance;
  end if;

  next_balance := current_balance + amount;

  update public.billing_accounts
    set balance_pln = next_balance,
        welcome_granted = true,
        updated_at = now()
  where user_id = p_user_id
    and welcome_granted = false;

  return query select amount, next_balance;
end;
$$;

revoke all on function public.grant_welcome_balance(uuid) from public;
