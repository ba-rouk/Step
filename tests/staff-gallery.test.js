import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("staff gallery delete actions bind every matching button", async () => {
  const source = await readFile(new URL("../src/staff-workspace.js", import.meta.url), "utf8");
  assert.match(source, /\$\$\("\[data-gallery-delete\]"\)\.forEach\(/);
  assert.doesNotMatch(source, /(^|[^$])\$\("\[data-gallery-delete\]"\)\.forEach\(/);
});
