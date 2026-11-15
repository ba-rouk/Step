import test from "node:test";
import assert from "node:assert/strict";
import {
  addCartItem,
  cartItemCount,
  mergeCartItems,
  normalizeCartItems,
  readCartStorage,
  removeCartItem,
  resolveCartProducts,
  setCartQuantity
} from "../src/cart-state.js";

const carrots = "1db3e2d1-391d-4e00-b8ad-c1c0e6da89b6";
const cake = "e990fd39-ea9b-43ab-b7ea-76ad03eabb78";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem:key => values.has(key) ? values.get(key) : null,
    setItem:(key,value) => values.set(key,String(value)),
    removeItem:key => values.delete(key),
    has:key => values.has(key)
  };
}

test("a repeated add increments exactly one unit per action", () => {
  let cart = addCartItem([], {id:carrots,slug:"carrots-1db3e2d1",name:"carrots"});
  assert.equal(cart[0].quantity, 1);
  cart = addCartItem(cart, {id:carrots,slug:"carrots-1db3e2d1",name:"carrots"});
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cartItemCount(cart), 2);
});

test("merging the same cart snapshot does not inflate quantities", () => {
  const saved = [{product_id:carrots,quantity:3}];
  const merged = mergeCartItems(saved, saved, saved);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 3);
});

test("quantity changes and removal act on the selected product only", () => {
  const cart = [{product_id:carrots,quantity:2},{product_id:cake,quantity:1}];
  const changed = setCartQuantity(cart, carrots, 5);
  assert.equal(changed.find(item=>item.product_id===carrots).quantity, 5);
  assert.equal(removeCartItem(changed, cake).length, 1);
  assert.equal(removeCartItem(changed, cake)[0].product_id, carrots);
});

test("legacy v1 cart migrates once and invalid ghost rows are discarded", () => {
  const storage = memoryStorage({
    "step-town-cart-v1": JSON.stringify([
      {product_id:carrots,quantity:2},
      {product_id:"deleted-product",quantity:7}
    ])
  });
  const migrated = readCartStorage(storage, "step-town-cart-v2", ["step-town-cart-v1"]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].quantity, 2);
  assert.equal(storage.has("step-town-cart-v1"), false);
  assert.equal(JSON.parse(storage.getItem("step-town-cart-v2")).length, 1);
});

test("catalogue hydration refreshes price data and removes products that no longer exist", () => {
  const saved = [{product_id:carrots,quantity:2,price:999999},{product_id:cake,quantity:1}];
  const hydrated = resolveCartProducts(saved, [{id:carrots,name:"carrots",price:"1500.00",price_unit:"tray"}]);
  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0].price, "1500.00");
  assert.equal(hydrated[0].quantity, 2);
});

test("malformed storage and malformed rows produce a safe empty cart", () => {
  const storage = memoryStorage({"step-town-cart-v2":"{"});
  assert.deepEqual(readCartStorage(storage, "step-town-cart-v2"), []);
  assert.deepEqual(normalizeCartItems([null,{}, {id:"not-a-product",quantity:4}]), []);
});
