-- Fix Supabase advisor lint: RLS init plan + function search_path

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_sessions'
      and policyname = 'user_sessions_select_own'
  ) then
    execute 'alter policy user_sessions_select_own on public.user_sessions using ((select auth.uid()) = user_id)';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_sessions'
      and policyname = 'Users can read own sessions'
  ) then
    execute 'alter policy "Users can read own sessions" on public.user_sessions using ((select auth.uid()) = user_id)';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and p.pronargs = 0
  ) then
    execute 'alter function public.set_updated_at() set search_path = public';
  end if;
end $$;
