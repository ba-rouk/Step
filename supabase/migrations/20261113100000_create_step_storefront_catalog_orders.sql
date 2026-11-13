create table if not exists public.store_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  cover_image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.store_categories(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  price numeric(12,2) check (price is null or price >= 0),
  image_url text,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_products_category_available_order_idx
  on public.store_products (category_id, is_available, sort_order);

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 120),
  customer_phone text not null check (char_length(btrim(customer_phone)) between 7 and 40),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  fulfillment text not null check (fulfillment in ('pickup', 'delivery', 'event')),
  requested_date date,
  delivery_location text check (delivery_location is null or char_length(delivery_location) <= 180),
  notes text check (notes is null or char_length(notes) <= 3000),
  items jsonb not null check (
    case
      when jsonb_typeof(items) = 'array'
      then jsonb_array_length(items) between 1 and 50
      else false
    end
  ),
  estimated_total numeric(12,2) check (estimated_total is null or estimated_total >= 0),
  price_needs_confirmation boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.store_categories enable row level security;
alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;

revoke all on public.store_categories from anon, authenticated;
revoke all on public.store_products from anon, authenticated;
revoke all on public.store_orders from anon, authenticated;

grant select on public.store_categories to anon, authenticated;
grant select on public.store_products to anon, authenticated;
grant insert on public.store_orders to anon, authenticated;
grant all on public.store_categories, public.store_products, public.store_orders to service_role;

drop policy if exists "Public visitors can read active store categories" on public.store_categories;
create policy "Public visitors can read active store categories"
  on public.store_categories for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Public visitors can read available store products" on public.store_products;
create policy "Public visitors can read available store products"
  on public.store_products for select
  to anon, authenticated
  using (is_available = true);

drop policy if exists "Public visitors can submit store orders" on public.store_orders;
create policy "Public visitors can submit store orders"
  on public.store_orders for insert
  to anon, authenticated
  with check (
    status = 'new'
    and char_length(btrim(customer_name)) between 2 and 120
    and char_length(btrim(customer_phone)) between 7 and 40
  );

insert into public.store_categories
  (name, slug, description, cover_image_url, sort_order, is_active)
values
  ('Catering', 'catering',
   'Buffets and thoughtfully prepared food for weddings, parties and gatherings.',
   'https://images.unsplash.com/photo-1773040835762-ace903c83f36?auto=format&fit=crop&w=1000&q=85',
   1, true),
  ('Barbecue', 'barbecue',
   'Fire-grilled favourites made for sharing with your guests.',
   'https://images.unsplash.com/photo-1567932783552-e305bbf70b63?auto=format&fit=crop&w=1000&q=85',
   2, true),
  ('Wedding cakes', 'wedding-cakes',
   'Made-to-order cakes for weddings and celebrations.',
   'https://images.unsplash.com/photo-1623428454614-abaf00244e52?auto=format&fit=crop&w=1000&q=85',
   3, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  cover_image_url = excluded.cover_image_url,
  sort_order = excluded.sort_order,
  is_active = true;
