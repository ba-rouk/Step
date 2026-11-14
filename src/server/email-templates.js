const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const formatRwf = value => value == null ? "To be confirmed" : "RWF " + Number(value).toLocaleString("en-RW", { maximumFractionDigits:0 });

function shell(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + escapeHtml(title) + '</title></head>' +
    '<body style="margin:0;background:#211d1a;color:#fff4eb;font-family:Inter,Arial,sans-serif">' +
    '<div style="max-width:620px;margin:28px auto;padding:34px 24px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:22px">' +
    '<p style="margin:0 0 10px;color:#ffbd8d;letter-spacing:3px;font-size:11px;font-weight:700">STEP TOWN · RWANDA</p>' +
    '<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:32px;font-weight:600;line-height:1.1">' + escapeHtml(title) + '</h1>' +
    body +
    '<p style="margin:30px 0 0;color:#d4c5b9;font-size:12px;line-height:1.6">Good food. Thoughtful details. Your kind of celebration.<br>Step Town · Runda, Rwanda</p>' +
    '</div></body></html>';
}

export function orderConfirmationTemplate(payload = {}) {
  const order = payload.order || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.map(item => {
    const name = escapeHtml(item.name || "Menu item");
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unit = item.unit_price == null ? "Quote to be confirmed" : formatRwf(item.unit_price) + " per " + escapeHtml(item.price_unit_label || "unit");
    const line = item.line_total == null ? "Quote required" : formatRwf(item.line_total);
    return '<tr><td style="padding:12px 0;border-bottom:1px solid #56483f"><b>' + name + '</b><br><span style="color:#d4c5b9;font-size:12px">' + quantity + ' × ' + unit + '</span></td><td style="padding:12px 0;border-bottom:1px solid #56483f;text-align:right">' + line + '</td></tr>';
  }).join("");
  const total = order.estimated_total == null ? "To be confirmed by Step Town" : formatRwf(order.estimated_total);
  const trackingUrl = escapeHtml(payload.tracking_url || "");
  const fulfillment = escapeHtml(order.fulfillment || "pickup");
  const slot = [order.requested_date, order.requested_time].filter(Boolean).map(escapeHtml).join(" · ");
  const location = escapeHtml(order.delivery_location || "Pickup");
  const body = '<p style="line-height:1.7;color:#f5e4d6">Thank you for your order request. Your request is saved, and our team will contact you to confirm availability and final pricing.</p>' +
    '<div style="padding:16px;border-radius:14px;background:#2b2521"><span style="font-size:11px;color:#d4c5b9">ORDER NUMBER</span><p style="margin:4px 0 0;font-size:24px;font-weight:800;color:#ffbd8d">' + escapeHtml(order.order_number || "") + '</p></div>' +
    '<h2 style="margin:24px 0 8px;font-family:Georgia,serif">Your order</h2><table role="presentation" style="width:100%;border-collapse:collapse;color:#fff4eb">' + itemRows + '</table>' +
    '<p style="display:flex;justify-content:space-between;font-size:17px"><b>Estimated total</b><b style="color:#ffbd8d">' + escapeHtml(total) + '</b></p>' +
    '<p style="color:#d4c5b9;font-size:13px;line-height:1.7">Fulfilment: ' + fulfillment + '<br>Preferred date/time: ' + (slot || "Not set") + '<br>Location: ' + location + '</p>' +
    (payload.order_description ? '<p style="color:#d4c5b9;font-size:13px;line-height:1.7"><b>Describe your order</b><br>' + escapeHtml(payload.order_description) + '</p>' : "") +
    '<p style="margin:24px 0"><a href="' + trackingUrl + '" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#ffbd8d;color:#211d1a;text-decoration:none;font-weight:800">View order status</a></p>' +
    '<p style="font-size:11px;color:#d4c5b9">Final pricing is confirmed by Step Town before your order is accepted.</p>';
  const textItems = items.map(item => '- ' + (item.name || "Menu item") + ' x ' + Math.max(1, Number(item.quantity || 1)) + ' — ' + (item.line_total == null ? "Quote required" : formatRwf(item.line_total))).join("\n");
  const text = [
    "STEP TOWN — ORDER CONFIRMATION",
    "Order: " + (order.order_number || ""),
    "",
    "Thank you. Your order request has been saved.",
    "",
    "YOUR ORDER",
    textItems,
    "",
    "Estimated total: " + total,
    "Fulfilment: " + fulfillment,
    "Preferred date/time: " + (slot || "Not set"),
    "Location: " + location,
    payload.order_description ? "Describe your order: " + payload.order_description : "",
    "",
    "Track your order: " + (payload.tracking_url || ""),
    "Final pricing is confirmed by Step Town before your order is accepted."
  ].filter(Boolean).join("\n");
  return { subject:"Step Town order " + (order.order_number || "confirmation"), html:shell("Thank you for your order.", body), text };
}

export function loginCodeTemplate(payload = {}) {
  const code = String(payload.code || "");
  const body = '<p style="color:#f5e4d6;line-height:1.7">Use this one-time code to sign in to Step Town and securely view your orders.</p>' +
    '<div style="margin:24px 0;padding:22px;border-radius:16px;background:#2b2521;text-align:center"><span style="display:block;color:#d4c5b9;font-size:11px;letter-spacing:2px">YOUR LOGIN CODE</span><strong style="display:block;margin-top:8px;color:#ffbd8d;font-size:36px;letter-spacing:9px">' + escapeHtml(code) + '</strong></div>' +
    '<p style="color:#d4c5b9;font-size:13px;line-height:1.7">This code expires in 10 minutes and can be used once. Step Town will never ask you to share it with anyone.</p>';
  const text = "STEP TOWN LOGIN CODE\n\nYour one-time login code is: " + code + "\n\nIt expires in 10 minutes and can only be used once. Do not share this code.";
  return { subject:"Your Step Town sign-in code", html:shell("Your sign-in code.", body), text };
}
