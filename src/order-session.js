const ORDER_CONFIRMATION_KEY = "vitanova-order-confirmation";
const ORDER_MESSAGE_KEY = "vitanova-last-order-message";
const LEGACY_ORDER_CONFIRMATION_KEY = "step-town-order-confirmation";
const LEGACY_ORDER_MESSAGE_KEY = "step-town-last-order-message";

export function saveOrderSession(confirmation, message) {
  try {
    sessionStorage.setItem(ORDER_CONFIRMATION_KEY, JSON.stringify(confirmation || {}));
    sessionStorage.setItem(ORDER_MESSAGE_KEY, String(message || ""));
    sessionStorage.removeItem(LEGACY_ORDER_CONFIRMATION_KEY);
    sessionStorage.removeItem(LEGACY_ORDER_MESSAGE_KEY);
  } catch {
    // The confirmation page can still show the order number from the URL.
  }
}

function readAndMigrate(key, legacyKey) {
  try {
    let value = sessionStorage.getItem(key);
    if (value === null) {
      value = sessionStorage.getItem(legacyKey);
      if (value !== null) sessionStorage.setItem(key, value);
    }
    if (value !== null) sessionStorage.removeItem(legacyKey);
    return value;
  } catch {
    return null;
  }
}

export function readOrderConfirmation() {
  try {
    return JSON.parse(readAndMigrate(ORDER_CONFIRMATION_KEY, LEGACY_ORDER_CONFIRMATION_KEY) || "{}");
  } catch {
    return {};
  }
}

export function readOrderMessage() {
  return readAndMigrate(ORDER_MESSAGE_KEY, LEGACY_ORDER_MESSAGE_KEY) || "";
}
