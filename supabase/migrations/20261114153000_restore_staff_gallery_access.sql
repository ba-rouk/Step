-- Restore the gallery permissions required by the Manager and Accountant staff workspace.
-- The preceding cleanup migration removed these named policies; recreate them explicitly.
alter table public.gallery_items enable row level security;

grant select on public.gallery_items to anon, authenticated;
grant insert, update, delete on public.gallery_items to authenticated;

drop policy if exists "Public and staff can read gallery items" on public.gallery_items;
create policy "Public and staff can read gallery items"
on public.gallery_items
for select
to anon, authenticated
using (
  is_published = true
  or private.staff_has_role(array['manager','accountant'])
);

drop policy if exists "Staff can add gallery items" on public.gallery_items;
create policy "Staff can add gallery items"
on public.gallery_items
for insert
to authenticated
with check (private.staff_has_role(array['manager','accountant']));

drop policy if exists "Staff can update gallery items" on public.gallery_items;
create policy "Staff can update gallery items"
on public.gallery_items
for update
to authenticated
using (private.staff_has_role(array['manager','accountant']))
with check (private.staff_has_role(array['manager','accountant']));

drop policy if exists "Staff can delete gallery items" on public.gallery_items;
create policy "Staff can delete gallery items"
on public.gallery_items
for delete
to authenticated
using (private.staff_has_role(array['manager','accountant']));

notify pgrst, 'reload schema';
