import { test, expect } from "@playwright/test";

const enabled = Boolean(process.env.E2E_BASE_URL);
const PRODUCT_SLUG = "carrots-1db3e2d1";

function captureDiagnostics(page) {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], apiRequests: [], storageSnapshots: [] };
  page.on("console", message => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", error => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", request => diagnostics.failedRequests.push({
    method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText || "unknown"
  }));
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      diagnostics.apiRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
    }
  });
  return diagnostics;
}

async function snapshotCartStorage(page, label, diagnostics) {
  const values = await page.evaluate(() => {
    const keys = [
      "step-town-cart-v2", "step-town-cart-v1", "step-town-cart-handoff-v1",
      "step-town-bag-v1", "step-town-bag", "shopping-bag", "cart", "bag", "cart_version"
    ];
    return Object.fromEntries(keys
      .map(key => [key, localStorage.getItem(key)])
      .filter(([, value]) => value !== null));
  });
  diagnostics.storageSnapshots.push({ label, values });
}

async function attachDiagnostics(testInfo, diagnostics) {
  await testInfo.attach("cart-browser-diagnostics.json", {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: "application/json"
  });
}

async function openMenuWithGuestSession(page) {
  await page.route("**/api/session", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await page.route("**/api/profile", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Not signed in" }) }));
  await page.goto("/categories");
  const search = page.locator("#menu-search");
  if (await search.count()) await search.fill("carrots");
  const carrotsCard = page.locator("[data-product-card]").filter({ hasText: /carrots/i }).first();
  await expect(carrotsCard).toBeVisible({ timeout: 30_000 });
  return carrotsCard;
}

test.describe("Step Town cart acceptance — 390px mobile", () => {
  test.skip(!enabled, "Set E2E_BASE_URL to a deployed preview with the Carrots product available.");

  test("guest adds carrots once and twice, cart survives reload, remove empties it", async ({ page }, testInfo) => {
    const diagnostics = captureDiagnostics(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    const card = await openMenuWithGuestSession(page);
    await snapshotCartStorage(page, "guest-before-add", diagnostics);
    const add = card.locator("[data-add-product]").first();

    await add.click();
    await expect(page.locator("#mobile-cart-count")).toHaveText("1");
    await add.click();
    await expect(page.locator("#mobile-cart-count")).toHaveText("2");
    await snapshotCartStorage(page, "guest-after-two-adds", diagnostics);

    await page.goto("/cart");
    const savedItem = page.locator('.cart-selected-item[data-cart-kind="saved"]');
    await expect(savedItem).toContainText(/carrots/i);
    await expect(savedItem.locator("output")).toHaveText("2");
    await expect(page.locator("#mobile-cart-count")).toHaveText("2");

    await page.reload();
    await expect(page.locator('.cart-selected-item[data-cart-kind="saved"]')).toContainText(/carrots/i);
    await expect(page.locator('.cart-selected-item[data-cart-kind="saved"] output')).toHaveText("2");
    await expect(page.locator("#mobile-cart-count")).toHaveText("2");

    await page.locator('.cart-selected-item[data-cart-kind="saved"] [data-action="remove"]').click();
    await expect(page.locator("#cart-product-summary")).toContainText("Your cart is empty");
    await expect(page.locator("#mobile-cart-count")).toBeHidden();
    await snapshotCartStorage(page, "guest-after-remove", diagnostics);
    await attachDiagnostics(testInfo, diagnostics);
  });

  test("server renders quick-order details before JavaScript and rejects unknown slugs", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, javaScriptEnabled: false });
    const page = await context.newPage();
    const diagnostics = captureDiagnostics(page);

    const quickResponse = await page.goto(new URL("/cart?product=" + PRODUCT_SLUG, process.env.E2E_BASE_URL).toString());
    expect(quickResponse?.status()).toBe(200);
    await expect(page.locator("#quick-order-summary")).toContainText("ORDER THIS ITEM");
    await expect(page.locator("#quick-order-summary")).toContainText(/carrots/i);
    await expect(page.locator("#product-order-form")).toBeVisible();

    const badResponse = await page.goto(new URL("/cart?product=definitely-not-a-real-step-town-product", process.env.E2E_BASE_URL).toString());
    expect(badResponse?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Product not found." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore the menu" })).toHaveAttribute("href", "/categories");
    await attachDiagnostics(testInfo, diagnostics);
    await context.close();
  });

  test("quick-order form submits once and reaches confirmation", async ({ page }, testInfo) => {
    const diagnostics = captureDiagnostics(page);
    await page.route("**/api/orders", async route => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: {
          order_number: "ST-E2E-0001",
          estimated_total: 1500,
          items: [{ name: "Carrots", quantity: 1, line_total: 1500 }]
        } })
      });
    });
    await page.goto("/cart?product=" + PRODUCT_SLUG);
    await expect(page.locator("#quick-order-summary")).toContainText(/carrots/i);
    await page.locator('[name="customer_name"]').fill("Playwright Guest");
    await page.locator('[name="customer_phone"]').fill("+250780382589");
    await page.locator('[name="customer_email"]').fill("cart-test@example.invalid");
    await page.locator("#product-order-submit").click();
    await expect(page).toHaveURL(/\/order\/confirmation/);
    await expect(page.locator("#confirmed-order-number")).toHaveText("ST-E2E-0001");
    await attachDiagnostics(testInfo, diagnostics);
  });

  test("repeated guest-to-account synchronization keeps max quantity without doubling", async ({ page }, testInfo) => {
    const diagnostics = captureDiagnostics(page);
    let accountWrite = null;
    await page.route("**/api/session", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }));
    await page.route("**/api/profile", route => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { id: "e2e-user", email: "cart-test@example.invalid" }, profile: { full_name: "Playwright Guest", phone: "+250780382589" } })
    }));
    await page.route("**/api/profile/cart", async route => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ items: [] })
        });
      }
      if (route.request().method() === "PUT") {
        accountWrite = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.continue();
    });
    const card = await (async () => {
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/categories");
      const search = page.locator("#menu-search");
      if (await search.count()) await search.fill("carrots");
      const item = page.locator("[data-product-card]").filter({ hasText: /carrots/i }).first();
      await expect(item).toBeVisible({ timeout: 30_000 });
      return item;
    })();
    const add = card.locator("[data-add-product]").first();
    await snapshotCartStorage(page, "guest-before-account-merge", diagnostics);
    await add.click();
    await add.click();
    await page.goto("/cart");
    await expect(page.locator('.cart-selected-item[data-cart-kind="saved"] output')).toHaveText("2");
    await expect(page.locator("#mobile-cart-count")).toHaveText("2");
    await expect.poll(() => accountWrite?.items?.[0]?.quantity).toBe(2);
    await snapshotCartStorage(page, "account-after-merge", diagnostics);
    await attachDiagnostics(testInfo, diagnostics);
  });
});
