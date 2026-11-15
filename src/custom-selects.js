// Accessible custom select enhancement. The native select remains in the form as
// the source of truth, preserving name/value, validation and change events.
(() => {
  const enhanced = new WeakSet();
  const closeAll = except => document.querySelectorAll(".st-select.is-open").forEach(root => {
    if (root !== except) close(root);
  });
  function close(root) {
    const trigger = root.querySelector(".st-select-trigger");
    const list = root.querySelector(".st-select-list");
    root.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
    list?.setAttribute("hidden", "");
  }
  function enhance(select) {
    if (enhanced.has(select) || select.multiple || select.size > 1 || select.closest("[data-native-select]")) return;
    enhanced.add(select);
    const root = document.createElement("div");
    root.className = "st-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "st-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || "Choose an option");
    const list = document.createElement("div");
    list.className = "st-select-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    const options = [...select.options];
    const buttons = [];
    function selectedText() {
      const option = select.selectedOptions[0];
      trigger.textContent = option?.textContent?.trim() || "Choose an option";
      trigger.classList.toggle("is-placeholder", !option || option.disabled && !option.value);
      trigger.setAttribute("aria-valuetext", option?.textContent?.trim() || "");
    }
    function selectOption(option, button) {
      if (option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("input", {bubbles:true}));
      select.dispatchEvent(new Event("change", {bubbles:true}));
      selectedText();
      buttons.forEach(item => {
        const active = item.dataset.value === select.value;
        item.setAttribute("aria-selected", String(active));
        item.classList.toggle("is-selected", active);
      });
      close(root);
      trigger.focus();
    }
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "st-select-option";
      button.setAttribute("role", "option");
      button.dataset.value = option.value;
      button.textContent = option.textContent.trim();
      button.disabled = option.disabled;
      button.setAttribute("aria-selected", String(option.selected));
      button.addEventListener("click", () => selectOption(option, button));
      list.append(button);
      buttons.push(button);
    });
    select.insertAdjacentElement("afterend", root);
    root.append(trigger, list);
    select.classList.add("st-select-native");
    selectedText();
    trigger.addEventListener("click", () => {
      const opening = !root.classList.contains("is-open");
      closeAll(root);
      root.classList.toggle("is-open", opening);
      trigger.setAttribute("aria-expanded", String(opening));
      list.hidden = !opening;
      if (opening) {
        const current = buttons.find(item => item.dataset.value === select.value) || buttons.find(item => !item.disabled);
        current?.focus();
      }
    });
    trigger.addEventListener("keydown", event => {
      if (["ArrowDown","ArrowUp","Enter"," "].includes(event.key)) {
        event.preventDefault();
        closeAll(root);
        root.classList.add("is-open");
        trigger.setAttribute("aria-expanded","true");
        list.hidden = false;
        const current = buttons.find(item => item.dataset.value === select.value) || buttons.find(item => !item.disabled);
        current?.focus();
      }
    });
    list.addEventListener("keydown", event => {
      const enabled = buttons.filter(item => !item.disabled);
      const index = enabled.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); close(root); trigger.focus(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        enabled[(index + delta + enabled.length) % enabled.length]?.focus();
      } else if (event.key === "Home") { event.preventDefault(); enabled[0]?.focus(); }
      else if (event.key === "End") { event.preventDefault(); enabled.at(-1)?.focus(); }
      else if (event.key === "Tab") close(root);
    });
    select.addEventListener("change", selectedText);
    const observer = new MutationObserver(() => {
      const value = select.value;
      const next = [...select.options];
      if (next.length !== buttons.length || next.some((item,i) => item.value !== buttons[i]?.dataset.value || item.textContent.trim() !== buttons[i]?.textContent)) {
        root.remove(); select.classList.remove("st-select-native"); enhanced.delete(select); enhance(select);
      } else { select.value = value; selectedText(); }
    });
    observer.observe(select, {childList:true,subtree:true,characterData:true});
  }
  function scan(node=document) {
    if (node.matches?.("select")) enhance(node);
    node.querySelectorAll?.("select").forEach(enhance);
  }
  document.addEventListener("click", event => {
    if (!event.target.closest(".st-select")) closeAll(null);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeAll(null); });
  document.addEventListener("DOMContentLoaded", () => scan());
  scan();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) scan(node);
  }))).observe(document.documentElement, {childList:true,subtree:true});
})();