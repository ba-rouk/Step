-- Customer order identity, public tracking, email verification codes and durable email delivery.
create extension if not exists pgcrypto;

alter table public.store_orders
  add column if not exists customer_email_normalized text,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists tracking_token text;

update public.store_orders
set customer_email_normalized=lower(btrim(customer_email))
where customer_email is not null
  and customer_email_normalized is distinct from lower(btrim(customer_email));

update public.store_orders
set user_id=customer_id
where user_id is null and customer_id is not null;

update public.store_orders
set tracking_token=encode(gen_random_bytes(16),'hex')
where tracking_token is null;

alter table public.store_orders
  alter column tracking_token set default encode(gen_random_bytes(16),'hex'),
  alter column tracking_token set not null;

create unique index if not exists store_orders_tracking_token_uidx
  on public.store_orders(tracking_token);
create index if not exists store_orders_customer_email_normalized_idx
  on public.store_orders(customer_email_normalized,created_at desc)
  where customer_email_normalized is not null;
create index if not exists store_orders_user_id_created_idx
  on public.store_orders(user_id,created_at desc)
  where user_id is not null;

alter table public.store_orders drop constraint if exists store_orders_tracking_token_format_check;
alter table public.store_orders add constraint store_orders_tracking_token_format_check
  check (tracking_token ~ '^[0-9a-f]{32}$');

alter table public.customer_profiles
  add column if not exists email_verified_at timestamptz;

create table if not exists public.login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check(attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  ip_hash text,
  constraint login_codes_email_check check(email=lower(btrim(email)) and char_length(email) between 5 and 254)
);
create index if not exists login_codes_email_created_idx on public.login_codes(email,created_at desc);
alter table public.login_codes enable row level security;
revoke all on public.login_codes from public,anon,authenticated;

create table if not exists public.email_verification_events (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_events_email_created_idx
  on public.email_verification_events(email_normalized,created_at desc);
alter table public.email_verification_events enable row level security;
revoke all on public.email_verification_events from public,anon,authenticated;

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_pending_idx on public.email_outbox(next_attempt_at,created_at)
  where status in ('pending','failed');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public,anon,authenticated;

create or replace function public.claim_verified_guest_orders()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_email text; v_count integer;
begin
  select lower(btrim(email)) into v_email
  from auth.users
  where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  update public.store_orders
    set user_id=auth.uid(),customer_id=coalesce(customer_id,auth.uid())
  where user_id is null
    and customer_id is null
    and customer_email_normalized=v_email;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.claim_verified_guest_orders() from public,anon;
grant execute on function public.claim_verified_guest_orders() to authenticated;

-- The verified-email read policy remains constrained to the authenticated user's
-- own verified Auth email. Orders already assigned to another user are never claimable.
drop policy if exists "Customers read orders by account or exact email" on public.store_orders;
create policy "Customers read orders by account or exact email"
  on public.store_orders for select to authenticated
  using (
    user_id=(select auth.uid())
    or customer_id=(select auth.uid())
    or (
      customer_email_normalized is not null
      and customer_email_normalized=(
        select lower(btrim(u.email)) from auth.users u
        where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      )
    )
  );

notify pgrst,'reload schema';
