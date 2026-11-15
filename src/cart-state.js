const CART_VERSION = 2;
export const CART_STORAGE_KEY = "step-town-cart-v2";
export const CART_VERSION_KEY = "cart_version";
export const LEGACY_CART_KEYS = [
  "step-town-cart-v1",
  "step-town-cart-handoff-v1"
];
export const MAX_ITEM_QUANTITY = 20;
export const MAX_DISTINCT_ITEMS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageOf(storage) {
  const target = storage || globalThis.localStorage;
  if (!target) throw new Error("Browser storage is unavailable.");
  return target;
}

export function clampQuantity(value) {
  const quantity = Math.floor(Number(value));
  return Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number.isFinite(quantity) ? quantity : 1));
}

export function normalizeCartItem(value) {
  if (!value || typeof value !== "object") return null;
  const productId = String(value.product_id || value.id || value.product?.id || "").trim();
  if (!UUID_RE.test(productId)) return null;
  const slug = String(value.slug || value.product?.slug || "").trim().slice(0, 160);
  return {
    product_id: productId,
    slug,
    quantity: clampQuantity(value.quantity)
  };
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.products)) return value.products;
  return Object.values(value).filter(item => item && typeof item === "object");
}

function parseRows(raw) {
  if (!raw) return [];
  try {
    return rowsFrom(JSON.parse(raw));
  } catch {
    return [];
  }
}

function dedupeByMax(rows) {
  const byId = new Map();
  for (const raw of rows) {
    const item = normalizeCartItem(raw);
    if (!item) continue;
    const previous = byId.get(item.product_id);
    byId.set(item.product_id, {
      product_id: item.product_id,
      slug: item.slug || previous?.slug || "",
      quantity: Math.max(previous?.quantity || 0, item.quantity)
    });
  }
  return [...byId.values()].slice(0, MAX_DISTINCT_ITEMS);
}

export function readCart(storage) {
  const target = storageOf(storage);
  const current = target.getItem(CART_STORAGE_KEY);
  if (target.getItem(CART_VERSION_KEY) === String(CART_VERSION)) {
    return dedupeByMax(parseRows(current));
  }
  const legacyRows = LEGACY_CART_KEYS.flatMap(key => parseRows(target.getItem(key)));
  return dedupeByMax([...parseRows(current), ...legacyRows]);
}

export function writeCart(items, storage) {
  const target = storageOf(storage);
  const clean = dedupeByMax(Array.isArray(items) ? items : []);
  target.setItem(CART_STORAGE_KEY, JSON.stringify(clean));
  target.setItem(CART_VERSION_KEY, String(CART_VERSION));
  return clean;
}

export function addItem(product, storage) {
  const productId = String(product?.product_id || product?.id || "").trim();
  if (!UUID_RE.test(productId)) throw new Error("The selected product has an invalid catalogue ID.");
  const slug = String(product?.slug || "").trim().slice(0, 160);
  const current = readCart(storage);
  const existing = current.find(item => item.product_id === productId);
  if (existing) existing.quantity = Math.min(MAX_ITEM_QUANTITY, existing.quantity + 1);
  else {
    if (current.length >= MAX_DISTINCT_ITEMS) throw new Error("Your cart can contain up to 50 different products.");
    current.push({ product_id: productId, slug, quantity: 1 });
  }
  return writeCart(current, storage);
}

export function setQuantity(productId, quantity, storage) {
  const id = String(productId || "");
  const current = readCart(storage);
  const next = current.map(item => item.product_id === id
    ? { ...item, quantity: clampQuantity(quantity) }
    : item);
  return writeCart(next, storage);
}

export function removeItem(productId, storage) {
  const id = String(productId || "");
  return writeCart(readCart(storage).filter(item => item.product_id !== id), storage);
}

export function clearCart(storage) {
  return writeCart([], storage);
}

export function mergeCarts(primary, secondary) {
  return dedupeByMax([...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]);
}

export function badgeCount(cart, resolvedProducts) {
  const ids = new Set((Array.isArray(resolvedProducts) ? resolvedProducts : [])
    .filter(product => product && product.id && product.is_available !== false && product.is_visible !== false)
    .map(product => String(product.id)));
  return dedupeByMax(cart).reduce((total, item) => total + (ids.has(item.product_id) ? item.quantity : 0), 0);
}

export async function migrateLegacyCart(resolveProduct, storage) {
  const target = storageOf(storage);
  if (target.getItem(CART_VERSION_KEY) === String(CART_VERSION)) return readCart(target);

  const candidates = [
    ...parseRows(target.getItem(CART_STORAGE_KEY)),
    ...LEGACY_CART_KEYS.flatMap(key => parseRows(target.getItem(key)))
  ];
  const normalized = dedupeByMax(candidates);
  const migrated = [];

  for (const item of normalized) {
    if (typeof resolveProduct !== "function") {
      if (item.slug) migrated.push(item);
      continue;
    }
    const product = await resolveProduct(item.product_id) || (item.slug ? await resolveProduct(item.slug) : null);
    if (!product?.id || String(product.id) !== item.product_id ||
        product.is_available === false || product.is_visible === false) continue;
    const slug = String(product.slug || item.slug || "").trim().slice(0, 160);
    if (!slug) continue;
    migrated.push({ product_id: item.product_id, slug, quantity: item.quantity });
  }

  const result = writeCart(migrated, target);
  for (const key of LEGACY_CART_KEYS) target.removeItem(key);
  return result;
}
