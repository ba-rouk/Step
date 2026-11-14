-- Anonymous orders are inserted by submit-store-order using the service role.
-- Direct anon table writes are revoked so callers cannot bypass API/Edge validation.
drop policy if exists "Guests can place Step Town orders" on public.store_orders;
revoke insert on public.store_orders from anon;

create table if not exists public.step_order_rate_limits (
  bucket_key text primary key,
  hit_count integer not null default 0 check (hit_count >= 0),
  window_started_at timestamptz not null default now()
);
alter table public.step_order_rate_limits enable row level security;
revoke all on public.step_order_rate_limits from public, anon, authenticated;

create or replace function public.consume_step_order_rate_limit(
  p_bucket_key text,
  p_max_hits integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_bucket_key is null or length(p_bucket_key) < 8 or length(p_bucket_key) > 180
     or p_max_hits < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.step_order_rate_limits(bucket_key, hit_count, window_started_at)
  values (p_bucket_key, 1, now())
  on conflict (bucket_key) do update
    set hit_count = case
          when public.step_order_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
          else public.step_order_rate_limits.hit_count + 1
        end,
        window_started_at = case
          when public.step_order_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
          else public.step_order_rate_limits.window_started_at
        end
  returning hit_count into v_count;

  return v_count <= p_max_hits;
end;
$$;

revoke all on function public.consume_step_order_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_step_order_rate_limit(text, integer, integer) to service_role;

create index if not exists step_order_rate_limits_window_idx
  on public.step_order_rate_limits(window_started_at);

notify pgrst, 'reload schema';
