const CART_KEY = "step-town-cart-v2";
const CART_EVENT = "step:cart-updated";

function safeImage(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function normalizeCartItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const productId = String(raw.product_id || raw.id || "");
  const quantity = Math.floor(Number(raw.quantity || 1));
  if (!productId || !/^[0-9a-f-]{36}$/i.test(productId) || !Number.isInteger(quantity) || quantity < 1) return null;
  const amount = raw.price === null || raw.price === undefined || raw.price === "" ? null : Number(raw.price);
  const unitPrice = raw.unit_price === null || raw.unit_price === undefined || raw.unit_price === "" ? amount : Number(raw.unit_price);
  return {
    product_id: productId,
    id: productId,
    slug: String(raw.slug || "").slice(0, 160),
    name: String(raw.name || "Menu item").slice(0, 120),
    description: String(raw.description || "").slice(0, 1200),
    category_name: String(raw.category_name || raw.category?.name || "Menu").slice(0, 80),
    price: Number.isFinite(unitPrice) ? unitPrice : null,
    price_unit: String(raw.price_unit || "unit").slice(0, 32),
    price_unit_label: String(raw.price_unit_label || raw.price_unit || "unit").slice(0, 32),
    image_url: safeImage(raw.image_url || raw.image_urls?.[0] || raw.images?.[0]?.url),
    quantity: Math.min(20, quantity)
  };
}

export function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeCartItem).filter(Boolean).slice(0, 50) : [];
  } catch { return []; }
}

export function saveCart(items) {
  const clean = (Array.isArray(items) ? items : []).map(normalizeCartItem).filter(Boolean).slice(0, 50);
  try { localStorage.setItem(CART_KEY, JSON.stringify(clean)); } catch (error) {
    console.warn("Step Town cart could not be saved locally:", error);
  }
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { items: clean } }));
  return clean;
}

export function getCartCount(items = loadCart()) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function mergeCartItems(first, second) {
  const merged = new Map();
  for (const source of [...(first || []), ...(second || [])]) {
    const item = normalizeCartItem(source);
    if (!item) continue;
    const prior = merged.get(item.product_id);
    merged.set(item.product_id, prior
      ? { ...prior, ...item, quantity: Math.min(20, prior.quantity + item.quantity) }
      : item);
  }
  return [...merged.values()].slice(0, 50);
}

export function addCartItem(product) {
  const item = normalizeCartItem({ ...product, quantity: 1 });
  if (!item) throw new Error("This menu item is unavailable. Refresh the menu and try again.");
  const items = loadCart();
  const existing = items.find(row => row.product_id === item.product_id);
  if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
  else {
    if (items.length >= 50) throw new Error("Your cart can contain up to 50 different products.");
    items.push(item);
  }
  saveCart(items);
  return items;
}

export async function syncCartWithAccount(apiFetch) {
  const sessionResponse = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || !session.authenticated) return { authenticated: false, items: loadCart() };

  const savedResponse = await apiFetch("/api/profile/cart");
  const savedPayload = await savedResponse.json().catch(() => ({}));
  if (!savedResponse.ok) throw new Error(savedPayload.error || "Your saved cart could not be loaded.");

  const merged = mergeCartItems(savedPayload.items || [], loadCart());
  const writeResponse = await apiFetch("/api/profile/cart", {
    method: "PUT",
    body: { items: merged.map(item => ({ product_id: item.product_id, quantity: item.quantity })) }
  });
  const writePayload = await writeResponse.json().catch(() => ({}));
  if (!writeResponse.ok) throw new Error(writePayload.error || "Your cart could not be synced to your account.");
  saveCart(merged);
  return { authenticated: true, items: merged };
}

export async function persistCartToAccount(apiFetch, items = loadCart()) {
  const sessionResponse = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!session.authenticated) return false;
  const response = await apiFetch("/api/profile/cart", {
    method: "PUT",
    body: { items: items.map(item => ({ product_id: item.product_id, quantity: item.quantity })) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Your account cart could not be updated.");
  }
  return true;
}

export const cartUpdatedEvent = CART_EVENT;
