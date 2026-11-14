import { supabase, supabaseConfigured } from "./supabase.js";
import { apiFetch } from "./api.js";
import { renderProductCard } from "./product-card.js";
import { renderProductPage } from "./product-page.js";
import { normalizeCategoryLabel } from "./catalog-config.js";
import { bindProductGallery, flashCartButton, showProductToast } from "./product-gallery.js";

(() => {
  const categoryShowcase = document.querySelector("#category-showcase");
  const productGrid = document.querySelector("#product-grid");
  const catalogStatus = document.querySelector("#catalog-status");
  const catalogCount = document.querySelector("#catalog-count");
  const productHeading = document.querySelector("#product-heading");
  const categoryFilterRow = document.querySelector("#category-filter-row");
  const searchInput = document.querySelector("#menu-search");
  const cartOpen = null;
  const mobileCartOpen = document.querySelector(".mobile-dock-cart");
  const cartClose = document.querySelector("#cart-close");
  const cartBackdrop = document.querySelector("#cart-backdrop");
  const cartDrawer = document.querySelector("#cart-drawer");
  const cartItems = document.querySelector("#cart-items");
  const cartCount = document.querySelector("#mobile-cart-count");
  const cartTotal = document.querySelector("#cart-total");
  const cartPricingNote = document.querySelector("#cart-pricing-note");
  const checkoutForm = document.querySelector("#checkout-form");
  const checkoutStatus = document.querySelector("#checkout-status");
  const checkoutSubmit = document.querySelector("#checkout-submit");
  const fulfillmentInput = document.querySelector("#checkout-fulfillment");
  const locationInput = document.querySelector("#checkout-location");
  const checkoutDate = document.querySelector("#checkout-date");
  const storageKey = "step-town-cart-v1";

  if (!categoryShowcase || !productGrid || !cartDrawer || !checkoutForm) return;

  let categories = [];
  let products = [];
  const pathname = decodeURIComponent(window.location.pathname.replace(/\/+$/, "") || "/");
  const categoryRoute = pathname === "/categories" || pathname.startsWith("/categories/");
  const galleryRoute = pathname === "/gallery";
  const cartRoute = pathname === "/cart";
  const categorySlug = categoryRoute && pathname.startsWith("/categories/") ? pathname.split("/").filter(Boolean).at(-1) : "";
  if (pathname === "/cart" || pathname === "/order/confirmation") return;
  let selectedCategory = "all";
  if (categoryRoute) document.body.classList.add("route-categories");
  if (galleryRoute) document.body.classList.add("route-gallery");
  if (cartRoute) document.body.classList.add("route-cart");
  const routeSearchMount = document.querySelector(".route-search-mount");
  const routeSearch = document.querySelector(".storefront-hero .menu-search");
  if (categoryRoute && routeSearchMount && routeSearch) routeSearchMount.append(routeSearch);
  let cart = loadCart();
  let lastCartTrigger = mobileCartOpen || cartOpen;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function money(value) {
    return new Intl.NumberFormat("en-RW", {
      style: "currency", currency: "RWF", maximumFractionDigits: 0
    }).format(Number(value));
  }

  function loadCart() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(saved)) return [];
      return saved.filter((item) => item && typeof item.product_id === "string" && Number(item.quantity) > 0)
        .slice(0, 50)
        .map((item) => ({
          product_id: item.product_id,
          name: String(item.name || "Menu item").slice(0, 120),
          category_name: String(item.category_name || "").slice(0, 80),
          price: item.price == null ? null : Number(item.price),
          price_unit: String(item.price_unit || "unit"),
          price_unit_label: String(item.price_unit_label || item.price_unit || "unit"),
          image_url: safeImageUrl(item.image_url),
          quantity: Math.min(20, Math.max(1, Math.floor(Number(item.quantity))))
        }));
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      if (cartPricingNote) cartPricingNote.textContent = "Your browser could not save this cart between visits.";
    }
  }

  function categoryName(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    return category ? normalizeCategoryLabel(category.name) : "Step Town";
  }

  function categorySlugFor(category) {
    return String(category.slug || normalizeCategoryLabel(category.name) || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function renderCategories() {
    const allCard = '<a class="category-card category-card-all' + (selectedCategory === "all" ? " is-active" : "") + '" href="/categories"><span class="category-card-kicker">THE FULL MENU</span><strong>Everything</strong><span class="category-card-action">View all menu</span></a>';
    const cards = categories.map((category) => {
      const image = safeImageUrl(category.cover_image_url);
      return '<a class="category-card' + (selectedCategory === category.id ? " is-active" : "") + '" href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : "") +
        '<span class="category-card-overlay"></span><span class="category-card-copy"><span class="category-card-kicker">STEP TOWN MENU</span><strong>' + escapeHtml(normalizeCategoryLabel(category.name)) + '</strong><span class="category-card-action">Browse category</span></span></a>';
    }).join("");
    categoryShowcase.innerHTML = allCard + cards;
  }

  function renderCategoryFilters() {
    if (!categoryFilterRow || !categoryRoute || !categorySlug) return;
    const all = '<a href="/categories">All categories</a>';
    const links = categories.map((category) => {
      const active = category.id === selectedCategory;
      return '<a href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '"' + (active ? ' aria-current="page"' : "") + '>' + escapeHtml(normalizeCategoryLabel(category.name)) + '</a>';
    }).join("");
    categoryFilterRow.innerHTML = all + links;
  }

  function visibleProducts() {
    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
    return products.filter((product) => {
      const inCategory = selectedCategory === "all" || product.category_id === selectedCategory;
      const text = (product.name + " " + (product.description || "") + " " + categoryName(product.category_id)).toLowerCase();
      return inCategory && (!search || text.includes(search));
    });
  }

  function slugFor(product) {
    return String(product.slug || product.name || product.id).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || product.id;
  }
  function savedFavourites() {
    try { const ids = JSON.parse(localStorage.getItem("step-town-favourites-v1") || "[]"); return Array.isArray(ids) ? ids : []; } catch { return []; }
  }
  function renderProducts() {
    const productRoute = pathname.startsWith("/product/");
    const productSlug = productRoute ? pathname.split("/").filter(Boolean).at(-1) : "";
    let filtered = visibleProducts();
    if (productRoute) filtered = products.filter(product => slugFor(product) === productSlug || product.id === productSlug);
    const selected = categories.find(category => category.id === selectedCategory);
    if (productHeading) productHeading.textContent = productRoute ? (filtered[0]?.name || "Product not found") : (selected ? normalizeCategoryLabel(selected.name) : "Explore the menu");
    if (catalogCount) catalogCount.textContent = productRoute ? "" : filtered.length + (filtered.length === 1 ? " item" : " items");
    if (!filtered.length) {
      productGrid.innerHTML = "";
      catalogStatus.textContent = productRoute ? "This product could not be found." : (products.length ? "No menu items match your search or category." : "Our menu is being prepared. Contact Step Town for today’s catering options.");
      catalogStatus.hidden = false;
      return;
    }
    catalogStatus.hidden = true;
    productGrid.classList.toggle("product-detail-grid", productRoute);
    productGrid.dataset.productList = "shared";
    productGrid.dataset.productView = productRoute ? "detail" : (categoryRoute ? "categories" : "home");
    productGrid.setAttribute("aria-label", productRoute ? "Step Town product details" : "Step Town products");

    if (productRoute) {
      productGrid.innerHTML = renderProductPage(filtered[0], {
        categoryName: categoryName(filtered[0].category_id),
        liked: savedFavourites().includes(filtered[0].id)
      });
    } else {
      productGrid.innerHTML = filtered.map((product, index) => renderProductCard(product, {
        categoryName: categoryName(product.category_id),
        liked: savedFavourites().includes(product.id),
        eager: index === 0
      })).join("");
    }
    if (productRoute) {
      const product = filtered[0];
      const title = product.name + " | Step Town";
      document.title = title;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = product.description || title;
    }
  }
  async function syncFavouriteAccount(ids) {
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
      const session = await sessionResponse.json();
      if (!session.authenticated) return;
      await apiFetch("/api/profile/favourites", { method: "PUT", body: { product_ids: ids } });
    } catch (error) { console.warn("Favourite sync deferred:", error.message); }
  }
  function renderCart() {
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) {
      cartCount.textContent = itemCount > 99 ? "99+" : String(itemCount);
      cartCount.hidden = itemCount <= 0;
    }
    if (mobileCartOpen) {
      mobileCartOpen.setAttribute("aria-label", itemCount ? "Cart, " + itemCount + " items" : "Cart");
    }
    if (!cartItems) return;

    if (!cart.length) {
      cartItems.innerHTML = '<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your cart is empty.</strong><p>Browse the menu and add something you love.</p><a href="/categories" class="text-link dark-link" id="cart-browse-menu">Explore the menu</a></div>';
      cartTotal.textContent = "RWF —";
      cartPricingNote.textContent = "Your total will appear here when you add menu items.";
      return;
    }

    const allPriced = cart.every((item) => item.price != null && Number.isFinite(item.price));
    const subtotal = allPriced ? cart.reduce((sum, item) => sum + item.price * item.quantity, 0) : null;
    cartTotal.textContent = subtotal == null ? "Quote required" : money(subtotal);
    cartPricingNote.textContent = allPriced
      ? "This is an estimate. Step Town will confirm the final price and availability."
      : "At least one item needs a custom quote. Step Town will confirm the final price.";
    cartItems.innerHTML = cart.map((item) => {
      const image = safeImageUrl(item.image_url);
      const unitText = item.price_unit_label || item.price_unit || "unit";
      const linePrice = item.price == null ? "Quote required" : money(item.price) + " per " + unitText + " · " + money(item.price * item.quantity) + " estimated";
      return '<article class="cart-item">' +
        '<div class="cart-item-image">' + (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : '<span>ST</span>') + '</div>' +
        '<div class="cart-item-copy"><span>' + escapeHtml(item.category_name) + '</span><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(linePrice) + '</small>' +
        '<div class="cart-quantity"><button type="button" data-cart-action="decrease" data-product-id="' + escapeHtml(item.product_id) + '" aria-label="Decrease quantity">−</button><span>' + item.quantity + '</span><button type="button" data-cart-action="increase" data-product-id="' + escapeHtml(item.product_id) + '" aria-label="Increase quantity">+</button><button class="cart-remove" type="button" data-cart-action="remove" data-product-id="' + escapeHtml(item.product_id) + '">Remove</button></div></div></article>';
    }).join("");
  }

  function openCart() {
    cartDrawer.hidden = false;
    cartDrawer.setAttribute("aria-hidden", "false");
    cartDrawer.setAttribute("aria-modal", cartRoute ? "false" : "true");
    cartDrawer.setAttribute("role", cartRoute ? "region" : "dialog");
    cartBackdrop.hidden = cartRoute;
    if (!cartRoute) document.body.classList.add("cart-open");
    if (cartClose) cartClose.focus();
  }

  function closeCart() {
    if (cartRoute) { window.location.assign("/categories"); return; }
    cartDrawer.hidden = true;
    cartDrawer.setAttribute("aria-hidden", "true");
    cartBackdrop.hidden = true;
    document.body.classList.remove("cart-open");
    if (lastCartTrigger?.isConnected) lastCartTrigger.focus();
  }

  function addProduct(productId) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const existing = cart.find((item) => item.product_id === productId);
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + 1);
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        category_name: categoryName(product.category_id),
        price: product.price == null ? null : Number(product.price),
        price_unit: String(product.price_unit || "unit"),
        price_unit_label: String(product.price_unit_label || product.price_unit || "unit"),
        image_url: safeImageUrl(product.images?.[0]?.url) || safeImageUrl(product.image_urls?.[0]) || safeImageUrl(product.image_url) || safeImageUrl((categories.find((item) => item.id === product.category_id) || {}).cover_image_url),
        quantity: 1
      });
    }
    saveCart();
    renderCart();
    showProductToast("Added to your cart");
  }

  const menuPageSize = 12;
  const menuCacheKey = "step-town-menu-v2:" + (categorySlug || "all");
  let menuOffset = 0;
  let menuHasMore = false;
  let menuSearch = "";
  let menuLoadingMore = false;
  let searchTimer = null;

  function parseMenuCache() {
    try {
      const raw = localStorage.getItem(menuCacheKey);
      const value = raw ? JSON.parse(raw) : null;
      return value && Array.isArray(value.categories) && Array.isArray(value.products) ? value : null;
    } catch { return null; }
  }
  function saveMenuCache(data) {
    try {
      localStorage.setItem(menuCacheKey, JSON.stringify({
        cachedAt: Date.now(),
        categories,
        products,
        total: Number(data?.total ?? products.length),
        hasMore: menuHasMore
      }));
    } catch (error) { console.warn("Menu cache unavailable:", error.message); }
  }
  function applyMenuPage(data, append = false) {
    if (Array.isArray(data.categories) && data.categories.length) categories = data.categories;
    const incoming = Array.isArray(data.products) ? data.products : [];
    products = append ? [...products, ...incoming] : incoming;
    menuOffset = products.length;
    menuHasMore = Boolean(data.hasMore);
    if (categorySlug) {
      const requestedCategory = categories.find(item =>
        item.slug === categorySlug || item.id === categorySlug || categorySlugFor(item) === categorySlug.toLowerCase()
      );
      selectedCategory = requestedCategory ? requestedCategory.id : "__missing_category__";
      document.body.classList.add("route-category-detail");
      const routeTitle = document.querySelector(".route-catalog-heading h1");
      if (routeTitle) routeTitle.textContent = normalizeCategoryLabel(requestedCategory?.name || "Category not found");
      const routeIntro = document.querySelector(".route-catalog-heading > p:not(.eyebrow)");
      if (routeIntro) routeIntro.textContent = requestedCategory?.description || "Browse the menu items in this category.";
      const routeHeading = document.querySelector(".route-catalog-heading");
      if (routeHeading && !routeHeading.querySelector(".category-back-link")) {
        const back = document.createElement("a");
        back.className = "category-back-link";
        back.href = "/categories";
        back.textContent = "All categories";
        routeHeading.append(back);
      }
    }
    renderCategories();
    renderCategoryFilters();
    renderProducts();
    if (catalogStatus) catalogStatus.hidden = true;
    syncLoadMore();
  }
  function ensureLoadMore() {
    let host = document.querySelector("#catalog-pagination");
    if (!host) {
      host = document.createElement("div");
      host.id = "catalog-pagination";
      host.className = "catalog-pagination";
      productGrid.insertAdjacentElement("afterend", host);
    }
    if (!host.querySelector("button")) {
      host.innerHTML = '<button type="button" class="button button-dark" id="catalog-load-more">Load more</button>';
      host.querySelector("button").addEventListener("click", () => loadMoreProducts());
    }
    return host;
  }
  function syncLoadMore() {
    const host = ensureLoadMore();
    host.hidden = !menuHasMore;
    const button = host.querySelector("button");
    if (button) {
      button.disabled = menuLoadingMore;
      button.textContent = menuLoadingMore ? "Loading…" : "Load more";
    }
    if (menuHasMore && "IntersectionObserver" in window && !host.dataset.observing) {
      host.dataset.observing = "true";
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) void loadMoreProducts();
      }, { rootMargin: "320px 0px" });
      observer.observe(host);
    }
  }
  async function fetchMenuPage(offset = 0, search = "", append = false) {
    const params = new URLSearchParams({ limit: String(menuPageSize), offset: String(offset) });
    if (categorySlug) params.set("category", categorySlug);
    if (search) params.set("q", search);
    const response = await fetch("/api/catalog?" + params.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "default"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The menu could not be loaded.");
    applyMenuPage(data, append);
    if (!search) saveMenuCache(data);
    return data;
  }
  async function loadMoreProducts() {
    if (menuLoadingMore || !menuHasMore) return;
    menuLoadingMore = true;
    syncLoadMore();
    try { await fetchMenuPage(menuOffset, menuSearch, true); }
    catch (error) { console.warn("More menu items could not load:", error.message); }
    finally { menuLoadingMore = false; syncLoadMore(); }
  }
  async function loadCatalog() {
    let initial = null;
    const embedded = document.querySelector("#step-menu-initial-data");
    if (embedded) {
      try { initial = JSON.parse(embedded.textContent || "{}"); } catch (error) { console.warn("Initial menu data was invalid:", error); }
    }
    if (!initial?.products?.length) initial = parseMenuCache();
    if (initial?.products?.length) {
      categories = initial.categories || [];
      applyMenuPage(initial);
      saveMenuCache(initial);
    } else {
      catalogStatus.hidden = false;
      catalogStatus.textContent = "Loading the Step Town menu…";
    }
    if (!supabaseConfigured || !supabase) {
      if (!products.length) catalogStatus.textContent = "The online menu is not connected yet. Please contact Step Town directly.";
      return;
    }
    try {
      // Hydrate from the server cache in the background while embedded or
      // last-known products remain visible and interactive.
      await fetchMenuPage(0, "", false);
    } catch (error) {
      console.error("Step Town catalogue refresh failed:", error);
      if (!products.length) {
        catalogStatus.hidden = false;
        catalogStatus.innerHTML = 'We could not load the menu right now. Please <a href="https://wa.me/250780382589" target="_blank" rel="noopener">contact Step Town on WhatsApp</a>.';
      }
    }
  }
  // Category cards and filter chips navigate to real /categories/:slug routes.

  bindProductGallery(productGrid);
  productGrid.addEventListener("click", (event) => {
    const favourite = event.target.closest("[data-favourite]");
    if (favourite) {
      const key = "step-town-favourites-v1";
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
      const id = favourite.dataset.favourite;
      saved = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
      localStorage.setItem(key, JSON.stringify(saved));
      favourite.classList.toggle("is-saved", saved.includes(id));
      favourite.setAttribute("aria-pressed", String(saved.includes(id)));
      favourite.setAttribute("aria-label", (saved.includes(id) ? "Remove from" : "Add to") + " favourites");
      void syncFavouriteAccount(saved);
      return;
    }
    const button = event.target.closest("[data-add-product]");
    if (button) {
      addProduct(button.dataset.addProduct);
      flashCartButton(button);
    }
  });
  if (searchInput) searchInput.addEventListener("input", () => {
    menuSearch = searchInput.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try { await fetchMenuPage(0, menuSearch, false); }
      catch (error) { console.warn("Menu search failed:", error.message); }
    }, 160);
  });
  document.querySelectorAll('.desktop-primary-nav a[href="/categories"], .primary-nav a[href="/categories"], .mobile-dock a[href="/categories"]').forEach(link => {
    const warmMenu = () => fetch("/api/catalog?limit=12&offset=0", { credentials:"same-origin" }).catch(() => {});
    link.addEventListener("pointerenter", warmMenu, { once:true });
    link.addEventListener("focus", warmMenu, { once:true });
    link.addEventListener("touchstart", warmMenu, { once:true, passive:true });
  });
  // The Cart tab opens the public /cart page; login is required only when submitting an order.
    if (cartClose) cartClose.addEventListener("click", closeCart);
  if (cartBackdrop) cartBackdrop.addEventListener("click", closeCart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !cartDrawer.hidden) closeCart();
  });

  cartItems.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-action]");
    if (!button) return;
    const item = cart.find((entry) => entry.product_id === button.dataset.productId);
    if (!item) return;
    if (button.dataset.cartAction === "increase") item.quantity = Math.min(20, item.quantity + 1);
    if (button.dataset.cartAction === "decrease") item.quantity -= 1;
    if (button.dataset.cartAction === "remove" || item.quantity <= 0) {
      cart = cart.filter((entry) => entry.product_id !== button.dataset.productId);
    }
    saveCart();
    renderCart();
  });

  if (fulfillmentInput && locationInput) {
    const updateLocationRequirement = () => {
      locationInput.required = fulfillmentInput.value !== "pickup";
      locationInput.placeholder = fulfillmentInput.value === "pickup" ? "Optional collection notes" : "Area, venue or address";
    };
    fulfillmentInput.addEventListener("change", updateLocationRequirement);
    updateLocationRequirement();
  }

  if (checkoutDate) {
    const today = new Date();
    checkoutDate.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (checkoutStatus) checkoutStatus.textContent = "";

    if (!cart.length) {
      checkoutStatus.textContent = "Add at least one menu item before sending your order request.";
      return;
    }
    if (!checkoutForm.reportValidity()) return;

    const formData = new FormData(checkoutForm);
    const order = {
      customer_name: String(formData.get("customer_name") || "").trim(),
      customer_phone: String(formData.get("customer_phone") || "").trim(),
      customer_email: String(formData.get("customer_email") || "").trim() || null,
      fulfillment: String(formData.get("fulfillment") || "pickup"),
      requested_date: String(formData.get("requested_date") || "") || null,
      delivery_location: String(formData.get("delivery_location") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
      items: cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity
      }))
    };

    const originalText = checkoutSubmit.innerHTML;
    checkoutSubmit.disabled = true;
    checkoutSubmit.textContent = "Saving your request…";

    try {
      const response = await apiFetch("/api/orders", { method: "POST", body: order });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        window.location.assign("/login?next=" + encodeURIComponent("/cart"));
        return;
      }
      if (!response.ok) {
        checkoutStatus.textContent = [payload.error || "We couldn't save your request.", payload.suggestion ? "How to fix it: " + payload.suggestion : ""].filter(Boolean).join(" ");
        return;
      }

      const savedOrder = payload.order || {};
      const finalTotal = savedOrder.estimated_total == null ? null : Number(savedOrder.estimated_total);
      const messageLines = [
        "Hello Step Town, I have submitted an order request on your website.",
        "",
        "Order: " + (savedOrder.order_number || "New order request"),
        "Name: " + order.customer_name,
        "Phone: " + order.customer_phone,
        "Fulfilment: " + order.fulfillment,
        order.requested_date ? "Requested date: " + order.requested_date : "",
        order.delivery_location ? "Location: " + order.delivery_location : "",
        "",
        "Order items:",
        ...cart.map((item) => "- " + item.name + " × " + item.quantity),
        finalTotal == null ? "Total: To be confirmed by Step Town" : "Estimated total: " + money(finalTotal),
        order.notes ? "Notes: " + order.notes : ""
      ].filter(Boolean);
      const whatsappUrl = "https://wa.me/250780382589?text=" + encodeURIComponent(messageLines.join("\n"));

      cart = [];
      saveCart();
      renderCart();
      checkoutForm.reset();
      if (fulfillmentInput && locationInput) locationInput.required = false;
      checkoutStatus.innerHTML = 'Your order request has been saved. <a href="' + escapeHtml(whatsappUrl) + '" target="_blank" rel="noopener noreferrer">Continue on WhatsApp</a>';
    } catch (error) {
      console.error("Step Town order request failed:", error);
      checkoutStatus.textContent = "Connection problem: " + (error.message || "The order service could not be reached.") + " Try again after checking your internet connection. If it continues, contact Step Town on WhatsApp.";
    } finally {
      checkoutSubmit.disabled = false;
      checkoutSubmit.innerHTML = originalText;
    }
  });

  renderCart();
  loadCatalog();
  if (cartRoute) openCart();
})();
