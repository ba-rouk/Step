-- Step Town multi-image product galleries and customer favourites.
-- Legacy store_products.image_url and image_urls remain in place during rollout.
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products(id) on delete cascade,
  url text not null,
  public_id text,
  position integer not null default 0 check(position between 0 and 9),
  alt_text text,
  created_at timestamptz not null default now(),
  unique(product_id,position)
);
create index if not exists product_images_product_position_idx on public.product_images(product_id,position);
insert into public.product_images(product_id,url,position,alt_text)
select p.id,i.url,(i.ordinality-1)::integer,p.name||' photo '||i.ordinality
from public.store_products p
cross join lateral unnest(
  case when coalesce(array_length(p.image_urls,1),0)>0 then p.image_urls
       when p.image_url is not null then array[p.image_url]
       else array[]::text[] end
) with ordinality as i(url,ordinality)
where nullif(btrim(i.url),'') is not null and i.ordinality<=10
on conflict(product_id,position) do nothing;

alter table public.product_images enable row level security;
revoke all on public.product_images from anon,authenticated;
grant select on public.product_images to anon,authenticated;
grant all on public.product_images to service_role;
drop policy if exists "Public can view images for visible products" on public.product_images;
create policy "Public can view images for visible products" on public.product_images for select to anon,authenticated
using(exists(select 1 from public.store_products p where p.id=product_images.product_id and p.is_available=true and coalesce(p.is_visible,true)=true));
drop policy if exists "Managers and accountants manage product images" on public.product_images;
create policy "Managers and accountants manage product images" on public.product_images for all to authenticated
using(private.staff_has_role(array['manager','accountant']))
with check(private.staff_has_role(array['manager','accountant']));

create or replace function public.enforce_product_image_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare image_count integer;
begin
  select count(*) into image_count from public.product_images where product_id=new.product_id
    and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if image_count>=10 then raise exception 'A product can have at most 10 images.' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists product_images_max_ten on public.product_images;
create trigger product_images_max_ten before insert or update of product_id on public.product_images
for each row execute function public.enforce_product_image_limit();

create table if not exists public.customer_favourites(
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.store_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(customer_id,product_id)
);
alter table public.customer_favourites enable row level security;
revoke all on public.customer_favourites from anon,authenticated;
grant select,insert,delete on public.customer_favourites to authenticated;
drop policy if exists "Customers manage their own favourites" on public.customer_favourites;
create policy "Customers manage their own favourites" on public.customer_favourites for all to authenticated
using(customer_id=auth.uid()) with check(customer_id=auth.uid());

-- Storage-level MIME and size enforcement is performed by Supabase Storage.
update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp']
where id='step-town-media';
