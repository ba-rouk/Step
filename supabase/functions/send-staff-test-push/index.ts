import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const allowedOrigins = new Set(["https://steptown.onrender.com", "http://localhost:5173"]);
function json(body: unknown, status = 200, origin: string | null = null) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}
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

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required." }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:orders@steptown.rw";
  if (!url || !serviceKey) return json({ error: "Supabase server configuration is missing." }, 500, origin);
  if (!vapidPublic || !vapidPrivate) return json({ error: "Push notification keys are not configured.", ok: false }, 503, origin);

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return json({ error: "Your session is invalid." }, 401, origin);

  const { data: staff, error: staffError } = await db.from("staff_profiles")
    .select("id,role,is_active,full_name")
    .eq("user_id", user.id).maybeSingle();
  if (staffError || !staff?.is_active || !["manager", "accountant", "cashier"].includes(staff.role)) {
    return json({ error: "Active Step Town staff access required." }, 403, origin);
  }

  const { data: subscriptions, error: subscriptionsError } = await db.from("push_subscriptions")
    .select("id,endpoint,p256dh,auth_key")
    .eq("user_id", user.id);
  if (subscriptionsError) return json({ error: "Could not load this device subscription." }, 500, origin);
  if (!subscriptions?.length) return json({ error: "Enable alerts on this device before sending a test.", ok: false }, 400, origin);

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const payload = JSON.stringify({
    title: "Step Town alerts are working",
    body: "This is a test notification for " + (staff.full_name || "your staff account") + ".",
    url: "/staff/overview",
    tag: "step-town-test-" + user.id,
  });
  const outcomes = await Promise.all(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      }, payload);
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id);
      }
      console.error("Test push failed:", error);
      return false;
    }
  }));
  return json({
    ok: outcomes.some(Boolean),
    sent: outcomes.filter(Boolean).length,
    attempted: outcomes.length,
    error: outcomes.some(Boolean) ? undefined : "The push service did not accept this device subscription.",
  }, 200, origin);
});
