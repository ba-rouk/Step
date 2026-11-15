# Vitanova — Catering, Barbecue & Cake

Responsive Vite and Node website for Vitanova in Rwanda.

## Stack
- Vite 7
- Vanilla JavaScript and CSS
- Supabase JavaScript client
- Supabase Postgres for customer enquiries
- Render Web Service deployment

## Local development
Requires Node.js 22.12+.

```bash
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` with the Vitanova Supabase project URL and publishable key. Never use a Supabase secret or service-role key in browser code.

## Production build
```bash
npm run build
npm run preview
```
The production site is generated in `dist/`.

## Render
- Repository: `ba-rouk/Vitanova-`
- Production branch: `main`
- Runtime: Node.js 22.12+
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Live URL: `https://vitanova-1hfh.onrender.com`

Set these browser-safe values in the Render Web Service environment:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Vite exposes variables prefixed with `VITE_` to browser code. The publishable key is intended for client use; never place a Supabase secret/service-role key in these variables.

## Supabase
Project: `Vitanova` (`tyuousqmpexrwmnmvxtd`).

The enquiries schema and public-insert policy create `public.enquiries`, enable RLS, and allow anonymous inserts only when the new enquiry has the `new` status. There is no public read, update or delete policy, so visitors cannot list or manage stored enquiries.

The enquiry form validates required fields, saves the enquiry to Supabase, then offers an optional WhatsApp continuation. A successful database insert is confirmed before the success message appears.

## Business details
- Vitanova Catering and Cake
- Runda, Rwanda
- +250 793 607 387
- WhatsApp: https://wa.me/250793607387

Confirm the exact street address, opening hours, service radius, and contact details with the business before launch.

## Photography
The gallery currently uses illustrative preview photographs, not verified Vitanova portfolio images. Replace them with the business's own licensed photographs before promoting the site as a portfolio.


## Online menu and orders
- The storefront reads active categories from `public.store_categories` and available menu items from `public.store_products`.
- Add and manage real Vitanova dishes, packages, cake designs and prices in the Supabase Table Editor. Categories are pre-created: Catering, Barbecue and Cake.
- The shopping bag is stored in the visitor's browser. Checkout writes order requests to `public.store_orders`; public visitors can submit requests but cannot read, change or delete customer orders.
- Orders are requests, not online payments or confirmed bookings. Vitanova confirms availability and final prices directly, including any items whose price is left blank.


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
Vitanova's official Instagram profile URL has not yet been supplied.
The profile could not be read by the inspection tool. The temporary category backgrounds currently use externally hosted search-discovered images to avoid blank photo areas. They are illustrative references, not Vitanova's own portfolio. Replace them with approved originals from the business before public marketing. Third-party image availability and reuse rights must be confirmed by the site owner.


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
- `SITE_URL=https://vitanova-1hfh.onrender.com`: pins OAuth callbacks to the production website origin.
- `SESSION_SECRET`: a randomly generated secret of at least 32 bytes. Generate one with `openssl rand -hex 48`. Do not commit it or share it with the browser.
- Optional server aliases: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The server falls back to the existing `VITE_` values if these are omitted. A Supabase service-role key is not required by the customer API.

Enable **Phone** in Supabase Authentication providers and configure an SMS provider if phone confirmation is enabled. Set the Site URL to `https://vitanova-1hfh.onrender.com` and add `https://vitanova-1hfh.onrender.com/**` to the allowed Auth redirect URLs. Register `https://tyuousqmpexrwmnmvxtd.supabase.co/auth/v1/callback` as the Google OAuth authorized redirect URI in Google Cloud Console. Phone/password authentication requires a verified phone number when SMS confirmation is enabled; Supabase recommends MFA because phone numbers can be recycled.

The public gallery reads published records from `public.gallery_items`, with category filters for Catering, Staff, Barbecue and Cakes. Accountants and Managers upload product/gallery images to the public `step-town-media` Supabase Storage bucket; JPEG, PNG, WebP and AVIF images up to 10 MB are accepted. Cashiers cannot upload. Products can store multiple image URLs; the public menu presents them as horizontally swipeable photo strips with local favourites.

The mobile dock provides Home, Categories, Gallery, Cart and Profile shortcuts. Vins logo artwork has not yet been supplied; the old artwork remains in place until the Vins logo and icon files are added.


#### Supabase Auth URL Configuration

In **Authentication → URL Configuration**, set **Site URL** to `https://vitanova-1hfh.onrender.com` and add `https://vitanova-1hfh.onrender.com/auth/callback` (and the local development callback if needed) to the allowed redirect URLs. Remove any obsolete former-site URLs. Keep the Google OAuth provider's registered callback URI as `https://tyuousqmpexrwmnmvxtd.supabase.co/auth/v1/callback`; that is the provider-to-Supabase callback and is not the app's final redirect URL.


