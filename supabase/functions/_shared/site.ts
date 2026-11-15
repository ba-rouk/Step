const DEFAULT_SITE_URL = "https://vitanova-1hfh.onrender.com";

export function getSiteUrl(): string {
  const configured = Deno.env.get("SITE_URL") || Deno.env.get("APP_URL") || DEFAULT_SITE_URL;
  return configured.replace(/\\/+$/, "");
}

export function getAllowedSiteOrigins(): Set<string> {
  const origins = new Set(["http://localhost:5173"]);
  try {
    origins.add(new URL(getSiteUrl()).origin);
  } catch {
    origins.add(new URL(DEFAULT_SITE_URL).origin);
  }
  return origins;
}
