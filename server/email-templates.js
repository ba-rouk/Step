const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[char]);

export function formatRwf(value) {
  if (value == null || !Number.isFinite(Number(value))) return "To be confirmed";
  return new Intl.NumberFormat("en-RW", { style:"currency", currency:"RWF", maximumFractionDigits:0 }).format(Number(value));
}

export function loginCodeTemplate({ code, expiresMinutes = 10 }) {
  const subject = "Your Step Town sign-in code";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f0eb;font-family:Arial,sans-serif;color:#27221e"><div style="max-width:560px;margin:36px auto;padding:36px 28px;background:#fff;border:1px solid #e9e1d8;border-radius:22px"><p style="letter-spacing:3px;font-size:11px;font-weight:bold;color:#8a6547">STEP TOWN · YOUR ACCOUNT</p><h1 style="font-family:Georgia,serif;font-size:30px;font-weight:normal">Your sign-in code.</h1><p>Enter this one-time code to sign in and verify your email address.</p><div style="margin:28px 0;padding:20px;text-align:center;background:#f6f1eb;border-radius:14px;font-size:34px;letter-spacing:10px;font-weight:bold">${esc(code)}</div><p>This code expires in ${expiresMinutes} minutes and can only be used once. Never share it with anyone.</p><p style="margin-top:32px;color:#84796f;font-size:12px">Step Town · Catering · Barbecue · Cakes · Rwanda</p></div></body></html>`;
  const text = `STEP TOWN — YOUR ACCOUNT\n\nYour one-time sign-in code is: ${code}\n\nIt expires in ${expiresMinutes} minutes and can only be used once. Never share it with anyone.\n\nStep Town · Catering · Barbecue · Cakes · Rwanda`;
  return { subject, html, text };
}

export function orderConfirmationTemplate({ order, trackingUrl, appUrl }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const total = order.estimated_total == null ? "Final pricing to be confirmed" : formatRwf(order.estimated_total);
  const itemHtml = items.map(item => {
    const line = item.line_total == null ? "Quote to be confirmed" : formatRwf(item.line_total);
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee7df"><strong>${esc(item.name)}</strong><br><span style="color:#80766d;font-size:12px">${Number(item.quantity || 1)} × ${esc(item.price_unit_label || item.price_unit || "unit")}</span></td><td style="padding:12px 0;border-bottom:1px solid #eee7df;text-align:right">${esc(line)}</td></tr>`;
  }).join("");
  const plainItems = items.map(item => `- ${item.name} × ${item.quantity || 1}: ${item.line_total == null ? "Quote to be confirmed" : formatRwf(item.line_total)}`).join("\n");
  const subject = `Step Town order ${order.order_number} received`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f0eb;font-family:Arial,sans-serif;color:#27221e"><div style="max-width:620px;margin:30px auto;padding:32px 26px;background:#fff;border:1px solid #e9e1d8;border-radius:22px"><p style="letter-spacing:3px;font-size:11px;font-weight:bold;color:#8a6547">STEP TOWN · ORDER CONFIRMATION</p><h1 style="font-family:Georgia,serif;font-size:31px;font-weight:normal">We've received your order.</h1><p>Thank you, ${esc(order.customer_name)}. Your order request is saved. Our team will confirm availability and final pricing before it is accepted.</p><div style="padding:16px 18px;background:#f6f1eb;border-radius:14px"><small style="color:#80766d">ORDER NUMBER</small><div style="font-size:22px;font-weight:bold;margin-top:4px">${esc(order.order_number)}</div></div><h2 style="font-size:17px;margin-top:28px">Order summary</h2><table style="width:100%;border-collapse:collapse">${itemHtml}</table><p style="display:flex;justify-content:space-between;margin-top:20px;font-size:18px"><strong>Estimated total</strong><strong>${esc(total)}</strong></p><p style="color:#80766d;font-size:13px">Fulfilment: ${esc(order.fulfillment)}${order.delivery_location ? " · " + esc(order.delivery_location) : ""}</p>${order.requested_date ? `<p style="color:#80766d;font-size:13px">Preferred date: ${esc(order.requested_date)}${order.requested_time ? " at " + esc(order.requested_time) : ""}</p>` : ""}<p style="margin:30px 0"><a href="${esc(trackingUrl)}" style="display:inline-block;padding:14px 22px;background:#28231f;color:#fff;text-decoration:none;border-radius:999px">View order status</a></p><p style="font-size:12px;color:#80766d">This private tracking link shows your order items, status, total and delivery details. It does not display your contact information.</p><p style="margin-top:32px;font-size:12px;color:#84796f">Step Town · Catering · Barbecue · Cakes · Rwanda<br><a href="${esc(appUrl)}" style="color:#8a6547">${esc(appUrl)}</a></p></div></body></html>`;
  const text = `STEP TOWN — ORDER CONFIRMATION\n\nThank you, ${order.customer_name}. We received your order request.\nOrder: ${order.order_number}\n\nORDER SUMMARY\n${plainItems}\n\nEstimated total: ${total}\nFulfilment: ${order.fulfillment}${order.delivery_location ? " — " + order.delivery_location : ""}\n${order.requested_date ? "Preferred date: " + order.requested_date + (order.requested_time ? " at " + order.requested_time : "") + "\n" : ""}\nTrack your order: ${trackingUrl}\n\nStep Town will confirm availability and final pricing before accepting the order.`;
  return { subject, html, text };
}
