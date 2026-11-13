import { supabase, supabaseConfigured } from "./src/supabase.js";

(() => {
  const menuToggle = document.querySelector(".menu-toggle");
  const primaryNav = document.querySelector(".primary-nav");

  const closeMenu = () => {
    if (!menuToggle || !primaryNav) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    primaryNav.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  };

  if (menuToggle && primaryNav) {
    menuToggle.addEventListener("click", () => {
      const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      primaryNav.classList.toggle("is-open", !isOpen);
      document.body.classList.toggle("menu-open", !isOpen);
    });
    primaryNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) closeMenu();
    });
  }

  const dateInput = document.querySelector("#date");
  if (dateInput) {
    const today = new Date();
    dateInput.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
  }

  const form = document.querySelector("#enquiry-form");
  const error = document.querySelector("#form-error");
  const submitButton = form?.querySelector('button[type="submit"]');
  const privacyNote = form?.querySelector(".form-privacy");

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (error) { error.textContent = ""; error.style.color = ""; }
      if (!form.reportValidity()) return;

      if (!supabaseConfigured || !supabase) {
        if (error) error.textContent = "Enquiry saving is not configured yet. Please contact Step Town directly on WhatsApp or phone.";
        return;
      }

      const data = new FormData(form);
      const clean = (value) => String(value || "").trim();
      const name = clean(data.get("name"));
      const phone = clean(data.get("phone"));
      const service = clean(data.get("service"));
      const date = clean(data.get("date"));
      const guests = clean(data.get("guests"));
      const location = clean(data.get("location"));
      const details = clean(data.get("details"));

      if (!name || !phone || !service) {
        if (error) error.textContent = "Please complete your name, phone number and service.";
        return;
      }

      const enquiry = {
        name,
        phone,
        service,
        event_date: date || null,
        guest_count: guests ? Number(guests) : null,
        event_location: location || null,
        details: details || null
      };

      const originalButtonText = submitButton?.innerHTML;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Saving your enquiry…";
      }

      let insertError = null;
      try {
        const result = await supabase.from("enquiries").insert(enquiry);
        insertError = result.error;
      } catch (submissionError) {
        insertError = submissionError;
      }

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText || "Send enquiry";
      }

      if (insertError) {
        console.error("Step Town enquiry submission failed:", insertError);
        if (error) error.textContent = "We couldn't save your enquiry just now. Please try again or contact us directly on WhatsApp.";
        return;
      }

      const lines = [
        "Hello Step Town, I have just submitted an enquiry on your website.",
        "",
        "Name: " + name,
        "My phone: " + phone,
        "Service: " + service,
        date ? "Event date: " + date : "",
        guests ? "Approx. guests: " + guests : "",
        location ? "Event location: " + location : "",
        details ? "More details: " + details : "",
        "",
        "Please let me know the next steps. Thank you."
      ].filter(Boolean);

      const whatsappUrl = "https://wa.me/250780382589?text=" + encodeURIComponent(lines.join("\n"));
      form.reset();
      if (error) {
        error.textContent = "Thank you — your enquiry has been saved successfully.";
        error.style.color = "#55704b";
      }
      if (privacyNote) {
        privacyNote.textContent = "Your enquiry has been saved securely. You can also send the details to Step Town on WhatsApp.";
      }

      const whatsappLink = document.createElement("a");
      whatsappLink.className = "text-link dark-link";
      whatsappLink.href = whatsappUrl;
      whatsappLink.target = "_blank";
      whatsappLink.rel = "noopener noreferrer";
      whatsappLink.textContent = "Continue to WhatsApp ↗";
      whatsappLink.style.display = "inline-block";
      whatsappLink.style.marginTop = "12px";
      form.querySelector(".form-whatsapp-link")?.remove();
      const linkWrap = document.createElement("p");
      linkWrap.className = "form-whatsapp-link";
      linkWrap.append(whatsappLink);
      form.append(linkWrap);
    });
  }

  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  const revealItems = document.querySelectorAll(".service-card, .process-step, .gallery-item, .manifesto-copy, .store-heading, .store-intro-row, .product-heading, .quote-copy, .enquiry-form, .location-copy, .map-card, .closing-inner");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver((entries, activeObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          activeObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  }
})();
