import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("storefront and staff both load the shared popup and accessible select system", async () => {
  const [main, staff] = await Promise.all([read("../src/main.js"), read("../src/staff.js")]);
  for (const source of [main, staff]) {
    assert.ok(source.includes("popup-dropdown-system.css"));
    assert.ok(source.includes("custom-selects.js"));
    assert.ok(source.includes("popup-controls.js"));
  }
});

test("custom selects preserve native controls and expose accessible listbox semantics", async () => {
  const source = await read("../src/custom-selects.js");
  assert.ok(source.includes('insertAdjacentElement("afterend", root)'));
  assert.ok(source.includes('setAttribute("role", "combobox")'));
  assert.ok(source.includes('setAttribute("role", "listbox")'));
  assert.ok(source.includes('setAttribute("role", "option")'));
  assert.ok(source.includes('dispatchEvent(new Event("change"'));
  assert.ok(source.includes('addEventListener("invalid"'));
  assert.ok(source.includes('addEventListener("reset"'));
  assert.ok(source.includes('Object.defineProperty(select, "value"'));
});

test("staff edit modal supports Escape, backdrop close and keyboard focus trapping", async () => {
  const source = await read("../src/popup-controls.js");
  assert.ok(source.includes('event.key === "Escape"'));
  assert.ok(source.includes("event.target === modal"));
  assert.ok(source.includes("event.shiftKey"));
  assert.ok(source.includes('setAttribute("aria-modal", "true")'));
});

test("public enquiry and order dropdowns match their dark glass form inputs", async () => {
  const css = await read("../src/popup-dropdown-system.css");
  assert.match(css, /\.enquiry-form \.step-select-trigger/);
  assert.match(css, /\.product-order-form \.step-select-trigger/);
  assert.match(css, /background: rgba\(20, 15, 17, \.40\)/);
  assert.match(css, /\.enquiry-form \.step-select-trigger:hover/);
  assert.match(css, /\.product-order-form \.step-select-trigger:focus-visible/);
});
