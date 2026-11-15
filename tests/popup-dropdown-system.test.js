import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("storefront and staff both load the shared popup and accessible select system", async () => {
  const [main, staff] = await Promise.all([read("../src/main.js"), read("../src/staff.js")]);
  for (const source of [main, staff]) {
    assert.match(source, /popup-dropdown-system\\.css/);
    assert.match(source, /custom-selects\\.js/);
    assert.match(source, /popup-controls\\.js/);
  }
});

test("custom selects preserve native controls and expose combobox/listbox semantics", async () => {
  const source = await read("../src/custom-selects.js");
  assert.match(source, /insertAdjacentElement\\("afterend", root\\)/);
  assert.match(source, /setAttribute\\("role", "combobox"\\)/);
  assert.match(source, /setAttribute\\("role", "listbox"\\)/);
  assert.match(source, /setAttribute\\("role", "option"\\)/);
  assert.match(source, /dispatchEvent\\(new Event\\("change"/);
  assert.match(source, /addEventListener\\("invalid"/);
  assert.match(source, /addEventListener\\("reset"/);
});

test("staff edit modal supports Escape, backdrop close and keyboard focus trapping", async () => {
  const source = await read("../src/popup-controls.js");
  assert.match(source, /event\\.key === "Escape"/);
  assert.match(source, /event\\.target === modal/);
  assert.match(source, /event\\.shiftKey/);
  assert.match(source, /aria-modal/);
});
