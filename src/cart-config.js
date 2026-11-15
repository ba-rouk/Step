// New guest cart storage key. Legacy keys are migrated on read so saved carts survive the rebrand.
export const GUEST_CART_STORAGE_KEY = "vitanova-cart-v3";
export const LEGACY_GUEST_CART_STORAGE_KEYS = ["step-town-cart-v2", "step-town-cart-v1"];
export const REQUIRE_LOGIN_FOR_CART_LIST = true;
