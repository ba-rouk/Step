const boundRoots = new WeakSet();
const buttonTimers = new WeakMap();
const CART_ICON = '<path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"></path><circle cx="10" cy="20" r="1.3"></circle><circle cx="18" cy="20" r="1.3"></circle>';
const CHECK_ICON = '<path d="m5 12 4 4L19 6"></path>';

function syncDots(strip) {
  const card = strip.closest(".product-card");
  if (!card) return;
  const dots = card.querySelectorAll("[data-dot]");
  if (!dots.length) return;
  const width = strip.clientWidth || 1;
  const active = Math.max(0, Math.min(dots.length - 1, Math.round(strip.scrollLeft / width)));
  dots.forEach((dot,index) => {
    dot.classList.toggle("is-active", index === active);
    dot.setAttribute("aria-pressed", String(index === active));
  });
}

export function bindProductGallery(root) {
  if (!root || boundRoots.has(root)) return;
  boundRoots.add(root);
  let frame = 0;
  const pending = new Set();
  root.addEventListener("scroll", event => {
    const strip = event.target && event.target.closest ? event.target.closest(".product-image-strip") : null;
    if (!strip || !root.contains(strip)) return;
    pending.add(strip);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      pending.forEach(syncDots);
      pending.clear();
      frame = 0;
    });
  }, true);
  root.addEventListener("click", event => {
    const dot = event.target.closest("[data-dot]");
    if (!dot || !root.contains(dot)) return;
    const strip = dot.closest(".product-image")?.querySelector(".product-image-strip");
    const index = Number(dot.dataset.dot);
    if (!strip || !Number.isInteger(index) || index < 0) return;
    event.preventDefault();
    strip.scrollTo({left:index * strip.clientWidth,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  });
  root.addEventListener("keydown", event => {
    const strip = event.target.closest(".product-image-strip");
    if (!strip || !root.contains(strip) || !["ArrowLeft","ArrowRight"].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    strip.scrollBy({left:(event.key === "ArrowRight" ? 1 : -1) * strip.clientWidth,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  });
}

export function showProductToast(message) {
  let toast = document.querySelector(".store-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "store-toast";
    toast.setAttribute("role","status");
    toast.setAttribute("aria-live","polite");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showProductToast.timer);
  showProductToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1500);
}

export function flashCartButton(button) {
  if (!button) return;
  const previous = buttonTimers.get(button);
  if (previous) window.clearTimeout(previous);
  const svg = button.querySelector("svg");
  if (svg) svg.innerHTML = CHECK_ICON;
  else {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.textContent = "Added";
  }
  button.classList.add("is-added");
  button.setAttribute("aria-label","Added to cart");
  button.setAttribute("title","Added to cart");
  const timer = window.setTimeout(() => {
    if (!button.isConnected) return;
    if (svg) svg.innerHTML = CART_ICON;
    else button.textContent = button.dataset.originalText || "Add to cart";
    button.classList.remove("is-added");
    button.setAttribute("aria-label","Add to cart");
    button.setAttribute("title","Add to cart");
    buttonTimers.delete(button);
  }, 1000);
  buttonTimers.set(button,timer);
}
