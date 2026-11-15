// Add reliable keyboard, backdrop and focus behavior to the staff's non-native edit modal.
(() => {
  const SELECTOR = ".staff-modal";
  const previousFocus = new WeakMap();
  const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function visible(modal) {
    return Boolean(modal && !modal.hidden && modal.getAttribute("aria-hidden") !== "true");
  }

  function focusable(modal) {
    return Array.from(modal.querySelectorAll(focusableSelector))
      .filter(element => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true");
  }

  function openModal(modal) {
    if (modal.dataset.stepModalOpen === "true") return;
    previousFocus.set(modal, document.activeElement);
    modal.dataset.stepModalOpen = "true";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const heading = modal.querySelector("h1,h2,h3,[data-modal-title]");
    if (heading) {
      if (!heading.id) heading.id = "step-modal-title-" + Math.random().toString(36).slice(2, 9);
      modal.setAttribute("aria-labelledby", heading.id);
    }
    document.body.classList.add("step-modal-open");
    requestAnimationFrame(() => (focusable(modal)[0] || modal).focus());
  }

  function closeModal(modal) {
    if (modal.dataset.stepModalOpen !== "true") return;
    delete modal.dataset.stepModalOpen;
    const stillOpen = Array.from(document.querySelectorAll(SELECTOR)).some(item => visible(item));
    if (!stillOpen) document.body.classList.remove("step-modal-open");
    const target = previousFocus.get(modal);
    previousFocus.delete(modal);
    if (target?.isConnected && typeof target.focus === "function") target.focus();
  }

  function syncModal(modal) {
    if (!modal?.matches?.(SELECTOR)) return;
    if (visible(modal)) openModal(modal);
    else closeModal(modal);
  }

  function scan(node = document) {
    if (node.matches?.(SELECTOR)) syncModal(node);
    node.querySelectorAll?.(SELECTOR).forEach(syncModal);
  }

  document.addEventListener("click", event => {
    const modal = event.target.closest?.(SELECTOR);
    if (modal && event.target === modal && visible(modal)) {
      modal.hidden = true;
      syncModal(modal);
    }
  });

  document.addEventListener("keydown", event => {
    const modal = Array.from(document.querySelectorAll(SELECTOR)).find(visible);
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      modal.hidden = true;
      syncModal(modal);
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable(modal);
    if (!items.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  scan();
  new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === "attributes") {
        if (record.target.matches?.(SELECTOR)) syncModal(record.target);
      } else record.addedNodes.forEach(scan);
    });
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden"]
  });
})();