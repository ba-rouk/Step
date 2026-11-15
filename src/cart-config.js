// Guests can view and edit carts. Versioned storage lets older saved carts migrate once.
export const REQUIRE_LOGIN_FOR_CART_LIST = false;
export const GUEST_CART_STORAGE_KEY = "step-town-cart-v2";
export const LEGACY_GUEST_CART_STORAGE_KEYS = ["step-town-cart-v1"];
