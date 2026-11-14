import { supabase, supabaseConfigured } from "./supabase.js";
import { apiFetch } from "./api.js";
import { renderProductCard } from "./product-card.js";
import { renderProductPage } from "./product-page.js";
import { normalizeCategoryLabel } from "./catalog-config.js";
import { bindProductGallery, showProductToast, flashCartButton } from "./product-gallery.js";
import { addCartItem, bindCartBadge, syncCartToAccount } from "./cart-store.js";

(() => {
  const categoryShowcase = document.querySelector("#category-showcase");
  const productGrid = document.querySelector("#product-grid");
  const catalogStatus = document.querySelector("#catalog-status");
  const catalogCount = document.querySelector("#catalog-count");
  const productHeading = document.querySelector("#product-heading");
  const categoryFilterRow = document.querySelector("#category-filter-row");
  const searchInput = document.querySelector("#menu-search");
  if (!categoryShowcase || !productGrid) return;

  let categories = [];
  let products = [];
  const pathname = decodeURIComponent(window.location.pathname.replace(/\/+$/, "") || "/");
  const categoryRoute = pathname === "/categories" || pathname.startsWith("/categories/");
  const galleryRoute = pathname === "/gallery";
  const categorySlug = categoryRoute && pathname.startsWith("/categories/") ? pathname.split("/").filter(Boolean).at(-1) : "";
  if (pathname === "/cart" || pathname === "/order/confirmation") return;
  let selectedCategory = "all";
  if (categoryRoute) document.body.classList.add("route-categories");
  if (galleryRoute) document.body.classList.add("route-gallery");
  const routeSearchMount = document.querySelector(".route-search-mount");
  const routeSearch = document.querySelector(".storefront-hero .menu-search");
  if (categoryRoute && routeSearchMount && routeSearch) routeSearchMount.append(routeSearch);
  bindCartBadge();

  function addProduct(productId) {
    const product = products.find(item => String(item.id) === String(productId));
    if (!product?.id) {
      showProductToast("This menu item is unavailable. Refresh the menu and try again.");
      return false;
    }
    const added = addCartItem({ product_id: String(product.id), slug: String(product.slug || "") });
    if (!added) {
      showProductToast("Your cart could not be updated. Check your browser storage.");
      return false;
    }
    void syncCartToAccount().catch(error => console.warn("Account cart sync deferred:", error.message));
    return true;
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
  if (!productGrid.dataset.stepCartDelegationBound) {
    productGrid.dataset.stepCartDelegationBound = "true";
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
      event.preventDefault();
      event.stopPropagation();
      if (!addProduct(button.dataset.addProduct)) return;
      flashCartButton(button);
      let toast = document.querySelector(".store-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "store-toast";
        toast.setAttribute("role","status");
        toast.setAttribute("aria-live","polite");
        document.body.append(toast);
      }
      toast.innerHTML = 'Added to cart <a href="/cart">View cart</a>';
      toast.classList.add("is-visible");
      clearTimeout(toast._stepTimer);
      toast._stepTimer = setTimeout(() => toast.classList.remove("is-visible"),2400);
    }
    });
  }

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
  void syncCartToAccount().catch(error => console.warn("Account cart sync deferred:", error.message));
  loadCatalog();
})();
