import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set(["https://steptown.onrender.com", "http://localhost:5173"]);
const attempts = new Map<string, { count: number; reset: number }>();
const json = (body: unknown, status = 200, origin: string | null = null) => {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    const headers = new Headers({
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    });
    if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
    return new Response("ok", { headers });
  }
  if (req.method !== "POST" || (origin && !allowedOrigins.has(origin))) {
    return json({ error: "Origin or method not allowed." }, 403, origin);
  }

  const forwarded = req.headers.get("x-forwarded-for") || "unknown";
  const ip = forwarded.split(",")[0].trim();
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (bucket && bucket.reset > now && bucket.count >= 8) {
    return json({ ok: true }, 200, origin);
  }
  if (!bucket || bucket.reset <= now) attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
  else bucket.count++;

  const payload = await req.json().catch(() => null);
  if (!payload || payload.event !== "failed") return json({ error: "Invalid event." }, 400, origin);
  const email = String(payload.email || "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: true }, 200, origin);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const fingerprint = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Audit service is not configured." }, 500, origin);

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from("audit_log").insert({
    actor_id: null,
    actor_role: null,
    action: "staff_login_failed",
    entity_type: "staff_auth",
    entity_id: fingerprint,
    details: { email_fingerprint: fingerprint, source: "staff_portal" },
  });
  if (error) {
    console.error("Could not write failed staff login audit:", error.message);
    return json({ error: "Audit entry could not be written." }, 500, origin);
  }
  return json({ ok: true }, 200, origin);
});
