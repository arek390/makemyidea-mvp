-- Autopay payments table + apply_payment RPC

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'autopay',
  order_id text not null unique,
  amount_pln numeric(12,2) not null,
  amount_pln_grosze integer not null,
  status text not null default 'pending' check (status in ('pending','paid','failed','canceled')),
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists payments_status_idx on public.payments(status);

alter table public.payments enable row level security;

create policy select_own on public.payments
  for select
  using (auth.uid() = user_id);

create or replace function public.apply_payment(order_id_in text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount_pln numeric(12,2);
  v_status text;
begin
  select user_id, amount_pln, status
    into v_user_id, v_amount_pln, v_status
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

  insert into public.billing_accounts (user_id, balance_pln, total_paid_pln, updated_at)
  values (v_user_id, v_amount_pln, v_amount_pln, now())
  on conflict (user_id) do update
    set balance_pln = coalesce(public.billing_accounts.balance_pln, 0) + excluded.balance_pln,
        total_paid_pln = coalesce(public.billing_accounts.total_paid_pln, 0) + excluded.total_paid_pln,
        updated_at = now();
end;
$$;

revoke all on function public.apply_payment(text) from public;
grant execute on function public.apply_payment(text) to service_role;
