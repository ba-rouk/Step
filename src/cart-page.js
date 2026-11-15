import "./cart-page.css";
import { GUEST_CART_STORAGE_KEY, LEGACY_GUEST_CART_STORAGE_KEYS, REQUIRE_LOGIN_FOR_CART_LIST } from "./cart-config.js";
import { cartItemCount, mergeCartItems, readCartStorage, removeCartItem, setCartQuantity, writeCartStorage } from "./cart-state.js";
import { apiFetch } from "./api.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => new Intl.NumberFormat("en-RW", {style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
let savedItems = [];
let busy = false;

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
  const badges = document.querySelectorAll("#mobile-cart-count");
  badges.forEach(badge => {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  });
}

function render() {
  const host = document.querySelector("#saved-cart-list");
  const totalHost = document.querySelector("#saved-cart-total");
  const error = document.querySelector("#cart-page-error");
  if (!host) return;

  if (!savedItems.length) {
    host.setAttribute("aria-busy","false");
    host.innerHTML = '<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your saved cart is empty.</strong><p>Add items from the menu using the cart icon. You can order any individual item directly from its product page.</p><a class="button button-dark" href="/categories">Explore the menu</a></div>';
    if (totalHost) totalHost.hidden = true;
    updateBadge();
    return;
  }

  host.setAttribute("aria-busy","false");
  host.innerHTML = '<p class="eyebrow">SAVED TO YOUR ACCOUNT</p><div class="cart-selected-items">' + savedItems.map(item => {
    const image = imageFor(item);
    const price = item.price == null ? "Price to be confirmed" : money(item.price) + " per " + html(item.price_unit_label || item.price_unit || "unit");
    const line = item.price == null ? "Quote required" : money(Number(item.price) * item.quantity);
    const href = "/order?product=" + encodeURIComponent(item.slug || item.product_id);
    return '<article class="cart-selected-item" data-saved-product="' + html(item.product_id) + '">' +
      '<div class="cart-selected-image">' + (image ? '<img src="' + html(image) + '" alt="' + html(item.name) + '" loading="lazy">' : '<div class="product-image-placeholder">STEP TOWN</div>') + '</div>' +
      '<div class="cart-selected-copy"><div class="cart-selected-head"><span class="cart-selected-category">' + html(item.category_name || item.category?.name || "Menu") + '</span><button type="button" class="cart-item-remove" data-action="remove">Remove</button></div>' +
      '<h2>' + html(item.name || "Menu item") + '</h2>' + (item.description ? '<p class="cart-summary-description">' + html(item.description) + '</p>' : '') +
      '<div class="cart-unit-price"><span>' + price + '</span><strong>' + line + '</strong></div>' +
      '<div class="cart-item-footer"><div class="order-quantity"><button type="button" data-action="decrease" aria-label="Decrease quantity" ' + (item.quantity <= 1 ? "disabled" : "") + '>−</button><output>' + item.quantity + '</output><button type="button" data-action="increase" aria-label="Increase quantity" ' + (item.quantity >= 20 ? "disabled" : "") + '>+</button></div><a class="cart-order-link" href="' + html(href) + '">Order this item</a></div></div></article>';
  }).join("") + '</div>';

  const summary = cartTotal(savedItems);
  if (totalHost) {
    totalHost.hidden = false;
    totalHost.innerHTML = '<div><span>Estimated saved-cart total</span><strong>' + (summary.allPriced ? money(summary.amount) : (summary.hasKnown ? money(summary.amount) + " + quote" : "Quote required")) + '</strong></div><p>This is an estimate only. Each product has its own order form where Step Town confirms final availability and price.</p>';
  }
  if (error) error.textContent = "";
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

async function startCart() {
  setPage();
  const host = document.querySelector("#saved-cart-list");
  if (!host) return;
  const guestItems = readGuestCart();
  try {
    const {response,data} = await request("/api/profile");
    if (response.status === 401 && REQUIRE_LOGIN_FOR_CART_LIST) {
      window.location.replace("/login?next=" + encodeURIComponent("/cart"));
      return;
    }
    if (!response.ok) throw new Error(data.error || "Please sign in to view your saved cart.");

    let accountItems = await loadAccountCart();
    if (guestItems.length) {
      const merged = mergeCartItems(accountItems, guestItems);
      await saveAccountCart(merged);
      for (const key of [GUEST_CART_STORAGE_KEY, ...LEGACY_GUEST_CART_STORAGE_KEYS]) {
        try { localStorage.removeItem(key); } catch {}
      }
      accountItems = await loadAccountCart();
    }
    savedItems = mergeCartItems(accountItems);
    render();
  } catch (error) {
    host.setAttribute("aria-busy","false");
    host.innerHTML = '<div class="cart-empty"><strong>Your cart could not be loaded.</strong><p>' + html(error.message || "Please sign in and try again.") + '</p><a class="button button-dark" href="/login?next=%2Fcart">Sign in</a></div>';
  }

  host.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || busy) return;
    const row = button.closest("[data-saved-product]");
    const item = savedItems.find(value => value.product_id === row?.dataset.savedProduct);
    if (!item) return;
    const previous = savedItems.map(value => ({...value}));
    if (button.dataset.action === "increase") savedItems = setCartQuantity(savedItems, item.product_id, item.quantity + 1);
    else if (button.dataset.action === "decrease" && item.quantity > 1) savedItems = setCartQuantity(savedItems, item.product_id, item.quantity - 1);
    else if (button.dataset.action === "remove") savedItems = removeCartItem(savedItems, item.product_id);
    await persistAndRender(previous);
  });
}

if (route === "/cart") void startCart();