## Guest cart, quick orders and email login

The storefront uses two separate cart flows:

- The product-card cart icon adds one item in place and updates the Cart badge. It does not navigate.
- The product image and product text open `/cart?product=<slug>`. This quick-order form submits only that selected item and does not change the saved cart.
- The Cart tab displays the editable saved cart. Guest carts are stored in `localStorage`; signed-in carts are persisted to `customer_cart_items`. A guest cart is merged into the account cart after sign-in.
- `src/cart-config.js` contains the single `REQUIRE_LOGIN_FOR_CART_LIST` switch. It defaults to `true`; guests are redirected to sign-in before seeing their saved-cart list. Quick order remains guest-accessible.

### Email login and verification

The primary customer sign-in is **Email me a login code**. Codes are six digits, hashed in `public.login_codes`, expire after 10 minutes, are single-use and lock after five incorrect attempts. The request endpoint responds identically for all syntactically valid addresses. Successful verification confirms the Supabase Auth email, creates the account if necessary, issues a normal Supabase session and claims only unassigned guest orders whose normalized email matches the verified address. An order already linked to a different user is never reassigned.

Password sign-in remains available. An account with an unverified email sees a verification prompt instead of order history.

### HTTPS email delivery (no SMTP)

Render free web services block outbound SMTP ports 25, 465 and 587. Vitanova therefore sends email only through the provider's HTTPS API; do not add Nodemailer SMTP transport or SMTP credentials.

Set these values as **Supabase Edge Function secrets** (and the matching server-side values in Render where indicated):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (Edge Functions only; never expose to Vite/browser code)
- `EMAIL_PROVIDER=resend` (supported values: `resend`, `brevo`, `postmark`, `mailgun`, `sendgrid`)
- `EMAIL_API_KEY` (or `RESEND_API_KEY` for Resend)
- `EMAIL_FROM` (must use a verified sender/domain)
- `EMAIL_FROM_NAME=Vitanova`
- `SITE_URL=https://vitanova-1hfh.onrender.com`
- `LOGIN_CODE_PEPPER` (random secret, at least 32 bytes)
- `EMAIL_OUTBOX_SECRET` (different random secret, at least 32 bytes)
- For Mailgun only: `MAILGUN_DOMAIN`

Generate independent secrets with `openssl rand -hex 32`. Keep service-role keys, provider keys and peppers out of Git and browser variables. `.env.example` contains placeholders only.

#### Sender-domain setup (SPF and DKIM)

1. Add and verify your sending domain in the chosen provider (Resend is the default).
2. Publish the exact SPF TXT record supplied by the provider. If the domain already has SPF, merge the provider's include mechanism into the existing single SPF record; do not publish multiple SPF records.
3. Publish every DKIM record supplied by the provider (usually one or more TXT or CNAME records).
4. Add the provider's recommended DMARC TXT record. Start with a monitoring policy such as `p=none`, review aggregate reports, then tighten it after legitimate mail is passing.
5. Wait for DNS propagation, verify the domain in the provider dashboard, and set `EMAIL_FROM` to an address on that domain.

#### Sandbox testing

Use the provider's sandbox/test mode and its permitted test recipient addresses first. For Resend, use the provider's test-mode API key and a verified test sender/recipient as required by the current Resend account. Confirm that the outbox records a successful send; simulate provider failures to verify exponential retries. Do not use real customer addresses until the sender domain is verified and deliverability has been tested.

### Deploying the email and tracking Edge Functions

After applying all migrations to the Vitanova Supabase project, deploy:

```bash
supabase functions deploy submit-store-order
supabase functions deploy request-login-code --no-verify-jwt
supabase functions deploy verify-login-code --no-verify-jwt
supabase functions deploy process-email-outbox --no-verify-jwt
supabase functions deploy track-store-order --no-verify-jwt
supabase functions deploy send-order-push
```

Set the secrets listed above with `supabase secrets set`. Schedule `process-email-outbox` to run every minute using a trusted scheduler, sending `Authorization: Bearer <EMAIL_OUTBOX_SECRET>`. The order and login-code endpoints also make an immediate best-effort outbox delivery attempt; the scheduled worker retries temporary failures. The outbox is the durable source of truth, so order saving does not depend on email delivery.

### Order tracking and privacy

Each order receives a cryptographically random 128-bit tracking token. The public `/order/<token>` page shows only the order number, status, items, estimated total and fulfilment/delivery details. It never returns the customer's phone number or email. Customer order history is available only after the Supabase Auth email is verified.
