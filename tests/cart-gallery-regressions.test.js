import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const staff = await readFile(new URL("../src/staff-workspace.js", import.meta.url), "utf8");

test("the dedicated cart route keeps its main content visible", () => {
  const blocks = [...styles.matchAll(/body\.route-cart\s+main\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(
    blocks.some(block => /display:\s*block\s*!important/.test(block)),
    "body.route-cart main must override the legacy display:none rule"
  );
});

test("gallery delete actions bind all matching cards with the collection selector", () => {
  assert.match(staff, /\$\$\("\[data-gallery-delete\]"\)\.forEach/);
  assert.doesNotMatch(staff, /\$\("\[data-gallery-delete\]"\)\.forEach/);
});
