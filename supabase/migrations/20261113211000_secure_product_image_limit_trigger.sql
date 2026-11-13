-- Restrict direct invocation of the trigger helper; the trigger itself remains active.
create or replace function public.enforce_product_image_limit()
returns trigger language plpgsql security invoker set search_path=public as $$
declare image_count integer;
begin
  select count(*) into image_count from public.product_images
  where product_id=new.product_id and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if image_count>=10 then raise exception 'A product can have at most 10 images.' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_product_image_limit() from public,anon,authenticated;
