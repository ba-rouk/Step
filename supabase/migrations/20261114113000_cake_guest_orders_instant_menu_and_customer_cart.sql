-- Step Town category, public menu and guest order support.
-- Preserve the existing category UUID so every existing product remains attached.
update public.store_categories
set name = 'Cake', slug = 'cake'
where slug = 'wedding-cakes' or lower(name) = 'wedding cakes';

-- Normalize historical order snapshots so reports use the canonical category label.
update public.store_orders so
set items = (
  select coalesce(jsonb_agg(
    case
      when lower(coalesce(item->>'category','')) = 'wedding cakes'
      then jsonb_set(item, '{category}', '"Cake"'::jsonb, true)
      else item
    end order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(so.items) with ordinality as entry(item, ord)
)
where jsonb_typeof(so.items) = 'array'
  and exists (
    select 1 from jsonb_array_elements(so.items) as entry(item)
    where lower(coalesce(item->>'category','')) = 'wedding cakes'
  );

alter table public.store_orders
  add column if not exists order_description text,
  add column if not exists push_notified_at timestamptz;
alter table public.store_orders
  drop constraint if exists store_orders_order_description_check;
alter table public.store_orders
  add constraint store_orders_order_description_check
  check (order_description is null or char_length(order_description) <= 5000);

-- Guest requests use the same ST-#### sequence, events and staff workflow.
drop policy if exists "Guests can place Step Town orders" on public.store_orders;
create policy "Guests can place Step Town orders"
on public.store_orders for insert to anon
with check (
  customer_id is null and status = 'new'
  and acknowledged_at is null and escalated_at is null
  and push_notified_at is null
  and char_length(btrim(customer_name)) between 2 and 120
  and char_length(btrim(customer_phone)) between 7 and 40
  and (order_description is null or char_length(order_description) <= 5000)
);
grant insert on public.store_orders to anon;

-- Logged-in customers keep their cart list server-side. Guest cart entries are
-- merged from localStorage when they sign in.
create table if not exists public.customer_cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.store_products(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.customer_cart_items enable row level security;
revoke all on public.customer_cart_items from anon, authenticated;
grant select, insert, update, delete on public.customer_cart_items to authenticated;
drop policy if exists "Customers manage their own cart items" on public.customer_cart_items;
create policy "Customers manage their own cart items"
on public.customer_cart_items for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create index if not exists store_products_public_menu_idx
  on public.store_products (is_available, is_visible, sort_order, category_id, id);
create index if not exists store_categories_active_order_idx
  on public.store_categories (is_active, sort_order);
create index if not exists store_orders_customer_phone_created_idx
  on public.store_orders (customer_phone, created_at desc);

notify pgrst, 'reload schema';
