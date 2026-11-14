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
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Order service is not configured." }, 503);

  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const rawBody = await req.text();
  if (rawBody.length > 24000) return json({ error: "Order details are too large." }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody || "{}"); } catch { return json({ error: "Invalid order details." }, 400); }

  if (String(body.website || body.company_website || "").trim()) {
    return json({ error: "We could not process this request. Please try again." }, 400);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let user: { id: string; email: string } | null = null;
  if (token) {
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data?.user) return json({ error: "Your sign-in session expired. Refresh and try again." }, 401);
    user = {
      id: auth.data.user.id,
      email: String(auth.data.user.email || "").trim().toLowerCase()
    };
  }

  const name = String(body.customer_name || "").trim();
  const phone = normalizePhone(body.customer_phone);
  const email = String(user?.email || body.customer_email || "").trim().toLowerCase();
  const fulfillment = String(body.fulfillment || "pickup");
  const description = String(body.order_description || "").trim();
  const notes = String(body.notes || "").trim();
  const location = String(body.delivery_location || "").trim();
  const date = body.requested_date ? String(body.requested_date) : null;
  const time = body.requested_time ? String(body.requested_time) : null;

  if (name.length < 2 || name.length > 120) return json({ error: "Enter your full name (2–120 characters)." }, 400);
  if (!phone) return json({ error: "Enter a valid phone number, including the +250 country code." }, 400);
  if (!validEmail(email)) return json({ error: "Enter a valid email address so you can receive your confirmation and find this order later." }, 400);
  if (!["pickup", "delivery"].includes(fulfillment)) return json({ error: "Choose pickup or delivery." }, 400);
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
  if ([...quantitiesById.values(), ...quantitiesBySlug.values()].some(value => value > 20)) {
    return json({ error: "Each product quantity must be between 1 and 20." }, 400);
  }

  const ip = String(req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",").at(-1)!.trim();
  const ipHash = await digest("ip:" + ip);
  const phoneHash = await digest("phone:" + phone);
  const emailHash = await digest("email:" + email);
  const limits = [
    ["ip:" + ipHash, 8, 900],
    ["phone:" + phoneHash, 5, 900],
    ["email:" + emailHash, 5, 3600]
  ] as const;
  for (const [bucket, maximum, seconds] of limits) {
    const result = await db.rpc("consume_step_order_rate_limit", {
      p_bucket_key: bucket, p_max_hits: maximum, p_window_seconds: seconds
    });
    if (result.error) {
      console.error("Order rate limit:", result.error);
      return json({ error: "The order service is busy. Please try again shortly." }, 503);
    }
    if (!result.data) return json({ error: "Too many order requests. Please wait before trying again." }, 429);
  }

  const ids = [...quantitiesById.keys()];
  const slugs = [...quantitiesBySlug.keys()];
  let query = db.from("store_products")
    .select("id,slug,name,category_id,price,price_unit,price_unit_label,image_url,image_urls,category:store_categories!store_products_category_id_fkey(name),images:product_images!product_images_product_id_fkey(url,position)")
    .eq("is_available", true).eq("is_visible", true);
  if (ids.length && slugs.length) query = query.or("id.in.(" + ids.join(",") + "),slug.in.(" + slugs.join(",") + ")");
  else if (ids.length) query = query.in("id", ids);
  else query = query.in("slug", slugs);

  const { data: products, error: productError } = await query;
  if (productError) {
    console.error("Order products:", productError);
    return json({ error: "The menu could not be checked. Please refresh and try again." }, 502);
  }
  const requestedCount = ids.length + slugs.length;
  if ((products || []).length !== requestedCount) {
    return json({ error: "One or more selected products are no longer available. Refresh the menu and try again." }, 400);
  }

  let total = 0;
  let priced = true;
  const cleanItems = (products || []).map(product => {
    const quantity = quantitiesById.get(product.id) || quantitiesBySlug.get(product.slug) || 1;
    const unitPrice = product.price == null ? null : Number(product.price);
    if (unitPrice == null || !Number.isFinite(unitPrice)) priced = false;
    else total += unitPrice * quantity;
    const firstImage = Array.isArray(product.images)
      ? [...product.images].sort((a, b) => Number(a.position || 0) - Number(b.position || 0))[0]
      : null;
    return {
      product_id: product.id, slug: product.slug, name: product.name,
      category: product.category?.name || "Menu", quantity,
      image_url: firstImage?.url || product.image_urls?.[0] || product.image_url || null,
      price_unit: product.price_unit || "unit",
      price_unit_label: product.price_unit_label || product.price_unit || "unit",
      unit_price: unitPrice,
      line_total: unitPrice == null ? null : unitPrice * quantity
    };
  });

  const orderPayload = {
    customer_id: user?.id || null,
    user_id: user?.id || null,
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    fulfillment,
    requested_date: date,
    requested_time: time,
    delivery_location: location || null,
    order_description: description || null,
    notes: notes || null,
    items: cleanItems,
    estimated_total: priced ? total : null,
    price_needs_confirmation: !priced,
    tracking_token: randomToken(),
    status: "new"
  };

  const { data: saved, error: insertError } = await db.from("store_orders")
    .insert(orderPayload)
    .select("id,order_number,tracking_token,estimated_total,created_at,items,status,fulfillment,delivery_location")
    .single();

  if (insertError || !saved) {
    console.error("Order save failed:", insertError);
    return json({ error: "We could not save your order just now. Please retry or contact Step Town on WhatsApp." }, 502);
  }

  // The database trigger has already queued the confirmation email and cashier
  // push alert. Those jobs run independently and retry without undoing this order.
  return json({
    ok: true,
    alert_queued: true,
    order: {
      id: saved.id,
      order_number: saved.order_number,
      tracking_token: saved.tracking_token,
      estimated_total: saved.estimated_total,
      created_at: saved.created_at,
      items: saved.items,
      status: saved.status,
      fulfillment: saved.fulfillment,
      delivery_location: saved.delivery_location
    }
  }, 201);
});
