import { supabase, supabaseConfigured } from "./supabase.js";
import { apiFetch } from "./api.js";

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
    return category ? category.name : "Step Town";
  }

  function categorySlugFor(category) {
    return String(category.slug || category.name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function renderCategories() {
    const allCard = '<a class="category-card category-card-all' + (selectedCategory === "all" ? " is-active" : "") + '" href="/categories"><span class="category-card-kicker">THE FULL MENU</span><strong>Everything</strong><span class="category-card-action">View all menu</span></a>';
    const cards = categories.map((category) => {
      const image = safeImageUrl(category.cover_image_url);
      return '<a class="category-card' + (selectedCategory === category.id ? " is-active" : "") + '" href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : "") +
        '<span class="category-card-overlay"></span><span class="category-card-copy"><span class="category-card-kicker">STEP TOWN MENU</span><strong>' + escapeHtml(category.name) + '</strong><span class="category-card-action">Browse category</span></span></a>';
    }).join("");
    categoryShowcase.innerHTML = allCard + cards;
  }

  function renderCategoryFilters() {
    if (!categoryFilterRow || !categoryRoute || !categorySlug) return;
    const all = '<a href="/categories">All categories</a>';
    const links = categories.map((category) => {
      const active = category.id === selectedCategory;
      return '<a href="/categories/' + encodeURIComponent(categorySlugFor(category)) + '"' + (active ? ' aria-current="page"' : "") + '>' + escapeHtml(category.name) + '</a>';
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
  function productCard(product, index, detail = false) {
    const category = categories.find(item => item.id === product.category_id);
    const imageRecords = (Array.isArray(product.images) && product.images.length ? product.images : (Array.isArray(product.image_urls) ? product.image_urls : [product.image_url]).filter(Boolean).map(url => ({url})));
    const uniqueImages = imageRecords.filter(image => safeImageUrl(image.url)).filter((image,index,array) => array.findIndex(item => item.url === image.url) === index);
    const liked = savedFavourites().includes(product.id);
    const slug = slugFor(product);
    const href = "/product/" + encodeURIComponent(slug);
    const slides = uniqueImages.length ? uniqueImages.map((image, i) => {
      const src = safeImageUrl(image.url);
      const variants = image.variants && typeof image.variants === "object" ? image.variants : {};
      const srcset = Object.entries(variants).filter(([width,url]) => /^\\d+$/.test(width) && safeImageUrl(url)).map(([width,url]) => safeImageUrl(url) + " " + width + "w").join(", ");
      return '<img src="' + escapeHtml(src) + '"' + (srcset ? ' srcset="' + escapeHtml(srcset) + '" sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw"' : '') + ' alt="' + escapeHtml(image.alt_text || product.name + " — photo " + (i+1)) + '" width="800" height="600" ' + (index === 0 && i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"') + ' decoding="async">';
    }).join("") : '<div class="product-image-placeholder" role="img" aria-label="' + escapeHtml(product.name) + ' image unavailable">STEP TOWN</div>';
    const dots = uniqueImages.length > 1 ? '<div class="product-dots" role="group" aria-label="Choose product photo">' + uniqueImages.map((_,i) => '<button type="button" data-dot="' + i + '" aria-label="Show photo ' + (i+1) + '" aria-pressed="' + (i===0) + '" class="' + (i===0 ? 'is-active' : '') + '"></button>').join("") + '</div>' : "";
    const description = escapeHtml(product.description || "Prepared with care by Step Town.");
    const full = detail;
    return '<article class="product-card' + (full ? ' product-card-detail' : '') + '" data-product-card="' + escapeHtml(product.id) + '">' +
      '<div class="product-image">' +
        '<a class="product-open product-image-link" href="' + href + '" aria-label="View ' + escapeHtml(product.name) + '">' +
          '<div class="product-image-strip" tabindex="0" role="region" aria-label="' + escapeHtml(product.name) + ' photos">' + slides + '</div></a>' +
        '<button class="product-image-action product-cart-action" type="button" data-add-product="' + escapeHtml(product.id) + '" aria-label="Add to cart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg><span class="product-cart-plus">+</span></button>' +
        '<button class="product-image-action product-favourite' + (liked ? ' is-saved' : '') + '" type="button" data-favourite="' + escapeHtml(product.id) + '" aria-label="' + (liked ? 'Remove ' : 'Save ') + escapeHtml(product.name) + ' ' + (liked ? 'from' : 'to') + ' favourites" aria-pressed="' + liked + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.2-8.8 10.2-8.8 10.2S3.2 14 3.2 8.8A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.7Z"/></svg></button>' +
        '<span class="product-category" title="' + escapeHtml(category?.name || "Menu") + '">' + escapeHtml(category?.name || "Menu") + '</span>' + dots +
      '</div>' +
      '<div class="product-card-copy"><a class="product-open product-copy-link" href="' + href + '"><h4>' + escapeHtml(product.name) + '</h4></a>' +
        '<p class="product-description' + (full ? ' is-expanded' : '') + '">' + description + '</p>' +
        (!full && product.description && product.description.length > 120 ? '<button type="button" class="product-read-more" data-read-more>Read more</button>' : '') +
        '<div class="product-card-bottom"><strong>' + escapeHtml(product.price == null ? "Request a quote" : money(product.price)) + '</strong>' +
        (full ? '<button class="product-detail-add" type="button" data-add-product="' + escapeHtml(product.id) + '">Add to cart</button>' : '') + '</div>' +
        (full ? '<a class="product-back-link" href="/categories">Back to menu</a>' : '') +
      '</div></article>';
  }
  function renderProducts() {
    const productRoute = pathname.startsWith("/product/");
    const productSlug = productRoute ? pathname.split("/").filter(Boolean).at(-1) : "";
    let filtered = visibleProducts();
    if (productRoute) filtered = products.filter(product => slugFor(product) === productSlug || product.id === productSlug);
    const selected = categories.find(category => category.id === selectedCategory);
    if (productHeading) productHeading.textContent = productRoute ? (filtered[0]?.name || "Product not found") : (selected ? selected.name : "Explore the menu");
    if (catalogCount) catalogCount.textContent = productRoute ? "" : filtered.length + (filtered.length === 1 ? " item" : " items");
    if (!filtered.length) {
      productGrid.innerHTML = "";
      catalogStatus.textContent = productRoute ? "This product could not be found." : (products.length ? "No menu items match your search or category." : "Our menu is being prepared. Contact Step Town for today’s catering options.");
      catalogStatus.hidden = false;
      return;
    }
    catalogStatus.hidden = true;
    productGrid.classList.toggle("product-detail-grid", productRoute);
    productGrid.innerHTML = filtered.map((product,index) => productCard(product,index,productRoute)).join("");
    if (productRoute) {
      const product = filtered[0];
      const title = product.name + " | Step Town";
      document.title = title;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = product.description || title;
    }
  }
  function updateCarousel(card) {
    const strip = card.querySelector(".product-image-strip");
    if (!strip) return;
    const images = [...strip.querySelectorAll("img")];
    if (!images.length) return;
    let nearest = 0, min = Infinity;
    images.forEach((img,index) => { const distance = Math.abs(img.getBoundingClientRect().left - strip.getBoundingClientRect().left); if (distance < min) { min=distance; nearest=index; } });
    card.querySelectorAll("[data-dot]").forEach((dot,index) => {
      dot.classList.toggle("is-active",index===nearest);
      dot.setAttribute("aria-pressed",String(index===nearest));
    });
  }
  function showCartToast(message) {
    let toast = document.querySelector(".store-toast");
    if (!toast) { toast=document.createElement("div"); toast.className="store-toast"; toast.setAttribute("role","status"); document.body.append(toast); }
    toast.textContent=message; toast.classList.add("is-visible");
    window.clearTimeout(showCartToast.timer);
    showCartToast.timer=window.setTimeout(()=>toast.classList.remove("is-visible"),1500);
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
      const linePrice = item.price == null ? "Quote required" : money(item.price * item.quantity);
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
        image_url: safeImageUrl(product.image_url) || safeImageUrl((categories.find((item) => item.id === product.category_id) || {}).cover_image_url),
        quantity: 1
      });
    }
    saveCart();
    renderCart();
    showCartToast("Added to your cart");
  }

  async function loadCatalog() {
    if (!supabaseConfigured || !supabase) {
      catalogStatus.textContent = "The online menu is not connected yet. Please contact Step Town directly while the catalogue is configured.";
      return;
    }

    catalogStatus.hidden = false;
    catalogStatus.textContent = "Loading the Step Town menu…";
    const [categoryResult, productResult] = await Promise.all([
      supabase.from("store_categories").select("id,name,slug,description,cover_image_url,sort_order").eq("is_active", true).order("sort_order"),
      supabase.from("store_products").select("id,category_id,name,description,price,image_url,image_urls,sort_order,is_visible").eq("is_available", true).eq("is_visible", true).order("sort_order")
    ]);

    if (categoryResult.error || productResult.error) {
      console.error("Step Town catalogue could not load:", categoryResult.error || productResult.error);
      catalogStatus.innerHTML = 'We could not load the menu right now. Please <a href="https://wa.me/250780382589" target="_blank" rel="noopener">contact Step Town on WhatsApp </a>.';
      return;
    }

    categories = categoryResult.data || [];
    products = productResult.data || [];
    const ids = products.map(product => product.id);
    if (ids.length) {
      const { data: galleryRows, error: galleryError } = await supabase.from("product_images").select("id,product_id,url,position,alt_text,variants").in("product_id", ids).order("position");
      if (!galleryError && galleryRows?.length) {
        const byProduct = new Map();
        for (const image of galleryRows) { if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []); byProduct.get(image.product_id).push(image); }
        products = products.map(product => ({ ...product, images: byProduct.get(product.id) || [] }));
      }
    }
    if (categorySlug) {
      const requestedCategory = categories.find((item) =>
        item.slug === categorySlug ||
        item.id === categorySlug ||
        categorySlugFor(item) === categorySlug.toLowerCase()
      );
      selectedCategory = requestedCategory ? requestedCategory.id : "__missing_category__";
      document.body.classList.add("route-category-detail");
      const routeTitle = document.querySelector(".route-catalog-heading h1");
      if (routeTitle) routeTitle.textContent = requestedCategory?.name || "Category not found";
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
  }

  // Category cards and filter chips navigate to real /categories/:slug routes.

  productGrid.addEventListener("scroll", event => {
    const strip = event.target.closest(".product-image-strip");
    if (strip) updateCarousel(strip.closest(".product-card"));
  }, true);
  productGrid.addEventListener("keydown", event => {
    const strip = event.target.closest(".product-image-strip");
    if (!strip || !["ArrowLeft","ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    strip.scrollBy({ left: (event.key === "ArrowRight" ? 1 : -1) * strip.clientWidth, behavior: "smooth" });
  });
  productGrid.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-dot]");
    if (dot) {
      const strip = dot.closest(".product-image").querySelector(".product-image-strip");
      const image = strip?.querySelectorAll("img")[Number(dot.dataset.dot)];
      image?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
      return;
    }
    const more = event.target.closest("[data-read-more]");
    if (more) {
      const description = more.previousElementSibling;
      description.classList.toggle("is-expanded");
      more.textContent = description.classList.contains("is-expanded") ? "Read less" : "Read more";
      return;
    }
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
      favourite.setAttribute("aria-label", (saved.includes(id) ? "Remove " : "Save ") + "product " + (saved.includes(id) ? "from" : "to") + " favourites");
      void syncFavouriteAccount(saved);
      return;
    }
    const button = event.target.closest("[data-add-product]");
    if (button) {
      addProduct(button.dataset.addProduct);
      button.classList.add("is-added");
      const svg = button.querySelector("svg");
      if (svg) svg.innerHTML = '<path d="m5 12 4 4L19 6"/>';
      window.setTimeout(() => { if (button.isConnected) { button.classList.remove("is-added"); if (svg) svg.innerHTML = '<path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>'; } },1000);
    }
  });

  if (searchInput) searchInput.addEventListener("input", renderProducts);
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
        checkoutStatus.textContent = payload.error || "We couldn't save your request. Please check your details and try again.";
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
      checkoutStatus.textContent = "We couldn't reach the order service. Please try again or contact Step Town on WhatsApp.";
    } finally {
      checkoutSubmit.disabled = false;
      checkoutSubmit.innerHTML = originalText;
    }
  });

  renderCart();
  loadCatalog();
  if (cartRoute) openCart();
})();
