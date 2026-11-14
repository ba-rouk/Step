import { CAKE_CATEGORY, normalizeCategoryLabel } from "./category-config.js";
import { apiFetch } from "./api.js";
import { renderProductCard } from "./product-card.js";
import { renderProductPage } from "./product-page.js";
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
  const orderConfirmationRoute = pathname === "/order-confirmation";
  const categorySlug = categoryRoute && pathname.startsWith("/categories/") ? pathname.split("/").filter(Boolean).at(-1) : "";
  let selectedCategory = "all";
  let menuOffset = 0;
  let menuHasMore = false;
  let menuLoadingMore = false;
  let menuAuthenticated = false;
  let selectedOrderProduct = null;
  let orderQuantity = 1;
  let menuSearchTimer = null;
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
    return category ? normalizeCategoryLabel(category.name, category.slug) : "Step Town";
  }

  function categorySlugFor(category) {
    return normalizeCategoryLabel(category.name, category.slug) === CAKE_CATEGORY.label
      ? CAKE_CATEGORY.slug
      : String(category.slug || category.name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function renderCategories() {
    const allCard = '<a class="category-card category-card-all' + (selectedCategory === "all" ? " is-active" : "") + '" href="/categories"><span class="category-card-kicker">THE FULL MENU</span><strong>Everything</strong><span class="category-card-action">View all menu</span></a>';
    const cards = categories.map((category) => {
      const image = safeImageUrl(category.cover_image_url);
      return '<a class="category-card' + (selectedCategory === category.id ? " is-active" : "") + '" href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : "") +
        '<span class="category-card-overlay"></span><span class="category-card-copy"><span class="category-card-kicker">STEP TOWN MENU</span><strong>' + escapeHtml(categoryName(category.id)) + '</strong><span class="category-card-action">Browse category</span></span></a>';
    }).join("");
    categoryShowcase.innerHTML = allCard + cards;
  }

  function renderCategoryFilters() {
    if (!categoryFilterRow || !categoryRoute || !categorySlug) return;
    const all = '<a href="/categories">All categories</a>';
    const links = categories.map((category) => {
      const active = category.id === selectedCategory;
      return '<a href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '"' + (active ? ' aria-current="page"' : "") + '>' + escapeHtml(categoryName(category.id)) + '</a>';
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
    if (productHeading) productHeading.textContent = productRoute ? (filtered[0]?.name || "Product not found") : (selected ? categoryName(selected.id) : "Explore the menu");
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
    const listLock = document.querySelector("#cart-list-lock");
    const listSection = document.querySelector("#cart-list-section");
    if (cartRoute) {
      if (listLock) listLock.hidden = menuAuthenticated;
      if (listSection) listSection.hidden = !menuAuthenticated;
    }

    if (!cart.length) {
      cartItems.innerHTML = '<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your cart is empty.</strong><p>Browse the menu and add something you love.</p><a href="/categories" class="text-link dark-link" id="cart-browse-menu">Explore the menu</a></div>';
      cartTotal.textContent = "RWF —";
      cartPricingNote.textContent = "Your total will appear here when you add menu items.";
      renderOrderProductSummary();
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
    renderOrderProductSummary();
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
    persistAccountCart();
    showProductToast("Added to your cart");
  }

  async function loadCatalog({ append = false, quiet = false, search = "" } = {}) {
    if (menuLoadingMore) return;
    menuLoadingMore = true;
    const offset = append ? menuOffset : 0;
    const params = new URLSearchParams({ limit: "12", offset: String(offset) });
    if (categorySlug) params.set("category", categorySlug);
    if (search) params.set("search", search.slice(0, 80));
    if (!quiet && !products.length) {
      catalogStatus.hidden = false;
      catalogStatus.textContent = "Loading the Step Town menu…";
      catalogStatus.setAttribute("aria-busy", "true");
    }
    try {
      const response = await fetch("/api/catalog?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-cache"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The menu could not be loaded.");
      categories = Array.isArray(payload.categories) ? payload.categories : categories;
      const nextProducts = Array.isArray(payload.products) ? payload.products : [];
      if (append) {
        const byId = new Map(products.map(product => [product.id, product]));
        nextProducts.forEach(product => byId.set(product.id, product));
        products = [...byId.values()];
      } else {
        products = nextProducts;
      }
      menuOffset = Number(payload.nextOffset || (offset + nextProducts.length));
      menuHasMore = Boolean(payload.hasMore);
      try {
        localStorage.setItem("step-town-menu-cache-v1", JSON.stringify({
          savedAt: Date.now(), categories, products: products.slice(0, 24)
        }));
      } catch (error) {
        console.warn("Menu cache unavailable:", error.message);
      }
      if (categorySlug) {
        const requestedCategory = categories.find(item =>
          item.slug === categorySlug || item.id === categorySlug || categorySlugFor(item) === categorySlug.toLowerCase()
        );
        selectedCategory = requestedCategory ? requestedCategory.id : "__missing_category__";
        document.body.classList.add("route-category-detail");
        const routeTitle = document.querySelector(".route-catalog-heading h1");
        if (routeTitle) routeTitle.textContent = requestedCategory ? categoryName(requestedCategory.id) : "Category not found";
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
      catalogStatus.removeAttribute("aria-busy");
      if (!products.length) {
        catalogStatus.hidden = false;
        catalogStatus.textContent = "No menu items match your search or category.";
      }
      ensureMenuPagination();
    } catch (error) {
      console.error("Step Town catalogue could not load:", error);
      if (!products.length) {
        catalogStatus.hidden = false;
        catalogStatus.textContent = "We could not load the menu right now. Please contact Step Town on WhatsApp.";
      }
      catalogStatus.removeAttribute("aria-busy");
    } finally {
      menuLoadingMore = false;
    }
  }

  function ensureMenuPagination() {
    let sentinel = document.querySelector("#catalog-load-more");
    if (!sentinel) {
      sentinel = document.createElement("div");
      sentinel.id = "catalog-load-more";
      sentinel.className = "catalog-load-more";
      sentinel.setAttribute("aria-hidden", "true");
      productGrid.insertAdjacentElement("afterend", sentinel);
    }
    if (!("IntersectionObserver" in window)) return;
    if (window.stepTownMenuObserver) window.stepTownMenuObserver.disconnect();
    window.stepTownMenuObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && menuHasMore && !menuLoadingMore) {
        loadCatalog({ append: true, quiet: true, search: searchInput?.value.trim() || "" });
      }
    }, { rootMargin: "700px 0px" });
    if (menuHasMore) window.stepTownMenuObserver.observe(sentinel);
  }

  function hydrateInitialMenu() {
    let initial = null;
    const embedded = document.querySelector("#step-town-initial-catalog");
    if (embedded) {
      try { initial = JSON.parse(embedded.textContent || "null"); } catch {}
    }
    if (!initial) {
      try {
        const cached = JSON.parse(localStorage.getItem("step-town-menu-cache-v1") || "null");
        if (cached && Date.now() - Number(cached.savedAt || 0) < 86400000) {
          initial = { categories: cached.categories, products: cached.products, nextOffset: cached.products?.length || 0, hasMore: true };
        }
      } catch {}
    }
    if (!initial) return false;
    categories = Array.isArray(initial.categories) ? initial.categories : [];
    products = Array.isArray(initial.products) ? initial.products : [];
    menuOffset = Number(initial.nextOffset || products.length);
    menuHasMore = Boolean(initial.hasMore);
    if (categorySlug) {
      const requestedCategory = categories.find(item => item.slug === categorySlug || categorySlugFor(item) === categorySlug.toLowerCase());
      selectedCategory = requestedCategory ? requestedCategory.id : "__missing_category__";
    }
    renderCategories();
    renderCategoryFilters();
    renderProducts();
    catalogStatus.hidden = true;
    ensureMenuPagination();
    return true;
  }

  function renderOrderConfirmation() {
    const main = document.querySelector("main");
    if (!main) return;
    const params = new URLSearchParams(window.location.search);
    const orderNumber = params.get("order") || "Submitted";
    let whatsapp = params.get("whatsapp") || "";
    try {
      const url = new URL(whatsapp);
      if (url.hostname !== "wa.me" || url.protocol !== "https:") whatsapp = "";
    } catch { whatsapp = ""; }
    document.body.classList.add("route-order-confirmation");
    document.title = "Order " + orderNumber + " | Step Town";
    main.innerHTML =
      '<section class="order-confirmation page-shell">' +
        '<p class="eyebrow">STEP TOWN · ORDER RECEIVED</p>' +
        '<div class="order-confirmation-mark" aria-hidden="true">✓</div>' +
        '<h1>Thank you. Your order request is on its way.</h1>' +
        '<p>Step Town has received your request. The team will contact you to confirm availability, details and final pricing.</p>' +
        '<div class="order-confirmation-number"><small>YOUR ORDER NUMBER</small><strong>' + escapeHtml(orderNumber) + '</strong></div>' +
        '<div class="order-confirmation-actions">' +
          (whatsapp ? '<a class="button button-dark" href="' + escapeHtml(whatsapp) + '" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>' : "") +
          '<a class="button button-light" href="/categories">Continue browsing</a>' +
        '</div>' +
      '</section>';
  }

  function renderOrderProductSummary() {
    const host = document.querySelector("#order-product-summary");
    if (!host) return;
    if (!selectedOrderProduct) {
      host.innerHTML = cart.length
        ? '<div class="order-summary-cart"><strong>' + cart.length + (cart.length === 1 ? " item" : " items") + ' selected from your cart</strong><p>Your order will include the items shown in the saved cart list below.</p></div>'
        : '<p class="order-summary-empty">Choose a menu item to begin your order.</p>';
      return;
    }
    const product = selectedOrderProduct;
    const image = safeImageUrl(product.images?.[0]?.url) || safeImageUrl(product.image_urls?.[0]) || safeImageUrl(product.image_url);
    host.innerHTML =
      '<article class="order-product-summary">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(product.name) + '" width="160" height="160" loading="eager">' : '<div class="order-product-placeholder">STEP TOWN</div>') +
        '<div class="order-product-copy"><small>' + escapeHtml(normalizeCategoryLabel(product.category_name || "Menu", product.category_slug)) + '</small><h3>' + escapeHtml(product.name) + '</h3>' +
        '<b>' + (product.price == null ? "Quote required" : escapeHtml(money(product.price))) + (product.price == null ? "" : " per " + escapeHtml(product.price_unit_label || product.price_unit || "unit")) + '</b>' +
        '<details><summary>View full description</summary><p>' + escapeHtml(product.description || "Prepared with care by Step Town.") + '</p></details>' +
        '<div class="order-quantity"><button type="button" data-order-quantity="minus" aria-label="Decrease quantity">−</button><output id="order-quantity-value">' + orderQuantity + '</output><button type="button" data-order-quantity="plus" aria-label="Increase quantity">+</button><span>Quantity</span></div></div>' +
      '</article>';
  }

  async function loadSelectedOrderProduct() {
    const slug = new URLSearchParams(window.location.search).get("product");
    if (!cartRoute || !slug) return;
    let product = products.find(item => (item.slug || slugFor(item)) === slug || item.id === slug);
    if (!product) {
      try {
        const response = await fetch("/api/catalog?" + new URLSearchParams({ product: slug, limit: "1" }), { credentials: "same-origin" });
        const payload = await response.json();
        product = payload.products?.[0] || null;
      } catch (error) { console.warn("Selected menu item lookup failed:", error.message); }
    }
    selectedOrderProduct = product || null;
    renderOrderProductSummary();
  }

  async function syncAccountCart() {
    try {
      const sessionResponse = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      const session = await sessionResponse.json().catch(() => ({}));
      menuAuthenticated = Boolean(session.authenticated);
      const lock = document.querySelector("#cart-list-lock");
      const list = document.querySelector("#cart-list-section");
      if (cartRoute) {
        if (lock) lock.hidden = menuAuthenticated;
        if (list) list.hidden = !menuAuthenticated;
      }
      if (menuAuthenticated) {
        const profileResponse = await apiFetch("/api/profile");
        const profile = await profileResponse.json().catch(() => ({}));
        const name = profile.profile?.full_name || profile.user?.user_metadata?.full_name || "";
        const phone = profile.profile?.phone || profile.user?.phone || "";
        const nameInput = checkoutForm.elements.customer_name;
        const phoneInput = checkoutForm.elements.customer_phone;
        if (nameInput && !nameInput.value) nameInput.value = name;
        if (phoneInput && (!phoneInput.value || phoneInput.value === "+250")) phoneInput.value = phone || "+250";
        const accountResponse = await apiFetch("/api/cart");
        const accountPayload = await accountResponse.json().catch(() => ({}));
        const merged = new Map();
        (accountPayload.items || []).forEach(item => merged.set(item.id, {
          product_id: item.id, name: item.name, category_name: item.category_name,
          price: item.price == null ? null : Number(item.price), price_unit: item.price_unit || "unit",
          price_unit_label: item.price_unit_label || item.price_unit || "unit",
          image_url: item.images?.[0]?.url || item.image_urls?.[0] || item.image_url || "",
          quantity: Number(item.quantity || 1)
        }));
        cart.forEach(item => {
          const saved = merged.get(item.product_id);
          if (saved) saved.quantity = Math.min(20, saved.quantity + item.quantity);
          else merged.set(item.product_id, item);
        });
        cart = [...merged.values()].slice(0, 50);
        saveCart();
        await apiFetch("/api/cart", { method: "PUT", body: { items: cart.map(item => ({ product_id: item.product_id, quantity: item.quantity })) } });
      }
    } catch (error) {
      console.warn("Account cart sync deferred:", error.message);
    }
    renderCart();
    renderOrderProductSummary();
  }

  function persistAccountCart() {
    if (!menuAuthenticated) return;
    void apiFetch("/api/cart", { method: "PUT", body: { items: cart.map(item => ({ product_id: item.product_id, quantity: item.quantity })) } })
      .catch(error => console.warn("Account cart update deferred:", error.message));
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
    window.clearTimeout(menuSearchTimer);
    menuSearchTimer = window.setTimeout(() => loadCatalog({ quiet: true, search: searchInput.value.trim() }), 180);
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
    persistAccountCart();
  });

  if (fulfillmentInput && locationInput) {
    const updateLocationRequirement = () => {
      locationInput.required = fulfillmentInput.value === "delivery";
      locationInput.closest("label")?.toggleAttribute("hidden", fulfillmentInput.value !== "delivery");
      locationInput.placeholder = fulfillmentInput.value === "pickup" ? "Optional pickup notes" : "Area, venue or address";
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
    checkoutStatus.textContent = "";
    if (!checkoutForm.reportValidity()) return;
    const formData = new FormData(checkoutForm);
    const items = selectedOrderProduct
      ? [{ product_id: selectedOrderProduct.id, quantity: orderQuantity }]
      : cart.map(item => ({ product_id: item.product_id, quantity: item.quantity }));
    if (!items.length) {
      checkoutStatus.textContent = "Choose a menu item or add products to your cart before sending the order.";
      return;
    }
    const order = {
      customer_name: String(formData.get("customer_name") || "").trim(),
      customer_phone: String(formData.get("customer_phone") || "").trim(),
      customer_email: String(formData.get("customer_email") || "").trim() || null,
      order_description: String(formData.get("order_description") || "").trim(),
      requested_date: String(formData.get("requested_date") || "") || null,
      requested_time: String(formData.get("requested_time") || "") || null,
      fulfillment: String(formData.get("fulfillment") || "pickup"),
      delivery_location: String(formData.get("delivery_location") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
      website: String(formData.get("website") || ""),
      items
    };
    const originalText = checkoutSubmit.textContent;
    checkoutSubmit.disabled = true;
    checkoutSubmit.textContent = "Sending order…";
    try {
      const response = await apiFetch("/api/orders", { method: "POST", body: order });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        checkoutStatus.textContent = [payload.error || "We couldn’t send your order.", payload.suggestion || ""].filter(Boolean).join(" ");
        return;
      }
      const savedOrder = payload.order || {};
      if (!savedOrder.order_number) {
        checkoutStatus.textContent = "Your request was received. Step Town will contact you to confirm the details.";
        return;
      }
      const productNames = selectedOrderProduct
        ? [selectedOrderProduct.name]
        : items.map(item => cart.find(entry => entry.product_id === item.product_id)?.name || "Menu item");
      const message = [
        "Hello Step Town, I have submitted an order request on your website.",
        "Order: " + savedOrder.order_number,
        "Name: " + order.customer_name,
        "Phone: " + order.customer_phone,
        "Description: " + (order.order_description || "As discussed"),
        "Fulfilment: " + order.fulfillment,
        order.requested_date ? "Preferred date: " + order.requested_date : "",
        order.requested_time ? "Preferred time: " + order.requested_time : "",
        order.delivery_location ? "Location: " + order.delivery_location : "",
        ...items.map((item,index) => "- " + productNames[index] + " × " + item.quantity)
      ].filter(Boolean).join("\n");
      const whatsappUrl = "https://wa.me/250780382589?text=" + encodeURIComponent(message);
      if (!selectedOrderProduct) {
        cart = [];
        saveCart();
        persistAccountCart();
      }
      window.location.assign("/order-confirmation?order=" + encodeURIComponent(savedOrder.order_number) + "&whatsapp=" + encodeURIComponent(whatsappUrl));
    } catch (error) {
      console.error("Step Town order request failed:", error);
      checkoutStatus.textContent = "We couldn’t reach the order service. Check your connection and try again, or contact Step Town on WhatsApp.";
    } finally {
      checkoutSubmit.disabled = false;
      checkoutSubmit.textContent = originalText;
    }
  });

  document.querySelector("#order-product-summary")?.addEventListener("click", event => {
    const button = event.target.closest("[data-order-quantity]");
    if (!button || !selectedOrderProduct) return;
    orderQuantity = Math.max(1, Math.min(20, orderQuantity + (button.dataset.orderQuantity === "plus" ? 1 : -1)));
    renderOrderProductSummary();
  });


  const hasInitialMenu = hydrateInitialMenu();
  renderCart();
  if (orderConfirmationRoute) {
    renderOrderConfirmation();
  } else {
    loadCatalog({ quiet: hasInitialMenu });
  }
  void syncAccountCart();
  if (cartRoute) {
    openCart();
    void loadSelectedOrderProduct();
  }
  document.querySelectorAll('a[href="/categories"], [data-dock-route="categories"]').forEach(link => {
    const warm = () => { if (!window.stepTownCategoriesPrefetched) { window.stepTownCategoriesPrefetched = true; fetch("/api/catalog?limit=12&offset=0", { credentials:"same-origin" }).catch(() => {}); } };
    link.addEventListener("pointerenter", warm, { once:true });
    link.addEventListener("focus", warm, { once:true });
    link.addEventListener("touchstart", warm, { once:true, passive:true });
  });
})();
