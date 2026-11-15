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


test("gallery menu sits in the card toolbar outside the clipped image wrapper", () => {
  const cardStart = staff.indexOf('<article class="staff-gallery-card">');
  const toolbar = staff.indexOf("staff-gallery-card-toolbar", cardStart);
  const menu = staff.indexOf("staff-gallery-menu", cardStart);
  const image = staff.indexOf("staff-gallery-image-wrap", cardStart);
  assert.ok(cardStart >= 0 && toolbar > cardStart && menu > toolbar && image > menu);
  assert.match(staff, /data-gallery-edit=/);
  assert.match(staff, /data-gallery-publish=/);
  assert.match(staff, /data-gallery-delete=/);
});

test("gallery edit dialog saves title, category, caption and alt text", () => {
  assert.match(staff, /id="staff-gallery-edit-dialog"/);
  assert.match(staff, /fields\.namedItem\("title"\)/);
  assert.match(staff, /fields\.namedItem\("category"\)/);
  assert.match(staff, /caption: String\(fields\.get\("caption"\)/);
  assert.match(staff, /alt_text: String\(fields\.get\("alt_text"\)/);
  assert.match(staff, /gallery_item_edited/);
});

test("gallery menu popover can overflow the card and photo frame", () => {
  assert.match(styles, /\.staff-gallery-card-toolbar\s*\{/);
  assert.match(styles, /\.staff-gallery-menu \.staff-action-menu-pop\s*\{[^}]*position:absolute !important/s);
  assert.match(styles, /\.staff-gallery-manage article\.staff-gallery-card:has\(\.staff-gallery-menu\[open\]\)\s*\{[^}]*z-index:40/s);
});
