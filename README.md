# Step Town — Food, Celebrations & Cake

Responsive Vite storefront for Step Town's catering, barbecue and Cake services in Rwanda.

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
`npm run preview` starts the Node server used by Render, including the `/api` routes. Use `npm run vite:preview` only when you need Vite's static preview server.

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

## Render server environment

The Node service at `https://steptown.onrender.com` must have `SUPABASE_SERVICE_ROLE_KEY` set as a private Render secret for the validated guest-order API and server-triggered staff push. Never expose this value through a `VITE_` variable or browser bundle. The browser uses only the Supabase publishable key.

## Supabase
Project: `Step` (`tyuousqmpexrwmnmvxtd`).

Migrations `create_step_town_enquiries` and `allow_public_enquiry_insert` create `public.enquiries`, enable RLS, and allow anonymous inserts only when the new enquiry has the `new` status. There is no public read, update or delete policy, so visitors cannot list or manage stored enquiries.

The enquiry form validates required fields, saves the enquiry to Supabase, then offers an optional WhatsApp continuation. A successful database insert is confirmed before the success message appears.

## Business details
- Step Town · Food, Celebrations & Cake
- Runda, Rwanda
- +250 780 382 589
- WhatsApp: https://wa.me/250780382589

Confirm the exact street address, opening hours, service radius, and contact details with the business before launch.

## Photography
The gallery currently uses illustrative preview photographs, not verified Step Town portfolio images. Replace them with the business's own licensed photographs before promoting the site as a portfolio.


## Online menu and orders
- The storefront reads active categories from `public.store_categories` and available menu items from `public.store_products`.
- Add and manage real Step Town dishes, packages, cake designs and prices in the Supabase Table Editor. Categories are pre-created: Catering, Barbecue and Cake.
- The shopping bag is stored in the visitor's browser. Checkout writes order requests to `public.store_orders`; public visitors can submit requests but cannot read, change or delete customer orders.
- Orders are requests, not online payments or confirmed bookings. Step Town confirms availability and final prices directly, including any items whose price is left blank.


## Staff workspace (in progress)
Staff routes are served by the Vite single-page application:
- `/staff/login`
- `/staff/dashboard`
- `/staff/orders` and `/staff/orders/:orderNumber`
- `/staff/products`, `/staff/gallery`, `/staff/enquiries`, `/staff/reports`
- Manager-only views: `/staff/team` and `/staff/audit`

Staff authentication uses Supabase Auth email/password sessions. The browser checks the authenticated user's `public.staff_profiles` row, active flag and role. Database RLS policies remain the actual authorization boundary; do not rely on hidden navigation as security. First-login password changes are supported through `must_change_password`.

**Provisioning limitation:** the browser deliberately does not create Auth users or reset other staff passwords. Those actions require a privileged Supabase Edge Function using the Auth Admin API and must never be implemented with a service-role key in the browser. The Team view is currently read-only until that server-side function is deployed.

The service worker and PWA manifest are included. They can display and route a push payload to the exact order URL. A server-side push sender, VAPID secrets, delivery retries/escalation worker and provider fallback (SMS/WhatsApp/email) still need to be configured before live push delivery can be relied on. iPhone push requires staff to install the website to the Home Screen.

The current staff browser session is managed by Supabase JS. This uses Supabase's client-managed token storage/refresh rather than a custom httpOnly cookie session. For a strict httpOnly-cookie architecture, move staff auth and all privileged operations behind a server-side application/API before production.

## Photography sources
Instagram profile supplied by the business: https://www.instagram.com/step_town_supermarket/
The profile could not be read by the inspection tool. The temporary category backgrounds currently use externally hosted search-discovered images to avoid blank photo areas. They are illustrative references, not Step Town's own portfolio. Replace them with approved originals from the business before public marketing. Third-party image availability and reuse rights must be confirmed by the site owner.


### Deploying the staff backend
The Edge Function source lives under `supabase/functions/`:
- `seed-manager` — one-time initial Manager bootstrap, protected by `SEED_MANAGER_TOKEN`.
- `staff-admin` — Manager-only create/reset/deactivate/activate for Accountant and Cashier accounts.
- `send-order-push` — sends a new-order push to active Cashier devices and optionally posts a fallback alert webhook.
- `escalate-orders` — re-notifies Cashiers after 10 minutes, then Accountants 10 minutes later if the order remains unacknowledged.

Deploy from a trusted local machine with Supabase CLI linked to project `tyuousqmpexrwmnmvxtd`:

