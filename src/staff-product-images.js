import { supabase } from "./supabase.js";
import { getCsrfToken } from "./api.js";

const MAX_FILES = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

async function compressForUpload(file) {
  if (!ACCEPTED.has(file.type)) throw new Error(file.name + ": choose a JPG, PNG or WEBP image.");
  if (file.size > MAX_BYTES) throw new Error(file.name + ": the original file must be 5 MB or smaller.");
  const bitmap = await createImageBitmap(file);
  try {
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 70) || "product";
    const encode = async maxWidth => {
      const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Your browser could not prepare this image.");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error("Image compression failed.")), "image/webp", 0.86);
      });
      if (!blob.size || blob.size > MAX_BYTES) throw new Error(file.name + ": a compressed image variant is larger than 5 MB.");
      return new File([blob], stem + "-" + width + ".webp", { type: "image/webp", lastModified: Date.now() });
    };
    const primary = await encode(1600);
    const variants = {
      480: await encode(480),
      800: await encode(800),
      1200: await encode(1200)
    };
    return { primary, variants };
  } finally {
    bitmap.close?.();
  }
}

async function sessionHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your staff session has expired. Sign in again.");
  return {
    authorization: "Bearer " + session.access_token,
    csrf: await getCsrfToken()
  };
}

function uploadWithProgress(productId, imageFiles, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const auth = await sessionHeaders();
      const form = new FormData();
      form.append("file", imageFiles.primary, imageFiles.primary.name);
      for (const [width, variant] of Object.entries(imageFiles.variants)) {
        form.append("variant_" + width, variant, variant.name);
      }
      form.append("alt_text", imageFiles.primary.name.replace(/\.[^.]+$/, "").slice(0, 240));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/staff/products/" + encodeURIComponent(productId) + "/images");
      xhr.withCredentials = true;
      xhr.setRequestHeader("Authorization", auth.authorization);
      xhr.setRequestHeader("X-CSRF-Token", auth.csrf);
      xhr.upload.addEventListener("progress", event => {
        if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
      });
      xhr.addEventListener("load", () => {
        let payload = {};
        try { payload = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(payload.error || "The image could not be uploaded."));
          return;
        }
        resolve(payload.image);
      });
      xhr.addEventListener("error", () => reject(new Error("The image upload was interrupted. Check your connection and retry.")));
      xhr.addEventListener("abort", () => reject(new Error("The image upload was cancelled.")));
      xhr.send(form);
    } catch (error) {
      reject(error);
    }
  });
}

async function requestJson(path, method, body) {
  const auth = await sessionHeaders();
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "Authorization": auth.authorization,
      "X-CSRF-Token": auth.csrf,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The product images could not be saved.");
  return payload;
}

