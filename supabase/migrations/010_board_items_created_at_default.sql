-- Ensure board_items.created_at defaults to now()

alter table public.board_items
  alter column created_at set default now();
