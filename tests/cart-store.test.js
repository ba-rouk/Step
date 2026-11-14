import test from "node:test";
import assert from "node:assert/strict";
import { createCartStore } from "../src/cart-store.js";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

test("add stores only stable id, slug and quantity; adding again increments once", () => {
  const storage = new MemoryStorage();
  const cart = createCartStore(storage);
  assert.equal(cart.add({ product_id: "carrots-id", slug: "carrots" }), true);
  assert.equal(cart.add({ product_id: "carrots-id", slug: "carrots", name: "Carrots", price: 900 }), true);
  assert.deepEqual(cart.getItems(), [{ product_id: "carrots-id", slug: "carrots", quantity: 2 }]);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem("step-town-cart-v2"))[0]).sort(), ["product_id", "quantity", "slug"]);
});

test("set quantity clamps at 20 and zero removes the item", () => {
  const cart = createCartStore(new MemoryStorage());
  cart.add({ product_id: "a", slug: "a" });
  cart.setQuantity("a", 99);
  assert.equal(cart.getItems()[0].quantity, 20);
  cart.setQuantity("a", 0);
  assert.deepEqual(cart.getItems(), []);
});

test("remove and clear update the single store", () => {
  const cart = createCartStore(new MemoryStorage());
  cart.add({ product_id: "a", slug: "a" });
  cart.add({ product_id: "b", slug: "b" });
  cart.remove("a");
  assert.deepEqual(cart.getItems().map(item => item.product_id), ["b"]);
  cart.clear();
  assert.deepEqual(cart.getItems(), []);
});

test("legacy formats migrate once, clamp quantities and discard records without stable ids", async () => {
  const storage = new MemoryStorage();
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const c = "33333333-3333-4333-8333-333333333333";
  const d = "44444444-4444-4444-8444-444444444444";
  storage.setItem("step-town-cart-v1", JSON.stringify([
    { id: a, slug: "old-a", quantity: 27, name: "stale name", price: 999 },
    { product_id: b, slug: "b", quantity: 2 },
    { id: "legacy-cake", quantity: 4 },
    { slug: "missing-id", quantity: 1 },
    { slug: "deleted-item", quantity: 3 }
  ]));
  storage.setItem("step-town-cart-handoff-v1", JSON.stringify({ items: [
    { product_id: "a", slug: "new-a", quantity: 3 }
  ] }));
  const cart = createCartStore(storage);
  const migrated = await cart.migrate(async slug => ({ id: slug === "missing-id" ? c : slug === "legacy-cake" ? d : null, slug }));
  assert.deepEqual(migrated, [
    { product_id: a, slug: "old-a", quantity: 20 },
    { product_id: b, slug: "b", quantity: 2 },
    { product_id: d, slug: "legacy-cake", quantity: 4 },
    { product_id: c, slug: "missing-id", quantity: 1 }
  ]);
  assert.equal(storage.getItem("cart_version"), "2");
  assert.equal(storage.getItem("step-town-cart-v1"), null);
  assert.equal(storage.getItem("step-town-cart-handoff-v1"), null);
  const second = await cart.migrate(async () => { throw new Error("must not run twice"); });
  assert.deepEqual(second, migrated);
});

test("ghost cleanup removes ids that no longer resolve in the products API", async () => {
  const cart = createCartStore(new MemoryStorage());
  cart.add({ product_id: "valid", slug: "valid" });
  cart.add({ product_id: "ghost", slug: "ghost" });
  const resolved = await cart.resolve(async items => [{ id: "valid", name: "Carrots" }]);
  assert.deepEqual(resolved.map(item => item.product_id), ["valid"]);
  assert.deepEqual(cart.getItems(), [{ product_id: "valid", slug: "valid", quantity: 1 }]);
});

test("account merge is idempotent and does not double quantities on repeated sync", () => {
  const cart = createCartStore(new MemoryStorage());
  cart.add({ product_id: "a", slug: "a" }, 2);
  cart.merge([{ product_id: "a", slug: "a", quantity: 2 }, { product_id: "b", slug: "b", quantity: 1 }]);
  cart.merge([{ product_id: "a", slug: "a", quantity: 2 }, { product_id: "b", slug: "b", quantity: 1 }]);
  assert.deepEqual(cart.getItems(), [
    { product_id: "a", slug: "a", quantity: 2 },
    { product_id: "b", slug: "b", quantity: 1 }
  ]);
});