```bash
supabase functions deploy staff-admin
supabase functions deploy send-order-push
supabase functions deploy seed-manager --no-verify-jwt
supabase functions deploy escalate-orders --no-verify-jwt
```

Set these Edge Function secrets in Supabase before use:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the project service role key; never expose it to the browser)
- `SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD` (minimum 16 characters), `SEED_MANAGER_NAME`, `SEED_MANAGER_TOKEN`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `ESCALATION_SECRET`
- Optional fallback provider adapter: `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TOKEN`

Run the seed function exactly once using its Bearer seed token, then remove the `SEED_MANAGER_*` secrets. The manager's temporary password must be changed on first login.

Configure `VITE_VAPID_PUBLIC_KEY` as a **public** Render environment variable on the Web Service so staff browsers can subscribe. Keep the private VAPID key only in Supabase Edge Function secrets. Schedule `escalate-orders` every 5 minutes using a trusted scheduler (for example a Render Cron Job) with `Authorization: Bearer <ESCALATION_SECRET>`. The function handles the 10-minute and second-stage timing itself.

Before relying on this in production, deploy the functions, configure the provider webhook and scheduler, seed the first Manager, create the Accountant/Cashier accounts, subscribe Cashier devices, and run the end-to-end order/push/acknowledgement test. iOS push requires Home Screen installation.


### Customer accounts, gallery and media

Customer routes are served by the Node server in `server.js`, which also provides the History API fallback:
- Public pages: `/`, `/categories`, `/categories/:slug`, `/gallery`, and `/cart`.
- Protected pages: `/profile` and `/profile/orders`. Logged-out visitors are redirected to `/login?next=<original-path>`.
- Customer auth: `/login` and `/register`; registration uses full name, phone number and password. Phone-confirmation projects use an SMS OTP screen. Google sign-in continues through a server-side PKCE callback.
- Cart contents remain in the browser's `localStorage` across public page changes. The server validates the current customer, product availability and prices before inserting an order.
- Customer access/refresh tokens are encrypted into an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Unsafe API requests require a same-origin CSRF token and auth/order endpoints are rate-limited. Supabase Auth handles password hashing (bcrypt); the app never stores plaintext passwords.
- Staff routes and the Manager, Accountant and Cashier authentication remain separate at `/staff/login` and `/staff/*`.

#### Required production environment

Keep these values in the Render Web Service environment (never in browser code):
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (already used by the public catalogue and staff client).
- `APP_URL=https://steptown.onrender.com`: pins OAuth callbacks to the production website origin.
- `SESSION_SECRET`: a randomly generated secret of at least 32 bytes. Generate one with `openssl rand -hex 48`. Do not commit it or share it with the browser.
- Optional aliases: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The server falls back to the existing `VITE_` values if these are omitted.
- `SUPABASE_SERVICE_ROLE_KEY`: required by the guest-capable order API for server-side order inserts and the private order-push invocation. Set it only as a Render secret; never add it to a `VITE_` variable or browser code.

Enable **Phone** in Supabase Authentication providers and configure an SMS provider if phone confirmation is enabled. Set the site URL to `https://steptown.onrender.com`. Add `https://steptown.onrender.com/auth/callback` to the allowed Auth redirect URLs for Google OAuth. Phone/password authentication requires a verified phone number when SMS confirmation is enabled; Supabase recommends MFA because phone numbers can be recycled.

The public gallery reads published records from `public.gallery_items`, with category filters for Catering, Staff, Barbecue and Cakes. Accountants and Managers upload product/gallery images to the public `step-town-media` Supabase Storage bucket; JPEG, PNG, WebP and AVIF images up to 10 MB are accepted. Cashiers cannot upload. Products can store multiple image URLs; the public menu presents them as horizontally swipeable photo strips with local favourites.

The mobile dock provides Home, Categories, Gallery, Cart and Profile shortcuts. The Step Town logo image supplied by the owner is used in the header, phone contact block and map card.


#### Supabase Auth URL Configuration

In **Authentication → URL Configuration**, set **Site URL** to `https://steptown.onrender.com` and add `https://steptown.onrender.com/auth/callback` to the allowed redirect URLs. Remove malformed entries such as `https://tyuousqmpexrwmnmvxtd.supabase.co/steptown.onrender.com`. Keep the Google OAuth provider's registered callback URI as `https://tyuousqmpexrwmnmvxtd.supabase.co/auth/v1/callback`; that is the provider-to-Supabase callback and is not the app's final redirect URL.
