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

    primaryNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

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
    const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    dateInput.min = localToday;
  }

  const form = document.querySelector("#enquiry-form");
  const error = document.querySelector("#form-error");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (error) error.textContent = "";

      if (!form.reportValidity()) return;

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

      const lines = [
        "Hello Step Town, I'd like to make an event enquiry.",
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

      const message = encodeURIComponent(lines.join("\n"));
      const whatsappUrl = "https://wa.me/250780382589?text=" + message;
      const opened = window.open(whatsappUrl, "_blank", "noopener,noreferrer");

      if (!opened) {
        window.location.href = whatsappUrl;
      }
    });
  }

  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  const revealItems = document.querySelectorAll(".service-card, .process-step, .gallery-item");
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