const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 50;
const MAX_QUANTITY = 20;

function productIdOf(item) {
  return String(item?.product_id || item?.id || "").trim();
}

function quantityOf(value) {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) ? Math.max(1, Math.min(MAX_QUANTITY, quantity)) : 1;
}

export function normalizeCartItems(rows) {
  const normalized = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== "object") continue;
    const id = productIdOf(raw);
    if (!PRODUCT_ID_PATTERN.test(id)) continue;
    const item = {...raw, id, product_id:id, quantity:quantityOf(raw.quantity)};
    const previous = normalized.get(id);
    normalized.set(id, previous
      ? {...previous, ...item, quantity:Math.max(previous.quantity, item.quantity)}
      : item);
    if (normalized.size >= MAX_ITEMS) break;
  }
  return [...normalized.values()];
}

export function mergeCartItems(...collections) {
  return normalizeCartItems(collections.flatMap(rows => Array.isArray(rows) ? rows : []));
}

export function addCartItem(rows, product) {
  const cart = normalizeCartItems(rows);
  const id = productIdOf(product);
  if (!PRODUCT_ID_PATTERN.test(id)) return cart;
  const existing = cart.find(item => item.product_id === id);
  if (!existing && cart.length >= MAX_ITEMS) return cart;
  if (existing) {
    return cart.map(item => item.product_id === id
      ? {...item, ...product, id, product_id:id, quantity:Math.min(MAX_QUANTITY, item.quantity + 1)}
      : item);
  }
  return normalizeCartItems([...cart, {...product, id, product_id:id, quantity:1}]);
}

export function setCartQuantity(rows, productId, quantity) {
  const id = String(productId || "").trim();
  if (!PRODUCT_ID_PATTERN.test(id)) return normalizeCartItems(rows);
  const nextQuantity = quantityOf(quantity);
  return normalizeCartItems(rows).map(item =>
    item.product_id === id ? {...item, quantity:nextQuantity} : item
  );
}

export function removeCartItem(rows, productId) {
  const id = String(productId || "").trim();
  return normalizeCartItems(rows).filter(item => item.product_id !== id);
}

export function cartItemCount(rows) {
  return normalizeCartItems(rows).reduce((count, item) => count + item.quantity, 0);
}

function parseStoredCart(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function readCartStorage(storage, key, legacyKeys = []) {
  const keys = [key, ...legacyKeys.filter(oldKey => oldKey !== key)];
  const collections = keys.map(storageKey => parseStoredCart(storage, storageKey));
  const cart = mergeCartItems(...collections);
  const serialized = JSON.stringify(cart);
  try {
    if (storage.getItem(key) !== serialized) storage.setItem(key, serialized);
    for (const oldKey of keys.slice(1)) storage.removeItem(oldKey);
  } catch {
    // Keep the in-memory cart usable when browser storage is unavailable.
  }
  return cart;
}

export function writeCartStorage(storage, key, rows) {
  const cart = normalizeCartItems(rows);
  try {
    storage.setItem(key, JSON.stringify(cart));
    return true;
  } catch {
    return false;
  }
}

export function resolveCartProducts(cartItems, catalogueProducts) {
  const products = new Map(
    (Array.isArray(catalogueProducts) ? catalogueProducts : [])
      .map(product => [String(product?.id || product?.product_id || ""), product])
      .filter(([id]) => PRODUCT_ID_PATTERN.test(id))
  );
  return normalizeCartItems(cartItems).flatMap(item => {
    const product = products.get(item.product_id);
    if (!product) return [];
    return [{
      ...item,
      ...product,
      id:item.product_id,
      product_id:item.product_id,
      quantity:item.quantity,
      category_name:product.category_name || product.category?.name || item.category_name || "Menu"
    }];
  });
}
