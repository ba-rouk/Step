-- Complete Step Town product gallery enforcement.
-- The base product_images/customer_favourites tables already exist in this project.
alter table public.product_images add column if not exists public_id text;
alter table public.product_images add column if not exists alt_text text;

-- Preserve and backfill the legacy cover/gallery fields without dropping them.
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

create or replace function public.enforce_product_image_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare image_count integer;
begin
  select count(*) into image_count from public.product_images
  where product_id=new.product_id and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if image_count>=10 then
    raise exception 'A product can have at most 10 images.' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists product_images_max_ten on public.product_images;
create trigger product_images_max_ten
before insert or update of product_id on public.product_images
for each row execute function public.enforce_product_image_limit();

-- Supabase Storage rejects non-image MIME types and objects over 5 MB.
update storage.buckets
set file_size_limit=5242880,
    allowed_mime_types=array['image/jpeg','image/png','image/webp']
where id='step-town-media';
