-- Fix welcome balance grant after legacy RPC/runtime drift.
-- This migration is intentionally self-contained so it repairs environments
-- where 011 exists but 017 was not applied, or where the RPC has ambiguous
-- unqualified user_id references.

alter table public.pricing_rules
  add column if not exists welcome_balance_pln numeric(12,2);

alter table public.billing_accounts
  add column if not exists balance_pln_grosze bigint;

alter table public.billing_accounts
  add column if not exists balance_usd_cents bigint;

alter table public.billing_accounts
  add column if not exists welcome_granted boolean not null default false;

alter table public.billing_accounts
  alter column balance_pln_grosze set default 0;

alter table public.billing_accounts
  alter column balance_usd_cents set default 0;

update public.billing_accounts as ba
  set balance_pln_grosze = 0
where ba.balance_pln_grosze is null;

update public.billing_accounts as ba
  set balance_usd_cents = 0
where ba.balance_usd_cents is null;

-- Ensure welcome amount exists and is active. Current pricing uses
-- action_key='welcome_bonus' and price_grosze as the configured source.
-- The legacy welcome_balance_pln column is backfilled only for compatibility.
insert into public.pricing_rules (
  action_key,
  price_grosze,
  is_active,
  welcome_balance_pln
)
values (
  'welcome_bonus',
  800,
  true,
  coalesce(
    (select pr.welcome_balance_pln
     from public.pricing_rules as pr
     where pr.action_key in ('welcome_bonus', 'welcome')
       and pr.welcome_balance_pln is not null
     order by case when pr.action_key = 'welcome_bonus' then 0 else 1 end
     limit 1),
    (select round(pr.price_grosze::numeric / 100, 2)
     from public.pricing_rules as pr
     where pr.action_key = 'welcome_bonus'
     limit 1),
    8.00
  )
)
on conflict (action_key) do update
  set welcome_balance_pln = coalesce(
        public.pricing_rules.welcome_balance_pln,
        excluded.welcome_balance_pln
      ),
      is_active = true,
      updated_at = now();

-- Repair accounts that were granted by the legacy function into balance_pln,
-- but are empty in the current minor-unit balance.
update public.billing_accounts as ba
  set balance_pln_grosze = case
        when pr.action_key = 'welcome_bonus' then pr.price_grosze::bigint
        else coalesce(round(pr.welcome_balance_pln * 100)::bigint, pr.price_grosze::bigint)
      end,
      updated_at = now()
from public.pricing_rules as pr
where pr.action_key in ('welcome_bonus', 'welcome')
  and pr.is_active = true
  and (
    (pr.action_key = 'welcome_bonus' and coalesce(pr.price_grosze, 0) > 0)
    or coalesce(pr.welcome_balance_pln, 0) > 0
  )
  and ba.welcome_granted = true
  and coalesce(ba.balance_pln_grosze, 0) = 0
  and coalesce(ba.balance_pln, 0) >= case
    when pr.action_key = 'welcome_bonus' then pr.price_grosze::numeric / 100
    else coalesce(pr.welcome_balance_pln, pr.price_grosze::numeric / 100)
  end
  and not exists (
    select 1
    from public.pricing_rules as preferred
    where preferred.action_key = 'welcome_bonus'
      and preferred.is_active = true
      and pr.action_key <> 'welcome_bonus'
  );

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
  v_amount_minor bigint;
  v_current_minor bigint;
  v_next_minor bigint;
  v_already_granted boolean;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.billing_accounts as ba (
    user_id,
    balance_pln_grosze,
    balance_usd_cents,
    total_paid_pln,
    created_at,
    updated_at,
    welcome_granted
  )
  values (p_user_id, 0, 0, 0, now(), now(), false)
  on conflict on constraint billing_accounts_pkey do nothing;

  select coalesce(ba.balance_pln_grosze, 0), coalesce(ba.welcome_granted, false)
    into v_current_minor, v_already_granted
  from public.billing_accounts as ba
  where ba.user_id = p_user_id
  for update;

  if v_already_granted then
    return query select false, 0::bigint, coalesce(v_current_minor, 0);
    return;
  end if;

  select case
      when pr.action_key = 'welcome_bonus' then pr.price_grosze::bigint
      else coalesce(round(pr.welcome_balance_pln * 100)::bigint, pr.price_grosze::bigint)
    end
    into v_amount_minor
  from public.pricing_rules as pr
  where pr.action_key in ('welcome_bonus', 'welcome')
    and pr.is_active = true
  order by case when pr.action_key = 'welcome_bonus' then 0 else 1 end
  limit 1;

  if v_amount_minor is null or v_amount_minor <= 0 then
    return query select false, 0::bigint, coalesce(v_current_minor, 0);
    return;
  end if;

  v_next_minor := coalesce(v_current_minor, 0) + v_amount_minor;

  update public.billing_accounts as ba
    set balance_pln_grosze = v_next_minor,
        welcome_granted = true,
        updated_at = now()
  where ba.user_id = p_user_id
    and ba.welcome_granted = false;

  if not found then
    select coalesce(ba.balance_pln_grosze, 0)
      into v_current_minor
    from public.billing_accounts as ba
    where ba.user_id = p_user_id;

    return query select false, 0::bigint, coalesce(v_current_minor, 0);
    return;
  end if;

  return query select true, v_amount_minor, v_next_minor;
end;
$$;

revoke all on function public.grant_welcome_balance(uuid) from public;
grant execute on function public.grant_welcome_balance(uuid) to service_role;
