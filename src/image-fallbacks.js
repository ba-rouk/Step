// Replace broken image sources with the local branded fallback, once per image.
(() => {
  const fallback = "/image-fallback.svg";
  function guard(img) {
    if (img.dataset.fallbackBound) return;
    img.dataset.fallbackBound = "1";
    img.addEventListener("error", () => {
      if (img.src.endsWith(fallback)) return;
      img.src = fallback;
      img.removeAttribute("srcset");
      img.classList.add("image-fallback-active");
    });
  }
  document.querySelectorAll("img").forEach(guard);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.("img")) guard(node);
    node.querySelectorAll?.("img").forEach(guard);
  }))).observe(document.documentElement,{childList:true,subtree:true});
})();