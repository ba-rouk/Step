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

  function clearEnquiryFieldErrors() {
    ["name","phone","service","date","guests","location","details"].forEach((key) => {
      const field = form?.elements.namedItem(key);
      if (field) {
        field.setCustomValidity("");
        field.removeAttribute("aria-invalid");
      }
    });
  }

  function showEnquiryIssue(fieldName, message) {
    const field = form?.elements.namedItem(fieldName);
    if (field) {
      field.setAttribute("aria-invalid","true");
      field.setCustomValidity(message);
      field.reportValidity();
      field.focus();
    }
    if (error) error.textContent = "We couldn't save your enquiry. Issue: " + ({
      name:"Your name",phone:"Your phone number",service:"Service",date:"Event date",
      guests:"Approximate guest count",location:"Event location",details:"Additional details"
    }[fieldName] || "Enquiry details") + " — " + message;
  }

  function enquiryConstraintIssue(insertError) {
    const source = [insertError?.constraint,insertError?.message,insertError?.details,insertError?.hint].filter(Boolean).join(" ").toLowerCase();
    const issues = [
      ["name",/enquiries_name_check|name_check/,"Enter 2–120 characters for your name."],
      ["phone",/enquiries_phone_check|phone_check/,"Enter 5–40 characters for your phone number."],
      ["service",/enquiries_service_check|service_check/,"Choose one of the listed services."],
      ["guests",/enquiries_guest_count_check|guest_count/,"Enter a whole number from 1 to 10,000, or leave it blank."],
      ["location",/enquiries_event_location_check|event_location/,"Keep the event location to 180 characters or fewer."],
      ["details",/enquiries_details_check|details_check/,"Keep additional details to 3,000 characters or fewer."]
    ];
    return issues.find(([,pattern]) => pattern.test(source)) || null;
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

      if (name.length < 2 || name.length > 120) {
        showEnquiryIssue("name","Enter 2–120 characters.");
        return;
      }
      if (phone.length < 5 || phone.length > 40) {
        showEnquiryIssue("phone","Enter 5–40 characters, including your country code if available.");
        return;
      }
      const validServices = Array.from(form.elements.service.options).map(option => option.value).filter(Boolean);
      if (!service || !validServices.includes(service)) {
        showEnquiryIssue("service","Choose one of the available services.");
        return;
      }
      if (date && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
        showEnquiryIssue("date","Choose a valid calendar date.");
        return;
      }
      const guestCount = guests ? Number(guests) : null;
      if (guests && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 10000)) {
        showEnquiryIssue("guests","Enter a whole number from 1 to 10,000, or leave it blank.");
        return;
      }
      if (location.length > 180) {
        showEnquiryIssue("location","Use 180 characters or fewer.");
        return;
      }
      if (details.length > 3000) {
        showEnquiryIssue("details","Use 3,000 characters or fewer.");
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
        const issue = enquiryConstraintIssue(insertError);
        if (issue) {
          showEnquiryIssue(issue[0],issue[2]);
        } else if (insertError?.code === "42501") {
          if (error) error.textContent = "We couldn't save your enquiry. Issue: submission permission — refresh the page and try again. If it continues, contact Step Town on WhatsApp.";
        } else if (insertError?.code === "22023") {
          if (error) error.textContent = "We couldn't save your enquiry. Issue: one of the date or number fields has an invalid value. Check Event date and Approx. guests.";
          const guestField = form.elements.guests;
          if (guestField) { guestField.setAttribute("aria-invalid","true"); guestField.focus(); }
        } else if (error) {
          error.textContent = "We couldn't save your enquiry. Issue: " + (insertError?.message || "the enquiry service could not accept the request") + ". Check the highlighted details or contact Step Town on WhatsApp.";
        }
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
