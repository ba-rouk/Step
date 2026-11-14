export const CAKE_CATEGORY_LABEL = "Cake";

export function normalizeCategoryLabel(value) {
  const label = String(value || "").trim();
  return /^(?:wedding\s*)?cakes?$/i.test(label) ? CAKE_CATEGORY_LABEL : label;
}

export function categorySlugLabel(value) {
  return normalizeCategoryLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
