-- Keep saved/abandoned carts separate from submitted store orders.
create table if not exists public.customer_cart_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cart_id uuid not null,
  items jsonb not null,
  item_count integer not null,
  estimated_total numeric,
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_cart_history_items_check
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  constraint customer_cart_history_item_count_check
    check (item_count between 1 and 1000),
  constraint customer_cart_history_estimated_total_check
    check (estimated_total is null or estimated_total >= 0),
  constraint customer_cart_history_status_check
    check (status in ('saved','abandoned','converted')),
  constraint customer_cart_history_user_cart_unique unique (user_id,cart_id)
);

create index if not exists customer_cart_history_user_updated_idx
  on public.customer_cart_history (user_id,updated_at desc);

alter table public.customer_cart_history enable row level security;
drop policy if exists "Customers read their own cart history" on public.customer_cart_history;
drop policy if exists "Customers save their own cart history" on public.customer_cart_history;
drop policy if exists "Customers update their own cart history" on public.customer_cart_history;
create policy "Customers read their own cart history"
  on public.customer_cart_history for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Customers save their own cart history"
  on public.customer_cart_history for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Customers update their own cart history"
  on public.customer_cart_history for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select,insert,update on public.customer_cart_history to authenticated;

-- Keep the public enquiry service values aligned with the live enquiry form.
alter table public.enquiries drop constraint if exists enquiries_service_check;
alter table public.enquiries add constraint enquiries_service_check
  check (service = any (array[
    'Event catering',
    'Barbecue',
    'Wedding cake',
    'Cake',
    'Catering + wedding cake',
    'Catering + Cake',
    'I''d like to discuss an idea'
  ]));
