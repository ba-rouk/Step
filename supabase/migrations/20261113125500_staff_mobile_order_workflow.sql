
create schema if not exists private;

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null unique,
  phone text,
  role text not null check (role in ('manager','accountant','cashier')),
  reports_to uuid references public.staff_profiles(id) on delete restrict,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint staff_profiles_reports_to_check check (
    (role = 'manager' and reports_to is null) or
    (role in ('accountant','cashier') and reports_to is not null)
  )
);
create unique index if not exists staff_profiles_one_active_manager on public.staff_profiles(role) where role='manager' and is_active=true;
create index if not exists staff_profiles_role_active_idx on public.staff_profiles(role,is_active);
create index if not exists staff_profiles_reports_to_idx on public.staff_profiles(reports_to);

create or replace function private.staff_has_role(allowed_roles text[])
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id=(select auth.uid()) and sp.is_active=true and sp.role=any(allowed_roles)
  );
$$;
revoke all on function private.staff_has_role(text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.staff_has_role(text[]) to authenticated, service_role;

create or replace function private.enforce_staff_hierarchy()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare parent_role text; parent_active boolean;
begin
  if new.role='manager' then
    if new.reports_to is not null then raise exception 'A Manager cannot report to another staff member'; end if;
    return new;
  end if;
  select role,is_active into parent_role,parent_active from public.staff_profiles where id=new.reports_to;
  if not found or parent_active is distinct from true then raise exception 'The reporting staff member must exist and be active'; end if;
  if new.role='accountant' and parent_role<>'manager' then raise exception 'An Accountant must report to a Manager'; end if;
  if new.role='cashier' and parent_role<>'accountant' then raise exception 'A Cashier must report to an Accountant'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_staff_hierarchy() from public, anon, authenticated;
drop trigger if exists staff_profiles_hierarchy_guard on public.staff_profiles;
create trigger staff_profiles_hierarchy_guard before insert or update of role,reports_to,is_active
on public.staff_profiles for each row execute function private.enforce_staff_hierarchy();

alter table public.store_products
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists is_visible boolean not null default true,
  add column if not exists has_stock boolean not null default true,
  add column if not exists stock_quantity integer,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.store_orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null,
  add column if not exists order_number text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
create sequence if not exists public.store_order_number_seq start with 1042;
update public.store_orders set order_number='ST-'||lpad(nextval('public.store_order_number_seq')::text,4,'0') where order_number is null;
alter table public.store_orders alter column order_number set default ('ST-'||lpad(nextval('public.store_order_number_seq')::text,4,'0'));
alter table public.store_orders alter column order_number set not null;
create unique index if not exists store_orders_order_number_uidx on public.store_orders(order_number);
create index if not exists store_orders_status_created_idx on public.store_orders(status,created_at desc);
create index if not exists store_orders_customer_idx on public.store_orders(customer_id);
alter table public.store_orders drop constraint if exists store_orders_status_check;
alter table public.store_orders add constraint store_orders_status_check check (status in ('new','confirmed','preparing','ready','completed','cancelled'));

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.store_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  method text not null check (method in ('cash','mobile_money')),
  amount numeric(12,2) not null check (amount>0),
  reference text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  notes text
);
create index if not exists store_order_payments_order_idx on public.store_order_payments(order_id,recorded_at desc);
create table if not exists public.store_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null, old_status text, new_status text, description text,
  created_at timestamptz not null default now()
);
create index if not exists store_order_events_order_idx on public.store_order_events(order_id,created_at desc);

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  title text,
  category text not null check (category in ('catering','barbecue','cakes','staff')),
  image_url text not null, alt_text text, caption text,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists gallery_items_category_sort_idx on public.gallery_items(category,sort_order,created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth_key text not null,
  user_agent text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text, action text not null, entity_type text not null, entity_id text,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id,created_at desc);

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path=pg_catalog
as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function private.touch_updated_at() from public,anon,authenticated;
drop trigger if exists store_products_touch_updated_at on public.store_products;
create trigger store_products_touch_updated_at before update on public.store_products for each row execute function private.touch_updated_at();
drop trigger if exists store_orders_touch_updated_at on public.store_orders;
create trigger store_orders_touch_updated_at before update on public.store_orders for each row execute function private.touch_updated_at();
drop trigger if exists customer_profiles_touch_updated_at on public.customer_profiles;
create trigger customer_profiles_touch_updated_at before update on public.customer_profiles for each row execute function private.touch_updated_at();
drop trigger if exists gallery_items_touch_updated_at on public.gallery_items;
create trigger gallery_items_touch_updated_at before update on public.gallery_items for each row execute function private.touch_updated_at();

