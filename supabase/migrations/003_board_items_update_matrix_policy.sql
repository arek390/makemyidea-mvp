alter table public.board_items enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'board_items'
      and policyname = 'board_items_update_matrix'
  ) then
    create policy board_items_update_matrix
      on public.board_items
      for update
      using (
        exists (
          select 1
          from public.user_sessions us
          where us.session_id = board_items.session_id
            and us.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.user_sessions us
          where us.session_id = board_items.session_id
            and us.user_id = auth.uid()
        )
      );
  end if;
end $$;
