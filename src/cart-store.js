import { apiFetch } from "./api.js";

const CART_KEY = "step-town-cart-v2";
const VERSION_KEY = "cart_version";
const VERSION = "2";
const LEGACY_KEYS = [
  "step-town-cart-v1",
  "step-town-cart-handoff-v1",
  "step-town-bag-v1",
  "step-town-bag",
  "shopping-bag",
  "cart",
  "bag"
];
const MAX_ITEMS = 50;
const MAX_QUANTITY = 20;

function safeParse(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function unwrapRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "cart", "bag", "products"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeItem(value) {
  if (!value || typeof value !== "object") return null;
  const productId = String(value.product_id || value.id || value.product?.id || "").trim();
  const slug = String(value.slug || value.product?.slug || "").trim().slice(0, 180);
  const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(Number(value.quantity) || 1)));
  if (!productId) return null;
  return { product_id: productId, slug, quantity };
}

function combine(items) {
  const map = new Map();
  for (const raw of items) {
    const item = normalizeItem(raw);
    if (!item) continue;
    const previous = map.get(item.product_id);
    map.set(item.product_id, {
      product_id: item.product_id,
      slug: item.slug || previous?.slug || "",
      quantity: Math.max(previous?.quantity || 0, item.quantity)
    });
  }
  return [...map.values()].slice(0, MAX_ITEMS);
}

export function createCartStore(storage) {
  const target = storage || null;
  const read = (key) => target ? safeParse(target.getItem(key)) : null;
  const write = (items) => {
    if (!target) return false;
    try {
      target.setItem(CART_KEY, JSON.stringify(combine(items)));
      return true;
    } catch { return false; }
  };
  const emit = () => {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("step-town-cart-change"));
    }
  };

  function getItems() {
    return combine(unwrapRows(read(CART_KEY)));
  }

  function replace(items) {
    const next = combine(items);
    if (!write(next)) return false;
    emit();
    return true;
  }

  function add(product, amount = 1) {
    const incoming = normalizeItem({ ...product, quantity: amount });
    if (!incoming) return false;
    const items = getItems();
    const index = items.findIndex(item => item.product_id === incoming.product_id);
    if (index >= 0) {
      items[index] = {
        ...items[index],
        slug: incoming.slug || items[index].slug,
        quantity: Math.min(MAX_QUANTITY, items[index].quantity + incoming.quantity)
      };
    } else {
      if (items.length >= MAX_ITEMS) return false;
      items.push(incoming);
    }
    return replace(items);
  }

  function setQuantity(productId, quantity) {
    const id = String(productId || "");
    const amount = Math.max(0, Math.min(MAX_QUANTITY, Math.floor(Number(quantity) || 0)));
    const items = getItems();
    const found = items.find(item => item.product_id === id);
    if (!found) return false;
    return amount === 0
      ? replace(items.filter(item => item.product_id !== id))
      : replace(items.map(item => item.product_id === id ? { ...item, quantity: amount } : item));
  }

  function remove(productId) {
    const id = String(productId || "");
    return replace(getItems().filter(item => item.product_id !== id));
  }

  function clear() {
    return replace([]);
  }

  async function migrate(resolveLegacySlug) {
    const alreadyMigrated = target && target.getItem(VERSION_KEY) === VERSION;
    if (alreadyMigrated) {
      const clean = getItems();
      write(clean);
      return clean;
    }
    const candidates = [...unwrapRows(read(CART_KEY))];
    for (const key of LEGACY_KEYS) {
      if (key === CART_KEY) continue;
      const legacy = read(key);
      candidates.push(...unwrapRows(legacy));
    }
    const prepared = [];
    let legacyLookupFailed = false;
    for (const raw of candidates) {
      let item = normalizeItem(raw);
      const hasStableId = item && /^[0-9a-f-]{36}$/i.test(item.product_id);
      if (!hasStableId && raw && typeof raw === "object") {
        const slug = String(raw.slug || raw.product?.slug || raw.id || raw.product_id || "").trim();
        if (slug && typeof resolveLegacySlug === "function") {
          try {
            const product = await resolveLegacySlug(slug);
            item = product?.id
              ? normalizeItem({ product_id: product.id, slug: product.slug || slug, quantity: raw.quantity })
              : null;
          } catch { legacyLookupFailed = true; item = null; }
        } else {
          item = null;
        }
      }
      if (item) prepared.push(item);
    }
    // Items may be added while legacy slugs are being resolved. Re-read v2
    // at commit time so migration cannot overwrite a tap that arrived mid-flight.
    const latestCurrent = unwrapRows(read(CART_KEY));
    const migrated = combine([...prepared, ...latestCurrent]);
    if (!write(migrated)) throw new Error("The cart could not be migrated in browser storage.");
    if (target && !legacyLookupFailed) {
      for (const key of LEGACY_KEYS) {
        try { target.removeItem(key); } catch { /* Continue cleanup of other legacy keys. */ }
      }
      target.setItem(VERSION_KEY, VERSION);
    }
    emit();
    return migrated;
  }

  function merge(items) {
    return replace([...getItems(), ...(Array.isArray(items) ? items : [])]);
  }

  async function resolve(resolveProducts) {
    const stored = getItems();
    if (!stored.length) return [];
    const products = await resolveProducts(stored);
    const byId = new Map((Array.isArray(products) ? products : []).map(product => [String(product.id || product.product_id), product]));
    const resolved = [];
    const valid = [];
    for (const item of stored) {
      const product = byId.get(item.product_id);
      if (!product) continue;
      valid.push(item);
      resolved.push({ ...product, product_id: item.product_id, slug: product.slug || item.slug, quantity: item.quantity });
    }
    if (valid.length !== stored.length) replace(valid);
    return resolved;
  }

  return Object.freeze({ getItems, replace, add, setQuantity, remove, clear, migrate, merge, resolve });
}

