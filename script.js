import { supabase, supabaseConfigured } from "./src/supabase.js";

(() => {
  // Start the storefront background only after the first paint. Poster-only mode
  // is used for reduced motion, Data Saver, or a failed media request.
  const storefrontHero = document.querySelector(".storefront-hero");
  const heroVideo = storefrontHero?.querySelector(".storefront-hero-video");
  if (storefrontHero && heroVideo) {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const dataSaverEnabled = () => Boolean(connection?.saveData);
    const showPosterOnly = () => {
      storefrontHero.classList.add("video-poster-only");
      heroVideo.pause?.();
    };
    const startHeroVideo = () => {
      if (motionPreference.matches || dataSaverEnabled() || typeof heroVideo.play !== "function") {
        showPosterOnly();
        return;
      }
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const sources = Array.from(heroVideo.querySelectorAll("source[data-src]"));
        if (!sources.length) {
          showPosterOnly();
          return;
        }
        sources.forEach((source) => {
          source.src = source.dataset.src;
          source.removeAttribute("data-src");
        });
        heroVideo.load();
        const playback = heroVideo.play();
        if (playback && typeof playback.catch === "function") playback.catch(showPosterOnly);
      }));
    };
    heroVideo.addEventListener("error", showPosterOnly);
    if (typeof motionPreference.addEventListener === "function") {
      motionPreference.addEventListener("change", (event) => {
        if (event.matches) showPosterOnly();
      });
    } else {
      motionPreference.addListener?.((event) => {
        if (event.matches) showPosterOnly();
      });
    }
    connection?.addEventListener?.("change", () => {
      if (dataSaverEnabled()) showPosterOnly();
    });
    startHeroVideo();
  }

  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  const activeDockRoute = currentPath === "/" ? "home"
    : currentPath.startsWith("/categories") ? "categories"
    : currentPath.startsWith("/gallery") ? "gallery"
    : currentPath.startsWith("/cart") ? "cart"
    : currentPath.startsWith("/profile") || currentPath.startsWith("/account") || currentPath === "/login" || currentPath === "/register" ? "profile"
    : "";
  document.querySelectorAll(".mobile-dock [data-dock-route]").forEach((link) => {
    const active = link.dataset.dockRoute === activeDockRoute;
    link.classList.toggle("dock-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll(".desktop-primary-nav [data-site-route]").forEach((link) => {
    const active = link.dataset.siteRoute === activeDockRoute;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

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

      if (name.length > 120 || phone.length > 40 || location.length > 180 || details.length > 3000) {
        if (error) error.textContent = "Please shorten one of your entries and try again.";
        return;
      }
      const guestCount = guests ? Number(guests) : null;
      if (guests && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 10000)) {
        if (error) error.textContent = "Enter a guest count between 1 and 10,000.";
        return;
      }
      const enquiry = {
        name, phone, service,
        event_date: date || null,
        guest_count: guestCount,
        event_location: location || null,
        details: details || null,
        status: "new"
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
        const policyBlocked = insertError?.code === "42501";
        const invalidEntry = ["22023", "23514"].includes(insertError?.code);
        if (error) error.textContent = "We couldn't save your enquiry. " + (policyBlocked
          ? "Refresh the page and try again."
          : invalidEntry
            ? "Check the length and range of your details, then try again."
            : "Please try again or contact us directly on WhatsApp.");
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
      whatsappLink.textContent = "Continue to WhatsApp ";
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
