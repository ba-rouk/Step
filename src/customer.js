import "../customer.css";
import { apiFetch } from "./api.js";
import { renderProductCard } from "./product-card.js";
import { bindProductGallery, flashCartButton, showProductToast } from "./product-gallery.js";
import { addCartItem, bindCartBadge, syncCartToAccount } from "./cart-store.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const isAuthRoute = ["/login","/register","/profile","/profile/orders","/profile/cart-history"].includes(route);

if (isAuthRoute) {
  void syncCartToAccount().catch(error => console.warn("Account cart merge deferred:", error.message));
  document.body.classList.add("route-customer-page");
  const nextParam = new URLSearchParams(window.location.search).get("next");
  const safeNext = typeof nextParam === "string" &&
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//") &&
    !nextParam.includes("\\") &&
    !nextParam.startsWith("/staff")
      ? nextParam
      : (route.startsWith("/profile") ? route : "/profile");

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
    '<label class="customer-field"><span>' + label + '</span><span class="customer-password-wrap"><input name="password" type="password" minlength="' + minLength + '" maxlength="128" required autocomplete="' + autocomplete + '" placeholder="At least ' + minLength + ' characters"><button class="customer-password-toggle" type="button" data-toggle-password aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg></button></span></label>';

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
    app.innerHTML = '<section class="customer-auth"><div class="customer-auth-card"><p class="customer-kicker">' + kicker + '</p>' + content + '</div></section>';
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
      '<form id="email-code-request" novalidate>' +
      (registering ? '<label class="customer-field"><span>Full name</span><input name="name" type="text" autocomplete="name" minlength="2" maxlength="120" required placeholder="Your full name"></label>' : '') +
      '<label class="customer-field"><span>Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label>' +
      '<p class="customer-error" role="alert" aria-live="polite"></p><button class="customer-submit" type="submit">Email me a login code</button></form>' +
      '<div class="customer-divider"><span>OR USE PASSWORD</span></div>' +
      '<form id="customer-auth-form" novalidate>' + fields +
      '<p class="customer-error" role="alert" aria-live="polite">' + escapeHtml(message) + '</p>' +
      '<button class="customer-submit" type="submit">' + (registering ? "Create account" : "Sign in") + '</button></form>' +
      '<div class="customer-divider"><span>OR</span></div>' +
      '<a class="customer-google" href="/api/auth/google?next=' + encodeURIComponent(safeNext) + '"><svg class="customer-google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.3 30.4 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M47.5 24.5c0-1.6-.2-3.2-.5-4.7H24v9h13.2c-.6 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.6-4.2 7.4-10.2 7.4-17z"/><path fill="#FBBC05" d="M10.4 28.6A14.5 14.5 0 0 1 9.6 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A23.7 23.7 0 0 0 0 24c0 3.8.9 7.5 2.5 10.7z"/><path fill="#34A853" d="M24 48c6.4 0 11.8-2.1 15.7-5.8l-7.5-5.8c-2.1 1.4-4.8 2.2-8.2 2.2-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg> Continue with Google</a>' +
      '<p class="customer-note">' + (registering ? 'Already have an account? <a href="/login?next=' + encodeURIComponent(safeNext) + '">Sign in</a>.' : 'New to Step Town? <a href="/register?next=' + encodeURIComponent(safeNext) + '">Create an account</a>.') + '</p>' +
      '<p class="customer-note">Staff use the separate <a href="/staff/login">staff sign-in</a>.</p>',
      registering ? "JOIN THE STEP TOWN TABLE" : "YOUR STEP TOWN ACCOUNT"
    );
    const codeRequest = app.querySelector("#email-code-request");
    codeRequest?.addEventListener("submit", async event => {
      event.preventDefault();
      const error = codeRequest.querySelector(".customer-error");
      if (!codeRequest.reportValidity()) return;
      const values = Object.fromEntries(new FormData(codeRequest).entries());
      const button = codeRequest.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Sending code…";
      try {
        const response = await apiFetch("/api/auth/email-code/request", {method:"POST",body:{email:values.email}});
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Please try again shortly.");
        emailCodeVerificationForm(String(values.email).trim().toLowerCase(),String(values.name||""));
      } catch (errorValue) {
        error.textContent = errorValue.message || "We could not send a code. Please try again.";
      } finally {
        if (button.isConnected) {button.disabled=false;button.textContent="Email me a login code";}
      }
    });
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

  function emailCodeVerificationForm(email, name) {
    shell(
      '<h1>Check your email.</h1><p class="customer-intro">If <strong>' + escapeHtml(email) + '</strong> can receive mail, a six-digit sign-in code has been sent. It expires in 10 minutes.</p>' +
      '<form id="email-code-verify"><label class="customer-field"><span>Six-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000"></label>' +
      '<p class="customer-error" role="alert" aria-live="polite"></p><button class="customer-submit" type="submit">Verify and sign in</button></form>' +
      '<p class="customer-note"><a href="/login?next=' + encodeURIComponent(safeNext) + '">Use another email address</a></p>',
      "EMAIL VERIFICATION"
    );
    app.querySelector("#email-code-verify").addEventListener("submit", async event => {
      event.preventDefault();
      const form=event.currentTarget,error=form.querySelector(".customer-error");
      if(!form.reportValidity())return;
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;button.textContent="Verifying…";
      try{
        const response=await apiFetch("/api/auth/email-code/verify",{method:"POST",body:{email,code:new FormData(form).get("code"),name,next:safeNext}});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok){error.textContent=payload.error||"That code is invalid or expired.";return;}
        window.location.assign(payload.next||safeNext);
      }catch(errorValue){error.textContent=errorValue.message||"We could not verify that code. Please try again.";}
      finally{if(button.isConnected){button.disabled=false;button.textContent="Verify and sign in";}}
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

  function renderProfile(payload, favouriteProducts = []) {
    const profile = payload.profile || {};
    const user = payload.user || {};
    const name = profile.full_name || user.user_metadata?.full_name || user.user_metadata?.name || "Step Town customer";
    const phone = profile.phone || user.phone || "Not provided";
    const favouritesMarkup = favouriteProducts.length
      ? favouriteProducts.map((product,index) => renderProductCard(product, {
          categoryName: product.category_name || "Menu",
          liked: true,
          eager: index === 0,
          extraClass: "customer-favourite-card"
        })).join("")
      : '<p class="customer-empty-favourites">You have not saved any menu items yet. Tap the heart on a product to add it here.</p>';
    shell(
      '<h1>Your profile.</h1><p class="customer-intro">Your Step Town account and order details.</p>' +
      '<div class="customer-profile-details"><div><small>FULL NAME</small><strong>' + escapeHtml(name) + '</strong></div><div><small>PHONE NUMBER</small><strong>' + escapeHtml(phone) + '</strong></div></div>' +
      '<section class="customer-favourites"><h2>Your favourites</h2><div class="product-grid customer-favourites-grid" data-product-list="shared" data-product-view="favourites">' + favouritesMarkup + '</div></section>' +
      '<div class="customer-profile-actions"><a class="customer-submit" href="/profile/orders">View order history</a><a class="customer-secondary" href="/categories">Browse menu</a><button id="customer-signout" class="customer-secondary" type="button">Sign out</button></div>' +
      '<p class="customer-error" id="customer-profile-error" role="alert"></p>',
      "MY STEP TOWN PROFILE"
    );
    const favouritesGrid = app.querySelector(".customer-favourites-grid");
    bindProductGallery(favouritesGrid);
    favouritesGrid?.addEventListener("click", async (event) => {
      const remove = event.target.closest("[data-favourite]");
      if (remove) {
        const ids = JSON.parse(localStorage.getItem("step-town-favourites-v1") || "[]")
          .filter((id) => id !== remove.dataset.favourite);
        localStorage.setItem("step-town-favourites-v1", JSON.stringify(ids));
        remove.classList.remove("is-saved");
        remove.setAttribute("aria-pressed", "false");
        remove.closest("[data-product-card]")?.remove();
        if (!favouritesGrid.querySelector("[data-product-card]")) {
          favouritesGrid.innerHTML = '<p class="customer-empty-favourites">You have not saved any menu items yet. Tap the heart on a product to add it here.</p>';
        }
        try {
          await apiFetch("/api/profile/favourites", {method:"PUT",body:{product_ids:ids}});
        } catch (error) {
          console.warn("Favourite removal sync deferred:", error.message);
        }
        return;
      }
      const add = event.target.closest("[data-add-product]");
      if (!add) return;
      event.preventDefault();
      event.stopPropagation();
      const product = favouriteProducts.find(item => item.id === add.dataset.addProduct);
      if (!product) return;
      const added = addCartItem({ product_id: String(product.id), slug: String(product.slug || "") });
      if (!added) {
        showProductToast("Your cart could not be updated. Check your browser storage.");
        return;
      }
      bindCartBadge();
      flashCartButton(add);
      let toast = document.querySelector(".store-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "store-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.append(toast);
      }
      toast.innerHTML = 'Added to cart <a href="/cart">View cart</a>';
      toast.classList.add("is-visible");
      clearTimeout(toast._stepTimer);
      toast._stepTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
      void syncCartToAccount().catch(error => console.warn("Favourite cart sync deferred:", error.message));
    });
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
    if (payload.verified === false) {
      shell(
        '<h1>Verify your email.</h1><p class="customer-intro">Verify <strong>' + escapeHtml(payload.email || "your account email") + '</strong> to see your orders, including orders you placed as a guest. We will send a one-time six-digit code to that address.</p>' +
        '<p class="customer-error" id="order-verification-status" role="status" aria-live="polite"></p>' +
        '<button class="customer-submit" id="send-order-verification-code" type="button">Send code</button>' +
        '<p class="customer-note"><a href="/profile">Back to profile</a></p>',
        "EMAIL VERIFICATION REQUIRED"
      );
      app.querySelector("#send-order-verification-code").addEventListener("click", async event => {
        const button=event.currentTarget,status=app.querySelector("#order-verification-status");
        button.disabled=true;button.textContent="Sending code…";
        try{
          const response=await apiFetch("/api/auth/email-code/request",{method:"POST",body:{email:payload.email}});
          if(!response.ok)throw new Error("We could not send a code. Please try again.");
          emailCodeVerificationForm(payload.email,"");
        }catch(error){status.textContent=error.message||"Please try again.";}
        finally{if(button.isConnected){button.disabled=false;button.textContent="Send code";}}
      });
      return;
    }
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    const money = value => new Intl.NumberFormat("en-RW", {
      style: "currency", currency: "RWF", maximumFractionDigits: 0
    }).format(Number(value));
    const cards = orders.length ? orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemMarkup = items.map(item => {
        const name = String(item.name || "Menu item");
        const imageValue = String(item.image_url || "");
        const image = /^https?:\/\//i.test(imageValue) ? imageValue : "";
        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitPrice = item.unit_price ?? item.price ?? null;
        const lineTotal = item.line_total ?? (
          unitPrice == null || !Number.isFinite(Number(unitPrice)) ? null : Number(unitPrice) * quantity
        );
        const priceLabel = unitPrice == null || !Number.isFinite(Number(unitPrice))
          ? "Quote to be confirmed"
          : money(unitPrice) + " per " + escapeHtml(item.price_unit_label || item.price_unit || "unit");
        const totalLabel = lineTotal == null || !Number.isFinite(Number(lineTotal))
          ? ""
          : money(lineTotal);
        return '<div class="customer-order-item">' +
          (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(name) + '" loading="lazy">' : '') +
          '<div class="customer-order-item-copy"><strong>' + escapeHtml(name) + '</strong>' +
          '<small>' + quantity + ' × ' + priceLabel + '</small></div>' +
          (totalLabel ? '<b>' + escapeHtml(totalLabel) + '</b>' : '') +
          '</div>';
      }).join("");
      const total = order.estimated_total == null
        ? "Quote to be confirmed"
        : money(order.estimated_total);
      const detailHref=order.tracking_token?"/order/"+encodeURIComponent(order.tracking_token):"#";
      return '<a class="customer-order-card customer-order-card-link" href="' + detailHref + '"><div class="customer-order-top"><strong>' +
        escapeHtml(order.order_number || "Step Town order") + '</strong><span>' +
        escapeHtml(order.status || "new") + '</span></div><small>' +
        escapeHtml(order.created_at ? new Date(order.created_at).toLocaleDateString() : "") +
        ' · ' + escapeHtml(order.fulfillment || "") + '</small>' +
        '<div class="customer-order-items">' + itemMarkup + '</div>' +
        (order.order_description ? '<p class="customer-order-description"><strong>Describe your order</strong><br>' + escapeHtml(order.order_description) + '</p>' : '') +
        (order.notes ? '<p>' + escapeHtml(order.notes) + '</p>' : '') +
        '<b>' + escapeHtml(total) + '</b>' +
        '</a>';
    }).join("") : '<div class="customer-empty-orders"><strong>No orders yet.</strong><p>Your submitted order requests will appear here.</p><a href="/categories">Explore the menu</a></div>';
    shell(
      '<h1>Your orders.</h1><p class="customer-intro">Your submitted Step Town orders, including requests made as a guest using this account email.</p>' +
      '<div class="customer-order-list">' + cards + '</div><p class="customer-note"><a href="/profile">Back to profile</a></p>',
      "ORDER HISTORY"
    );
  }


  async function loadProtectedView() {
    shell('<h1>Loading your account…</h1><p class="customer-intro">Checking your secure Step Town session.</p>', "SECURE ACCOUNT");
    try {
      if (route === "/profile/cart-history" || route === "/profile/orders") {
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
        const [savedResponse, productResponse] = await Promise.all([
          apiFetch("/api/profile/favourites"),
          fetch("/api/catalog", { credentials:"same-origin" })
        ]);
        const savedPayload = savedResponse.ok ? await savedResponse.json() : { product_ids:[] };
        const productPayload = productResponse.ok ? await productResponse.json() : { products:[] };
        let localIds = [];
        try { localIds = JSON.parse(localStorage.getItem("step-town-favourites-v1") || "[]"); } catch {}
        const mergedIds = [...new Set([...(savedPayload.product_ids || []), ...(Array.isArray(localIds) ? localIds : [])])];
        if (mergedIds.length) {
          await apiFetch("/api/profile/favourites", { method:"PUT", body:{ product_ids:mergedIds } });
          localStorage.setItem("step-town-favourites-v1", JSON.stringify(mergedIds));
        }
        const favouriteProducts = (productPayload.products || []).filter(product => mergedIds.includes(product.id));
        renderProfile(payload, favouriteProducts);
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
    document.title = route === "/profile/orders" ? "Step Town | Order history" : route === "/profile/cart-history" ? "Step Town | Cart history" : "Step Town | Profile";
    loadProtectedView();
  }
}
