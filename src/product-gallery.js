const boundRoots = new WeakSet();
const buttonTimers = new WeakMap();
const CART_ICON = '<path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"></path><circle cx="10" cy="20" r="1.3"></circle><circle cx="18" cy="20" r="1.3"></circle>';
const CHECK_ICON = '<path d="m5 12 4 4L19 6"></path>';

function activeSlideIndex(strip) {
  const slides = Array.from(strip.children);
  if (!slides.length) return 0;
  let active = 0;
  let nearest = Number.POSITIVE_INFINITY;
  slides.forEach((slide, index) => {
    const offset = slide.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    const distance = Math.abs(offset - strip.scrollLeft);
    if (distance < nearest) { nearest = distance; active = index; }
  });
  return active;
}

function syncDots(strip) {
  const dots = strip.closest(".product-card")?.querySelectorAll("[data-dot]");
  if (!dots?.length) return;
  const active = activeSlideIndex(strip);
  dots.forEach((dot, index) => {
    const selected = index === active;
    dot.classList.toggle("is-active", selected);
    dot.setAttribute("aria-pressed", String(selected));
  });
}

/* Native touch scrolling and scroll-snap handle swipe gestures without pointer capture. */
export function bindProductGallery(root) {
  if (!root || boundRoots.has(root)) return;
  boundRoots.add(root);
  let frame = 0;
  const pending = new Set();

  root.addEventListener("scroll", event => {
    const strip = event.target?.closest?.(".product-image-strip");
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
    const arrow = event.target.closest?.("[data-photo-prev], [data-photo-next]");
    if (arrow && root.contains(arrow)) {
      const strip = arrow.closest(".product-image")?.querySelector(".product-image-strip");
      if (!strip || strip.children.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const step = arrow.hasAttribute("data-photo-next") ? 1 : -1;
      const next = (activeSlideIndex(strip) + step + strip.children.length) % strip.children.length;
      strip.scrollTo({
        left: strip.children[next].offsetLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
      return;
    }

    const dot = event.target.closest?.("[data-dot]");
    if (!dot || !root.contains(dot)) return;
    const strip = dot.closest(".product-image")?.querySelector(".product-image-strip");
    const index = Number(dot.dataset.dot);
    if (!strip || !Number.isInteger(index) || index < 0 || index >= strip.children.length) return;
    event.preventDefault();
    event.stopPropagation();
    strip.scrollTo({
      left: strip.children[index].offsetLeft,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });

  root.addEventListener("keydown", event => {
    const strip = event.target.closest?.(".product-image-strip");
    if (!strip || !root.contains(strip) || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || !strip.children.length) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(
      strip.children.length - 1,
      activeSlideIndex(strip) + (event.key === "ArrowRight" ? 1 : -1)
    ));
    strip.scrollTo({
      left: strip.children[next].offsetLeft,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
}

export function showProductToast(message) {
  let toast = document.querySelector(".store-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "store-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
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
  button.classList.add("is-added");
  button.setAttribute("aria-label", "Added to cart");
  button.setAttribute("title", "Added to cart");
  const timer = window.setTimeout(() => {
    if (!button.isConnected) return;
    if (svg) svg.innerHTML = CART_ICON;
    button.classList.remove("is-added");
    button.setAttribute("aria-label", "Add to cart");
    button.setAttribute("title", "Add to cart");
    buttonTimers.delete(button);
  }, 1000);
  buttonTimers.set(button, timer);
}