export function mountProductImageManager(host, productId, existingImages = []) {
  if (!host) throw new Error("The product image upload area is missing.");
  const items = (Array.isArray(existingImages) ? existingImages : []).map(image => ({
    kind: "existing",
    id: image.id,
    url: image.url,
    public_id: image.public_id || null,
    alt_text: image.alt_text || "",
    file: null,
    progress: 100
  }));
  const removed = [];
  let errorMessage = "";
  let saving = false;

  const render = () => {
    host.innerHTML =
      '<div class="staff-image-manager">' +
        '<div class="staff-image-manager-head"><div><b>Product gallery</b><small>Up to 10 images · JPG, PNG or WEBP · 5 MB each</small></div><span class="staff-image-count">' + items.length + ' / 10</span></div>' +
        '<div class="staff-image-dropzone" data-image-dropzone><span class="staff-image-drop-title">Drop product photos here</span><span>or choose images from your device</span><label class="staff-primary staff-image-pick">Choose images<input type="file" data-image-input accept="image/jpeg,image/png,image/webp" multiple ' + (saving ? 'disabled' : '') + '></label></div>' +
        '<div class="staff-image-grid" data-image-grid>' + items.map((item, index) =>
          '<article class="staff-image-item" data-image-index="' + index + '" draggable="' + (!saving) + '">' +
            '<div class="staff-image-thumb"><img src="' + esc(item.url) + '" alt="' + esc(item.alt_text || "Product photo " + (index + 1)) + '">' +
              (index === 0 ? '<span class="staff-image-cover">COVER</span>' : '') +
            '</div>' +
            '<div class="staff-image-progress" aria-label="Upload progress"><span style="width:' + Number(item.progress || 0) + '%"></span></div>' +
            '<small>' + (item.kind === "new" ? (item.progress >= 100 ? 'Ready to upload' : 'Waiting to upload') : 'Saved image') + '</small>' +
            '<div class="staff-image-actions">' +
              (index === 0 ? '<span class="staff-image-cover-label">Cover image</span>' : '<button type="button" data-image-cover="' + index + '">Make cover</button>') +
              '<button type="button" data-image-left="' + index + '" ' + (index === 0 || saving ? 'disabled' : '') + '>Move earlier</button>' +
              '<button type="button" data-image-right="' + index + '" ' + (index === items.length - 1 || saving ? 'disabled' : '') + '>Move later</button>' +
              '<button type="button" class="staff-image-remove" data-image-remove="' + index + '" ' + (saving ? 'disabled' : '') + '>Remove</button>' +
            '</div>' +
          '</article>'
        ).join("") + '</div>' +
        (errorMessage ? '<p class="staff-image-error" role="alert">' + esc(errorMessage) + '</p>' : '') +
        '<p class="staff-image-help">The first image is the cover and first carousel slide. Drag photos to reorder them, or use the move buttons.</p>' +
      '</div>';

    const input = host.querySelector("[data-image-input]");
    const dropzone = host.querySelector("[data-image-dropzone]");
    input?.addEventListener("change", event => {
      addFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });
    ["dragenter", "dragover"].forEach(name => dropzone?.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    }));
    ["dragleave", "drop"].forEach(name => dropzone?.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
    }));
    dropzone?.addEventListener("drop", event => addFiles(Array.from(event.dataTransfer?.files || [])));

    host.querySelectorAll("[data-image-remove]").forEach(button => button.addEventListener("click", () => {
      const item = items.splice(Number(button.dataset.imageRemove), 1)[0];
      if (item?.kind === "new" && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      if (item?.kind === "existing" && item.id) removed.push(item);
      errorMessage = "";
      render();
    }));
    host.querySelectorAll("[data-image-cover]").forEach(button => button.addEventListener("click", () => moveTo(Number(button.dataset.imageCover), 0)));
    host.querySelectorAll("[data-image-left]").forEach(button => button.addEventListener("click", () => moveBy(Number(button.dataset.imageLeft), -1)));
    host.querySelectorAll("[data-image-right]").forEach(button => button.addEventListener("click", () => moveBy(Number(button.dataset.imageRight), 1)));

    const grid = host.querySelector("[data-image-grid]");
    grid?.querySelectorAll("[data-image-index]").forEach(card => {
      card.addEventListener("dragstart", event => {
        event.dataTransfer?.setData("text/plain", card.dataset.imageIndex);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragover", event => event.preventDefault());
      card.addEventListener("drop", event => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData("text/plain"));
        const to = Number(card.dataset.imageIndex);
        if (Number.isInteger(from) && from !== to) moveTo(from, to);
      });
    });
  };

  function addFiles(files) {
    if (!files.length) return;
    errorMessage = "";
    for (const file of files) {
      if (items.length >= MAX_FILES) {
        errorMessage = "A product can have no more than 10 images.";
        break;
      }
      if (!ACCEPTED.has(file.type)) {
        errorMessage = file.name + ": choose a JPG, PNG or WEBP image.";
        continue;
      }
      if (file.size > MAX_BYTES) {
        errorMessage = file.name + ": the image must be 5 MB or smaller.";
        continue;
      }
      items.push({
        kind: "new",
        file,
        url: URL.createObjectURL(file),
        public_id: null,
        alt_text: file.name.replace(/\.[^.]+$/, "").slice(0, 240),
        progress: 0
      });
    }
    render();
  }

  function moveTo(from, to) {
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const item = items.splice(from, 1)[0];
    items.splice(to, 0, item);
    render();
  }

  function moveBy(index, amount) {
    moveTo(index, index + amount);
  }

  async function save(savedProductId) {
    if (saving) return;
    if (!savedProductId) throw new Error("Save the product details before uploading images.");
    if (items.length > MAX_FILES) throw new Error("A product can have no more than 10 images.");
    saving = true;
    errorMessage = "";
    render();
    try {
      while (removed.length) {
        const oldImage = removed[0];
        await requestJson("/api/staff/products/" + encodeURIComponent(savedProductId) + "/images/" + encodeURIComponent(oldImage.id), "DELETE");
        removed.shift();
      }
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.kind !== "new") continue;
        const compressed = await compressForUpload(item.file);
        const oldPreview = item.url;
        item.url = URL.createObjectURL(compressed.primary);
        URL.revokeObjectURL(oldPreview);
        item.progress = 0;
        render();
        const image = await uploadWithProgress(savedProductId, compressed, progress => {
          item.progress = progress;
          const card = host.querySelector('[data-image-index="' + index + '"]');
          const bar = card?.querySelector(".staff-image-progress span");
          if (bar) bar.style.width = progress + "%";
        });
        URL.revokeObjectURL(item.url);
        item.kind = "existing";
        item.id = image.id;
        item.url = image.url;
        item.public_id = image.public_id;
        item.variants = image.variants || {};
        item.alt_text = image.alt_text || item.alt_text;
        item.progress = 100;
        item.file = null;
        render();
      }
      const imageIds = items.map(item => item.id).filter(Boolean);
      if (imageIds.length) {
        await requestJson("/api/staff/products/" + encodeURIComponent(savedProductId) + "/images/order", "PATCH", { imageIds });
      }
      saving = false;
      render();
    } catch (error) {
      saving = false;
      errorMessage = error.message || "The product images could not be saved.";
      render();
      throw error;
    }
  }

  render();
  return {
    save,
    getImages: () => items.map(item => ({ ...item })),
    destroy: () => items.forEach(item => { if (item.kind === "new" && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url); })
  };
}
