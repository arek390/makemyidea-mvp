begin;

alter table public.session_ai_cost_events
  alter column event_type set default 'ai_usage';

alter table public.session_ai_cost_events
  alter column event_kind set default 'ai_response';

create or replace function public.sync_session_ai_cost_event_type()
returns trigger
language plpgsql
as $$
begin
  if new.event_type = 'ai_usage' and (new.event_kind is null or new.event_kind = '') then
    new.event_kind := 'ai_response';
  end if;

  if new.event_kind = 'ai_response' and (new.event_type is null or new.event_type = '') then
    new.event_type := 'ai_usage';
  end if;

  if new.event_type in ('report_generate', 'report_update', 'image_generate', 'image_regenerate')
     and (new.event_kind is null or new.event_kind = '') then
    new.event_kind := 'billing';
  end if;

  return new;
end;
$$;

commit;

