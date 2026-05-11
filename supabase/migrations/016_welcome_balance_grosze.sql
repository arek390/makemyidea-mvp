-- Align welcome balance with the current PLN-only minor-unit billing model.
-- The configurable source remains pricing_rules.welcome_balance_pln (major PLN),
-- but grants are stored only in billing_accounts.balance_pln_grosze.

alter table public.billing_accounts
  add column if not exists welcome_granted boolean not null default false;

update public.billing_accounts
  set balance_pln_grosze = 0
where balance_pln_grosze is null;

-- Conservative repair for accounts that received the legacy welcome grant after
-- balance_pln_grosze became the runtime balance. Only fix accounts where the
-- current minor-unit balance is empty, to avoid restoring already-spent funds.
update public.billing_accounts ba
  set balance_pln_grosze = round(pr.welcome_balance_pln * 100)::bigint,
      updated_at = now()
from public.pricing_rules pr
where pr.action_key = 'welcome'
  and pr.is_active = true
  and coalesce(pr.welcome_balance_pln, 0) > 0
  and ba.welcome_granted = true
  and coalesce(ba.balance_pln_grosze, 0) = 0
  and coalesce(ba.balance_pln, 0) >= pr.welcome_balance_pln;

drop function if exists public.grant_welcome_balance(uuid);

create or replace function public.grant_welcome_balance(
  p_user_id uuid
)
returns table(
  granted boolean,
  amount_pln_grosze bigint,
  balance_after_pln_grosze bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  amount_minor bigint;
  current_minor bigint;
  next_minor bigint;
  already_granted boolean;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.billing_accounts (
    user_id,
    balance_pln_grosze,
    balance_usd_cents,
    total_paid_pln,
    created_at,
    updated_at,
    welcome_granted
  )
  values (p_user_id, 0, 0, 0, now(), now(), false)
  on conflict (user_id) do nothing;

  select coalesce(balance_pln_grosze, 0), welcome_granted
    into current_minor, already_granted
  from public.billing_accounts
  where user_id = p_user_id
  for update;

  if already_granted then
    return query select false, 0::bigint, coalesce(current_minor, 0);
    return;
  end if;

  select round(welcome_balance_pln * 100)::bigint
    into amount_minor
  from public.pricing_rules
  where action_key = 'welcome'
    and is_active = true
  limit 1;

  if amount_minor is null or amount_minor <= 0 then
    return query select false, 0::bigint, coalesce(current_minor, 0);
    return;
  end if;

  next_minor := coalesce(current_minor, 0) + amount_minor;

  update public.billing_accounts
    set balance_pln_grosze = next_minor,
        welcome_granted = true,
        updated_at = now()
  where user_id = p_user_id
    and welcome_granted = false;

  if not found then
    select coalesce(balance_pln_grosze, 0)
      into current_minor
    from public.billing_accounts
    where user_id = p_user_id;

    return query select false, 0::bigint, coalesce(current_minor, 0);
    return;
  end if;

  return query select true, amount_minor, next_minor;
end;
$$;

revoke all on function public.grant_welcome_balance(uuid) from public;
grant execute on function public.grant_welcome_balance(uuid) to service_role;
