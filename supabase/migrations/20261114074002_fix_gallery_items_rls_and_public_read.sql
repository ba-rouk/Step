create policy "Public and staff can read gallery items"
on public.gallery_items
for select
to anon, authenticated
using (
  is_published = true
  or private.staff_has_role(array['manager','accountant'])
);

create policy "Staff can add gallery items"
on public.gallery_items
for insert
to authenticated
with check (private.staff_has_role(array['manager','accountant']));

create policy "Staff can update gallery items"
on public.gallery_items
for update
to authenticated
using (private.staff_has_role(array['manager','accountant']))
with check (private.staff_has_role(array['manager','accountant']));

create policy "Staff can delete gallery items"
on public.gallery_items
for delete
to authenticated
using (private.staff_has_role(array['manager','accountant']));