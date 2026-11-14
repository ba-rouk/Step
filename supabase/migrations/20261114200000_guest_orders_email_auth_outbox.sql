-- Guest-safe orders, verified customer identity, one-time email login codes and retryable email jobs.
-- Additive migration: keep legacy customer_id and order workflows intact.

alter table public.store_orders
  add column if not exists customer_email_normalized text,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists tracking_token text;

update public.store_orders set customer_email_normalized = lower(btrim(customer_email))
where customer_email is not null and customer_email_normalized is distinct from lower(btrim(customer_email));
update public.store_orders set user_id = customer_id where user_id is null and customer_id is not null;

create unique index if not exists store_orders_tracking_token_uidx on public.store_orders(tracking_token) where tracking_token is not null;
create index if not exists store_orders_customer_email_normalized_created_idx on public.store_orders(customer_email_normalized, created_at desc) where customer_email_normalized is not null;
create index if not exists store_orders_user_created_idx on public.store_orders(user_id, created_at desc) where user_id is not null;

alter table public.customer_profiles add column if not exists email_verified_at timestamptz;

create table if not exists public.login_codes (
  id uuid primary key default gen_random_uuid(), email text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'login' check (purpose in ('login','email_change')),
  user_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null, attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists login_codes_email_created_idx on public.login_codes(email, created_at desc);
alter table public.login_codes enable row level security;
revoke all on public.login_codes from public, anon, authenticated;
grant all on public.login_codes to service_role;

create table if not exists public.customer_email_verification_events (
  id uuid primary key default gen_random_uuid(), email_normalized text not null,
  event_type text not null check (event_type in ('code_requested','code_sent','code_send_failed','code_invalid','code_locked','code_expired','code_verified','email_changed','rate_limited')),
  user_id uuid references auth.users(id) on delete set null, ip_hash text, created_at timestamptz not null default now()
);
create index if not exists customer_email_verification_events_email_created_idx on public.customer_email_verification_events(email_normalized, created_at desc);
alter table public.customer_email_verification_events enable row level security;
revoke all on public.customer_email_verification_events from public, anon, authenticated;
grant all on public.customer_email_verification_events to service_role;

create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('order_confirmation','login_code')),
  recipient text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','dead')),
  attempts integer not null default 0 check (attempts >= 0), max_attempts integer not null default 6 check (max_attempts between 1 and 12),
  available_at timestamptz not null default now(), locked_at timestamptz, sent_at timestamptz,
  last_error text, created_at timestamptz not null default now()
);
create index if not exists email_jobs_pending_idx on public.email_jobs(status, available_at, created_at) where status in ('pending','failed');
alter table public.email_jobs enable row level security;
revoke all on public.email_jobs from public, anon, authenticated;
grant all on public.email_jobs to service_role;

create or replace function public.consume_step_login_code(p_email text, p_code_hash text, p_purpose text default 'login')
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_code public.login_codes%rowtype;
begin
  select * into v_code from public.login_codes where email = lower(btrim(p_email)) and purpose = p_purpose and consumed_at is null order by created_at desc limit 1 for update;
  if not found then return 'missing'; end if;
  if v_code.expires_at <= now() then update public.login_codes set consumed_at = now() where id = v_code.id; return 'expired'; end if;
  if v_code.attempts >= 5 then return 'locked'; end if;
  if v_code.code_hash <> p_code_hash then
    update public.login_codes set attempts = least(5, attempts + 1), consumed_at = case when attempts + 1 >= 5 then now() else consumed_at end where id = v_code.id;
    if v_code.attempts + 1 >= 5 then return 'locked'; end if;
    return 'invalid';
  end if;
  update public.login_codes set consumed_at = now() where id = v_code.id;
  return 'ok';
end; $$;
revoke all on function public.consume_step_login_code(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_step_login_code(text, text, text) to service_role;

drop policy if exists "Customers read orders by account or exact email" on public.store_orders;
create policy "Customers read verified customer orders" on public.store_orders for select to authenticated using (
  (
    (user_id = (select auth.uid()) or customer_id = (select auth.uid()))
    and (select private.current_verified_customer_email()) is not null
  )
  or (
    user_id is null and customer_id is null
    and customer_email_normalized is not null
    and customer_email_normalized = (select private.current_verified_customer_email())
  )
);
notify pgrst, 'reload schema';