let browserStorage = null;
try {
  if (typeof window !== "undefined") browserStorage = window.localStorage;
} catch {
  // Storage can be disabled by browser privacy settings; keep the app usable.
}
const store = createCartStore(browserStorage);
let migrationPromise = null;

export const CART_STORAGE_KEY = CART_KEY;
export const CART_VERSION = VERSION;
export const LEGACY_CART_KEYS = Object.freeze([...LEGACY_KEYS]);
export const getCartItems = () => store.getItems();
export const replaceCartItems = items => store.replace(items);
export const addCartItem = (product, amount) => store.add(product, amount);
export const setCartItemQuantity = (productId, quantity) => store.setQuantity(productId, quantity);
export const removeCartItem = productId => store.remove(productId);
export const clearCart = () => store.clear();
export function migrateCart(resolveLegacySlug) {
  if (!migrationPromise) {
    migrationPromise = store.migrate(resolveLegacySlug).finally(() => { migrationPromise = null; });
  }
  return migrationPromise;
}
export const mergeCartItems = items => store.merge(items);

let accountCartSync = Promise.resolve();
export function syncCartToAccount() {
  accountCartSync = accountCartSync.catch(() => {}).then(async () => {
    await migrateCart(async slug => {
      const response = await fetch("/api/catalog?limit=1&slug=" + encodeURIComponent(slug), {
        credentials: "same-origin", cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Legacy cart lookup failed.");
      return (data.products || [])[0] || null;
    });
    const sessionResponse = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!session.authenticated) return false;
    const accountResponse = await fetch("/api/profile/cart", { credentials: "same-origin", cache: "no-store" });
    const accountData = await accountResponse.json().catch(() => ({}));
    if (!accountResponse.ok) throw new Error(accountData.error || "Your account cart could not be loaded.");
    store.merge(Array.isArray(accountData.items) ? accountData.items : []);
    const items = store.getItems();
    const saveResponse = await apiFetch("/api/profile/cart", {
      method: "PUT",
      body: { items: items.map(item => ({ product_id: item.product_id, quantity: item.quantity })) }
    });
    const saved = await saveResponse.json().catch(() => ({}));
    if (!saveResponse.ok) throw new Error(saved.error || "Your account cart could not be saved.");
    return true;
  });
  return accountCartSync;
}
export const resolveCartItems = resolver => store.resolve(resolver);

export async function fetchCartProducts(items, fetcher = fetch) {
  const ids = [...new Set((items || []).map(item => String(item.product_id || "")).filter(Boolean))];
  if (!ids.length) return [];
  const response = await fetcher("/api/catalog?limit=50&ids=" + encodeURIComponent(ids.join(",")), {
    credentials: "same-origin",
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The menu could not be loaded.");
  return Array.isArray(data.products) ? data.products : [];
}

let badgeBound = false;
let badgeRequest = null;
let badgeRefreshPending = false;
export function bindCartBadge() {
  if (typeof document === "undefined" || badgeBound) return;
  badgeBound = true;
  const update = async () => {
    if (badgeRequest) {
      badgeRefreshPending = true;
      return badgeRequest;
    }
    badgeRequest = (async () => {
      const requestedItems = getCartItems();
      let products = [];
      try { products = await fetchCartProducts(requestedItems); }
      catch { return; }
      const validIds = new Set(products.map(product => String(product.id)));
      const requestedIds = new Set(requestedItems.map(item => item.product_id));
      const latestItems = getCartItems();
      const unresolvedRequested = new Set([...requestedIds].filter(id => !validIds.has(id)));
      const cleanedItems = latestItems.filter(item => !unresolvedRequested.has(item.product_id));
      if (cleanedItems.length !== latestItems.length) store.replace(cleanedItems);
      const count = cleanedItems.filter(item => validIds.has(item.product_id)).reduce((sum, item) => sum + item.quantity, 0);
      const addedDuringLookup = cleanedItems.some(item => !requestedIds.has(item.product_id));
      document.querySelectorAll("#mobile-cart-count, [data-cart-count]").forEach(badge => {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = count === 0;
      });
      document.querySelectorAll(".mobile-dock-cart").forEach(link => {
        link.setAttribute("aria-label", count ? "Open cart, " + count + " items" : "Open cart");
      });
      if (addedDuringLookup) badgeRefreshPending = true;
    })().finally(() => {
      badgeRequest = null;
      if (badgeRefreshPending) {
        badgeRefreshPending = false;
        void update();
      }
    });
    return badgeRequest;
  };
  window.addEventListener("step-town-cart-change", update);
  void migrateCart(async slug => {
    const response = await fetch("/api/catalog?limit=1&slug=" + encodeURIComponent(slug), {
      credentials: "same-origin", cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Legacy cart lookup failed.");
    return (data.products || [])[0] || null;
  }).then(update).catch(error => console.warn("Cart migration deferred:", error.message));
  void update();
}
