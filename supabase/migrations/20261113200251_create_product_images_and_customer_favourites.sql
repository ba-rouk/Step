-- Ordered product gallery, backwards-compatible catalogue slug and customer favourites.
alter table public.store_products add column if not exists slug text;

update public.store_products
set slug = trim(both '-' from regexp_replace(lower(coalesce(name, 'product')), '[^a-z0-9]+', '-', 'g'))
           || '-' || left(id::text, 8)
where slug is null or btrim(slug) = '';

create unique index if not exists store_products_slug_uidx on public.store_products(slug);

create or replace function public.set_store_product_slug()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := trim(both '-' from regexp_replace(lower(coalesce(new.name, 'product')), '[^a-z0-9]+', '-', 'g'))
                || '-' || left(new.id::text, 8);
  end if;
  return new;
end;
$$;

drop trigger if exists store_products_set_slug on public.store_products;
create trigger store_products_set_slug
before insert on public.store_products
for each row execute function public.set_store_product_slug();

alter table public.store_products alter column slug set not null;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products(id) on delete cascade,
  url text not null check (char_length(btrim(url)) between 8 and 2048),
  public_id text,
  position integer not null default 0 check (position >= 0),
  alt_text text check (alt_text is null or char_length(alt_text) <= 240),
  created_at timestamptz not null default now(),
  constraint product_images_product_position_key unique (product_id, position)
);

create index if not exists product_images_product_position_idx
  on public.product_images(product_id, position);

alter table public.product_images enable row level security;
revoke all on public.product_images from anon, authenticated;
grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

drop policy if exists "Public can read published product images" on public.product_images;
create policy "Public can read published product images"
on public.product_images for select
to anon, authenticated
using (
  exists (
    select 1 from public.store_products p
    where p.id = product_images.product_id
      and p.is_available = true
      and p.is_visible = true
      and p.has_stock = true
  )
);

drop policy if exists "Managers and Accountants manage product images" on public.product_images;
create policy "Managers and Accountants manage product images"
on public.product_images for all
to authenticated
using (private.staff_has_role(array['manager','accountant']))
with check (private.staff_has_role(array['manager','accountant']));

-- Backfill both the original image_url column and the later image_urls array.
-- Legacy columns remain in place until the new gallery is fully verified.
insert into public.product_images(product_id, url, public_id, position, alt_text)
select p.id, legacy.url, null, (legacy.ordinality - 1)::integer,
       left(p.name || ' photo ' || legacy.ordinality, 240)
from public.store_products p
cross join lateral (
  select distinct u.url, min(u.ord)::bigint as ord, min(u.ord)::bigint as ordinality
  from unnest(
    coalesce(p.image_urls, '{}'::text[]) ||
    case when p.image_url is not null and btrim(p.image_url) <> '' then array[p.image_url] else '{}'::text[] end
  ) with ordinality as u(url, ord)
  where u.url is not null and btrim(u.url) <> ''
  group by u.url
) legacy
order by p.id, legacy.ordinality
on conflict (product_id, position) do nothing;

create or replace function public.guard_product_image_count()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if tg_op = 'INSERT' then
    select count(*) into current_count
    from public.product_images
    where product_id = new.product_id;
    if current_count >= 10 then
      raise exception 'A product can have no more than 10 images.' using errcode = '22023';
    end if;
  elsif tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    select count(*) into current_count
    from public.product_images
    where product_id = new.product_id and id <> old.id;
    if current_count >= 10 then
      raise exception 'A product can have no more than 10 images.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_limit_count on public.product_images;
create trigger product_images_limit_count
before insert or update of product_id on public.product_images
for each row execute function public.guard_product_image_count();

create or replace function public.staff_reorder_product_images(
  p_product_id uuid,
  p_image_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  existing_count integer;
  requested_count integer;
begin
  if auth.uid() is null or not private.staff_has_role(array['manager','accountant']) then
    raise exception 'Accountant or Manager access required.' using errcode = '42501';
  end if;

  if coalesce(array_length(p_image_ids, 1), 0) > 10 then
    raise exception 'A product can have no more than 10 images.' using errcode = '22023';
  end if;

  select count(*) into existing_count
  from public.product_images
  where product_id = p_product_id;

  requested_count := coalesce(array_length(p_image_ids, 1), 0);
  if requested_count <> existing_count then
    raise exception 'The image list changed. Refresh and try again.' using errcode = '22023';
  end if;

  if requested_count > 0 and (
    (select count(distinct x) from unnest(p_image_ids) as x) <> requested_count
    or exists (
      select 1 from unnest(p_image_ids) as requested(id)
      where not exists (
        select 1 from public.product_images pi
        where pi.id = requested.id and pi.product_id = p_product_id
      )
    )
  ) then
    raise exception 'The image order contains invalid or duplicate items.' using errcode = '22023';
  end if;

  update public.product_images
  set position = position + 100
  where product_id = p_product_id;

  update public.product_images pi
  set position = requested.ordinality - 1
  from unnest(p_image_ids) with ordinality as requested(id, ordinality)
  where pi.id = requested.id and pi.product_id = p_product_id;
end;
$$;

revoke all on function public.staff_reorder_product_images(uuid, uuid[]) from public, anon;
grant execute on function public.staff_reorder_product_images(uuid, uuid[]) to authenticated;

create table if not exists public.customer_favourites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.store_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists customer_favourites_product_idx
  on public.customer_favourites(product_id);

alter table public.customer_favourites enable row level security;
revoke all on public.customer_favourites from anon, authenticated;
grant select, insert, delete on public.customer_favourites to authenticated;

drop policy if exists "Customers read their own favourites" on public.customer_favourites;
create policy "Customers read their own favourites"
on public.customer_favourites for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Customers add their own favourites" on public.customer_favourites;
create policy "Customers add their own favourites"
on public.customer_favourites for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Customers remove their own favourites" on public.customer_favourites;
create policy "Customers remove their own favourites"
on public.customer_favourites for delete
to authenticated
using (user_id = (select auth.uid()));
