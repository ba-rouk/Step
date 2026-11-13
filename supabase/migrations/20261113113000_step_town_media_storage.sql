insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('step-town-media','step-town-media',true,10485760,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public=true,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Public can view Step Town media" on storage.objects;
create policy "Public can view Step Town media" on storage.objects
for select to anon, authenticated using (bucket_id='step-town-media');

drop policy if exists "Accountants and Managers upload Step Town media" on storage.objects;
create policy "Accountants and Managers upload Step Town media" on storage.objects
for insert to authenticated with check (bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));

drop policy if exists "Accountants and Managers update Step Town media" on storage.objects;
create policy "Accountants and Managers update Step Town media" on storage.objects
for update to authenticated using (bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']))
with check (bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));

drop policy if exists "Accountants and Managers delete Step Town media" on storage.objects;
create policy "Accountants and Managers delete Step Town media" on storage.objects
for delete to authenticated using (bucket_id='step-town-media' and private.staff_has_role(array['manager','accountant']));
