import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

function normalizePhone(value: unknown): string | null {
  let phone = String(value || "").trim().replace(/[()\s.-]/g, "");
  if (/^0\d{8,10}$/.test(phone)) phone = "+250" + phone.slice(1);
  else if (/^250\d{8,12}$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Order service is not configured." }, 503);

  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const rawBody = await req.text();
  if (rawBody.length > 16000) return json({ error: "Order details are too large." }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody || "{}"); } catch { return json({ error: "Invalid order details." }, 400); }

  // Honeypot: silently reject automated form fills without saving or notifying.
  if (String(body.website || body.company_website || "").trim()) {
    return json({ error: "We could not process this request. Please try again." }, 400);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let user: { id: string } | null = null;
  if (token) {
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data?.user) return json({ error: "Your sign-in session expired. Refresh and try again." }, 401);
    user = { id: auth.data.user.id };
  }

  const name = String(body.customer_name || "").trim();
  const phone = normalizePhone(body.customer_phone);
  const fulfillment = String(body.fulfillment || "pickup");
  const description = String(body.order_description || "").trim();
  const notes = String(body.notes || "").trim();
  const location = String(body.delivery_location || "").trim();
  const email = String(body.customer_email || "").trim();
  const date = body.requested_date ? String(body.requested_date) : null;
  const time = body.requested_time ? String(body.requested_time) : null;

  if (name.length < 2 || name.length > 120) return json({ error: "Enter your name (2–120 characters)." }, 400);
  if (!phone) return json({ error: "Enter a valid phone number, including the +250 country code." }, 400);
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return json({ error: "Enter a valid email address or leave it blank." }, 400);
  if (!["pickup", "delivery"].includes(fulfillment)) return json({ error: "Choose pickup or delivery for this order." }, 400);
  if (fulfillment === "delivery" && location.length < 3) return json({ error: "Add the delivery location before sending." }, 400);
  if (location.length > 180 || description.length > 5000 || notes.length > 3000) return json({ error: "One of your order details is too long. Shorten it and try again." }, 400);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Choose a valid preferred date." }, 400);
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({ error: "Choose a valid preferred time." }, 400);

  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  if (!items.length || items.length > 50) return json({ error: "Choose at least one menu item before sending your order." }, 400);

  const quantitiesById = new Map<string, number>();
  const quantitiesBySlug = new Map<string, number>();
  for (const item of items) {
    const quantity = Number(item.quantity || 1);
    const id = String(item.product_id || item.id || "");
    const slug = String(item.slug || item.product_slug || "").trim().slice(0, 160);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return json({ error: "Each product quantity must be between 1 and 20." }, 400);
    if (id && /^[0-9a-f-]{36}$/i.test(id)) quantitiesById.set(id, Math.min(20, (quantitiesById.get(id) || 0) + quantity));
    else if (slug && /^[a-z0-9-]+$/i.test(slug)) quantitiesBySlug.set(slug, Math.min(20, (quantitiesBySlug.get(slug) || 0) + quantity));
    else return json({ error: "A selected product is invalid. Refresh the menu and try again." }, 400);
  }

  const ip = String(req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",").at(-1)!.trim();
  const ipHash = await digest("ip:" + ip);
  const phoneHash = await digest("phone:" + phone);
  const ipLimit = await db.rpc("consume_step_order_rate_limit", { p_bucket_key: "ip:" + ipHash, p_max_hits: 8, p_window_seconds: 900 });
  if (ipLimit.error) { console.error("IP rate limit:", ipLimit.error); return json({ error: "The order service is busy. Please try again shortly." }, 503); }
  if (!ipLimit.data) return json({ error: "Too many order requests from this connection. Try again in 15 minutes." }, 429);
  const phoneLimit = await db.rpc("consume_step_order_rate_limit", { p_bucket_key: "phone:" + phoneHash, p_max_hits: 5, p_window_seconds: 900 });
  if (phoneLimit.error) { console.error("Phone rate limit:", phoneLimit.error); return json({ error: "The order service is busy. Please try again shortly." }, 503); }
  if (!phoneLimit.data) return json({ error: "Too many orders have been sent from this phone number. Try again in 15 minutes." }, 429);

  const ids = [...quantitiesById.keys()];
  const slugs = [...quantitiesBySlug.keys()];
  let query = db.from("store_products")
    .select("id,slug,name,category_id,price,price_unit,price_unit_label,category:store_categories!store_products_category_id_fkey(name)")
    .eq("is_available", true).eq("is_visible", true);
  if (ids.length && slugs.length) query = query.or("id.in.(" + ids.join(",") + "),slug.in.(" + slugs.join(",") + ")");
  else if (ids.length) query = query.in("id", ids);
  else query = query.in("slug", slugs);
  const { data: products, error: productError } = await query;
  if (productError) { console.error("Order products:", productError); return json({ error: "The menu could not be checked. Please refresh and try again." }, 502); }
  const requestedCount = ids.length + slugs.length;
  if ((products || []).length !== requestedCount) return json({ error: "One or more selected products are no longer available. Refresh the menu and try again." }, 400);

  let total = 0;
  let priced = true;
  const cleanItems = (products || []).map(product => {
    const quantity = quantitiesById.get(product.id) || quantitiesBySlug.get(product.slug) || 1;
    const unitPrice = product.price == null ? null : Number(product.price);
    if (!Number.isFinite(unitPrice)) priced = false;
    else total += unitPrice * quantity;
    return {
      product_id: product.id, slug: product.slug, name: product.name,
      category: product.category?.name || "Menu", quantity,
      price_unit: product.price_unit || "unit",
      price_unit_label: product.price_unit_label || product.price_unit || "unit",
      unit_price: unitPrice,
      line_total: unitPrice == null ? null : unitPrice * quantity
    };
  });

  const orderPayload = {
    customer_id: user?.id || null,
    customer_name: name, customer_phone: phone, customer_email: email || null,
    fulfillment, requested_date: date, requested_time: time,
    delivery_location: location || null,
    order_description: description || null,
    notes: notes || null,
    items: cleanItems,
    estimated_total: priced ? total : null,
    price_needs_confirmation: !priced,
    status: "new"
  };

  // Service-role insertion returns the generated order number without granting
  // anonymous customers permission to read private order rows.
  const { data: saved, error: insertError } = await db.from("store_orders")
    .insert(orderPayload)
    .select("id,order_number,estimated_total,created_at")
    .single();
  if (insertError || !saved) {
    console.error("Order save failed:", insertError);
    return json({ error: "We could not save your order just now. Please retry or contact Step Town on WhatsApp." }, 502);
  }

  // Notification is a separate best-effort step; a push failure never rolls back the order.
  let alertQueued = false;
  try {
    const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const push = await fetch(supabaseUrl + "/functions/v1/send-order-push", {
      method: "POST", headers, body: JSON.stringify({ order_id: saved.id })
    });
    alertQueued = push.ok;
    if (!push.ok) console.warn("Order saved; staff push failed with status", push.status);
  } catch (error) {
    console.error("Order saved; staff push failed:", error);
  }

  return json({
    ok: true,
    order: { order_number: saved.order_number, estimated_total: saved.estimated_total, created_at: saved.created_at },
    alert_queued: alertQueued
  }, 201);
});
