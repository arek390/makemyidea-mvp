-- Align the default session creation price with the current product price.
-- Runtime code still reads public.pricing_rules dynamically; this only fixes
-- databases that still carry the original seed value.

insert into public.pricing_rules (action_key, price_grosze, is_active)
values ('session_create', 50, true)
on conflict (action_key) do nothing;

update public.pricing_rules
set price_grosze = 50,
    is_active = true,
    updated_at = now()
where action_key = 'session_create'
  and price_grosze = 200;

