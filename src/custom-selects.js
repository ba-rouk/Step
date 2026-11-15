// Accessible, form-preserving custom select controls for the storefront and staff workspace.
(() => {
  const SELECTOR = "select:not([multiple]):not([size])";
  const roots = new WeakMap();
  let nextId = 0;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeSelectedIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");

  function labelFor(select) {
    const explicit = select.getAttribute("aria-label");
    if (explicit) return explicit;
    const labels = Array.from(select.labels || []).map(label => label.textContent.replace(/\\s+/g, " ").trim());
    return labels.find(Boolean) || "Choose an option";
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || roots.has(select)) return;
    if (select.multiple || select.hasAttribute("size") || select.dataset.nativeSelect === "true") return;

    const root = document.createElement("div");
    root.className = "step-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "step-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", labelFor(select));
    trigger.setAttribute("aria-required", String(select.required));
    trigger.setAttribute("aria-controls", "step-select-list-" + (++nextId));

    const list = document.createElement("div");
    list.className = "step-select-list";
    list.id = trigger.getAttribute("aria-controls");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", labelFor(select));
    list.hidden = true;
    root.append(trigger, list);

    // Keep the native select in its original label/form position. It remains
    // the submitted control and validity source; only its visual UI is hidden.
    select.insertAdjacentElement("afterend", root);
    select.classList.add("step-select-native");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;

    const state = { root, trigger, list, options: [], activeIndex: -1, typeBuffer: "", reposition: null, close: null };
    roots.set(select, state);

    function enabledIndices() {
      return state.options.map((option, index) => option.getAttribute("aria-disabled") === "true" ? -1 : index).filter(index => index >= 0);
    }

    function updateDisabledState() {
      trigger.disabled = select.disabled;
      trigger.setAttribute("aria-required", String(select.required));
      trigger.setAttribute("aria-invalid", String(select.getAttribute("aria-invalid") === "true"));
      root.classList.toggle("is-disabled", select.disabled);\n      if (select.disabled && state.close) state.close();
    }

    function syncSelected() {
      const selected = select.selectedOptions[0] || null;
      trigger.textContent = selected ? selected.textContent.trim() : "Choose an option";
      trigger.classList.toggle("is-placeholder", !selected || (!selected.value && selected.disabled));
      trigger.setAttribute("aria-valuetext", selected ? selected.textContent.trim() : "");
      state.options.forEach((option, index) => {
        const active = Boolean(selected && option.dataset.value === selected.value && Number(option.dataset.index) === select.selectedIndex);
        option.setAttribute("aria-selected", String(active));
        option.classList.toggle("is-selected", active);
        if (active) state.activeIndex = index;
      });
      if (state.activeIndex >= state.options.length || state.activeIndex < 0 || state.options[state.activeIndex]?.getAttribute("aria-disabled") === "true") {
        state.activeIndex = enabledIndices()[0] ?? -1;
      }
      updateDisabledState();
    }

    function renderOptions() {
      const previousValue = select.value;
      list.replaceChildren();
      state.options = Array.from(select.options).map((source, index) => {
        const option = document.createElement("div");
        option.className = "step-select-option";
        option.id = list.id + "-option-" + index;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.setAttribute("aria-disabled", String(source.disabled));
        option.dataset.value = source.value;
        option.dataset.index = String(index);
        option.textContent = source.textContent.trim();
        if (source.disabled) option.classList.add("is-disabled");
        option.addEventListener("click", () => choose(index));
        list.append(option);
        return option;
      });
      if (nativeValue?.set) nativeValue.set.call(select, previousValue);
      syncSelected();
    }

    function setActive(index) {
      const available = enabledIndices();
      if (!available.length) {
        state.activeIndex = -1;
        trigger.removeAttribute("aria-activedescendant");
        return;
      }
      const next = available.includes(index) ? index : available[0];
      state.activeIndex = next;
      trigger.setAttribute("aria-activedescendant", state.options[next].id);
      state.options.forEach((option, optionIndex) => option.classList.toggle("is-active", optionIndex === next));
      state.options[next].scrollIntoView?.({ block: "nearest" });
    }

    function repositionList() {
      const rect = trigger.getBoundingClientRect();
      const host = select.closest("dialog") || document.body;
      const hostRect = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - 16;
      const availableAbove = rect.top - 16;
      const maxHeight = Math.max(120, Math.min(320, Math.max(availableBelow, availableAbove)));
      list.style.position = "fixed";
      list.style.left = Math.max(8, rect.left - hostRect.left) + "px";
      list.style.width = Math.min(rect.width, window.innerWidth - 16) + "px";
      list.style.maxHeight = maxHeight + "px";
      const measuredHeight = Math.min(list.scrollHeight, maxHeight);
      const useAbove = availableBelow < Math.min(190, list.scrollHeight) && availableAbove > availableBelow;
      const top = useAbove
        ? rect.top - hostRect.top - measuredHeight - 8
        : rect.bottom - hostRect.top + 8;
      list.style.top = Math.max(8, top) + "px";
    }

    function close() {
      root.classList.remove("is-open");
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (state.reposition) {
        window.removeEventListener("resize", state.reposition);
        document.removeEventListener("scroll", state.reposition, true);
        state.reposition = null;
      }
      root.append(list);
      list.removeAttribute("style");
    }

    state.close = close;\n\n    function open() {
      if (select.disabled || root.classList.contains("is-open")) return;
      document.querySelectorAll(".step-select.is-open").forEach(other => {
        const otherSelect = other.previousElementSibling;
        const otherState = otherSelect && roots.get(otherSelect);
        if (otherState) otherState.close?.();
      });
      root.classList.add("is-open");
      const host = select.closest("dialog") || document.body;
      host.append(list);
      list.hidden = false;
      repositionList();
      trigger.setAttribute("aria-expanded", "true");
      state.reposition = repositionList;
      window.addEventListener("resize", state.reposition);
      document.addEventListener("scroll", state.reposition, true);
      const selectedIndex = select.selectedIndex;
      setActive(selectedIndex >= 0 && !select.options[selectedIndex]?.disabled ? selectedIndex : (enabledIndices()[0] ?? -1));
    }

    function choose(index) {
      const source = select.options[index];
      if (!source || source.disabled || select.disabled) return;
      if (nativeValue?.set) nativeValue.set.call(select, source.value);
      else select.value = source.value;
      select.removeAttribute("aria-invalid");
      trigger.classList.remove("is-invalid");
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncSelected();
      close();
      trigger.focus();
    }

    trigger.addEventListener("click", () => {
      if (root.classList.contains("is-open")) close();
      else open();
    });
    trigger.addEventListener("keydown", event => {
      const available = enabledIndices();
      const isOpen = root.classList.contains("is-open");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen) open();
        else {
          const current = available.indexOf(state.activeIndex);
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setActive(available[(current + delta + available.length) % available.length]);
        }
      } else if ((event.key === "Enter" || event.key === " ") && isOpen) {
        event.preventDefault();
        if (state.activeIndex >= 0) choose(state.activeIndex);
      } else if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        close();
      } else if (event.key === "Home" && isOpen) {
        event.preventDefault();
        setActive(available[0] ?? -1);
      } else if (event.key === "End" && isOpen) {
        event.preventDefault();
        setActive(available.at(-1) ?? -1);
      } else if (event.key === "Tab" && isOpen) {
        close();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        state.typeBuffer += event.key.toLocaleLowerCase();
        const match = state.options.findIndex((option, index) =>
          select.options[index] && !select.options[index].disabled && option.textContent.trim().toLocaleLowerCase().startsWith(state.typeBuffer));
        if (match >= 0) {
          if (!isOpen) open();
          setActive(match);
        }
        window.clearTimeout(state.typeTimer);
        state.typeTimer = window.setTimeout(() => { state.typeBuffer = ""; }, 650);
      }
    });

    state.close = close;\n\n    select.addEventListener("change", () => {
      syncSelected();
      trigger.classList.remove("is-invalid");
    });
    select.addEventListener("invalid", event => {
      event.preventDefault();
      trigger.classList.add("is-invalid");
      trigger.setAttribute("aria-invalid", "true");
      trigger.focus();
    }, true);

    if (nativeValue?.get && nativeValue?.set) {
      try {
        Object.defineProperty(select, "value", {
          configurable: true,
          get() { return nativeValue.get.call(this); },
          set(value) { nativeValue.set.call(this, value); syncSelected(); }
        });
      } catch {}
    }
    if (nativeSelectedIndex?.get && nativeSelectedIndex?.set) {
      try {
        Object.defineProperty(select, "selectedIndex", {
          configurable: true,
          get() { return nativeSelectedIndex.get.call(this); },
          set(value) { nativeSelectedIndex.set.call(this, value); syncSelected(); }
        });
      } catch {}
    }

    select.form?.addEventListener("reset", () => window.requestAnimationFrame(() => {
      syncSelected();
      trigger.classList.remove("is-invalid");
      select.removeAttribute("aria-invalid");
    }));

    const optionsObserver = new MutationObserver(renderOptions);
    optionsObserver.observe(select, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["disabled", "selected", "label", "value"]
    });
    const attributesObserver = new MutationObserver(updateDisabledState);
    attributesObserver.observe(select, { attributes: true, attributeFilter: ["disabled", "required", "aria-label"] });
    renderOptions();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches?.(SELECTOR)) enhance(node);
    node.querySelectorAll?.(SELECTOR).forEach(enhance);
  }

  document.addEventListener("pointerdown", event => {
    if (event.target.closest?.(".step-select, .step-select-list")) return;
    document.querySelectorAll(".step-select.is-open").forEach(root => {
      const select = root.previousElementSibling;
      const state = select && roots.get(select);
      if (state) state.close?.();
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".step-select.is-open").forEach(root => {
      const select = root.previousElementSibling;
      const state = select && roots.get(select);
      if (state) state.close?.();
    });
  });

  scan(document.documentElement);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(scan));
  }).observe(document.documentElement, { childList: true, subtree: true });
})();