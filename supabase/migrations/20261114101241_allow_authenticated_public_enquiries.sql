-- Allow public event enquiry submissions whether the visitor is signed out or authenticated.
-- Keep public submissions in the New state and limit which fields the browser may insert.
drop policy if exists "Public visitors can submit Step Town enquiries" on public.enquiries;
create policy "Public visitors can submit Step Town enquiries"
on public.enquiries
for insert
to anon, authenticated
with check (status = 'new');

revoke insert on table public.enquiries from anon, authenticated;
grant insert (name, phone, service, event_date, guest_count, event_location, details, status)
on table public.enquiries to anon, authenticated;

notify pgrst, 'reload schema';
