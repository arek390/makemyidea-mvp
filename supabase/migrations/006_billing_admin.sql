-- Admin billing balance adjustments + atomic increment RPC

create extension if not exists pgcrypto;

create table if not exists public.billing_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  target_user_id uuid not null,
  delta_pln numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  created_at timestamptz not null default now(),
  note text null,
  request_id text null
);

alter table public.billing_balance_adjustments enable row level security;

create or replace function public.admin_increment_balance(
  target_user uuid,
  delta_pln numeric,
  request_id text default null,
  admin_user uuid default null
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

  insert into public.billing_accounts (user_id, balance_pln, updated_at)
  values (target_user, 0, now())
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
    coalesce(admin_user, auth.uid()),
    target_user,
    delta_pln,
    current_balance,
    next_balance,
    request_id
  );

  return query select current_balance, next_balance;
end;
$$;

revoke all on function public.admin_increment_balance(uuid, numeric, text, uuid) from public;
