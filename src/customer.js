import "../customer.css";
import { apiFetch } from "./api.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const isAuthRoute = ["/login","/register","/profile","/profile/orders"].includes(route);

if (isAuthRoute) {
  document.body.classList.add("route-customer-page");
  const nextParam = new URLSearchParams(window.location.search).get("next");
  const safeNext = typeof nextParam === "string" &&
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//") &&
    !nextParam.includes("\\") &&
    !nextParam.startsWith("/staff")
      ? nextParam
      : "/profile";

  const app = document.createElement("main");
  app.id = "customer-account";
  app.setAttribute("tabindex", "-1");
  const existingMain = document.querySelector("body > main");
  if (existingMain) document.body.insertBefore(app, existingMain);
  else document.body.append(app);

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[character]);

  const errorFromQuery = new URLSearchParams(window.location.search).get("error");
  const authError = errorFromQuery
    ? "Google sign-in could not be completed. Please try again or use your phone number."
    : "";

  const passwordField = (label, autocomplete = "current-password", minLength = 8) =>
    '<label class="customer-field"><span>' + label + '</span><span class="customer-password-wrap"><input name="password" type="password" minlength="' + minLength + '" maxlength="128" required autocomplete="' + autocomplete + '" placeholder="At least 10 characters"><button class="customer-password-toggle" type="button" data-toggle-password aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg></button></span></label>';

  function wirePasswordToggles(root) {
    root.querySelectorAll("[data-toggle-password]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.parentElement.querySelector("input");
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-label", show ? "Hide password" : "Show password");
        button.title = show ? "Hide password" : "Show password";
        button.classList.toggle("is-visible", show);
      });
    });
  }

  function shell(content, kicker = "STEP TOWN ACCOUNT") {
    app.innerHTML = '<section class="customer-auth"><a class="customer-brand" href="/" aria-label="Step Town home"><img src="/step-town-logo.png" alt=""><span><b>STEP TOWN</b><small>FOOD · CELEBRATIONS · CAKES</small></span></a><div class="customer-auth-card"><p class="customer-kicker">' + kicker + '</p>' + content + '</div></section>';
    app.focus({ preventScroll: true });
  }

  function authForm(mode, message = "") {
    const registering = mode === "register";
    const fields =
      (registering ? '<label class="customer-field"><span>Full name</span><input name="name" type="text" autocomplete="name" minlength="2" maxlength="120" required placeholder="Your full name"></label>' : "") +
      '<label class="customer-field"><span>' + (registering ? "Phone number" : "Phone number or email") + '</span><input name="phone" type="' + (registering ? "tel" : "text") + '" autocomplete="' + (registering ? "tel" : "username") + '" ' + (registering ? 'inputmode="tel" placeholder="+250 780 382 589"' : 'placeholder="+250 780 382 589 or you@example.com"') + ' required></label>' +
      passwordField("Password", registering ? "new-password" : "current-password", registering ? 10 : 8);
    shell(
      '<h1>' + (registering ? "Create your account." : "Welcome back.") + '</h1>' +
      '<p class="customer-intro">' + (registering ? "Create a Step Town account to keep your orders and details together." : "Sign in to view your profile and order history, or send an order request.") + '</p>' +
      '<form id="customer-auth-form" novalidate>' + fields +
      '<p class="customer-error" role="alert" aria-live="polite">' + escapeHtml(message) + '</p>' +
      '<button class="customer-submit" type="submit">' + (registering ? "Create account" : "Sign in") + '</button></form>' +
      '<div class="customer-divider"><span>OR</span></div>' +
      '<a class="customer-google" href="/api/auth/google?next=' + encodeURIComponent(safeNext) + '"><span class="customer-google-mark">G</span> Continue with Google</a>' +
      '<p class="customer-note">' + (registering ? 'Already have an account? <a href="/login?next=' + encodeURIComponent(safeNext) + '">Sign in</a>.' : 'New to Step Town? <a href="/register?next=' + encodeURIComponent(safeNext) + '">Create an account</a>.') + '</p>' +
      '<p class="customer-note">Staff use the separate <a href="/staff/login">staff sign-in</a>.</p>',
      registering ? "JOIN THE STEP TOWN TABLE" : "YOUR STEP TOWN ACCOUNT"
    );
    const form = app.querySelector("#customer-auth-form");
    wirePasswordToggles(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = form.querySelector(".customer-error");
      error.textContent = "";
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      button.textContent = registering ? "Creating account…" : "Signing in…";
      try {
        const response = await apiFetch(registering ? "/api/auth/register" : "/api/auth/login", {
          method: "POST",
          body: { ...values, next: safeNext }
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 202 && payload.requiresVerification) {
          verificationForm(payload.phone, values.name || "");
          return;
        }
        if (!response.ok) {
          error.textContent = payload.error || "We couldn't sign you in. Please try again.";
          return;
        }
        window.location.assign(payload.next || safeNext);
      } catch (cause) {
        error.textContent = cause.message || "We couldn't reach the sign-in service. Try again.";
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = registering ? "Create account" : "Sign in";
        }
      }
    });
  }

  function verificationForm(phone, name) {
    shell(
      '<h1>Verify your phone.</h1><p class="customer-intro">We sent a one-time code to <strong>' + escapeHtml(phone) + '</strong>. Enter it to finish creating your Step Town account.</p>' +
      '<form id="customer-verify-form"><label class="customer-field"><span>Verification code</span><input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required placeholder="6-digit code"></label>' +
      '<p class="customer-error" role="alert" aria-live="polite"></p><button class="customer-submit" type="submit">Verify and continue</button></form>' +
      '<p class="customer-note"><a href="/register?next=' + encodeURIComponent(safeNext) + '">Back to registration</a></p>',
      "PHONE VERIFICATION"
    );
    app.querySelector("#customer-verify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const error = form.querySelector(".customer-error");
      error.textContent = "";
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Verifying…";
      try {
        const response = await apiFetch("/api/auth/verify", {
          method: "POST",
          body: { phone, token: new FormData(form).get("token"), name, next: safeNext }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          error.textContent = payload.error || "That code could not be verified.";
          return;
        }
        window.location.assign(payload.next || safeNext);
      } catch (cause) {
        error.textContent = cause.message || "Verification failed. Please try again.";
      } finally {
        button.disabled = false;
        button.textContent = "Verify and continue";
      }
    });
  }

  function renderProfile(payload) {
    const profile = payload.profile || {};
    const user = payload.user || {};
    const name = profile.full_name || user.user_metadata?.full_name || user.user_metadata?.name || "Step Town customer";
    const phone = profile.phone || user.phone || "Not provided";
    shell(
      '<h1>Your profile.</h1><p class="customer-intro">Your Step Town account and order details.</p>' +
      '<div class="customer-profile-details"><div><small>FULL NAME</small><strong>' + escapeHtml(name) + '</strong></div><div><small>PHONE NUMBER</small><strong>' + escapeHtml(phone) + '</strong></div></div>' +
      '<div class="customer-profile-actions"><a class="customer-submit" href="/profile/orders">View order history</a><a class="customer-secondary" href="/categories">Browse menu</a><button id="customer-signout" class="customer-secondary" type="button">Sign out</button></div>' +
      '<p class="customer-error" id="customer-profile-error" role="alert"></p>',
      "MY STEP TOWN PROFILE"
    );
    app.querySelector("#customer-signout").addEventListener("click", async () => {
      const button = app.querySelector("#customer-signout");
      button.disabled = true;
      try {
        await apiFetch("/api/auth/logout", { method: "POST", body: {} });
        window.location.assign("/");
      } catch {
        app.querySelector("#customer-profile-error").textContent = "Sign out could not be completed. Please try again.";
        button.disabled = false;
      }
    });
  }

  function renderOrders(payload) {
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    const cards = orders.length ? orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const summary = items.map((item) => escapeHtml(item.name || "Menu item") + " × " + Number(item.quantity || 1)).join(", ");
      const total = order.estimated_total == null ? "Quote to be confirmed" : new Intl.NumberFormat("en-RW", { style: "currency", currency: "RWF", maximumFractionDigits: 0 }).format(Number(order.estimated_total));
      return '<article class="customer-order-card"><div class="customer-order-top"><strong>' + escapeHtml(order.order_number || "Step Town order") + '</strong><span>' + escapeHtml(order.status || "new") + '</span></div><small>' + escapeHtml(order.created_at ? new Date(order.created_at).toLocaleDateString() : "") + ' · ' + escapeHtml(order.fulfillment || "") + '</small><p>' + summary + '</p><b>' + escapeHtml(total) + '</b></article>';
    }).join("") : '<div class="customer-empty-orders"><strong>No orders yet.</strong><p>Your submitted order requests will appear here.</p><a href="/categories">Explore the menu</a></div>';
    shell(
      '<h1>Your orders.</h1><p class="customer-intro">Your recent Step Town order requests.</p>' +
      '<div class="customer-order-list">' + cards + '</div><p class="customer-note"><a href="/profile">Back to profile</a></p>',
      "ORDER HISTORY"
    );
  }

  async function loadProtectedView() {
    shell('<h1>Loading your account…</h1><p class="customer-intro">Checking your secure Step Town session.</p>', "SECURE ACCOUNT");
    try {
      if (route === "/profile/orders") {
        const response = await apiFetch("/api/profile/orders");
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.replace("/login?next=" + encodeURIComponent(route));
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Order history could not be loaded.");
        renderOrders(payload);
      } else {
        const response = await apiFetch("/api/profile");
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          window.location.replace("/login?next=" + encodeURIComponent(route));
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Your profile could not be loaded.");
        renderProfile(payload);
      }
    } catch (cause) {
      shell('<h1>Account unavailable.</h1><p class="customer-intro">' + escapeHtml(cause.message || "Please refresh and try again.") + '</p><a class="customer-submit" href="/login?next=' + encodeURIComponent(route) + '">Sign in again</a>', "SECURE ACCOUNT");
    }
  }

  if (route === "/login" || route === "/register") {
    document.title = route === "/register" ? "Step Town | Create an account" : "Step Town | Customer login";
    if (route === "/login") authForm("login", authError);
    else authForm("register", authError);
  } else {
    document.title = route === "/profile/orders" ? "Step Town | Order history" : "Step Town | Profile";
    loadProtectedView();
  }
}
