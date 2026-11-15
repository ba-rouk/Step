const DEFAULT_SITE_URL = "https://vitanova-1hfh.onrender.com";

export function getSiteUrl(): string {
  let configured = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
  while (configured.endsWith("/")) configured = configured.slice(0, -1);
  return configured;
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
