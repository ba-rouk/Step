const FAVOURITES_KEY = "step-town-favourites-v1";

export function escapeProductHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

export function getFavouriteIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVOURITES_KEY) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

export function saveFavouriteIds(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string"))].slice(0, 200);
  try { window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}

export function getProductImages(product) {
  if (Array.isArray(product?.images) && product.images.length) {
    return product.images.filter(image => image && typeof image.url === "string" && image.url).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  }
  const legacy = [];
  const values = [
    ...(Array.isArray(product?.image_urls) ? product.image_urls : []),
    product?.image_url
  ];
  for (const url of values) {
    if (typeof url === "string" && url && !legacy.some(image => image.url === url)) {
      legacy.push({ url, public_id: null, alt_text: product?.name ? product.name + " photograph" : "Step Town menu item", position: legacy.length });
    }
  }
  return legacy;
}

function imageMarkup(image, product, index, eager) {
  const url = escapeProductHtml(image.url);
  const candidates = Object.entries(image.variants || {})
    .map(([width, variantUrl]) => [Number(width), variantUrl])
    .filter(([width, variantUrl]) => Number.isFinite(width) && width > 0 && typeof variantUrl === "string" && variantUrl);
  if (!candidates.some(([width]) => width >= 1600)) candidates.push([1600, image.url]);
  const unique = new Map(candidates.map(([width, variantUrl]) => [width, variantUrl]));
  const srcset = [...unique.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([width, variantUrl]) => escapeProductHtml(variantUrl) + " " + width + "w")
    .join(", ");
  const alt = escapeProductHtml(image.alt_text || (product.name + " — Step Town product photo " + (index + 1)));
  const loading = eager && index === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const responsive = srcset ? ' srcset="' + srcset + '" sizes="(max-width: 640px) 100vw, (max-width: 1023px) 50vw, 33vw"' : "";
  return '<a class="product-carousel-slide" href="/product/' + escapeProductHtml(product.slug || product.id) + '" aria-label="View ' + escapeProductHtml(product.name) + '">' +
    '<img src="' + url + '"' + responsive + ' width="1600" height="1200" alt="' + alt + '" ' + loading + ' decoding="async"></a>';
}

function carouselMarkup(product, images, detail, eager) {
  const slides = images.length
    ? images.map((image, index) => imageMarkup(image, product, index, eager)).join("")
    : '<a class="product-carousel-slide product-image-placeholder" href="/product/' + escapeProductHtml(product.slug || product.id) + '" aria-label="View ' + escapeProductHtml(product.name) + '"><span>STEP TOWN</span></a>';
  const dots = images.length > 1
    ? '<div class="product-carousel-dots" role="group" aria-label="Choose product image">' + images.map((image, index) =>
        '<button type="button" class="product-carousel-dot' + (index === 0 ? ' is-active' : '') + '" data-carousel-dot="' + index + '" aria-label="Show image ' + (index + 1) + '"' + (index === 0 ? ' aria-current="true"' : '') + '></button>'
      ).join("") + '</div>'
    : "";
  return '<div class="product-carousel' + (detail ? ' product-carousel-detail' : '') + '" data-product-carousel role="region" aria-roledescription="carousel" aria-label="' + escapeProductHtml(product.name) + ' photos" tabindex="0">' +
    '<div class="product-carousel-track" data-carousel-track>' + slides + '</div>' +
    '<div class="product-image-gradient" aria-hidden="true"></div>' +
    '<span class="product-category-pill">' + escapeProductHtml(product.category_name || product.category?.name || "Menu") + '</span>' +
    dots + '</div>';
}

function heartIcon(liked) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.3 8.7c0 4.2-8.3 10-8.3 10S3.7 12.9 3.7 8.7A4.4 4.4 0 0 1 12 6.3a4.4 4.4 0 0 1 8.3 2.4Z" ' +
    (liked ? 'fill="currentColor"' : 'fill="none"') + '></path></svg>';
}

function cartIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h2l2.1 11.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"></path><circle cx="10" cy="20" r="1.3"></circle><circle cx="18" cy="20" r="1.3"></circle></svg>';
}

function priceText(product) {
  if (product.price == null || !Number.isFinite(Number(product.price))) return "Request a quote";
  return "RWF " + new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(Number(product.price));
}

