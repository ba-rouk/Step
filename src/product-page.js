import { renderProductCard } from "./product-card.js";

/**
 * The /product/:slug view uses the exact same product-card markup and carousel
 * as catalogue cards, with the expanded detail layout and full description.
 */
export function renderProductPage(product, options = {}) {
  if (!product) return "";
  return renderProductCard(product, {
    ...options,
    detail: true,
    eager: true
  });
}
