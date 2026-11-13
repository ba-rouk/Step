# Step Town — Catering, Barbecue & Wedding Cakes

Responsive Vite website for Step Town Catering and Wedding Cakes in Rwanda.

## Stack
- Vite 7
- Vanilla JavaScript and CSS
- Supabase JavaScript client
- Supabase Postgres for customer enquiries
- Netlify continuous deployment

## Local development
Requires Node.js 22.12+.

```bash
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` with the Step Supabase project URL and publishable key. Never use a Supabase secret or service-role key in browser code.

## Production build
```bash
npm run build
npm run preview
```
The production site is generated in `dist/`.

## Netlify
- Repository: `ba-rouk/Step`
- Production branch: `main`
- Base directory: `.` (repository root)
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: leave blank (no Netlify Functions are required for the current site)

The root `netlify.toml` contains the build and publish settings. Configure these site environment variables in Netlify:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Vite exposes variables prefixed with `VITE_` to browser code. The publishable key is intended for client use; never place a Supabase secret/service-role key in these variables.

## Supabase
Project: `Step` (`tyuousqmpexrwmnmvxtd`).

Migrations `create_step_town_enquiries` and `allow_public_enquiry_insert` create `public.enquiries`, enable RLS, and allow anonymous inserts only when the new enquiry has the `new` status. There is no public read, update or delete policy, so visitors cannot list or manage stored enquiries.

The enquiry form validates required fields, saves the enquiry to Supabase, then offers an optional WhatsApp continuation. A successful database insert is confirmed before the success message appears.

## Business details
- Step Town Catering and Wedding Cakes
- Runda, Rwanda
- +250 780 382 589
- WhatsApp: https://wa.me/250780382589

Confirm the exact street address, opening hours, service radius, and contact details with the business before launch.

## Photography
The gallery currently uses illustrative preview photographs, not verified Step Town portfolio images. Replace them with the business's own licensed photographs before promoting the site as a portfolio.