export function renderProductCard(product, index = 0, options = {}) {
  const images = getProductImages(product);
  const liked = getFavouriteIds().includes(String(product.id));
  const description = String(product.description || "Prepared with care by Step Town.");
  const truncated = description.length > 110;
  const safeName = escapeProductHtml(product.name || "Step Town menu item");
  const imageArea = carouselMarkup(product, images, false, index === 0);
  const count = typeof options.cartCount === "function" ? Number(options.cartCount(product.id) || 0) : 0;
  const cartBadge = count > 0
    ? '<span class="product-add-count" aria-label="' + count + ' in cart">' + count + '</span>'
    : '<span class="product-add-plus" aria-hidden="true">+</span>';
  const detailHref = '/product/' + escapeProductHtml(product.slug || product.id);
  return '<article class="product-card" data-product-card data-product-id="' + escapeProductHtml(product.id) + '">' +
    '<div class="product-card-image">' + imageArea +
      '<button class="product-image-action product-add-cart" type="button" data-add-product="' + escapeProductHtml(product.id) + '" aria-label="Add to cart" title="Add to cart">' +
        cartIcon() + cartBadge +
      '</button>' +
      '<button class="product-image-action product-favourite' + (liked ? ' is-saved' : '') + '" type="button" data-favourite="' + escapeProductHtml(product.id) + '" aria-label="' + (liked ? 'Remove ' + safeName + ' from favourites' : 'Add ' + safeName + ' to favourites') + '" aria-pressed="' + String(liked) + '">' + heartIcon(liked) + '</button>' +
    '</div>' +
    '<div class="product-card-copy">' +
      '<a class="product-card-copy-link" href="' + detailHref + '">' +
        '<h4>' + safeName + '</h4>' +
        '<p class="product-description' + (truncated ? ' is-clamped' : '') + '" data-product-description>' + escapeProductHtml(description) + '</p>' +
      '</a>' +
      (truncated ? '<button class="product-read-more" type="button" data-read-more aria-expanded="false">Read more</button>' : '') +
      '<a class="product-card-price-link" href="' + detailHref + '"><strong class="product-card-price">' + escapeProductHtml(priceText(product)) + '</strong></a>' +
    '</div></article>';
}

export function renderProductDetail(product) {
  const images = getProductImages(product);
  const description = String(product.description || "Prepared with care by Step Town.");
  const safeName = escapeProductHtml(product.name || "Step Town menu item");
  return '<section class="product-detail-page">' +
    '<a class="product-detail-back" href="/categories">Back to the menu</a>' +
    '<div class="product-detail-grid">' +
      '<div class="product-detail-media">' + carouselMarkup(product, images, true, true) + '</div>' +
      '<div class="product-detail-copy">' +
        '<span class="product-detail-category">' + escapeProductHtml(product.category_name || product.category?.name || "Menu") + '</span>' +
        '<h1>' + safeName + '</h1>' +
        '<p class="product-detail-description">' + escapeProductHtml(description) + '</p>' +
        '<strong class="product-detail-price">' + escapeProductHtml(priceText(product)) + '</strong>' +
        '<button class="product-detail-add" type="button" data-add-product="' + escapeProductHtml(product.id) + '">' + cartIcon() + ' Add to cart</button>' +
      '</div>' +
    '</div></section>';
}

export function bindProductCardEvents(root, options = {}) {
  if (!root || root.dataset.productCardEvents === "true") return;
  root.dataset.productCardEvents = "true";
  root.addEventListener("click", event => {
    const favourite = event.target.closest("[data-favourite]");
    if (favourite && root.contains(favourite)) {
      event.preventDefault();
      event.stopPropagation();
      const id = favourite.dataset.favourite;
      const saved = getFavouriteIds();
      const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
      saveFavouriteIds(next);
      const liked = next.includes(id);
      favourite.classList.toggle("is-saved", liked);
      favourite.setAttribute("aria-pressed", String(liked));
      favourite.setAttribute("aria-label", liked ? "Remove from favourites" : "Add to favourites");
      favourite.innerHTML = heartIcon(liked);
      window.dispatchEvent(new CustomEvent("step-town:favourites-change", { detail: { ids: next, productId: id, liked } }));
      if (typeof options.onFavouriteChange === "function") options.onFavouriteChange(next, id, liked);
      return;
    }

    const add = event.target.closest("[data-add-product]");
    if (add && root.contains(add)) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof options.onAddToCart === "function") options.onAddToCart(add.dataset.addProduct, add);
      else window.stepTownAddToCart?.(add.dataset.addProduct, add);
      return;
    }

    const readMore = event.target.closest("[data-read-more]");
    if (readMore && root.contains(readMore)) {
      event.preventDefault();
      event.stopPropagation();
      const card = readMore.closest("[data-product-card]");
      const description = card?.querySelector("[data-product-description]");
      const expanded = readMore.getAttribute("aria-expanded") !== "true";
      description?.classList.toggle("is-expanded", expanded);
      description?.classList.toggle("is-clamped", !expanded);
      readMore.setAttribute("aria-expanded", String(expanded));
      readMore.textContent = expanded ? "Read less" : "Read more";
    }
  });
}
