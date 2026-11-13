import { supabase, supabaseConfigured } from "./supabase.js";
import "../staff.css";

const PATH = location.pathname.replace(/\/+$/, "") || "/staff";
const ROLE_LABEL = { manager: "Manager", accountant: "Accountant", cashier: "Cashier" };
const ROLE_ACCESS = {
  overview: ["manager", "accountant", "cashier"],
  orders: ["manager", "accountant", "cashier"],
  products: ["manager", "accountant"],
  gallery: ["manager", "accountant"],
  enquiries: ["manager", "accountant", "cashier"],
  reports: ["manager", "accountant"],
  team: ["manager"],
  audit: ["manager"]
};
const ORDER_STATUSES = ["new", "confirmed", "preparing", "ready", "completed", "cancelled"];
const ENQUIRY_STATUSES = ["new", "contacted", "quoted", "won", "lost", "confirmed", "closed"];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));
const money = value => value == null
  ? "To confirm"
  : new Intl.NumberFormat("en-RW", { style: "currency", currency: "RWF", maximumFractionDigits: 0 }).format(Number(value));
const fmtDate = value => value ? new Date(value).toLocaleString("en-RW", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dateKey = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const waPhone = value => String(value || "").replace(/\D/g, "");
let app;
let profile = null;
let teamCache = [];
let toastTimer;

function notify(message, type = "success") {
  const node = $("#staff-toast");
  if (!node) return;
  node.textContent = message;
  node.className = "staff-toast is-visible " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 3600);
}
function panelError(error) {
  return '<div class="staff-alert" role="alert">' + esc(error?.message || "This information could not be loaded. Refresh and try again.") + "</div>";
}
async function queryRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function writeAudit(action, entityType, entityId = null, details = {}) {
  if (!profile?.user_id) return;
  const { error } = await supabase.from("audit_log").insert({
    actor_id: profile.user_id,
    actor_role: profile.role,
    action,
    entity_type: entityType,
    entity_id: entityId == null ? null : String(entityId),
    details
  });
  if (error) console.warn("Audit entry was not saved:", error.message);
}
function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function statusLabel(status) {
  return String(status || "new").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function statusPill(status) {
  return '<span class="staff-status status-' + esc(status) + '">' + esc(statusLabel(status)) + "</span>";
}
function pathForCurrent() {
  if (PATH === "/staff" || PATH === "/staff/dashboard") return "/staff/overview";
  return PATH;
}
function navItems() {
  const items = [
    ["overview", "/staff/overview", "Overview", "layout-dashboard"],
    ["orders", "/staff/orders", "Orders", "clipboard-list"],
    ["products", "/staff/products", "Products", "package"],
    ["gallery", "/staff/gallery", "Gallery", "images"],
    ["enquiries", "/staff/enquiries", "Enquiries", "messages-square"],
    ["reports", "/staff/reports", "Reports", "chart-no-axes-combined"],
    ["team", "/staff/team", "Team", "users"],
    ["audit", "/staff/audit", "Audit log", "history"]
  ];
  return items.filter(([key]) => ROLE_ACCESS[key].includes(profile.role)).map(([key, href, label]) =>
    '<a data-staff-nav="' + key + '" href="' + href + '">' +
      '<span class="staff-nav-mark" aria-hidden="true"></span><span>' + label + "</span>" +
    "</a>"
  ).join("");
}
function shell(title, body, subtitle = "") {
  const name = esc(profile?.full_name || "Staff member");
  const role = esc(ROLE_LABEL[profile?.role] || "Staff");
  app.innerHTML =
    '<header class="staff-top">' +
      '<a class="staff-brand" href="/" aria-label="Step Town home">' +
        '<img class="staff-logo" src="/step-town-logo.png" alt="Step Town">' +
        '<span><b>STEP TOWN</b><small>STAFF WORKSPACE</small></span>' +
      "</a>" +
      '<div class="staff-top-meta"><span>' + name + "</span><small>" + role + "</small></div>" +
      '<button id="staff-menu-toggle" class="staff-menu-toggle" type="button" aria-label="Open staff menu" aria-expanded="false" aria-controls="staff-sidebar"><span></span><span></span><span></span></button>' +
    "</header>" +
    '<div class="staff-workspace">' +
      '<aside id="staff-sidebar" class="staff-sidebar" aria-label="Staff workspace navigation">' +
        '<div class="staff-sidebar-heading"><span>WORKSPACE</span><button id="staff-sidebar-close" class="staff-sidebar-close" type="button" aria-label="Close staff menu">×</button></div>' +
        '<nav class="staff-nav" aria-label="Staff navigation">' + navItems() + "</nav>" +
        '<div class="staff-sidebar-footer">' +
          '<div class="staff-sidebar-user"><strong>' + name + "</strong><small>" + role + "</small></div>" +
          '<div id="staff-alert-area"></div>' +
          '<button id="staff-logout" class="staff-signout" type="button">Sign out</button>' +
        "</div>" +
      "</aside>" +
      '<button id="staff-sidebar-backdrop" class="staff-sidebar-backdrop" type="button" aria-label="Close staff navigation" hidden></button>' +
      '<main class="staff-main">' +
        '<div class="staff-title-row"><div><h1>' + esc(title) + "</h1>" + (subtitle ? '<p class="staff-muted">' + esc(subtitle) + "</p>" : "") + "</div></div>" +
        body +
      "</main>" +
    "</div>" +
    '<div id="staff-toast" class="staff-toast" role="status" aria-live="polite"></div>';

  const sidebar = $("#staff-sidebar");
  const toggle = $("#staff-menu-toggle");
  const backdrop = $("#staff-sidebar-backdrop");
  const setOpen = open => {
    sidebar?.classList.toggle("is-open", open);
    if (backdrop) backdrop.hidden = !open;
    toggle?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-label", open ? "Close staff menu" : "Open staff menu");
    document.body.classList.toggle("staff-menu-open", open);
  };
  toggle?.addEventListener("click", () => setOpen(true));
  $("#staff-sidebar-close")?.addEventListener("click", () => setOpen(false));
  backdrop?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => { if (event.key === "Escape") setOpen(false); });
  const current = pathForCurrent();
  $$("[data-staff-nav]").forEach(link => {
    const href = link.getAttribute("href");
    const active = href === current ||
      (href === "/staff/orders" && current.startsWith("/staff/orders/")) ||
      (href === "/staff/products" && current.startsWith("/staff/products/")) ||
      (href === "/staff/enquiries" && current.startsWith("/staff/enquiries/"));
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => setOpen(false));
  });
  $("#staff-logout")?.addEventListener("click", async () => {
    $("#staff-logout").disabled = true;
    try { await supabase.auth.signOut({ scope: "global" }); }
    finally { location.replace("/staff/login"); }
  });
  renderAlertControl();
}
async function renderAlertControl() {
  const host = $("#staff-alert-area");
  if (!host) return;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) {
    host.innerHTML = '<p class="staff-alert-hint">Push alerts are not supported in this browser.</p>';
    return;
  }
  if (Notification.permission === "denied") {
    host.innerHTML = '<button class="staff-alert-button is-blocked" type="button" id="staff-alert-help"><span class="staff-alert-dot"></span><span>Alerts blocked</span></button><p class="staff-alert-hint">Allow notifications in your browser or device settings, then reload.</p>';
    $("#staff-alert-help")?.addEventListener("click", () => notify("Open your browser or device settings, allow notifications for steptown.onrender.com, then reload this page.", "warning"));
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      host.innerHTML = '<button class="staff-alert-button is-on" type="button" id="staff-alert-off"><span class="staff-alert-dot"></span><span>Alerts on · Turn off</span></button><button class="staff-alert-test" type="button" id="staff-alert-test">Send test alert</button>';
      $("#staff-alert-off")?.addEventListener("click", disableAlerts);
      $("#staff-alert-test")?.addEventListener("click", sendTestAlert);
    } else {
      host.innerHTML = '<button class="staff-alert-button" type="button" id="staff-alert-on"><span class="staff-alert-dot"></span><span>Enable alerts</span></button>';
      $("#staff-alert-on")?.addEventListener("click", enableAlerts);
    }
  } catch (error) {
    host.innerHTML = '<button class="staff-alert-button" type="button" id="staff-alert-on">Enable alerts</button>';
    $("#staff-alert-on")?.addEventListener("click", enableAlerts);
  }
}
function decodeVapidKey(value) {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function enableAlerts() {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) { notify("Push notifications are not configured on the site.", "warning"); return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { await renderAlertControl(); notify("Notification permission was not granted.", "warning"); return; }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey)
    });
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: profile.user_id,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth_key: json.keys?.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) throw error;
    await writeAudit("push_alerts_enabled", "push_subscription", null, { user_agent: navigator.userAgent });
    await renderAlertControl();
    notify("Push alerts are enabled on this device.");
  } catch (error) {
    console.error(error);
    notify("Could not enable alerts: " + error.message, "error");
  }
}
async function disableAlerts() {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await supabase.from("push_subscriptions").delete().eq("user_id", profile.user_id).eq("endpoint", endpoint);
      await subscription.unsubscribe();
    }
    await writeAudit("push_alerts_disabled", "push_subscription");
    await renderAlertControl();
    notify("Alerts are turned off on this device.");
  } catch (error) {
    notify("Could not turn alerts off: " + error.message, "error");
  }
}
async function sendTestAlert() {
  const button = $("#staff-alert-test");
  if (button) { button.disabled = true; button.textContent = "Sending…"; }
  try {
    const { data, error } = await supabase.functions.invoke("send-staff-test-push", { body: {} });
    if (error || !data?.ok) throw error || new Error(data?.error || "Test alert could not be sent.");
    notify("Test alert sent to this device.");
  } catch (error) {
    notify("Test alert failed: " + error.message, "error");
  } finally {
    await renderAlertControl();
  }
}
async function getProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from("staff_profiles")
    .select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password")
    .eq("user_id", session.user.id).maybeSingle();
  if (error || !data || !data.is_active || !ROLE_LABEL[data.role]) return null;
  profile = data;
  return data;
}
function loginView(message = "") {
  app.innerHTML =
    '<div class="staff-login-wrap">' +
      '<a class="staff-brand staff-login-brand" href="/" aria-label="Step Town home"><img class="staff-logo" src="/step-town-logo.png" alt="Step Town"><span><b>STEP TOWN</b><small>STAFF ACCESS</small></span></a>' +
      '<section class="staff-login-card">' +
        '<p class="staff-eyebrow">PRIVATE TEAM PORTAL</p><h1>Welcome back.</h1>' +
        '<p class="staff-muted">Sign in with the account created by your Manager.</p>' +
        '<form id="staff-login-form">' +
          '<label>Email address<input name="email" type="email" autocomplete="username" required placeholder="name@example.com"></label>' +
          '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
          '<p id="staff-login-error" class="staff-error" role="alert">' + esc(message) + "</p>" +
          '<button class="staff-primary" type="submit">Sign in securely</button>' +
        "</form><p class=\"staff-login-foot\">Staff accounts are invitation-only. There is no public staff registration.</p>" +
      "</section><a class=\"staff-cancel\" href=\"/\" aria-label=\"Return to website\">×</a>" +
    "</div>";
  $("#staff-login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const button = $("button[type=submit]", form);
    const errorNode = $("#staff-login-error", form);
    button.disabled = true;
    button.textContent = "Signing in…";
    errorNode.textContent = "";
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(fields.get("email")).trim().toLowerCase(),
        password: String(fields.get("password"))
      });
      if (error) {
        await supabase.functions.invoke("staff-login-audit", { body: { event: "failed", email: String(fields.get("email") || "").trim().toLowerCase() } });
        throw error;
      }
      const staff = await getProfile();
      if (!staff) {
        await supabase.auth.signOut({ scope: "global" });
        throw new Error("This account does not have active Step Town staff access. Contact your Manager.");
      }
      await writeAudit("staff_login", "staff_profile", staff.id, {});
      const next = new URLSearchParams(location.search).get("next");
      location.replace(next?.startsWith("/staff/") && !next.startsWith("//") ? next : "/staff/overview");
    } catch (error) {
      errorNode.textContent = error.message || "Sign-in failed. Check your email and password.";
      button.disabled = false;
      button.textContent = "Sign in securely";
    }
  });
}
async function requireProfile() {
  const staff = await getProfile();
  if (!staff) {
    await supabase.auth.signOut({ scope: "global" });
    location.replace("/staff/login?next=" + encodeURIComponent(PATH));
    return false;
  }
  if (staff.must_change_password && PATH !== "/staff/change-password") {
    location.replace("/staff/change-password");
    return false;
  }
  return true;
}
async function deniedPage() {
  await writeAudit("staff_access_denied", "route", PATH, { path: PATH, role: profile.role });
  shell("No access", '<section class="staff-panel staff-no-access"><p class="staff-eyebrow">PERMISSION REQUIRED</p><h2>This page is not available to your role.</h2><p class="staff-muted">Your access attempt has been recorded. Return to your Overview or ask your Manager to review your permissions.</p><a class="staff-primary" href="/staff/overview">Back to Overview</a></section>');
}
function statCard(label, value, hint) {
  return '<article class="staff-stat-card"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + esc(hint || "") + "</small></article>";
}
function orderTable(orders, options = {}) {
  if (!orders.length) return '<div class="staff-empty-state"><strong>No orders here yet.</strong><span>New customer requests will appear in this list.</span></div>';
  return '<div class="staff-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Requested</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>' +
    orders.map(order =>
      '<tr><td><b class="staff-order-number">' + esc(order.order_number) + '</b><small>' + esc(fmtDate(order.created_at)) + "</small></td>" +
      '<td><b>' + esc(order.customer_name) + '</b><small>' + esc(order.customer_phone) + "</small></td>" +
      '<td>' + esc(order.requested_date || "Date not set") + (order.requested_time ? "<small>" + esc(order.requested_time) + "</small>" : "") + "</td>" +
      "<td>" + statusPill(order.status) + "</td><td>" + money(order.estimated_total) + '</td><td><a class="staff-table-link" href="/staff/orders/' + encodeURIComponent(order.id) + '">Open</a></td></tr>'
    ).join("") + "</tbody></table></div>";
}
async function overviewPage() {
  const start = todayStart();
  const [todayOrders, paymentsToday, todayEnquiries, allRecent] = await Promise.all([
    queryRows(supabase.from("store_orders").select("id,order_number,status,customer_name,customer_phone,estimated_total,created_at,requested_date,requested_time").gte("created_at", start).order("created_at", { ascending: false })),
    queryRows(supabase.from("store_order_payments").select("amount").gte("recorded_at", start)),
    queryRows(supabase.from("enquiries").select("id").gte("created_at", start)),
    queryRows(supabase.from("store_orders").select("id,order_number,status,customer_name,customer_phone,estimated_total,created_at,requested_date,requested_time").order("created_at", { ascending: false }).limit(10))
  ]);
  const pending = todayOrders.filter(o => o.status === "new").length;
  const progress = todayOrders.filter(o => ["confirmed", "preparing", "ready"].includes(o.status)).length;
  const completed = todayOrders.filter(o => o.status === "completed").length;
  const sales = paymentsToday.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  let extra = "";
  if (profile.role !== "cashier") {
    const sevenDaysAgo = new Date(Date.now() - 6 * 86400000);
    const recent = await queryRows(supabase.from("store_orders")
      .select("id,status,created_at,estimated_total").gte("created_at", sevenDaysAgo.toISOString()));
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(sevenDaysAgo); d.setDate(d.getDate() + index);
      const key = dateKey(d);
      return { key, label: d.toLocaleDateString("en", { weekday: "short" }), count: recent.filter(o => dateKey(o.created_at) === key).length };
    });
    const max = Math.max(1, ...buckets.map(x => x.count));
    extra =
      '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">LAST 7 DAYS</p><h2>Order activity</h2></div><a href="/staff/reports">View reports</a></div>' +
      '<div class="staff-bars">' + buckets.map(day =>
        '<div class="staff-bar-column"><span>' + day.count + '</span><div><i style="height:' + Math.max(5, day.count / max * 100) + '%"></i></div><small>' + day.label + '</small></div>'
      ).join("") + "</div></section>";
  }
  const content =
    '<section class="staff-stats">' +
      statCard("Orders today", todayOrders.length, "All new requests created today") +
      statCard("Pending", pending, "Awaiting confirmation") +
      statCard("In progress", progress, "Confirmed, preparing or ready") +
      statCard("Completed", completed, "Completed today") +
      statCard("Sales received", money(sales), "Payments recorded today") +
      statCard("New enquiries", todayEnquiries.length, "Event and catering enquiries today") +
    "</section>" +
    (profile.role === "cashier" ?
      '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">ACTION QUEUE</p><h2>Orders waiting</h2></div><a href="/staff/orders">All orders</a></div>' +
        orderTable(allRecent.filter(o => ["new", "confirmed", "preparing", "ready"].includes(o.status)).slice(0, 8)) +
      "</section>" : extra) +
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">LATEST ACTIVITY</p><h2>Recent orders</h2></div><a href="/staff/orders">View all orders</a></div>' +
      orderTable(allRecent.slice(0, 8)) + "</section>";
  shell("Overview", content, "Today's operations at a glance.");
}
function matchesOrder(order, term, date) {
  const text = [order.order_number, order.customer_name, order.customer_phone].join(" ").toLowerCase();
  return (!term || text.includes(term)) && (!date || dateKey(order.created_at) === date);
}
async function ordersPage() {
  const orders = await queryRows(supabase.from("store_orders").select("*").order("created_at", { ascending: false }).limit(500));
  shell("Orders",
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">ORDER MANAGEMENT</p><h2>Order inbox</h2></div><span class="staff-muted">' + orders.length + " records</span></div>" +
      '<div class="staff-filters"><label>Search<input id="order-search" type="search" placeholder="Order number, customer or phone"></label><label>Created date<input id="order-date" type="date"></label></div>' +
      '<div class="staff-order-tabs">' +
        '<button data-group="pending" class="active">Pending</button><button data-group="progress">In progress</button><button data-group="finished">Finished</button><button data-group="cancelled">Cancelled</button><button data-group="all">All</button>' +
      '</div><div id="orders-results"></div></section>');
  let group = "pending";
  const render = () => {
    const term = ($("#order-search").value || "").trim().toLowerCase();
    const date = $("#order-date").value;
    const visible = orders.filter(order => {
      const inGroup = group === "all" ||
        (group === "pending" && order.status === "new") ||
        (group === "progress" && ["confirmed", "preparing", "ready"].includes(order.status)) ||
        (group === "finished" && order.status === "completed") ||
        (group === "cancelled" && order.status === "cancelled");
      return inGroup && matchesOrder(order, term, date);
    });
    $("#orders-results").innerHTML = orderTable(visible);
  };
  $("#order-search").addEventListener("input", render);
  $("#order-date").addEventListener("change", render);
  $$("[data-group]").forEach(button => button.addEventListener("click", () => {
    group = button.dataset.group;
    $$("[data-group]").forEach(node => node.classList.toggle("active", node === button));
    render();
  }));
  render();
}
async function orderDetailPage(id) {
  const { data: order, error } = await supabase.from("store_orders").select("*").eq("id", id).maybeSingle();
  if (error || !order) {
    shell("Order not found", panelError(error || { message: "This order could not be found." }));
    return;
  }
  const [payments, events] = await Promise.all([
    queryRows(supabase.from("store_order_payments").select("*").eq("order_id", id).order("recorded_at", { ascending: false })),
    queryRows(supabase.from("store_order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }))
  ]);
  const canCorrect = ["manager", "accountant"].includes(profile.role);
  const phone = esc(order.customer_phone);
  const items = Array.isArray(order.items) ? order.items : [];
  shell("Order " + order.order_number,
    '<section class="staff-panel"><div class="staff-order-head"><div><p class="staff-eyebrow">CUSTOMER</p><h2>' + esc(order.customer_name) + '</h2><p>' + phone + " · " + esc(order.customer_email || "No email") + '</p><div class="staff-actions"><a href="tel:' + phone + '">Call customer</a><a target="_blank" rel="noopener" href="https://wa.me/' + waPhone(order.customer_phone) + '">WhatsApp</a></div></div><div>' + statusPill(order.status) + "</div></div>" +
      '<div class="staff-detail-grid"><div><small>FULFILMENT</small><b>' + esc(statusLabel(order.fulfillment)) + '</b></div><div><small>REQUESTED</small><b>' + esc(order.requested_date || "Not set") + " " + esc(order.requested_time || "") + '</b></div><div><small>LOCATION</small><b>' + esc(order.delivery_location || "Pickup") + '</b></div><div><small>ORDER TOTAL</small><b>' + money(order.estimated_total) + "</b></div></div>" +
      "<h3>Items ordered</h3><div class=\"staff-items\">" + items.map(item =>
        "<p><b>" + Number(item.quantity || 1) + " × " + esc(item.name) + "</b><span>" + money(item.line_total) + "</span></p>"
      ).join("") + "</div>" +
      '<p class="staff-notes">' + esc(order.notes || "No additional customer notes.") + "</p>" +
      (order.cancellation_reason ? '<p class="staff-cancel-reason"><b>Cancellation reason:</b> ' + esc(order.cancellation_reason) + "</p>" : "") +
    "</section>" +
    '<section class="staff-panel"><p class="staff-eyebrow">WORKFLOW</p><h2>Update order</h2><form id="order-status-form" class="staff-form-grid">' +
      '<label>Status<select name="status">' + ORDER_STATUSES.map(status => '<option value="' + status + '" ' + (order.status === status ? "selected" : "") + ">" + statusLabel(status) + "</option>").join("") + "</select></label>" +
      (canCorrect ? '<label>Correct total (RWF)<input name="total" type="number" min="0" step="1" value="' + (order.estimated_total ?? "") + '" placeholder="Leave blank for quote"></label><label class="wide">Order notes<textarea name="notes" rows="2">' + esc(order.notes || "") + "</textarea></label>" : "") +
      '<label id="cancel-reason-wrap" class="wide" ' + (order.status === "cancelled" ? "" : "hidden") + '>Cancellation reason<textarea name="cancel_reason" maxlength="1000" rows="2">' + esc(order.cancellation_reason || "") + "</textarea></label>" +
      '<button class="staff-primary" type="submit">Save order update</button><p id="order-status-message" class="staff-muted" role="status"></p>' +
    "</form></section>" +
    '<section class="staff-panel"><p class="staff-eyebrow">PAYMENT RECORDS</p><h2>Record a payment</h2><form id="payment-form" class="staff-form-grid">' +
      '<label>Method<select name="method"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>' +
      '<label>Amount received (RWF)<input name="amount" type="number" min="1" step="1" required></label>' +
      '<label>Reference<input name="reference" maxlength="160" placeholder="Mobile money transaction ID"></label>' +
      '<label>Notes<input name="notes" maxlength="1000" placeholder="Optional payment note"></label>' +
      '<button class="staff-primary" type="submit">Save payment</button><p id="payment-message" class="staff-muted" role="status"></p>' +
    "</form><div class=\"staff-payment-list\">" +
      (payments.length ? payments.map(payment =>
        '<article><div><b>' + esc(statusLabel(payment.method)) + " · " + money(payment.amount) + '</b><small>' + esc(fmtDate(payment.recorded_at)) + " · " + esc(payment.reference || "No reference") + "</small></div>" +
        (canCorrect ? '<div class="staff-row-actions"><button type="button" data-payment-edit="' + payment.id + '">Correct</button><button type="button" data-payment-delete="' + payment.id + '">Delete</button></div>' : "") +
        "</article>"
      ).join("") : '<p class="staff-empty">No payments recorded yet.</p>') +
    "</div></section>" +
    '<section class="staff-panel"><p class="staff-eyebrow">ORDER HISTORY</p><h2>Timeline</h2>' +
      (events.length ? '<ol class="staff-timeline">' + events.map(event =>
        "<li><span>" + esc(statusLabel(event.event_type)) + "</span><b>" + esc(event.description || (event.old_status || "") + " → " + (event.new_status || "")) + "</b><small>" + esc(fmtDate(event.created_at)) + "</small></li>"
      ).join("") + "</ol>" : '<p class="staff-empty">No timeline entries yet.</p>') +
    '</section><button class="staff-quiet" id="print-receipt" type="button">Print receipt</button>');
  $("#order-status-form").addEventListener("change", () => {
    $("#cancel-reason-wrap").hidden = $("#order-status-form").elements.status.value !== "cancelled";
  });
  $("#order-status-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const status = String(fields.get("status"));
    const updateTotal = canCorrect;
    const totalRaw = String(fields.get("total") ?? "").trim();
    const total = totalRaw === "" ? null : Number(totalRaw);
    if (status === "cancelled" && String(fields.get("cancel_reason") || "").trim().length < 3) {
      $("#order-status-message").textContent = "Enter a cancellation reason before cancelling.";
      return;
    }
    if (updateTotal && total !== null && (!Number.isFinite(total) || total < 0)) {
      $("#order-status-message").textContent = "Enter a valid non-negative total.";
      return;
    }
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      const payload = {
        p_order_id: order.id,
        p_status: status,
        p_estimated_total: total,
        p_update_total: updateTotal && totalRaw !== "",
        p_notes: canCorrect ? String(fields.get("notes") || "").trim() || null : null,
        p_update_notes: canCorrect,
        p_cancel_reason: String(fields.get("cancel_reason") || "").trim() || null
      };
      const { error } = await supabase.rpc("staff_update_order", payload);
      if (error) throw error;
      await writeAudit("order_workflow_saved", "store_order", order.id, { status });
      notify("Order updated.");
      await orderDetailPage(order.id);
    } catch (error) {
      $("#order-status-message").textContent = error.message || "Order could not be updated.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  $("#payment-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const amount = Number(fields.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      $("#payment-message").textContent = "Enter an amount greater than zero.";
      return;
    }
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      const { error } = await supabase.from("store_order_payments").insert({
        order_id: order.id,
        method: String(fields.get("method")),
        amount,
        reference: String(fields.get("reference") || "").trim() || null,
        notes: String(fields.get("notes") || "").trim() || null,
        recorded_by: profile.user_id
      });
      if (error) throw error;
      await writeAudit("payment_recorded", "store_order_payment", order.id, { method: fields.get("method"), amount });
      notify("Payment recorded.");
      await orderDetailPage(order.id);
    } catch (error) {
      $("#payment-message").textContent = error.message || "Payment could not be recorded.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  $$("[data-payment-edit]").forEach(button => button.addEventListener("click", async () => {
    const payment = payments.find(row => row.id === button.dataset.paymentEdit);
    if (!payment) return;
    const method = prompt("Payment method: cash or mobile_money", payment.method);
    if (method === null) return;
    const amountText = prompt("Correct amount (RWF):", String(payment.amount));
    if (amountText === null) return;
    const amount = Number(amountText);
    if (!["cash", "mobile_money"].includes(method) || !Number.isFinite(amount) || amount <= 0) {
      notify("Use cash/mobile_money and a positive amount.", "warning"); return;
    }
    const reference = prompt("Transaction reference:", payment.reference || "");
    if (reference === null) return;
    const notes = prompt("Payment note:", payment.notes || "");
    if (notes === null) return;
    const { error } = await supabase.rpc("staff_update_order_payment", {
      p_payment_id: payment.id, p_method: method, p_amount: amount,
      p_reference: reference, p_notes: notes
    });
    if (error) notify(error.message, "error");
    else { notify("Payment corrected."); await orderDetailPage(order.id); }
  }));
  $$("[data-payment-delete]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this payment record? This action will be recorded in the audit log.")) return;
    const { error } = await supabase.rpc("staff_delete_order_payment", { p_payment_id: button.dataset.paymentDelete });
    if (error) notify(error.message, "error");
    else { notify("Payment deleted."); await orderDetailPage(order.id); }
  }));
  $("#print-receipt").addEventListener("click", () => window.print());
}
async function uploadImage(file, folder) {
  if (!file || !/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error("Choose a JPG, PNG, WebP or AVIF image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Each image must be 10 MB or smaller.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-90);
  const objectPath = folder + "/" + Date.now() + "-" + crypto.randomUUID() + "-" + safeName;
  const { error } = await supabase.storage.from("step-town-media").upload(objectPath, file, {
    contentType: file.type, upsert: false
  });
  if (error) throw error;
  return supabase.storage.from("step-town-media").getPublicUrl(objectPath).data.publicUrl;
}
async function productsPage() {
  const segments = PATH.split("/").filter(Boolean);
  const isNew = segments[2] === "new";
  const isEdit = segments[3] === "edit";
  const productId = isEdit ? segments[2] : null;
  const [categories, products] = await Promise.all([
    queryRows(supabase.from("store_categories").select("id,name,sort_order,is_active").eq("is_active", true).order("sort_order")),
    isNew || isEdit ? Promise.resolve([]) : queryRows(supabase.from("store_products").select("*,store_categories(name)").order("sort_order").order("created_at", { ascending: false }))
  ]);
  let product = null;
  if (isEdit) {
    const { data, error } = await supabase.from("store_products").select("*").eq("id", productId).maybeSingle();
    if (error || !data) { shell("Product not found", panelError(error || { message: "Product not found." })); return; }
    product = data;
  }
  if (isNew || isEdit) {
    const title = isNew ? "Add product" : "Edit product";
    shell(title,
      '<section class="staff-panel"><form id="product-form" class="staff-form-grid">' +
        '<label>Product name<input name="name" maxlength="120" required value="' + esc(product?.name || "") + '"></label>' +
        '<label>Category<select name="category_id" required>' + categories.map(category => '<option value="' + category.id + '" ' + (product?.category_id === category.id ? "selected" : "") + ">" + esc(category.name) + "</option>").join("") + "</select></label>" +
        '<label>Price (RWF)<input name="price" type="number" min="0" step="1" value="' + (product?.price ?? "") + '" placeholder="Leave blank for quote"></label>' +
        '<label>Stock quantity<input name="stock_quantity" type="number" min="0" step="1" value="' + (product?.stock_quantity ?? "") + '" placeholder="Blank means not tracked"></label>' +
        '<label class="wide">Description<textarea name="description" rows="3">' + esc(product?.description || "") + "</textarea></label>" +
        '<label class="wide">Product photos<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple></label>' +
        (product?.image_urls?.length || product?.image_url ? '<div class="staff-existing-images wide">' + (product.image_urls?.length ? product.image_urls : [product.image_url]).filter(Boolean).map(url => '<img src="' + esc(url) + '" alt="">').join("") + "</div>" : "") +
        '<label class="staff-check"><input type="checkbox" name="is_available" ' + (product?.is_available === false ? "" : "checked") + '> Available</label>' +
        '<label class="staff-check"><input type="checkbox" name="has_stock" ' + (product?.has_stock === false ? "" : "checked") + '> In stock</label>' +
        '<label class="staff-check"><input type="checkbox" name="is_visible" ' + (product?.is_visible === false ? "" : "checked") + '> Visible on public menu</label>' +
        '<div class="staff-form-actions wide"><a class="staff-quiet" href="/staff/products">Cancel</a><button class="staff-primary" type="submit">' + (isNew ? "Publish product" : "Save changes") + "</button></div>" +
        '<p id="product-message" class="staff-muted wide" role="status"></p>' +
      "</form></section>");
    $("#product-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const priceText = String(fields.get("price") || "").trim();
      const stockText = String(fields.get("stock_quantity") || "").trim();
      const price = priceText ? Number(priceText) : null;
      const stock = stockText ? Number(stockText) : null;
      if ((price !== null && (!Number.isFinite(price) || price < 0)) ||
          (stock !== null && (!Number.isInteger(stock) || stock < 0))) {
        $("#product-message").textContent = "Enter a valid price and stock quantity.";
        return;
      }
      const submit = $("button[type=submit]", form);
      submit.disabled = true;
      try {
        const files = Array.from($('input[name="images"]', form).files || []);
        const uploaded = [];
        for (let i = 0; i < files.length; i++) {
          $("#product-message").textContent = "Uploading photo " + (i + 1) + " of " + files.length + "…";
          uploaded.push(await uploadImage(files[i], "products"));
        }
        const previousImages = product?.image_urls?.length ? product.image_urls : (product?.image_url ? [product.image_url] : []);
        const imageUrls = uploaded.length ? [...previousImages, ...uploaded] : previousImages;
        const payload = {
          name: String(fields.get("name") || "").trim(),
          category_id: fields.get("category_id"),
          price,
          description: String(fields.get("description") || "").trim() || null,
          image_urls: imageUrls,
          image_url: imageUrls[0] || null,
          stock_quantity: stock,
          has_stock: fields.has("has_stock") && (stock === null || stock > 0),
          is_available: fields.has("is_available"),
          is_visible: fields.has("is_visible"),
          updated_by: profile.user_id,
          updated_at: new Date().toISOString()
        };
        const result = isEdit
          ? await supabase.from("store_products").update(payload).eq("id", productId)
          : await supabase.from("store_products").insert({ ...payload, sort_order: 0 });
        if (result.error) throw result.error;
        await writeAudit(isEdit ? "product_updated" : "product_created", "store_product", productId, { name: payload.name });
        location.assign("/staff/products");
      } catch (error) {
        $("#product-message").textContent = error.message || "Product could not be saved.";
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    });
    return;
  }
  shell("Products",
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">PUBLIC MENU</p><h2>Menu catalogue</h2></div><a class="staff-primary" href="/staff/products/new">Add product</a></div>' +
      '<label class="staff-search-label">Search products<input id="product-search" type="search" placeholder="Product or category"></label><div id="products-table"></div></section>');
  const render = () => {
    const term = ($("#product-search").value || "").toLowerCase();
    const visible = products.filter(item => (item.name + " " + (item.store_categories?.name || "")).toLowerCase().includes(term));
    $("#products-table").innerHTML = visible.length ?
      '<div class="staff-table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Menu status</th><th>Actions</th></tr></thead><tbody>' +
      visible.map(item =>
        "<tr><td><b>" + esc(item.name) + "</b></td><td>" + esc(item.store_categories?.name || "—") + "</td><td>" + money(item.price) + "</td>" +
        "<td>" + (item.stock_quantity == null ? (item.has_stock ? "In stock" : "Sold out") : item.stock_quantity) + "</td>" +
        "<td>" + ((item.is_visible && item.is_available && item.has_stock) ? "Published" : "Hidden / unavailable") + "</td>" +
        '<td><div class="staff-row-actions"><a href="/staff/products/' + item.id + '/edit">Edit</a><button data-product-stock="' + item.id + '">' + (item.has_stock ? "Mark sold out" : "Mark in stock") + '</button><button data-product-visibility="' + item.id + '">' + (item.is_visible ? "Hide" : "Show") + '</button><button data-product-delete="' + item.id + '">Delete</button></div></td></tr>'
      ).join("") + "</tbody></table></div>" : '<p class="staff-empty">No matching products.</p>';
    $$("[data-product-stock]").forEach(button => button.addEventListener("click", async () => {
      const item = products.find(row => row.id === button.dataset.productStock);
      const hasStock = !item.has_stock;
      const { error } = await supabase.from("store_products").update({ has_stock: hasStock, updated_by: profile.user_id, updated_at: new Date().toISOString() }).eq("id", item.id);
      if (error) notify(error.message, "error");
      else { await writeAudit("product_stock_changed", "store_product", item.id, { has_stock: hasStock }); notify("Stock status updated."); await productsPage(); }
    }));
    $$("[data-product-visibility]").forEach(button => button.addEventListener("click", async () => {
      const item = products.find(row => row.id === button.dataset.productVisibility);
      const isVisible = !item.is_visible;
      const { error } = await supabase.from("store_products").update({ is_visible: isVisible, updated_by: profile.user_id, updated_at: new Date().toISOString() }).eq("id", item.id);
      if (error) notify(error.message, "error");
      else { await writeAudit("product_visibility_changed", "store_product", item.id, { is_visible: isVisible }); notify("Menu visibility updated."); await productsPage(); }
    }));
    $$("[data-product-delete]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Permanently delete this menu item?")) return;
      const id = button.dataset.productDelete;
      const { error } = await supabase.from("store_products").delete().eq("id", id);
      if (error) notify(error.message, "error");
      else { await writeAudit("product_deleted", "store_product", id, {}); notify("Product deleted."); await productsPage(); }
    }));
  };
  $("#product-search").addEventListener("input", render);
  render();
}
async function galleryPage() {
  const items = await queryRows(supabase.from("gallery_items").select("*").order("sort_order").order("created_at", { ascending: false }));
  shell("Gallery",
    '<section class="staff-panel"><p class="staff-eyebrow">PUBLIC GALLERY</p><h2>Upload images</h2><form id="gallery-form" class="staff-form-grid">' +
      '<label class="wide">Images<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required></label>' +
      '<label>Category<select name="category"><option value="catering">Catering</option><option value="barbecue">Barbecue</option><option value="cakes">Cakes</option><option value="staff">Staff</option></select></label>' +
      '<label>Caption<input name="caption" maxlength="500" placeholder="Optional shared caption"></label>' +
      '<label class="wide">Alt text<input name="alt_text" maxlength="240" placeholder="Describe the image for accessibility"></label>' +
      '<button class="staff-primary" type="submit">Upload selected images</button><p id="gallery-progress" class="staff-muted" role="status"></p>' +
    "</form></section>" +
    '<section class="staff-panel"><div class="staff-panel-head"><h2>Gallery library</h2><span class="staff-muted">' + items.length + " images</span></div>" +
      (items.length ? '<div class="staff-gallery staff-gallery-manage">' + items.map((item, index) =>
        '<article><img src="' + esc(item.image_url) + '" alt="' + esc(item.alt_text || item.title || "") + '">' +
          '<b>' + esc(item.title || "Gallery image") + "</b><small>" + esc(statusLabel(item.category)) + " · " + (item.is_published ? "Published" : "Hidden") + "</small>" +
          '<label class="staff-gallery-caption">Caption<input data-gallery-caption="' + item.id + '" value="' + esc(item.caption || "") + '" maxlength="500"></label>' +
          '<div class="staff-row-actions"><button data-gallery-up="' + item.id + '" ' + (index === 0 ? "disabled" : "") + ' aria-label="Move up">↑</button><button data-gallery-down="' + item.id + '" ' + (index === items.length - 1 ? "disabled" : "") + ' aria-label="Move down">↓</button><button data-gallery-publish="' + item.id + '">' + (item.is_published ? "Unpublish" : "Publish") + '</button><label class="staff-file-button">Replace<input type="file" data-gallery-replace="' + item.id + '" accept="image/jpeg,image/png,image/webp,image/avif"></label><button data-gallery-delete="' + item.id + '">Delete</button></div>' +
        "</article>"
      ).join("") + "</div>" : '<p class="staff-empty">No gallery images yet.</p>') + "</section>");
  $("#gallery-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const files = Array.from($('input[name="images"]', form).files || []);
    if (!files.length) return;
    const fields = new FormData(form);
    const button = $("button[type=submit]", form);
    button.disabled = true;
    let count = 0;
    try {
      for (const file of files) {
        count++;
        $("#gallery-progress").textContent = "Uploading " + count + " of " + files.length + "…";
        const imageUrl = await uploadImage(file, "gallery");
        const { error } = await supabase.from("gallery_items").insert({
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
          category: fields.get("category"),
          image_url: imageUrl,
          alt_text: String(fields.get("alt_text") || "").trim() || file.name,
          caption: String(fields.get("caption") || "").trim() || null,
          sort_order: items.length + count,
          is_published: true,
          created_by: profile.user_id,
          updated_at: new Date().toISOString()
        });
        if (error) throw error;
        await writeAudit("gallery_image_added", "gallery_item", imageUrl, { category: fields.get("category") });
      }
      notify(files.length + " gallery image(s) uploaded.");
      await galleryPage();
    } catch (error) {
      $("#gallery-progress").textContent = error.message || "Gallery upload failed.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  async function moveItem(id, direction) {
    const index = items.findIndex(row => row.id === id);
    const other = items[index + direction];
    if (index < 0 || !other) return;
    const oldOrder = items[index].sort_order;
    const { error: firstError } = await supabase.from("gallery_items").update({ sort_order: other.sort_order, updated_at: new Date().toISOString() }).eq("id", id);
    const { error: secondError } = await supabase.from("gallery_items").update({ sort_order: oldOrder, updated_at: new Date().toISOString() }).eq("id", other.id);
    if (firstError || secondError) notify(firstError?.message || secondError?.message, "error");
    else { await writeAudit("gallery_reordered", "gallery_item", id, { direction }); await galleryPage(); }
  }
  $$("[data-gallery-up]").forEach(button => button.addEventListener("click", () => moveItem(button.dataset.galleryUp, -1)));
  $$("[data-gallery-down]").forEach(button => button.addEventListener("click", () => moveItem(button.dataset.galleryDown, 1)));
  $$("[data-gallery-publish]").forEach(button => button.addEventListener("click", async () => {
    const item = items.find(row => row.id === button.dataset.galleryPublish);
    const { error } = await supabase.from("gallery_items").update({ is_published: !item.is_published, updated_at: new Date().toISOString() }).eq("id", item.id);
    if (error) notify(error.message, "error");
    else { await writeAudit("gallery_publish_changed", "gallery_item", item.id, { is_published: !item.is_published }); await galleryPage(); }
  }));
  $$("[data-gallery-caption]").forEach(input => input.addEventListener("change", async () => {
    const { error } = await supabase.from("gallery_items").update({ caption: input.value.trim() || null, updated_at: new Date().toISOString() }).eq("id", input.dataset.galleryCaption);
    if (error) notify(error.message, "error");
    else { await writeAudit("gallery_caption_changed", "gallery_item", input.dataset.galleryCaption, {}); notify("Caption saved."); }
  }));
  $$("[data-gallery-replace]").forEach(input => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImage(file, "gallery");
      const { error } = await supabase.from("gallery_items").update({ image_url: url, alt_text: file.name, updated_at: new Date().toISOString() }).eq("id", input.dataset.galleryReplace);
      if (error) throw error;
      await writeAudit("gallery_image_replaced", "gallery_item", input.dataset.galleryReplace, {});
      notify("Gallery image replaced.");
      await galleryPage();
    } catch (error) { notify(error.message, "error"); }
  }));
  $$("[data-gallery-delete]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this gallery item?")) return;
    const id = button.dataset.galleryDelete;
    const { error } = await supabase.from("gallery_items").delete().eq("id", id);
    if (error) notify(error.message, "error");
    else { await writeAudit("gallery_image_deleted", "gallery_item", id, {}); await galleryPage(); }
  }));
}
function enquiryTable(data) {
  return data.length ? '<div class="staff-table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Event date</th><th>Guests</th><th>Status</th><th></th></tr></thead><tbody>' +
    data.map(item =>
      "<tr><td><b>" + esc(item.name) + "</b><small>" + esc(item.phone) + "</small></td><td>" + esc(item.service) + "</td><td>" + esc(item.event_date || "Not set") + "</td><td>" + esc(item.guest_count || "—") + "</td><td>" + statusPill(item.status) + '</td><td><a class="staff-table-link" href="/staff/enquiries/' + item.id + '">Open</a></td></tr>'
    ).join("") + "</tbody></table></div>" : '<p class="staff-empty">No enquiries match this view.</p>';
}
async function enquiriesPage() {
  const data = await queryRows(supabase.from("enquiries").select("*").order("created_at", { ascending: false }).limit(500));
  shell("Enquiries",
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">LEAD MANAGEMENT</p><h2>Website enquiry inbox</h2></div></div>' +
      '<div class="staff-filters"><label>Search<input id="enquiry-search" type="search" placeholder="Name or phone"></label><label>Status<select id="enquiry-status"><option value="all">All statuses</option>' + ENQUIRY_STATUSES.map(s => '<option value="' + s + '">' + statusLabel(s) + "</option>").join("") + "</select></label></div><div id=\"enquiry-results\"></div></section>");
  const render = () => {
    const term = ($("#enquiry-search").value || "").toLowerCase();
    const status = $("#enquiry-status").value;
    $("#enquiry-results").innerHTML = enquiryTable(data.filter(item =>
      (!term || (item.name + " " + item.phone).toLowerCase().includes(term)) &&
      (status === "all" || item.status === status)
    ));
  };
  $("#enquiry-search").addEventListener("input", render);
  $("#enquiry-status").addEventListener("change", render);
  render();
}
async function enquiryDetailPage(id) {
  const { data: enquiry, error } = await supabase.from("enquiries").select("*").eq("id", id).maybeSingle();
  if (error || !enquiry) { shell("Enquiry not found", panelError(error || { message: "Enquiry not found." })); return; }
  const converted = enquiry.converted_order_id;
  const canConvert = ["manager", "accountant"].includes(profile.role);
  shell("Enquiry details",
    '<section class="staff-panel"><p class="staff-eyebrow">CUSTOMER ENQUIRY</p><div class="staff-order-head"><div><h2>' + esc(enquiry.name) + '</h2><p>' + esc(enquiry.service) + '</p><div class="staff-actions"><a href="tel:' + esc(enquiry.phone) + '">Call customer</a><a target="_blank" rel="noopener" href="https://wa.me/' + waPhone(enquiry.phone) + '">WhatsApp</a></div></div>' + statusPill(enquiry.status) + "</div>" +
      '<div class="staff-detail-grid"><div><small>EVENT DATE</small><b>' + esc(enquiry.event_date || "Not set") + '</b></div><div><small>GUEST COUNT</small><b>' + esc(enquiry.guest_count || "Not specified") + '</b></div><div><small>LOCATION</small><b>' + esc(enquiry.event_location || "Not set") + '</b></div><div><small>RECEIVED</small><b>' + esc(fmtDate(enquiry.created_at)) + "</b></div></div>" +
      '<h3>Customer details</h3><p>' + esc(enquiry.details || "No additional details.") + "</p>" +
    "</section>" +
    '<section class="staff-panel"><h2>Follow-up</h2><form id="enquiry-form" class="staff-form-grid"><label>Status<select name="status">' + ENQUIRY_STATUSES.map(s => '<option value="' + s + '" ' + (enquiry.status === s ? "selected" : "") + ">" + statusLabel(s) + "</option>").join("") + '</select></label><label class="wide">Internal notes<textarea name="internal_notes" rows="4" maxlength="3000">' + esc(enquiry.internal_notes || "") + '</textarea></label><button class="staff-primary" type="submit">Save follow-up</button><p id="enquiry-message" class="staff-muted" role="status"></p></form>' +
      (converted ? '<p class="staff-success-note">Converted to order · <a href="/staff/orders/' + converted + '">Open linked order</a></p>' :
        (canConvert ? '<div class="staff-convert-box"><h3>Convert to order</h3><label>Quoted total (RWF)<input id="convert-total" type="number" min="0" step="1" placeholder="Leave blank until confirmed"></label><label>Order notes<textarea id="convert-notes" rows="2" placeholder="Optional details for the order"></textarea></label><button class="staff-primary" id="convert-enquiry" type="button">Create event order</button></div>' : "")) +
    "</section>");
  $("#enquiry-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("staff_update_enquiry", {
      p_enquiry_id: enquiry.id,
      p_status: fields.get("status"),
      p_internal_notes: String(fields.get("internal_notes") || "").trim() || null,
      p_update_notes: true
    });
    if (error) $("#enquiry-message").textContent = error.message;
    else { await writeAudit("enquiry_followup_saved", "enquiry", enquiry.id, { status: fields.get("status") }); notify("Enquiry updated."); await enquiryDetailPage(id); }
  });
  $("#convert-enquiry")?.addEventListener("click", async () => {
    const totalText = $("#convert-total").value.trim();
    const total = totalText ? Number(totalText) : null;
    if (total !== null && (!Number.isFinite(total) || total < 0)) { notify("Enter a valid total.", "warning"); return; }
    const button = $("#convert-enquiry");
    button.disabled = true;
    const { data, error } = await supabase.rpc("staff_convert_enquiry_to_order", {
      p_enquiry_id: enquiry.id, p_estimated_total: total,
      p_notes: $("#convert-notes").value.trim() || null
    });
    if (error) { button.disabled = false; notify(error.message, "error"); return; }
    notify("Enquiry converted to order.");
    location.assign("/staff/orders/" + data.id);
  });
}
async function reportsPage() {
  shell("Reports",
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">BUSINESS PERFORMANCE</p><h2>Sales overview</h2></div><button id="report-export" class="staff-quiet" type="button">Export CSV</button></div>' +
      '<div class="staff-report-filters"><label>Period<select id="report-period"><option value="today">Today</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom range</option></select></label><label>From<input id="report-from" type="date" disabled></label><label>To<input id="report-to" type="date" disabled></label><button id="report-refresh" class="staff-primary" type="button">Apply</button></div><div id="report-content"><p class="staff-muted">Loading report…</p></div></section>');
  let reportData = null;
  const refresh = async () => {
    const period = $("#report-period").value;
    const now = new Date();
    const from = period === "custom" ? $("#report-from").value : period === "today" ? dateKey(now) : dateKey(new Date(Date.now() - (Number(period) - 1) * 86400000));
    const to = period === "custom" ? $("#report-to").value : dateKey(now);
    if (!from || !to || from > to) { notify("Choose a valid report date range.", "warning"); return; }
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T23:59:59.999");
    $("#report-content").innerHTML = '<p class="staff-muted">Loading report…</p>';
    try {
      const [orders, payments] = await Promise.all([
        queryRows(supabase.from("store_orders").select("*").gte("created_at", fromDate.toISOString()).lte("created_at", toDate.toISOString()).order("created_at")),
        queryRows(supabase.from("store_order_payments").select("*").gte("recorded_at", fromDate.toISOString()).lte("recorded_at", toDate.toISOString()).order("recorded_at"))
      ]);
      reportData = { orders, payments, from, to };
      const sales = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const completed = orders.filter(o => o.status === "completed");
      const aov = completed.length ? completed.reduce((sum, o) => sum + Number(o.estimated_total || 0), 0) / completed.length : 0;
      const methods = payments.reduce((acc, p) => { acc[p.method] = (acc[p.method] || 0) + Number(p.amount || 0); return acc; }, {});
      const sellers = {};
      const categories = {};
      orders.forEach(order => (Array.isArray(order.items) ? order.items : []).forEach(item => {
        const name = String(item.name || "Item");
        const quantity = Number(item.quantity || 0);
        sellers[name] = (sellers[name] || 0) + quantity;
        const category = String(item.category || "Other");
        categories[category] = (categories[category] || 0) + Number(item.line_total || 0);
      }));
      const dayKeys = [];
      for (let d = new Date(fromDate); d <= toDate && dayKeys.length < 62; d.setDate(d.getDate() + 1)) dayKeys.push(dateKey(d));
      const dayCounts = dayKeys.map(key => orders.filter(o => dateKey(o.created_at) === key).length);
      const max = Math.max(1, ...dayCounts);
      const bars = dayKeys.map((key, index) => '<div class="staff-bar-column"><span>' + dayCounts[index] + '</span><div><i style="height:' + Math.max(4, dayCounts[index] / max * 100) + '%"></i></div><small>' + esc(key.slice(5)) + "</small></div>").join("");
      $("#report-content").innerHTML =
        '<div class="staff-stats">' +
          statCard("Sales received", money(sales), "Payments recorded in this period") +
          statCard("Orders", orders.length, "All statuses") +
          statCard("Average order value", money(aov), "Completed orders") +
          statCard("Completed", completed.length, "Orders completed") +
        "</div><h3>Orders by day</h3><div class=\"staff-bars staff-bars-report\">" + bars + "</div>" +
        '<div class="staff-report-columns"><section><h3>Payment methods</h3>' +
          (Object.keys(methods).length ? Object.entries(methods).map(([method, amount]) => '<p class="staff-report-line"><span>' + esc(statusLabel(method)) + '</span><b>' + money(amount) + "</b></p>").join("") : '<p class="staff-empty">No payments recorded.</p>') +
        '</section><section><h3>Category sales</h3>' +
          (Object.keys(categories).length ? Object.entries(categories).map(([category, amount]) => '<p class="staff-report-line"><span>' + esc(category) + '</span><b>' + money(amount) + "</b></p>").join("") : '<p class="staff-empty">No item sales data.</p>') +
        '</section><section><h3>Best sellers</h3>' +
          (Object.keys(sellers).length ? Object.entries(sellers).sort((a,b) => b[1]-a[1]).slice(0,8).map(([name, quantity]) => '<p class="staff-report-line"><span>' + esc(name) + '</span><b>' + quantity + " sold</b></p>").join("") : '<p class="staff-empty">No completed item data.</p>') +
        '</section></div><h3>Orders in range</h3>' + orderTable(orders);
    } catch (error) {
      $("#report-content").innerHTML = panelError(error);
    }
  };
  $("#report-period").addEventListener("change", () => {
    const custom = $("#report-period").value === "custom";
    $("#report-from").disabled = !custom;
    $("#report-to").disabled = !custom;
  });
  $("#report-refresh").addEventListener("click", refresh);
  $("#report-export").addEventListener("click", () => {
    if (!reportData) { notify("Load a report first.", "warning"); return; }
    downloadCsv("step-town-report-" + reportData.from + "-to-" + reportData.to + ".csv", [
      ["Order", "Customer", "Phone", "Status", "Total RWF", "Date", "Fulfilment"],
      ...reportData.orders.map(o => [o.order_number, o.customer_name, o.customer_phone, o.status, o.estimated_total, o.created_at, o.fulfillment]),
      [],
      ["Payment method", "Amount RWF"],
      ...reportData.payments.map(p => [p.method, p.amount])
    ]);
  });
  await refresh();
}
async function teamPage() {
  const { data: result, error } = await supabase.functions.invoke("staff-admin", { body: { action: "team" } });
  if (error || result?.error) { shell("Team", panelError(error || { message: result.error })); return; }
  teamCache = result?.staff || [];
  const accountants = teamCache.filter(item => item.role === "accountant" && item.is_active);
  shell("Team",
    '<section class="staff-panel"><p class="staff-eyebrow">TEAM ADMINISTRATION</p><h2>Create a staff account</h2><form id="team-create" class="staff-form-grid">' +
      '<label>Full name<input name="full_name" required maxlength="120"></label><label>Email<input name="email" type="email" required maxlength="254"></label>' +
      '<label>Phone<input name="phone" type="tel" maxlength="40"></label><label>Role<select name="role"><option value="accountant">Accountant</option><option value="cashier">Cashier</option></select></label>' +
      '<label class="wide" id="team-parent-wrap" hidden>Reports to Accountant<select name="reports_to"><option value="">Choose an Accountant</option>' + accountants.map(x => '<option value="' + x.id + '">' + esc(x.full_name) + "</option>").join("") + "</select></label>' +
      '<label class="wide">Temporary password<input name="password" type="password" required minlength="12" autocomplete="new-password"></label>' +
      '<button class="staff-primary" type="submit">Create account</button><p id="team-message" class="staff-muted" role="status">New staff will be required to change their temporary password.</p>' +
    "</form></section>" +
    '<section class="staff-panel"><h2>Staff accounts</h2>' +
      (teamCache.length ? '<div class="staff-table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Reports to</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      teamCache.map(member =>
        "<tr><td><b>" + esc(member.full_name) + "</b><small>" + esc(member.phone || "No phone") + "</small></td><td>" + esc(ROLE_LABEL[member.role]) + "</td><td>" + esc(member.email) + "</td>" +
        "<td>" + esc(teamCache.find(x => x.id === member.reports_to)?.full_name || "—") + "</td><td>" + (member.is_active ? "Active" : "Inactive") + "</td><td>" +
        (member.role !== "manager" ? '<div class="staff-row-actions"><button data-team-edit="' + member.user_id + '">Edit</button><button data-team-reset="' + member.user_id + '">Reset password</button><button data-team-toggle="' + member.user_id + '" data-active="' + member.is_active + '">' + (member.is_active ? "Deactivate" : "Reactivate") + "</button></div>" : "Current Manager") +
        "</td></tr>"
      ).join("") + "</tbody></table></div>" : '<p class="staff-empty">No additional staff accounts yet.</p>') +
    "</section>" +
    '<div id="team-edit-modal" class="staff-modal" hidden><div class="staff-modal-card"><div class="staff-panel-head"><h2>Edit staff profile</h2><button id="team-edit-close" class="staff-quiet" type="button">Close</button></div><form id="team-edit-form" class="staff-form-grid"><input type="hidden" name="user_id"><label>Full name<input name="full_name" required maxlength="120"></label><label>Phone<input name="phone" maxlength="40"></label><label>Role<select name="role"><option value="accountant">Accountant</option><option value="cashier">Cashier</option></select></label><label id="team-edit-parent-wrap" hidden>Reports to<select name="reports_to"><option value="">Choose Accountant</option>' + accountants.map(x => '<option value="' + x.id + '">' + esc(x.full_name) + "</option>").join("") + '</select></label><div class="staff-form-actions wide"><button class="staff-primary" type="submit">Save profile</button></div><p id="team-edit-message" class="staff-muted wide"></p></form></div></div>');
  $("#team-create").elements.role.addEventListener("change", event => { $("#team-parent-wrap").hidden = event.target.value !== "cashier"; });
  $("#team-create").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = {
      action: "create",
      full_name: String(fields.get("full_name")).trim(),
      email: String(fields.get("email")).trim().toLowerCase(),
      phone: String(fields.get("phone") || "").trim(),
      role: String(fields.get("role")),
      reports_to: String(fields.get("reports_to") || ""),
      password: String(fields.get("password") || "")
    };
    if (body.password.length < 12) { $("#team-message").textContent = "Temporary password must contain at least 12 characters."; return; }
    if (body.role === "cashier" && !body.reports_to) { $("#team-message").textContent = "Select the Accountant this Cashier reports to."; return; }
    const button = $("button[type=submit]", form); button.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke("staff-admin", { body });
      if (error || !data?.ok) throw error || new Error(data?.error || "Account creation failed.");
      notify("Staff account created.");
      await teamPage();
    } catch (error) { $("#team-message").textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $("#team-edit-close").addEventListener("click", () => { $("#team-edit-modal").hidden = true; });
  $("#team-edit-form").elements.role.addEventListener("change", event => { $("#team-edit-parent-wrap").hidden = event.target.value !== "cashier"; });
  $$("[data-team-edit]").forEach(button => button.addEventListener("click", () => {
    const member = teamCache.find(x => x.user_id === button.dataset.teamEdit);
    const form = $("#team-edit-form");
    form.elements.user_id.value = member.user_id;
    form.elements.full_name.value = member.full_name || "";
    form.elements.phone.value = member.phone || "";
    form.elements.role.value = member.role;
    form.elements.reports_to.value = member.reports_to || "";
    $("#team-edit-parent-wrap").hidden = member.role !== "cashier";
    $("#team-edit-modal").hidden = false;
  }));
  $("#team-edit-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const body = {
      action: "update-profile",
      user_id: fields.get("user_id"),
      full_name: String(fields.get("full_name") || "").trim(),
      phone: String(fields.get("phone") || "").trim(),
      role: String(fields.get("role")),
      reports_to: String(fields.get("reports_to") || "")
    };
    const { data, error } = await supabase.functions.invoke("staff-admin", { body });
    if (error || !data?.ok) { $("#team-edit-message").textContent = error?.message || data?.error || "Profile update failed."; return; }
    $("#team-edit-modal").hidden = true;
    notify("Staff profile updated.");
    await teamPage();
  });
  $$("[data-team-reset]").forEach(button => button.addEventListener("click", async () => {
    const password = prompt("Enter a new temporary password (at least 12 characters):");
    if (!password) return;
    if (password.length < 12) { notify("Use at least 12 characters.", "warning"); return; }
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke("staff-admin", { body: { action: "reset", user_id: button.dataset.teamReset, password } });
    if (error || !data?.ok) notify(error?.message || data?.error || "Password reset failed.", "error");
    else { notify("Password reset. The staff member must change it at next sign-in."); await teamPage(); }
    button.disabled = false;
  }));
  $$("[data-team-toggle]").forEach(button => button.addEventListener("click", async () => {
    const active = button.dataset.active === "true";
    if (active && !confirm("Deactivate this account? Their staff permissions will be revoked immediately.")) return;
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke("staff-admin", { body: { action: active ? "deactivate" : "activate", user_id: button.dataset.teamToggle } });
    if (error || !data?.ok) notify(error?.message || data?.error || "Account update failed.", "error");
    else { notify(active ? "Staff account deactivated." : "Staff account reactivated."); await teamPage(); }
    button.disabled = false;
  }));
}
async function auditPage() {
  const [logs, team] = await Promise.all([
    queryRows(supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(1000)),
    queryRows(supabase.from("staff_profiles").select("user_id,full_name,email,role"))
  ]);
  const teamByUser = new Map(team.map(member => [member.user_id, member]));
  shell("Audit log",
    '<section class="staff-panel"><div class="staff-panel-head"><div><p class="staff-eyebrow">SECURITY & OPERATIONS</p><h2>Activity history</h2></div><button id="audit-export" class="staff-quiet" type="button">Export CSV</button></div>' +
      '<div class="staff-filters"><label>Staff member<select id="audit-user"><option value="all">All staff</option>' + team.map(member => '<option value="' + member.user_id + '">' + esc(member.full_name) + "</option>").join("") + '</select></label><label>Action<input id="audit-action" type="search" placeholder="Filter by action"></label><label>From<input id="audit-date" type="date"></label></div>' +
      '<div id="audit-results"></div><div class="staff-pagination"><button id="audit-prev" class="staff-quiet" type="button">Previous</button><span id="audit-page-label"></span><button id="audit-next" class="staff-quiet" type="button">Next</button></div></section>');
  let page = 0;
  const pageSize = 50;
  let filtered = logs;
  const render = () => {
    const user = $("#audit-user").value;
    const action = ($("#audit-action").value || "").toLowerCase();
    const date = $("#audit-date").value;
    filtered = logs.filter(log =>
      (user === "all" || log.actor_id === user) &&
      (!action || log.action.toLowerCase().includes(action)) &&
      (!date || dateKey(log.created_at) >= date)
    );
    const start = page * pageSize;
    const current = filtered.slice(start, start + pageSize);
    $("#audit-results").innerHTML = current.length ?
      '<div class="staff-table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>' +
      current.map(log => {
        const actor = teamByUser.get(log.actor_id);
        return "<tr><td>" + esc(fmtDate(log.created_at)) + "</td><td>" + esc(actor?.full_name || "Former staff / system") + "</td><td>" + esc(log.actor_role || "—") + "</td><td>" + esc(log.action) + "</td><td>" + esc(log.entity_type) + " · " + esc(log.entity_id || "—") + "</td><td><code>" + esc(JSON.stringify(log.details || {})) + "</code></td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="staff-empty">No audit records match these filters.</p>';
    $("#audit-page-label").textContent = filtered.length ? "Page " + (page + 1) + " of " + Math.ceil(filtered.length / pageSize) : "No records";
    $("#audit-prev").disabled = page === 0;
    $("#audit-next").disabled = start + pageSize >= filtered.length;
  };
  ["audit-user", "audit-action", "audit-date"].forEach(id => $("#" + id).addEventListener(id === "audit-action" ? "input" : "change", () => { page = 0; render(); }));
  $("#audit-prev").addEventListener("click", () => { page = Math.max(0, page - 1); render(); });
  $("#audit-next").addEventListener("click", () => { if ((page + 1) * pageSize < filtered.length) page++; render(); });
  $("#audit-export").addEventListener("click", () => downloadCsv("step-town-audit-log.csv", [
    ["Time", "User", "Role", "Action", "Entity", "Entity ID", "Details"],
    ...filtered.map(log => [log.created_at, teamByUser.get(log.actor_id)?.full_name || "", log.actor_role, log.action, log.entity_type, log.entity_id, JSON.stringify(log.details || {})])
  ]));
  render();
}
async function changePasswordPage() {
  shell("Change password",
    '<section class="staff-panel staff-password"><p class="staff-eyebrow">FIRST SIGN-IN SECURITY</p><h2>Set a new password</h2><p class="staff-muted">Use at least 12 characters. Your temporary password will no longer work after this change.</p>' +
      '<form id="change-password-form"><label>New password<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><label>Confirm password<input name="confirm" type="password" required minlength="12" autocomplete="new-password"></label><button class="staff-primary" type="submit">Update password</button><p id="password-message" role="alert"></p></form></section>');
  $("#change-password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") || "");
    if (password !== fields.get("confirm")) { $("#password-message").textContent = "Passwords do not match."; return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { $("#password-message").textContent = error.message; return; }
    const { data, error: functionError } = await supabase.functions.invoke("staff-admin", { body: { action: "complete-password-change" } });
    if (functionError || !data?.ok) { $("#password-message").textContent = functionError?.message || data?.error || "The security flag could not be updated."; return; }
    await writeAudit("staff_password_changed", "staff_profile", profile.id, {});
    location.replace("/staff/overview");
  });
}
async function start() {
  app = document.querySelector("#staff-app");
  if (!app) {
    document.body.insertAdjacentHTML("afterbegin", '<div id="staff-app" class="staff-app"></div>');
    app = $("#staff-app");
  }
  if (!supabaseConfigured || !supabase) { loginView("Staff authentication is not configured."); return; }
  if (PATH === "/staff/login") {
    const current = await getProfile();
    if (current) location.replace(current.must_change_password ? "/staff/change-password" : "/staff/overview");
    else { await supabase.auth.signOut({ scope: "global" }); loginView(); }
    return;
  }
  if (PATH === "/staff/change-password") {
    if (!(await requireProfile())) return;
    return changePasswordPage();
  }
  if (!(await requireProfile())) return;
  if (PATH === "/staff" || PATH === "/staff/dashboard") { location.replace("/staff/overview"); return; }

  const route = PATH === "/staff/overview" ? "overview"
    : PATH === "/staff/orders" ? "orders"
    : PATH.startsWith("/staff/orders/") ? "order-detail"
    : PATH === "/staff/products" ? "products"
    : PATH === "/staff/products/new" || /^\/staff\/products\/[^/]+\/edit$/.test(PATH) ? "products"
    : PATH === "/staff/gallery" ? "gallery"
    : PATH === "/staff/enquiries" ? "enquiries"
    : PATH.startsWith("/staff/enquiries/") ? "enquiry-detail"
    : PATH === "/staff/reports" ? "reports"
    : PATH === "/staff/team" ? "team"
    : PATH === "/staff/audit" ? "audit"
    : "unknown";
  const permissionKey = route === "order-detail" ? "orders" : route === "enquiry-detail" ? "enquiries" : route;
  if (permissionKey !== "unknown" && ROLE_ACCESS[permissionKey] && !ROLE_ACCESS[permissionKey].includes(profile.role)) {
    await deniedPage();
    return;
  }
  if (route === "overview") return overviewPage();
  if (route === "orders") return ordersPage();
  if (route === "order-detail") return orderDetailPage(decodeURIComponent(PATH.split("/").pop()));
  if (route === "products") return productsPage();
  if (route === "gallery") return galleryPage();
  if (route === "enquiries") return enquiriesPage();
  if (route === "enquiry-detail") return enquiryDetailPage(decodeURIComponent(PATH.split("/").pop()));
  if (route === "reports") return reportsPage();
  if (route === "team") return teamPage();
  if (route === "audit") return auditPage();
  await deniedPage();
}

if (PATH.startsWith("/staff")) {
  document.body.innerHTML = '<div id="staff-app" class="staff-app"><div class="staff-loading">Opening secure staff workspace…</div></div>';
  app = $("#staff-app");
  start().catch(error => {
    console.error("Staff workspace error:", error);
    app.innerHTML = '<div class="staff-login-wrap"><section class="staff-login-card"><h1>Workspace unavailable</h1><p>' + esc(error.message || "Refresh and try again.") + '</p><a class="staff-primary" href="/staff/login">Return to sign in</a></section></div>';
  });
}
