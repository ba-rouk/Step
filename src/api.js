let csrfToken = null;
let csrfRequest = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch("/api/csrf", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.csrfToken) {
        throw new Error(payload.error || "Your secure session could not be started. Refresh the page and try again.");
      }
      csrfToken = payload.csrfToken;
      return csrfToken;
    }).finally(() => {
      csrfRequest = null;
    });
  }
  return csrfRequest;
}

export async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const init = {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: options.cache ?? (["GET", "HEAD"].includes(method) ? "default" : "no-store")
  };

  if (options.body !== undefined && options.body !== null && typeof options.body !== "string" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }

  return fetch(url, init);
}
