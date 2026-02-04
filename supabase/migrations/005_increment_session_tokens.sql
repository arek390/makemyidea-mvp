create or replace function public.increment_session_tokens(
  p_session_id text,
  p_tokens_in int,
  p_tokens_out int
) returns void
language sql
as $$
  update public.sessions
  set
    tokens_in_total = coalesce(tokens_in_total, 0) + coalesce(p_tokens_in, 0),
    tokens_out_total = coalesce(tokens_out_total, 0) + coalesce(p_tokens_out, 0)
  where id = p_session_id;
$$;
