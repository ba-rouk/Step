import { supabase, supabaseConfigured } from "./supabase.js";

const grid = document.querySelector(".gallery-grid");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

function normalizeGalleryImageUrl(value) {
  let candidate = value;

  // Older gallery uploads stored { url, public_id } as a JSON string.
  // Accept both that legacy format and the correct plain URL going forward.
  if (typeof candidate === "string" && candidate.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate);
      candidate = parsed && typeof parsed === "object" ? parsed.url : "";
    } catch {
      return "";
    }
  } else if (candidate && typeof candidate === "object") {
    candidate = candidate.url;
  }

  if (typeof candidate !== "string" || !candidate.trim()) return "";
  try {
    const url = new URL(candidate, window.location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

if (grid) {
  if (!supabaseConfigured || !supabase) {
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML = '<p class="gallery-empty">The Step Town gallery is temporarily unavailable.</p>';
  } else {
    const filters = ["All", "Catering", "Staff", "Barbecue", "Cakes"];
    let visibleGalleryItems = [];
    let lightboxIndex = 0;

    grid.setAttribute("aria-busy", "true");
    supabase.from("gallery_items")
      .select("id,title,category,image_url,alt_text,caption,sort_order,created_at")
      .eq("is_published", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.warn("Step Town gallery could not load", error);
          grid.setAttribute("aria-busy", "false");
          grid.innerHTML = '<p class="gallery-empty">Gallery photos could not load. Please try again later.</p>';
          return;
        }

        const rows = (data || []).map((item) => ({
          ...item,
          image_src: normalizeGalleryImageUrl(item.image_url)
        })).filter((item) => item.image_src);

        const filtersBar = document.createElement("div");
        filtersBar.className = "gallery-filters";
        filtersBar.setAttribute("aria-label", "Filter gallery images");

        filtersBar.innerHTML = filters.map((filter, index) =>
          '<button type="button" data-gallery-filter="' + filter + '"' +
          ' class="' + (index === 0 ? "active" : "") + '">' + filter + '</button>'
        ).join("");

        if (rows.length) grid.before(filtersBar);

        const render = (category) => {
          const items = category === "All"
            ? rows
            : rows.filter((item) => String(item.category).toLowerCase() === category.toLowerCase());
          visibleGalleryItems = items;

          grid.innerHTML = items.length
            ? items.map((item, index) =>
                '<figure class="gallery-item is-visible' +
                  (index === 0 ? " gallery-large" : index === 1 ? " gallery-tall" : "") + '">' +
                  '<img class="live-gallery-image" data-gallery-open="' + index + '" role="button" tabindex="0" src="' + escapeHtml(item.image_src) + '"' +
                    ' alt="' + escapeHtml(item.alt_text || item.title || "Step Town gallery photo") + '"' +
                    ' aria-label="Open image ' + (index + 1) + ' of ' + items.length + '"' +
                    ' loading="' + (index === 0 ? "eager" : "lazy") + '"' +
                    ' decoding="async" width="1200" height="900">' +
                  '<figcaption><span>' + String(index + 1).padStart(2, "0") + '</span>' +
                    escapeHtml(item.title || item.category || "Step Town") +
                    (item.caption ? " · " + escapeHtml(item.caption) : "") +
                  '</figcaption>' +
                '</figure>'
              ).join("")
            : '<p class="gallery-empty">No published photos in this category yet.</p>';

          grid.setAttribute("aria-busy", "false");
        };

        if (!rows.length) {
          grid.innerHTML = '<p class="gallery-empty">New Step Town moments will appear here soon.</p>';
          grid.setAttribute("aria-busy", "false");
          return;
        }

        const lightbox = document.createElement("dialog");
        lightbox.className = "public-gallery-lightbox";
        lightbox.innerHTML = '<button type="button" class="public-gallery-close" aria-label="Close image viewer">×</button><button type="button" class="public-gallery-prev" aria-label="Previous image">‹</button><img class="public-gallery-full-image" alt=""><button type="button" class="public-gallery-next" aria-label="Next image">›</button><p class="public-gallery-count"></p>';
        document.body.append(lightbox);
        const showLightbox = index => {
          if (!visibleGalleryItems.length) return;
          lightboxIndex = (index + visibleGalleryItems.length) % visibleGalleryItems.length;
          const item = visibleGalleryItems[lightboxIndex];
          const image = lightbox.querySelector(".public-gallery-full-image");
          image.src = item.image_src;
          image.alt = item.alt_text || item.title || "Step Town gallery photo";
          lightbox.querySelector(".public-gallery-count").textContent = (lightboxIndex + 1) + " / " + visibleGalleryItems.length;
          if (!lightbox.open) lightbox.showModal();
        };
        grid.addEventListener("click", event => {
          const image = event.target.closest("[data-gallery-open]");
          if (image) showLightbox(Number(image.dataset.galleryOpen));
        });
        grid.addEventListener("keydown", event => {
          const image = event.target.closest("[data-gallery-open]");
          if (image && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            showLightbox(Number(image.dataset.galleryOpen));
          }
        });
        lightbox.querySelector(".public-gallery-close").addEventListener("click", () => lightbox.close());
        lightbox.querySelector(".public-gallery-prev").addEventListener("click", () => showLightbox(lightboxIndex - 1));
        lightbox.querySelector(".public-gallery-next").addEventListener("click", () => showLightbox(lightboxIndex + 1));
        lightbox.addEventListener("click", event => { if (event.target === lightbox) lightbox.close(); });
        lightbox.addEventListener("keydown", event => {
          if (event.key === "ArrowLeft") showLightbox(lightboxIndex - 1);
          if (event.key === "ArrowRight") showLightbox(lightboxIndex + 1);
        });

        filtersBar.addEventListener("click", (event) => {
          const button = event.target.closest("[data-gallery-filter]");
          if (!button) return;

          filtersBar.querySelectorAll("button").forEach((item) => {
            item.classList.toggle("active", item === button);
          });
          render(button.dataset.galleryFilter);
        });

        render("All");
      })
      .catch((error) => {
        console.warn("Step Town gallery request failed", error);
        grid.setAttribute("aria-busy", "false");
        grid.innerHTML = '<p class="gallery-empty">Gallery photos could not load. Please try again later.</p>';
      });
  }
}