create or replace function private.log_store_order_event()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
begin
  if tg_op='INSERT' then
    insert into public.store_order_events(order_id,actor_id,event_type,new_status,description)
    values(new.id,auth.uid(),'order_created',new.status,'Customer order received');
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'order_created','store_order',new.id::text,jsonb_build_object('order_number',new.order_number,'status',new.status));
    return new;
  end if;
  if old.status is distinct from new.status then
    insert into public.store_order_events(order_id,actor_id,event_type,old_status,new_status,description)
    values(new.id,auth.uid(),'status_changed',old.status,new.status,'Order status changed');
    insert into public.audit_log(actor_id,actor_role,action,entity_type,entity_id,details)
    values(auth.uid(),(select role from public.staff_profiles where user_id=auth.uid() and is_active=true limit 1),
      'order_status_changed','store_order',new.id::text,
      jsonb_build_object('order_number',new.order_number,'old_status',old.status,'new_status',new.status));
  end if;
  return new;
end;
$$;
revoke all on function private.log_store_order_event() from public,anon,authenticated;
drop trigger if exists store_orders_log_events on public.store_orders;
create trigger store_orders_log_events after insert or update of status on public.store_orders for each row execute function private.log_store_order_event();

drop policy if exists "Public visitors can submit store orders" on public.store_orders;
drop policy if exists "Customers can place their own store orders" on public.store_orders;
drop policy if exists "Customers and staff can view allowed store orders" on public.store_orders;
drop policy if exists "Staff can update store orders" on public.store_orders;
create policy "Customers can place their own store orders" on public.store_orders for insert to authenticated
with check(customer_id=(select auth.uid()) and status='new' and acknowledged_at is null and escalated_at is null);
create policy "Customers and staff can view allowed store orders" on public.store_orders for select to authenticated
using(customer_id=(select auth.uid()) or private.staff_has_role(array['manager','accountant','cashier']));
create policy "Staff can update store orders" on public.store_orders for update to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']))
with check(private.staff_has_role(array['manager','accountant','cashier']));

drop policy if exists "Public visitors can read available store products" on public.store_products;
create policy "Public visitors can read available store products" on public.store_products for select to anon,authenticated
using(is_available=true and is_visible=true and has_stock=true);
create policy "Staff can view all products" on public.store_products for select to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']));
create policy "Accountants and Managers manage products" on public.store_products for all to authenticated
using(private.staff_has_role(array['manager','accountant']))
with check(private.staff_has_role(array['manager','accountant']));

drop policy if exists "Public visitors can read active store categories" on public.store_categories;
create policy "Public visitors can read active store categories" on public.store_categories for select to anon,authenticated using(is_active=true);
create policy "Staff can view all categories" on public.store_categories for select to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']));
create policy "Accountants and Managers manage categories" on public.store_categories for all to authenticated
using(private.staff_has_role(array['manager','accountant']))
with check(private.staff_has_role(array['manager','accountant']));

alter table public.staff_profiles enable row level security;
drop policy if exists "Staff can view own profile and permitted team" on public.staff_profiles;
create policy "Staff can view own profile and permitted team" on public.staff_profiles for select to authenticated
using(user_id=(select auth.uid()) or private.staff_has_role(array['manager']) or
  (private.staff_has_role(array['accountant']) and role='cashier'));

alter table public.customer_profiles enable row level security;
drop policy if exists "Customers manage their own profile" on public.customer_profiles;
create policy "Customers manage their own profile" on public.customer_profiles for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

alter table public.store_order_payments enable row level security;
drop policy if exists "Staff can view order payments" on public.store_order_payments;
drop policy if exists "Cashier and supervisors can record payments" on public.store_order_payments;
create policy "Staff can view order payments" on public.store_order_payments for select to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']));
create policy "Cashier and supervisors can record payments" on public.store_order_payments for insert to authenticated
with check(recorded_by=(select auth.uid()) and private.staff_has_role(array['manager','accountant','cashier']));

alter table public.store_order_events enable row level security;
drop policy if exists "Customers and staff can view order events" on public.store_order_events;
drop policy if exists "Staff can write order events" on public.store_order_events;
create policy "Customers and staff can view order events" on public.store_order_events for select to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']) or exists(
  select 1 from public.store_orders so where so.id=order_id and so.customer_id=(select auth.uid())
));
create policy "Staff can write order events" on public.store_order_events for insert to authenticated
with check(actor_id=(select auth.uid()) and private.staff_has_role(array['manager','accountant','cashier']));

