-- Fix admin_increment_balance signature and billing account bootstrap

create or replace function public.admin_increment_balance(
  admin_user uuid,
  target_user uuid,
  delta_pln numeric,
  request_id text default null
)
returns table(balance_before numeric, balance_after numeric)
language plpgsql
security definer
as $$
declare
  current_balance numeric;
  next_balance numeric;
begin
  if delta_pln is null or delta_pln <= 0 then
    raise exception 'delta_pln_must_be_positive' using errcode = '22023';
  end if;
  if delta_pln > 100000 then
    raise exception 'delta_pln_too_large' using errcode = '22023';
  end if;

  insert into public.billing_accounts (user_id, balance_pln, total_paid_pln, created_at, updated_at)
  values (target_user, 0, 0, now(), now())
  on conflict (user_id) do nothing;

  select balance_pln
    into current_balance
  from public.billing_accounts
  where user_id = target_user
  for update;

  if current_balance is null then
    current_balance := 0;
  end if;

  next_balance := current_balance + delta_pln;

  update public.billing_accounts
    set balance_pln = next_balance,
        updated_at = now()
  where user_id = target_user;

  insert into public.billing_balance_adjustments (
    admin_user_id,
    target_user_id,
    delta_pln,
    balance_before,
    balance_after,
    request_id
  )
  values (
    admin_user,
    target_user,
    delta_pln,
    current_balance,
    next_balance,
    request_id
  );

  return query select current_balance, next_balance;
end;
$$;

revoke all on function public.admin_increment_balance(uuid, uuid, numeric, text) from public;
