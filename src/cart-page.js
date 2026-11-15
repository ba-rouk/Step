import "./cart-page.css";
import { GUEST_CART_STORAGE_KEY, LEGACY_GUEST_CART_STORAGE_KEYS, REQUIRE_LOGIN_FOR_CART_LIST } from "./cart-config.js";
import { cartItemCount, mergeCartItems, readCartStorage, removeCartItem, setCartQuantity } from "./cart-state.js";
import { apiFetch } from "./api.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => new Intl.NumberFormat("en-RW", {style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
let savedItems = [];
let busy = false;
let sendingOrder = false;

async function request(url, options = {}) {
  const response = await fetch(url, {credentials:"same-origin", ...options});
  const data = await response.json().catch(() => ({}));
  return {response, data};
}

function setPage() {
  document.body.classList.add("route-cart");
  document.querySelector("#cart-page")?.removeAttribute("hidden");
}

function readGuestCart() {
  return readCartStorage(localStorage, GUEST_CART_STORAGE_KEY, LEGACY_GUEST_CART_STORAGE_KEYS);
}

async function saveAccountCart(items) {
  const response = await apiFetch("/api/profile/cart", {
    method:"PUT",
    body:{items:items.map(item=>({product_id:item.product_id||item.id,quantity:item.quantity}))}
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Your saved cart could not be updated.");
  return data;
}

async function loadAccountCart() {
  const {response,data} = await request("/api/profile/cart");
  if (!response.ok) throw new Error(data.error || "Your saved cart could not be loaded.");
  return Array.isArray(data.items) ? data.items : [];
}

function imageFor(item) {
  const first = Array.isArray(item.images) ? item.images[0] : null;
  const value = (typeof first === "string" ? first : first?.url) ||
    (Array.isArray(item.image_urls) ? item.image_urls[0] : "") || item.image_url || "";
  try {
    const url = new URL(String(value), window.location.origin);
    return ["https:","http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function cartTotal(items) {
  const known = items.filter(item => item.price !== null && item.price !== undefined && item.price !== "" && Number.isFinite(Number(item.price)));
  return {
    amount:known.reduce((sum,item)=>sum + Number(item.price) * item.quantity,0),
    allPriced:items.length > 0 && known.length === items.length,
    hasKnown:known.length > 0
  };
}

function updateBadge() {
  const count = cartItemCount(savedItems);
  document.querySelectorAll("#mobile-cart-count").forEach(badge => {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  });
}

function setCartFormAvailability() {
  const form = document.querySelector("#cart-order-form");
  const submit = document.querySelector("#cart-order-submit");
  if (form) form.hidden = savedItems.length === 0;
  if (submit) submit.disabled = !savedItems.length || busy || sendingOrder;
}

function render() {
  const host = document.querySelector("#saved-cart-list");
  const totalHost = document.querySelector("#saved-cart-total");
  const error = document.querySelector("#cart-page-error");
  if (!host) return;

  if (!savedItems.length) {
    host.setAttribute("aria-busy","false");
    host.innerHTML = '<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your saved cart is empty.</strong><p>Add products from the menu using the cart icon. Your selected products will appear here, followed by one order-details form for the whole cart.</p><a class="button button-dark" href="/categories">Explore the menu</a></div>';
    if (totalHost) totalHost.hidden = true;
    if (error) error.textContent = "";
    setCartFormAvailability();
    updateBadge();
    return;
  }

  host.setAttribute("aria-busy","false");
  host.innerHTML = '<p class="eyebrow">ALL ITEMS IN YOUR CART</p><div class="cart-selected-items">' + savedItems.map(item => {
    const image = imageFor(item);
    const price = item.price == null ? "Price to be confirmed" : money(item.price) + " per " + html(item.price_unit_label || item.price_unit || "unit");
    const line = item.price == null ? "Quote required" : money(Number(item.price) * item.quantity);
    return '<article class="cart-selected-item" data-saved-product="' + html(item.product_id) + '">' +
      '<div class="cart-selected-image">' + (image ? '<img src="' + html(image) + '" alt="' + html(item.name) + '" loading="lazy">' : '<div class="product-image-placeholder">VITANOVA</div>') + '</div>' +
      '<div class="cart-selected-copy"><div class="cart-selected-head"><span class="cart-selected-category">' + html(item.category_name || item.category?.name || "Menu") + '</span><button type="button" class="cart-item-remove" data-action="remove">Remove</button></div>' +
      '<h2>' + html(item.name || "Menu item") + '</h2>' + (item.description ? '<p class="cart-summary-description">' + html(item.description) + '</p>' : '') +
      '<div class="cart-unit-price"><span>' + price + '</span><strong>' + line + '</strong></div>' +
      '<div class="cart-item-footer"><div class="order-quantity"><button type="button" data-action="decrease" aria-label="Decrease quantity" ' + (item.quantity <= 1 ? "disabled" : "") + '>−</button><output>' + item.quantity + '</output><button type="button" data-action="increase" aria-label="Increase quantity" ' + (item.quantity >= 20 ? "disabled" : "") + '>+</button></div><span class="cart-quantity-caption">Quantity in this order</span></div></div></article>';
  }).join("") + '</div>';

  const summary = cartTotal(savedItems);
  if (totalHost) {
    totalHost.hidden = false;
    totalHost.innerHTML = '<div><span>Estimated order total</span><strong>' + (summary.allPriced ? money(summary.amount) : (summary.hasKnown ? money(summary.amount) + " + quote required" : "Quote required")) + '</strong></div><p>Based on the current menu prices and quantities shown above. Vitanova confirms final availability and pricing before accepting the order.</p>';
  }
  if (error) error.textContent = "";
  setCartFormAvailability();
  updateBadge();
}

async function persistAndRender(previous) {
  if (busy) return;
  busy = true;
  render();
  try {
    await saveAccountCart(savedItems);
  } catch (error) {
    savedItems = previous;
    const status = document.querySelector("#cart-page-error");
    if (status) status.textContent = error.message || "Your cart could not be saved. Please try again.";
  } finally {
    busy = false;
    render();
  }
}

function updateDeliveryField(form) {
  const select = form?.elements.fulfillment;
  const label = form?.querySelector("[data-cart-order-location-label]");
  const input = form?.elements.delivery_location;
  const required = select?.value === "delivery" || select?.value === "event";
  if (label) label.hidden = !required;
  if (input) input.required = required;
}

async function prefillSignedInCustomer(form) {
  try {
    const {response,data} = await request("/api/profile");
    if (!response.ok) return;
    const name = data.profile?.full_name || data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || "";
    const phone = data.profile?.phone || data.user?.phone || "";
    const email = data.user?.email || "";
    if (name && form.elements.customer_name) form.elements.customer_name.value = name;
    if (phone && form.elements.customer_phone) form.elements.customer_phone.value = phone;
    if (email && form.elements.customer_email) {
      form.elements.customer_email.value = email;
      form.elements.customer_email.readOnly = true;
      form.elements.customer_email.setAttribute("aria-readonly","true");
    }
  } catch (error) {
    console.warn("Customer details could not be prefilled:",error.message);
  }
}

function cartOrderMessage(order, fields, items) {
  const lines = items.map(item => {
    const price = item.price == null ? "Price to be confirmed" : money(Number(item.price) * item.quantity);
    return item.name + " × " + item.quantity + " — " + price;
  });
  return [
    "Hello Vitanova, I would like to place an order.",
    "Order: " + (order?.order_number || "New order"),
    "Name: " + fields.customer_name,
    "Email: " + fields.customer_email,
    "Phone: " + fields.customer_phone,
    "Items:",
    ...lines,
    "Estimated total: " + (items.every(item => item.price != null) ? money(items.reduce((sum,item)=>sum + Number(item.price)*item.quantity,0)) : "To be confirmed"),
    "Fulfilment: " + fields.fulfillment,
    fields.requested_date ? "Preferred date: " + fields.requested_date : "",
    fields.requested_time ? "Preferred time: " + fields.requested_time : "",
    fields.delivery_location ? "Location: " + fields.delivery_location : "",
    fields.order_description ? "Order details: " + fields.order_description : "",
    fields.notes ? "Notes: " + fields.notes : ""
  ].filter(Boolean).join("\n");
}

async function submitCartOrder(form) {
  const status = document.querySelector("#cart-order-error");
  const submit = document.querySelector("#cart-order-submit");
  if (sendingOrder || busy) return;
  if (status) status.textContent = "";
  if (!savedItems.length) {
    if (status) status.textContent = "Add at least one product to your cart before sending an order.";
    return;
  }
  if (!form.reportValidity()) return;

  const fields = new FormData(form);
  const orderFields = {
    customer_name:String(fields.get("customer_name")||"").trim(),
    customer_phone:String(fields.get("customer_phone")||"").trim(),
    customer_email:String(fields.get("customer_email")||"").trim(),
    fulfillment:String(fields.get("fulfillment")||"pickup"),
    requested_date:String(fields.get("requested_date")||"")||null,
    requested_time:String(fields.get("requested_time")||"")||null,
    delivery_location:String(fields.get("delivery_location")||"").trim(),
    order_description:String(fields.get("order_description")||"").trim(),
    notes:String(fields.get("notes")||"").trim(),
    website:String(fields.get("website")||"")
  };
  const items = savedItems.map(item => ({
    product_id:item.product_id || item.id,
    slug:item.slug,
    name:item.name || "Menu item",
    price:item.price == null || item.price === "" ? null : Number(item.price),
    quantity:Number(item.quantity)
  }));

  sendingOrder = true;
  setCartFormAvailability();
  if (submit) submit.textContent = "Sending order…";
  try {
    const response = await apiFetch("/api/orders", {
      method:"POST",
      body:{
        ...orderFields,
        items:items.map(item=>({product_id:item.product_id,slug:item.slug,quantity:item.quantity})),
        cart_source:"saved_cart"
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "We could not save your order. Please check the details and try again.");

    const resultOrder = data.order || {};
    const totals = cartTotal(items);
    const estimated = resultOrder.estimated_total == null ? (totals.allPriced ? totals.amount : null) : Number(resultOrder.estimated_total);
    const message = cartOrderMessage(resultOrder,orderFields,items);
    saveOrderSession({
      order_number:resultOrder.order_number || "",
      estimated_total:estimated,
      items:items.map(item=>({
        name:item.name,
        quantity:item.quantity,
        line_total:item.price == null ? null : Number(item.price)*item.quantity
      }))
    }, message);
    window.location.assign("/order/confirmation?order=" + encodeURIComponent(resultOrder.order_number || ""));
  } catch (error) {
    if (status) status.textContent = error.message || "Connection problem. Please try again.";
  } finally {
    sendingOrder = false;
    if (submit) submit.textContent = "Send order";
    setCartFormAvailability();
  }
}

async function startCart() {
  setPage();
  const host = document.querySelector("#saved-cart-list");
  const form = document.querySelector("#cart-order-form");
  if (!host) return;
  const guestItems = readGuestCart();

  let accountItems = [];
  let cartLoadWarning = "";
  try {
    const {response,data} = await request("/api/profile");
    if (response.status === 401 && REQUIRE_LOGIN_FOR_CART_LIST) {
      window.location.replace("/login?next=" + encodeURIComponent("/cart"));
      return;
    }
    if (!response.ok) throw new Error(data.error || "Your account cart could not be loaded.");
    accountItems = await loadAccountCart();
  } catch (error) {
    if (!guestItems.length) {
      host.setAttribute("aria-busy","false");
      host.innerHTML = '<div class="cart-empty"><strong>Your cart could not be loaded.</strong><p>' + html(error.message || "Please sign in and try again.") + '</p><a class="button button-dark" href="/login?next=%2Fcart">Sign in</a></div>';
      setCartFormAvailability();
      return;
    }
    // Keep locally saved products visible while the account API recovers.
    cartLoadWarning = "Your cart is shown from this device, but account sync is temporarily unavailable.";
  }

  savedItems = mergeCartItems(accountItems, guestItems);
  render();

  if (guestItems.length && !cartLoadWarning) {
    try {
      await saveAccountCart(savedItems);
      for (const key of [GUEST_CART_STORAGE_KEY, ...LEGACY_GUEST_CART_STORAGE_KEYS]) {
        try { localStorage.removeItem(key); } catch {}
      }
      accountItems = await loadAccountCart();
      savedItems = mergeCartItems(accountItems);
      render();
    } catch (error) {
      // A failed migration must not turn a non-empty cart into an empty one.
      // Keep the device copy so the customer can still review and edit it.
      cartLoadWarning = "Your cart is visible, but some items could not be synced to your account yet. " +
        (error.message || "Please try again shortly.");
    }
  }

  if (cartLoadWarning) {
    const status = document.querySelector("#cart-page-error");
    if (status) status.textContent = cartLoadWarning;
  }

  if (form) {
    const date = form.elements.requested_date;
    if (date) date.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);
    await prefillSignedInCustomer(form);
    updateDeliveryField(form);
    form.elements.fulfillment?.addEventListener("change",()=>updateDeliveryField(form));
    form.addEventListener("submit",event=>{
      event.preventDefault();
      void submitCartOrder(form);
    });
  }

  host.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || busy || sendingOrder) return;
    const row = button.closest("[data-saved-product]");
    const item = savedItems.find(value => value.product_id === row?.dataset.savedProduct);
    if (!item) return;
    const previous = savedItems.map(value => ({...value}));
    if (button.dataset.action === "increase") savedItems = setCartQuantity(savedItems,item.product_id,item.quantity+1);
    else if (button.dataset.action === "decrease" && item.quantity > 1) savedItems = setCartQuantity(savedItems,item.product_id,item.quantity-1);
    else if (button.dataset.action === "remove") savedItems = removeCartItem(savedItems,item.product_id);
    else return;
    await persistAndRender(previous);
  });
}

if (route === "/cart") void startCart();
