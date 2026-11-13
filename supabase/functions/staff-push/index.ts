import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicVapidKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const privateVapidKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:orders@steptown.onrender.com";

const allowedOrigin = (origin: string | null) =>
  origin === "https://steptown.onrender.com" || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";

function responseHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin) ? origin! : "https://steptown.onrender.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}
function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });
}
function money(value: number | null) {
  if (value === null || !Number.isFinite(Number(value))) return "Quote required";
  return "RWF " + new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(Number(value));
}
function fulfilmentLabel(order: any) {
  const base = order.fulfillment === "delivery" ? "Delivery" : order.fulfillment === "event" ? "Event service" : "Pickup";
  return order.requested_time ? base + " " + order.requested_time : base;
}
function orderBody(order: any) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemText = items.slice(0, 12).map((item: any) => (Number(item.quantity) || 1) + " x " + String(item.name || "Item").slice(0, 80)).join(", ");
  return (itemText || "New Step Town order") + " - " + money(order.estimated_total) + " - " + fulfilmentLabel(order);
}
function notification(order: any, escalated = false) {
  return {
    title: escalated ? "Order " + order.order_number + " needs attention" : "New order " + order.order_number,
    body: escalated ? "No cashier acknowledgement after 10 minutes. " + orderBody(order) : orderBody(order),
    tag: "step-town-" + order.id,
    data: { url: "/staff/orders/" + encodeURIComponent(order.order_number), orderNumber: order.order_number },
    renotify: escalated,
    requireInteraction: true,
  };
}
async function getCaller(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
  if (!token) return { user: null, profile: null };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { user: null, profile: null };
  const { data: profile } = await admin.from("staff_profiles").select("id,user_id,role,is_active,phone,email,full_name").eq("user_id", data.user.id).maybeSingle();
  if (!profile?.is_active) return { user: data.user, profile: null };
  return { user: data.user, profile };
}
function ensureVapid() {
  if (!publicVapidKey || !privateVapidKey) return false;
  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
  return true;
}
async function sendPushToRole(role: string, payload: unknown) {
  if (!ensureVapid()) return { sent: 0, failed: 0, skipped: true, profiles: [] as any[] };
  const { data: profiles } = await admin.from("staff_profiles").select("user_id,phone,email,full_name").eq("role", role).eq("is_active", true);
  const userIds = (profiles || []).map((p: any) => p.user_id);
  if (!userIds.length) return { sent: 0, failed: 0, skipped: false, profiles: profiles || [] };
  const { data: subscriptions } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth_key").in("user_id", userIds);
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      sent++;
    } catch (error) {
      failed++;
      const statusCode = Number((error as any)?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id);
      console.error("Web Push delivery failed", statusCode, String(error));
    }
  }
  return { sent, failed, skipped: false, profiles: profiles || [] };
}
async function sendFallback(profiles: any[], title: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM") || "Step Town <onboarding@resend.dev>";
  const results: string[] = [];
  for (const profile of profiles || []) {
    if (sid && token && from && profile.phone) {
      const form = new URLSearchParams({ To: profile.phone, From: from, Body: title + ": " + body });
      try {
        const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
          method: "POST",
          headers: { Authorization: "Basic " + btoa(sid + ":" + token), "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        results.push(response.ok ? "sms:" + profile.user_id : "sms_failed:" + profile.user_id);
      } catch { results.push("sms_failed:" + profile.user_id); }
    }
    if (resendKey && profile.email) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({ from: resendFrom, to: [profile.email], subject: title, text: body }),
        });
        results.push(response.ok ? "email:" + profile.user_id : "email_failed:" + profile.user_id);
      } catch { results.push("email_failed:" + profile.user_id); }
    }
  }
  return results;
}
async function notifyRole(role: string, order: any, escalated = false) {
  const payload = notification(order, escalated);
  const delivery = await sendPushToRole(role, payload);
  if (delivery.sent === 0 || delivery.failed > 0 || delivery.skipped) await sendFallback(delivery.profiles || [], payload.title, payload.body);
  return delivery;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (req.method !== "POST" || (origin && !allowedOrigin(origin))) return json({ error: "Origin or method not allowed." }, 403, origin);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }
  const action = String(body.action || "");

  if (action === "config") return json({ vapid_public_key: publicVapidKey, push_configured: Boolean(publicVapidKey && privateVapidKey) }, 200, origin);

  // Cron is public but can only claim New orders that have been waiting for ten minutes.
  if (action === "escalate") {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: waiting, error } = await admin.from("store_orders").select("*")
      .eq("status", "new").is("acknowledged_at", null).is("escalated_at", null)
      .lt("created_at", cutoff).order("created_at", { ascending: true }).limit(50);
    if (error) return json({ error: "Escalation scan failed." }, 500, origin);
    let escalated = 0;
    for (const order of waiting || []) {
      const { data: claimed } = await admin.from("store_orders").update({ escalated_at: new Date().toISOString() })
        .eq("id", order.id).eq("status", "new").is("acknowledged_at", null).is("escalated_at", null)
        .select("id").maybeSingle();
      if (!claimed) continue;
      await notifyRole("cashier", order, true);
      await notifyRole("accountant", order, true);
      await admin.from("audit_log").insert({ action: "order_escalated", entity_type: "store_order", entity_id: order.id, details: { order_number: order.order_number, delay_minutes: 10 } });
      escalated++;
    }
    return json({ success: true, escalated }, 200, origin);
  }

  const { user, profile } = await getCaller(req);
  if (!user) return json({ error: "Sign in to use staff notifications." }, 401, origin);

  if (action === "subscribe") {
    if (!profile) return json({ error: "Only active staff can subscribe to staff notifications." }, 403, origin);
    const subscription = body.subscription || {};
    const endpoint = String(subscription.endpoint || "");
    const p256dh = String(subscription.keys?.p256dh || "");
    const authKey = String(subscription.keys?.auth || "");
    if (!endpoint.startsWith("https://") || endpoint.length > 3000 || !p256dh || !authKey) return json({ error: "The browser push subscription is invalid." }, 400, origin);
    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: user.id, endpoint, p256dh, auth_key: authKey,
      user_agent: String(req.headers.get("user-agent") || "").slice(0, 400),
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) return json({ error: "Could not save this device subscription." }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  if (action === "unsubscribe") {
    if (!profile) return json({ error: "Only active staff can manage staff notifications." }, 403, origin);
    await admin.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", String(body.endpoint || ""));
    return json({ success: true }, 200, origin);
  }

  if (action === "new-order") {
    const orderId = String(body.order_id || "");
    const { data: order } = await admin.from("store_orders").select("*").eq("id", orderId).maybeSingle();
    if (!order || order.customer_id !== user.id) return json({ error: "That order could not be verified for your account." }, 403, origin);
    const result = await notifyRole("cashier", order, false);
    return json({ success: true, sent: result.sent, failed: result.failed, push_configured: !result.skipped }, 200, origin);
  }

  if (action === "acknowledge") {
    if (!profile || profile.role !== "cashier") return json({ error: "Only an active Cashier can acknowledge a new order." }, 403, origin);
    const orderId = String(body.order_id || "");
    const { data: updated, error } = await admin.from("store_orders")
      .update({ acknowledged_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", orderId).eq("status", "new").is("acknowledged_at", null)
      .select("id,order_number").maybeSingle();
    if (error) return json({ error: "Could not acknowledge this order." }, 400, origin);
    if (!updated) return json({ success: true, already_acknowledged: true }, 200, origin);
    await admin.from("store_order_events").insert({ order_id: orderId, actor_id: user.id, event_type: "acknowledged", description: "Cashier acknowledged the order" });
    await admin.from("audit_log").insert({ actor_id: user.id, actor_role: profile.role, action: "order_acknowledged", entity_type: "store_order", entity_id: orderId, details: { order_number: updated.order_number } });
    return json({ success: true }, 200, origin);
  }

  return json({ error: "Unknown push action." }, 400, origin);
});
