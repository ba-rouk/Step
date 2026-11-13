-- Step Town multi-image product galleries and customer favourites.
-- Existing product_images/customer_favourites tables are retained; adapt in place.
alter table public.product_images add column if not exists public_id text;
alter table public.product_images add column if not exists alt_text text;
create unique index if not exists product_images_product_position_uidx on public.product_images(product_id,position);
insert into public.product_images(product_id,url,public_id,position,alt_text)
select p.id,i.url,null,(i.ordinality-1)::integer,p.name||' photo '||i.ordinality
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
using(exists(select 1 from public.store_products p where p.id=product_images.product_id and p.is_available=true and p.is_visible=true and p.has_stock=true));
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

-- customer_favourites already uses (user_id, product_id) with own-row RLS policies.
alter table public.customer_favourites enable row level security;
grant select,insert,delete on public.customer_favourites to authenticated;

-- Storage enforces maximum size and MIME types independently of browser validation.
update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp']
where id='step-town-media';
