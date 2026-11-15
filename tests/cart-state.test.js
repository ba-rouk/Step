import test from "node:test";
import assert from "node:assert/strict";
import {
  CART_STORAGE_KEY,
  CART_VERSION_KEY,
  addItem,
  badgeCount,
  clearCart,
  mergeCarts,
  migrateLegacyCart,
  readCart,
  removeItem,
  setQuantity,
  writeCart
} from "../src/cart-state.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const idA = "1db3e2d1-391d-4e00-b8ad-c1c0e6da89b6";
const idB = "e990fd39-ea9b-43ab-b7ea-76ad03eabb78";
const carrots = { id: idA, slug: "carrots-1db3e2d1", name: "carrots", price: 1500 };
const cake = { id: idB, slug: "chocolate-cake-e990fd39", name: "Chocolate cake", price: 25000 };

test("add stores only product_id, slug and quantity", () => {
  const storage = new MemoryStorage();
  const cart = addItem(carrots, storage);
  assert.deepEqual(cart, [{ product_id: idA, slug: carrots.slug, quantity: 1 }]);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(CART_STORAGE_KEY))[0]).sort(),
    ["product_id", "quantity", "slug"]);
  assert.equal(storage.getItem(CART_VERSION_KEY), "2");
});

test("adding the same product again increments exactly one", () => {
  const storage = new MemoryStorage();
  addItem(carrots, storage);
  const cart = addItem(carrots, storage);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

test("set quantity clamps to the supported range", () => {
  const storage = new MemoryStorage();
  writeCart([{ product_id: idA, slug: carrots.slug, quantity: 1 }], storage);
  assert.equal(setQuantity(idA, 500, storage)[0].quantity, 20);
  assert.equal(setQuantity(idA, 0, storage)[0].quantity, 1);
});

test("remove and clear update the canonical store", () => {
  const storage = new MemoryStorage();
  writeCart([
    { product_id: idA, slug: carrots.slug, quantity: 2 },
    { product_id: idB, slug: cake.slug, quantity: 1 }
  ], storage);
  assert.deepEqual(removeItem(idA, storage), [
    { product_id: idB, slug: cake.slug, quantity: 1 }
  ]);
  assert.deepEqual(clearCart(storage), []);
  assert.deepEqual(readCart(storage), []);
});

test("legacy migration resolves and converts product snapshots", async () => {
  const storage = new MemoryStorage();
  storage.setItem("step-town-cart-v1", JSON.stringify([
    { product_id: idA, slug: carrots.slug, name: "stale name", price: 1, quantity: 3 },
    { product_id: idB, slug: cake.slug, name: "stale cake", quantity: 1 }
  ]));
  const resolved = async ref => ref === idA ? carrots : ref === idB ? cake : null;
  const cart = await migrateLegacyCart(resolved, storage);
  assert.deepEqual(cart, [
    { product_id: idA, slug: carrots.slug, quantity: 3 },
    { product_id: idB, slug: cake.slug, quantity: 1 }
  ]);
  assert.equal(storage.getItem("step-town-cart-v1"), null);
  assert.equal(storage.getItem(CART_VERSION_KEY), "2");
});

test("migration removes ghost products and malformed legacy data", async () => {
  const storage = new MemoryStorage();
  storage.setItem("step-town-cart-v1", JSON.stringify([
    { product_id: idA, slug: carrots.slug, quantity: 2 },
    { product_id: idB, slug: cake.slug, quantity: 4 },
    { product_id: "not-a-product", slug: "ghost", quantity: 6 }
  ]));
  const cart = await migrateLegacyCart(async ref => ref === idA ? carrots : null, storage);
  assert.deepEqual(cart, [{ product_id: idA, slug: carrots.slug, quantity: 2 }]);
});

test("merge on login takes the maximum quantity for mirrored products", () => {
  const merged = mergeCarts(
    [{ product_id: idA, slug: carrots.slug, quantity: 2 }],
    [
      { product_id: idA, slug: carrots.slug, quantity: 2 },
      { product_id: idB, slug: cake.slug, quantity: 1 }
    ]
  );
  assert.deepEqual(merged, [
    { product_id: idA, slug: carrots.slug, quantity: 2 },
    { product_id: idB, slug: cake.slug, quantity: 1 }
  ]);
});

test("badge counts only quantities for resolved, available products", () => {
  const cart = [
    { product_id: idA, slug: carrots.slug, quantity: 2 },
    { product_id: idB, slug: cake.slug, quantity: 3 }
  ];
  assert.equal(badgeCount(cart, [carrots]), 2);
  assert.equal(badgeCount(cart, [carrots, { ...cake, is_available: false }]), 2);
});
