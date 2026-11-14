import "./cart-page.css";
import { apiFetch } from "./api.js";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const params = new URLSearchParams(window.location.search);
const cartKey = "step-town-cart-v1";
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const money = value => new Intl.NumberFormat("en-RW", {
  style:"currency",currency:"RWF",maximumFractionDigits:0
}).format(Number(value));

let cartItems = [];
let accountData = null;
let accountUser = false;
let persistQueue = Promise.resolve();

function setPage(route) {
  document.body.classList.toggle("route-cart", route === "cart");
  document.body.classList.toggle("route-confirmation", route === "confirmation");
  const cartPage = document.querySelector("#cart-page");
  const confirmPage = document.querySelector("#order-confirmation-page");
  if (cartPage) cartPage.hidden = route !== "cart";
  if (confirmPage) confirmPage.hidden = route !== "confirmation";
}

function imageFor(product) {
  const first = Array.isArray(product?.images) ? product.images[0] : null;
  return (typeof first === "string" ? first : first?.url) ||
    (Array.isArray(product?.image_urls) ? product.image_urls[0] : "") ||
    product?.image_url || "";
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.product_id || raw.id || "");
  const quantity = Math.floor(Number(raw.quantity || 1));
  if (!id || !Number.isFinite(quantity) || quantity < 1) return null;
  const amount = raw.price === null || raw.price === undefined || raw.price === ""
    ? null : Number(raw.price);
  return {
    ...raw,
    id,
    product_id:id,
    slug:String(raw.slug || ""),
    name:String(raw.name || "Menu item"),
    description:String(raw.description || ""),
    category_name:String(raw.category_name || raw.category?.name || "Menu"),
    price:Number.isFinite(amount) ? amount : null,
    price_unit:String(raw.price_unit || "unit"),
    price_unit_label:String(raw.price_unit_label || raw.price_unit || "unit"),
    image_url:String(raw.image_url || imageFor(raw) || ""),
    quantity:Math.min(20, Math.max(1, quantity))
  };
}

function loadGuestCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(cartKey) || "[]");
    return Array.isArray(saved) ? saved.map(normalizeItem).filter(Boolean).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function saveGuestCart() {
  try {
    localStorage.setItem(cartKey, JSON.stringify(cartItems.map(item => ({
      id:item.id,
      product_id:item.product_id,
      slug:item.slug,
      name:item.name,
      description:item.description,
      category_name:item.category_name,
      price:item.price,
      price_unit:item.price_unit,
      price_unit_label:item.price_unit_label,
      image_url:item.image_url,
      image_urls:item.image_urls,
      images:item.images,
      quantity:item.quantity
    }))));
    return true;
  } catch (error) {
    console.warn("Guest cart could not be saved:", error);
    return false;
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { credentials:"same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function getAccount() {
  const { response, data } = await jsonRequest("/api/profile");
  if (response.ok) {
    accountData = data;
    accountUser = true;
    return true;
  }
  if (response.status === 401) {
    accountData = null;
    accountUser = false;
    return false;
  }
  throw new Error(data.error || "We couldn't verify your account.");
}

async function getAccountCart() {
  const { response, data } = await jsonRequest("/api/profile/cart");
  if (!response.ok) throw new Error(data.error || "Your saved cart could not be loaded.");
  return Array.isArray(data.items) ? data.items.map(normalizeItem).filter(Boolean) : [];
}

function mergeCarts(primary, secondary) {
  const merged = new Map();
  for (const raw of [...primary, ...secondary]) {
    const item = normalizeItem(raw);
    if (!item) continue;
    const previous = merged.get(item.product_id);
    if (previous) {
      merged.set(item.product_id, {
        ...previous,
        quantity:Math.min(20, previous.quantity + item.quantity)
      });
    } else {
      merged.set(item.product_id, item);
    }
  }
  return [...merged.values()].slice(0, 50);
}

async function persistCart() {
  if (!accountUser) {
    if (!saveGuestCart()) throw new Error("Your browser could not save this cart. Check available storage and try again.");
    return;
  }
  const operation = async () => {
    const items = cartItems.map(item => ({
      product_id:item.product_id || item.id,
      quantity:item.quantity
    }));
    const response = await apiFetch("/api/profile/cart", {
      method:"PUT",
      body:{ items }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      saveGuestCart();
      throw new Error(data.error || "Your cart could not be saved to your account.");
    }
    try { localStorage.removeItem(cartKey); } catch {}
  };
  persistQueue = persistQueue.then(operation, operation);
  return persistQueue;
}

async function getSelectedProduct(reference) {
  if (!reference) return null;
  const embedded = document.querySelector("#step-menu-initial-data");
  if (embedded) {
    try {
      const initial = JSON.parse(embedded.textContent || "{}");
      const found = (initial.products || []).find(product =>
        String(product.id) === reference || String(product.slug || "") === reference
      );
      if (found) return normalizeItem({ ...found, quantity:1 });
    } catch {}
  }

  const isId = /^[0-9a-f-]{36}$/i.test(reference);
  const query = isId ? "product_id=" : "slug=";
  const { response, data } = await jsonRequest(
    "/api/catalog?limit=1&" + query + encodeURIComponent(reference)
  );
  if (!response.ok) throw new Error(data.error || "The product could not be loaded.");
  const products = Array.isArray(data.products) ? data.products : [];
  const found = products.find(product =>
    String(product.id) === reference || String(product.slug || "") === reference
  );
  return found ? normalizeItem({ ...found, quantity:1 }) : null;
}

function addProduct(product) {
  const item = normalizeItem({ ...product, product_id:product.id, quantity:1 });
  if (!item) throw new Error("This product does not have a valid catalogue ID.");
  const existing = cartItems.find(entry => entry.product_id === item.product_id);
  if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
  else {
    if (cartItems.length >= 50) throw new Error("Your cart can contain up to 50 different products.");
    cartItems.push(item);
  }
}

function isPriced(item) {
  return item.price !== null && item.price !== undefined &&
    item.price !== "" && Number.isFinite(Number(item.price));
}

function cartEstimate() {
  const pricedItems = cartItems.filter(isPriced);
  const subtotal = pricedItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const allPriced = cartItems.length > 0 && pricedItems.length === cartItems.length;
  return { subtotal, allPriced, pricedCount:pricedItems.length };
}

function renderCart() {
  const host = document.querySelector("#cart-product-summary");
  const submit = document.querySelector("#product-order-submit");
  const status = document.querySelector("#product-order-error");
  if (!host) return;

  if (!cartItems.length) {
    host.innerHTML =
      '<div class="cart-empty">' +
        '<span aria-hidden="true">✳</span>' +
        '<strong>Your cart is empty.</strong>' +
        '<p>Choose catering, barbecue or a celebration cake to start an order.</p>' +
        '<a class="text-link" href="/categories">Explore the menu</a>' +
      '</div>';
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Add items to your cart first";
    }
    return;
  }

  const itemsHtml = cartItems.map(item => {
    const image = imageFor(item);
    const priced = isPriced(item);
    const unit = item.price_unit_label || item.price_unit || "unit";
    const lineTotal = priced ? money(Number(item.price) * item.quantity) : "Quote required";
    return '<article class="cart-selected-item" data-cart-product="' + html(item.product_id) + '">' +
      '<div class="cart-selected-image">' +
        (image
          ? '<img src="' + html(image) + '" alt="' + html(item.name) + '" loading="lazy">'
          : '<div class="product-image-placeholder">STEP TOWN</div>') +
      '</div>' +
      '<div class="cart-selected-copy">' +
        '<div class="cart-selected-head"><span class="cart-selected-category">' + html(item.category_name) + '</span>' +
          '<button class="cart-item-remove" type="button" data-cart-action="remove" aria-label="Remove ' + html(item.name) + '">Remove</button></div>' +
        '<h2>' + html(item.name) + '</h2>' +
        (item.description ? '<p class="cart-summary-description">' + html(item.description) + '</p>' : '') +
        '<div class="cart-unit-price"><span>Price per ' + html(unit) + '</span><strong>' + (priced ? html(money(item.price)) : 'To be confirmed') + '</strong></div>' +
        '<div class="cart-item-footer">' +
          '<div class="order-quantity" aria-label="Quantity for ' + html(item.name) + '">' +
            '<button type="button" data-cart-action="decrease" aria-label="Decrease quantity">−</button>' +
            '<output aria-live="polite">' + item.quantity + '</output>' +
            '<button type="button" data-cart-action="increase" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<div class="cart-line-total"><span>Item total</span><strong>' + html(lineTotal) + '</strong></div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }).join("");

  const estimate = cartEstimate();
  const totalText = estimate.allPriced
    ? money(estimate.subtotal)
    : (estimate.pricedCount ? money(estimate.subtotal) + " + quote" : "Quote required");
  const note = estimate.allPriced
    ? "Estimated total only. Step Town will confirm availability and final pricing."
    : "This estimate includes priced items only. Items marked “To be confirmed” will be quoted by Step Town.";
  host.innerHTML =
    '<div class="cart-selected-items">' + itemsHtml + '</div>' +
    '<div class="cart-estimate-bar"><div><span>Estimated cart total</span><strong>' + html(totalText) + '</strong></div>' +
      '<p>' + html(note) + '</p></div>';

  if (submit) {
    submit.disabled = false;
    submit.textContent = "Send order request";
  }
  if (status && status.dataset.clearOnRender === "true") status.textContent = "";
}

function updateDeliveryField() {
  const select = document.querySelector("#order-fulfillment");
  const label = document.querySelector("#order-location-label");
  const input = document.querySelector("#order-delivery-location");
  const delivery = select?.value === "delivery";
  const eventService = select?.value === "event";
  if (label) {
    label.hidden = !(delivery || eventService);
    const labelText = label.firstChild;
    if (labelText && labelText.nodeType === Node.TEXT_NODE) {
      labelText.textContent = eventService ? "Event venue " : "Delivery location ";
    }
  }
  if (input) input.required = Boolean(delivery || eventService);
}

function renderConfirmation() {
  setPage("confirmation");
  const number = document.querySelector("#confirmed-order-number");
  const message = sessionStorage.getItem("step-town-last-order-message") || "";
  if (number) number.textContent = params.get("order") || "";
  const link = document.querySelector("#confirmation-whatsapp");
  if (message && link) {
    link.href = "https://wa.me/250780382589?text=" + encodeURIComponent(message);
    link.hidden = false;
  }
  const details = document.querySelector("#confirmation-details");
  if (details) details.textContent = "Your request has been saved. Step Town will contact you to confirm the details.";
}

async function startCart() {
  setPage("cart");
  const form = document.querySelector("#product-order-form");
  if (!form) return;

  const dateInput = document.querySelector("#order-preferred-date");
  if (dateInput) {
    dateInput.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  cartItems = loadGuestCart();
  const status = document.querySelector("#product-order-error");

  try {
    const signedIn = await getAccount();
    if (signedIn) {
      const accountCart = await getAccountCart();
      cartItems = mergeCarts(accountCart, cartItems);
      if (cartItems.length) await persistCart();
      else {
        try { localStorage.removeItem(cartKey); } catch {}
      }
    }
  } catch (error) {
    if (status) status.textContent = error.message || "Your account cart could not be loaded. Your local cart is still available.";
  }

  const selectedReference = params.get("product");
  if (selectedReference) {
    try {
      const product = await getSelectedProduct(selectedReference);
      if (!product) throw new Error("This product could not be found in the current menu. Please refresh the menu and try again.");
      addProduct(product);
      await persistCart();
      history.replaceState(null, "", "/cart");
      if (status) {
        status.textContent = "Added to your cart.";
        status.dataset.clearOnRender = "true";
      }
    } catch (error) {
      if (status) {
        status.textContent = error.message || "The selected product could not be added.";
        status.dataset.clearOnRender = "false";
      }
      saveGuestCart();
    }
  }

  if (accountUser && accountData) {
    const name = form.elements.customer_name;
    const phone = form.elements.customer_phone;
    const savedName = accountData.profile?.full_name ||
      accountData.user?.user_metadata?.full_name ||
      accountData.user?.user_metadata?.name;
    const savedPhone = accountData.profile?.phone || accountData.user?.phone;
    if (savedName && name) name.value = savedName;
    if (savedPhone && phone) phone.value = savedPhone;
  }

  renderCart();
  updateDeliveryField();
  document.querySelector("#order-fulfillment")?.addEventListener("change", updateDeliveryField);

  const closePage = () => window.location.assign("/categories");
  document.querySelector("#cart-page-close")?.addEventListener("click", closePage);
  document.querySelector("#cart-close")?.addEventListener("click", closePage);

  document.querySelector("#cart-product-summary")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-cart-action]");
    if (!button) return;
    const row = button.closest("[data-cart-product]");
    const id = row?.dataset.cartProduct;
    const item = cartItems.find(entry => entry.product_id === id);
    if (!item) return;

    if (button.dataset.cartAction === "increase") {
      item.quantity = Math.min(20, item.quantity + 1);
    } else if (button.dataset.cartAction === "decrease") {
      item.quantity = Math.max(1, item.quantity - 1);
    } else if (button.dataset.cartAction === "remove") {
      cartItems = cartItems.filter(entry => entry.product_id !== id);
    }
    renderCart();
    try {
      await persistCart();
    } catch (error) {
      if (status) status.textContent = error.message || "Your cart change could not be saved.";
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (status) status.textContent = "";
    if (!cartItems.length) {
      if (status) status.textContent = "Add at least one menu item before sending your order.";
      return;
    }
    if (!form.reportValidity()) return;

    const fields = new FormData(form);
    const order = {
      customer_name:String(fields.get("customer_name") || "").trim(),
      customer_phone:String(fields.get("customer_phone") || "").trim(),
      fulfillment:String(fields.get("fulfillment") || "pickup"),
      requested_date:String(fields.get("requested_date") || "") || null,
      requested_time:String(fields.get("requested_time") || "") || null,
      delivery_location:String(fields.get("delivery_location") || "").trim() || null,
      order_description:String(fields.get("order_description") || "").trim(),
      notes:String(fields.get("notes") || "").trim(),
      website:String(fields.get("website") || ""),
      items:cartItems.map(item => ({
        product_id:item.product_id,
        slug:item.slug,
        quantity:item.quantity
      })),
      product_slug:cartItems[0]?.slug || null,
      quantity:cartItems.reduce((sum, item) => sum + item.quantity, 0)
    };

    const button = document.querySelector("#product-order-submit");
    if (button) {
      button.disabled = true;
      button.textContent = "Sending order…";
    }
    try {
      const response = await apiFetch("/api/orders", { method:"POST", body:order });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (status) status.textContent = data.error || "We could not save your order. Please try again.";
        return;
      }
      const estimate = cartEstimate();
      const message = [
        "Hello Step Town, I have placed an order request.",
        "Order: " + (data.order?.order_number || ""),
        "Name: " + order.customer_name,
        "Phone: " + order.customer_phone,
        "Items:",
        ...cartItems.map(item => {
          const line = item.name + " × " + item.quantity;
          return line + " — " + (isPriced(item) ? money(Number(item.price) * item.quantity) : "Quote required");
        }),
        "Estimated total: " + (estimate.allPriced ? money(estimate.subtotal) : (estimate.pricedCount ? money(estimate.subtotal) + " + quote" : "Quote required")),
        order.order_description ? "Order details: " + order.order_description : "",
        "Fulfilment: " + order.fulfillment,
        order.requested_date ? "Preferred date: " + order.requested_date : "",
        order.requested_time ? "Preferred time: " + order.requested_time : "",
        order.delivery_location ? "Location: " + order.delivery_location : "",
        order.notes ? "Notes: " + order.notes : ""
      ].filter(Boolean).join("\n");
      sessionStorage.setItem("step-town-last-order-message", message);
      cartItems = [];
      try { await persistCart(); } catch (error) {
        console.warn("The order was sent, but the cart could not be cleared from saved items:", error.message);
      }
      try { localStorage.removeItem(cartKey); } catch {}
      window.location.assign("/order/confirmation?order=" + encodeURIComponent(data.order?.order_number || ""));
    } catch (error) {
      if (status) status.textContent = error.message || "Connection problem. Check your internet and try again.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Send order request";
      }
    }
  });

  if (!cartItems.length) {
    const submit = document.querySelector("#product-order-submit");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Add items to your cart first";
    }
  }
}

if (path === "/cart") void startCart();
if (path === "/order/confirmation") renderConfirmation();
