const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

function safeImageUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function productSlug(product) {
  return String(product.slug || product.name || product.id).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || product.id;
}

function productImages(product) {
  const rows = Array.isArray(product.images) && product.images.length
    ? product.images
    : (Array.isArray(product.image_urls) && product.image_urls.length
        ? product.image_urls
        : [product.image_url]
      ).filter(Boolean).map((url) => typeof url === "string" ? { url } : url);

  return rows
    .map((image) => typeof image === "string" ? { url: image } : image)
    .filter((image) => Boolean(safeImageUrl(image && image.url)));
}

function formatPrice(value) {
  if (value == null || value === "") return "Request a quote";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-RW", {
        style: "currency",
        currency: "RWF",
        maximumFractionDigits: 0
      }).format(amount)
    : "Request a quote";
}

/**
 * One shared product-card template for Home, Categories, category detail,
 * search, Profile > Favourites, and the expanded product-detail route.
 */
export function renderProductCard(product, options = {}) {
  const categoryName = options.categoryName || product.category_name || "Menu";
  const liked = Boolean(options.liked);
  const detail = Boolean(options.detail);
  const eager = Boolean(options.eager);
  const extraClass = options.extraClass ? " " + escapeHtml(options.extraClass) : "";
  const href = "/product/" + encodeURIComponent(productSlug(product));
  const images = productImages(product);

  const slides = images.length
    ? images.map((image, index) => {
        const src = safeImageUrl(image.url);
        const variants = image.variants && typeof image.variants === "object" ? image.variants : {};
        const srcset = Object.entries(variants)
          .filter(([width, url]) => Number.isInteger(Number(width)) && safeImageUrl(url))
          .map(([width, url]) => safeImageUrl(url) + " " + Number(width) + "w")
          .join(", ");
        const loading = eager && index === 0
          ? 'loading="eager" fetchpriority="high"'
          : 'loading="lazy"';
        const alt = image.alt_text || (product.name + " — photo " + (index + 1));

        return '<img src="' + escapeHtml(src) + '"' +
          (srcset
            ? ' srcset="' + escapeHtml(srcset) + '"' +
              ' sizes="(max-width:639px) calc(100vw - 30px), (max-width:1023px) calc(50vw - 24px), 33vw"'
            : "") +
          ' alt="' + escapeHtml(alt) + '"' +
          ' width="800" height="1000" ' + loading +
          ' decoding="async" draggable="false">';
      }).join("")
    : '<div class="product-image-placeholder" role="img" aria-label="' +
      escapeHtml(product.name) + ' image unavailable">STEP TOWN</div>';

  const dots = images.length > 1
    ? '<div class="product-dots" role="group" aria-label="Choose product photo">' +
      images.map((image, index) =>
        '<button type="button" data-dot="' + index + '"' +
        ' aria-label="Show photo ' + (index + 1) + '"' +
        ' aria-pressed="' + (index === 0) + '"' +
        ' class="' + (index === 0 ? "is-active" : "") + '"></button>'
      ).join("") +
      '</div>'
    : "";

  const unit = product.price_unit || "unit";
  const unitLabel = product.price_unit_label || unit;
  const price = formatPrice(product.price) + (product.price == null ? "" : " per " + unitLabel);
  const title = escapeHtml(product.name || "Step Town menu item");
  const description = escapeHtml(product.description || "Prepared with care by Step Town.");

  return '<article class="product-card' +
    (detail ? " product-card-detail" : "") + extraClass + '"' +
    ' data-product-card="' + escapeHtml(product.id) + '"' +
    ' data-product-id="' + escapeHtml(product.id) + '"' +
    ' data-image-count="' + images.length + '">' +

      '<div class="product-image">' +
        '<a class="product-open product-image-link" href="' + href + '"' +
          ' aria-label="View ' + title + '">' +
          '<div class="product-image-strip" tabindex="0" role="region"' +
            ' aria-label="' + title + ' photos" aria-roledescription="carousel">' +
            slides +
          '</div>' +
        '</a>' +

        '<button class="product-image-action product-cart-action" type="button"' +
          ' data-add-product="' + escapeHtml(product.id) + '"' +
          ' aria-label="Add to cart" title="Add to cart">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"></path>' +
            '<circle cx="10" cy="20" r="1.3"></circle>' +
            '<circle cx="18" cy="20" r="1.3"></circle>' +
          '</svg>' +
        '</button>' +

        '<button class="product-image-action product-favourite' +
          (liked ? " is-saved" : "") + '" type="button"' +
          ' data-favourite="' + escapeHtml(product.id) + '"' +
          ' aria-label="' + (liked ? "Remove from" : "Add to") + ' favourites"' +
          ' aria-pressed="' + liked + '"' +
          ' title="' + (liked ? "Remove from favourites" : "Save to favourites") + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M20.8 8.8c0 5.2-8.8 10.2-8.8 10.2S3.2 14 3.2 8.8A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.7Z"></path>' +
          '</svg>' +
        '</button>' +

        '<div class="product-image-bottom">' +
          '<span class="product-category" title="' + escapeHtml(categoryName) + '">' +
            escapeHtml(categoryName) +
          '</span>' +
          dots +
        '</div>' +
      '</div>' +

      '<div class="product-card-copy">' +
        '<a class="product-open product-copy-link" href="' + href + '">' +
          '<h4 title="' + title + '">' + title + '</h4>' +
        '</a>' +
        '<a class="product-open product-description-link" href="' + href + '">' +
          '<p class="product-description' + (detail ? " is-expanded" : "") + '">' +
            description +
          '</p>' +
        '</a>' +
        '<div class="product-card-bottom">' +
          (detail
            ? '<strong class="product-price">' + escapeHtml(price) + '</strong>'
            : '<a class="product-open product-price-link" href="' + href + '">' +
                '<strong class="product-price">' + escapeHtml(price) + '</strong>' +
              '</a>') +
          "" +
        '</div>' +
        (detail ? '<a class="product-back-link" href="/categories">Back to menu</a>' : "") +
      '</div>' +
    '</article>';
}
