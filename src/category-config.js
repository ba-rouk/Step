export const CAKE_CATEGORY = Object.freeze({
  label: "Cake",
  slug: "cake",
  legacySlug: "wedding-cakes"
});

export function normalizeCategoryLabel(name, slug = "") {
  const value = String(name || "").trim();
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (normalizedSlug === CAKE_CATEGORY.slug ||
      normalizedSlug === CAKE_CATEGORY.legacySlug ||
      /^(wedding\s+cakes?|cake)$/i.test(value)) {
    return CAKE_CATEGORY.label;
  }
  return value || "Menu";
}
