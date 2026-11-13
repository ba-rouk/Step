export function attachProductCarousels(root = document) {
  const carousels = [];
  if (root.matches?.("[data-product-carousel]")) carousels.push(root);
  carousels.push(...(root.querySelectorAll?.("[data-product-carousel]") || []));
  carousels.forEach(carousel => {
    if (carousel.dataset.carouselReady === "true") return;
    carousel.dataset.carouselReady = "true";
    const track = carousel.querySelector("[data-carousel-track]");
    const dots = Array.from(carousel.querySelectorAll("[data-carousel-dot]"));
    if (!track) return;
    const slides = Array.from(track.children);
    if (slides.length < 2) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const width = track.clientWidth || 1;
      const active = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / width)));
      dots.forEach((dot, index) => {
        const selected = index === active;
        dot.classList.toggle("is-active", selected);
        if (selected) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    };
    track.addEventListener("scroll", () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    }, { passive: true });
    dots.forEach((dot, index) => dot.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      track.scrollTo({ left: slides[index].offsetLeft, behavior: reduced ? "auto" : "smooth" });
      update();
    }));
    carousel.addEventListener("keydown", event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const width = track.clientWidth || 1;
      const next = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / width) + (event.key === "ArrowRight" ? 1 : -1)));
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      track.scrollTo({ left: slides[next].offsetLeft, behavior: reduced ? "auto" : "smooth" });
    });
    update();
  });
}
