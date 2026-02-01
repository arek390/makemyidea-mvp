alter table public.board_items enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'board_items'
      and policyname = 'board_items_update_label'
  ) then
    create policy board_items_update_label
      on public.board_items
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