alter table public.gallery_items enable row level security;
drop policy if exists "Visitors can view published gallery images" on public.gallery_items;
drop policy if exists "Staff can view all gallery images" on public.gallery_items;
drop policy if exists "Accountants and Managers manage gallery" on public.gallery_items;
create policy "Visitors can view published gallery images" on public.gallery_items for select to anon,authenticated using(is_published=true);
create policy "Staff can view all gallery images" on public.gallery_items for select to authenticated
using(private.staff_has_role(array['manager','accountant']));
create policy "Accountants and Managers manage gallery" on public.gallery_items for all to authenticated
using(private.staff_has_role(array['manager','accountant']))
with check(private.staff_has_role(array['manager','accountant']));

alter table public.push_subscriptions enable row level security;
drop policy if exists "Staff manage their own push subscriptions" on public.push_subscriptions;
create policy "Staff manage their own push subscriptions" on public.push_subscriptions for all to authenticated
using(user_id=(select auth.uid()) and private.staff_has_role(array['manager','accountant','cashier']))
with check(user_id=(select auth.uid()) and private.staff_has_role(array['manager','accountant','cashier']));

alter table public.audit_log enable row level security;
drop policy if exists "Manager reads complete audit log" on public.audit_log;
drop policy if exists "Accountant reads cashier activity" on public.audit_log;
drop policy if exists "Staff insert own audit entries" on public.audit_log;
create policy "Manager reads complete audit log" on public.audit_log for select to authenticated
using(private.staff_has_role(array['manager']));
create policy "Accountant reads cashier activity" on public.audit_log for select to authenticated
using(private.staff_has_role(array['accountant']) and actor_id in(select user_id from public.staff_profiles where role='cashier'));
create policy "Staff insert own audit entries" on public.audit_log for insert to authenticated
with check(actor_id=(select auth.uid()) and private.staff_has_role(array['manager','accountant','cashier']));

drop policy if exists "Staff read enquiries" on public.enquiries;
drop policy if exists "Staff update enquiries" on public.enquiries;
create policy "Staff read enquiries" on public.enquiries for select to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']));
create policy "Staff update enquiries" on public.enquiries for update to authenticated
using(private.staff_has_role(array['manager','accountant','cashier']))
with check(private.staff_has_role(array['manager','accountant','cashier']));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('step-town-media','step-town-media',true,8388608,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do update set public=true,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/avif'];
drop policy if exists "Public read Step Town media" on storage.objects;
drop policy if exists "Accountants and Managers upload Step Town media" on storage.objects;
drop policy if exists "Accountants and Managers update Step Town media" on storage.objects;
drop policy if exists "Accountants and Managers delete Step Town media" on storage.objects;
create policy "Public read Step Town media" on storage.objects for select to anon,authenticated using(bucket_id='step-town-media');
create policy "Accountants and Managers upload Step Town media" on storage.objects for insert to authenticated
with check(bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));
create policy "Accountants and Managers update Step Town media" on storage.objects for update to authenticated
using(bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']))
with check(bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));
create policy "Accountants and Managers delete Step Town media" on storage.objects for delete to authenticated
using(bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));

grant select on public.staff_profiles to authenticated;
grant select,insert,update on public.customer_profiles to authenticated;
grant select,insert,update on public.store_orders to authenticated;
grant select,insert on public.store_order_payments to authenticated;
grant select,insert on public.store_order_events to authenticated;
grant select,insert,update,delete on public.gallery_items to authenticated;
grant select,insert,update,delete on public.store_products to authenticated;
grant select,insert,update,delete on public.store_categories to authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,insert on public.audit_log to authenticated;
grant select on public.store_categories,public.store_products,public.gallery_items to anon;
grant insert on public.enquiries to anon,authenticated;
grant select,update on public.enquiries to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema net;

do $$
begin
  if exists(select 1 from cron.job where jobname='step-town-order-escalation') then
    perform cron.unschedule(jobid) from cron.job where jobname='step-town-order-escalation';
  end if;
  perform cron.schedule('step-town-order-escalation','* * * * *',$job$
    select net.http_post(
      url := 'https://tyuousqmpexrwmnmvxtd.supabase.co/functions/v1/staff-push',
      headers := '{"Content-Type":"application/json","apikey":"sb_publishable_eDsGXU1y6_XdOp6IgyjSwQ_q0ARH7MX"}'::jsonb,
      body := '{"action":"escalate"}'::jsonb
    );
  $job$);
end $$;
