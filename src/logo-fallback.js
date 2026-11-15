// Hide failed Vitanova logo images without showing browser broken-image placeholders.
// The brand wordmark remains visible beside the image on the storefront and staff portal.
document.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.matches(".brand-logo, .contact-logo, .map-logo, .staff-logo")) return;
  image.hidden = true;
  image.dataset.logoUnavailable = "true";
}, true);
