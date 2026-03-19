alter table public.board_items
  add column if not exists sort_order double precision;

with ranked as (
  select
    id,
    row_number() over (
      partition by session_id
      order by created_at asc, id asc
    ) * 1024 as next_sort_order
  from public.board_items
  where sort_order is null
)
update public.board_items bi
set sort_order = ranked.next_sort_order
from ranked
where bi.id = ranked.id;

create index if not exists board_items_session_sort_order_idx
  on public.board_items (session_id, sort_order asc nulls last, created_at asc);
