import { sendProviderEmail } from "./email-provider.js";
import { loginCodeTemplate, orderConfirmationTemplate } from "./email-templates.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const APP_URL = String(process.env.APP_URL || "https://steptown.onrender.com").replace(/\/+$/, "");

async function db(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    method: options.method || "GET",
    headers: {
      apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(payload.message || payload.msg || "Outbox database operation failed.");
  return payload;
}

async function deliver(job) {
  if (job.job_type === "order_push") {
    const response = await fetch(SUPABASE_URL + "/functions/v1/send-order-push", {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: job.order_id || job.payload?.order_id })
    });
    if (!response.ok) throw new Error("Staff push delivery returned " + response.status);
    return;
  }
  if (job.job_type === "login_code") {
    await sendProviderEmail({ to: job.recipient, ...loginCodeTemplate(job.payload || {}) });
    return;
  }
  if (job.job_type === "order_confirmation") {
    const order = job.payload?.order || {};
    const trackingUrl = APP_URL + "/order/" + encodeURIComponent(order.tracking_token || "");
    await sendProviderEmail({ to: job.recipient, ...orderConfirmationTemplate({ order, trackingUrl, appUrl: APP_URL }) });
    return;
  }
  throw new Error("Unknown outbox job type: " + job.job_type);
}

async function updateJob(id, values) {
  await db("/rest/v1/email_outbox?id=eq." + encodeURIComponent(id), {
    method: "PATCH", body: values, headers: { Prefer: "return=minimal" }
  });
}

export async function processEmailOutbox() {
  if (!SUPABASE_URL || !SERVICE_KEY) return { skipped: true };
  let jobs;
  try {
    jobs = await db("/rest/v1/rpc/claim_step_email_jobs", { method: "POST", body: { p_limit: 8 } });
  } catch (error) {
    console.warn("Step Town outbox claim failed:", error.message);
    return { failed: true };
  }
  let sent = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try {
      await deliver(job);
      await updateJob(job.id, { status: "sent", sent_at: new Date().toISOString(), locked_at: null, last_error: null, payload: {} });
      sent++;
    } catch (error) {
      const attempt = Number(job.attempts || 1);
      const terminal = attempt >= 8;
      const delay = Math.min(6 * 60 * 60 * 1000, 15000 * (2 ** Math.max(0, attempt - 1)));
      await updateJob(job.id, {
        status: terminal ? "failed" : "pending",
        next_attempt_at: new Date(Date.now() + delay).toISOString(),
        locked_at: null,
        last_error: String(error.message || "Delivery failed").slice(0, 1000),
        ...(job.job_type === "login_code" && terminal ? { payload: {} } : {})
      }).catch(updateError => console.error("Outbox retry metadata failed:", updateError.message));
      console.warn("Step Town outbox job will retry:", job.job_type, error.message);
    }
  }
  return { sent, processed: Array.isArray(jobs) ? jobs.length : 0 };
}

export function startOutboxWorker() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn("Step Town outbox worker is disabled: SUPABASE_SERVICE_ROLE_KEY is missing.");
    return null;
  }
  const interval = Math.max(15000, Number(process.env.EMAIL_WORKER_INTERVAL_MS || 30000));
  void processEmailOutbox();
  return setInterval(() => void processEmailOutbox(), interval).unref();
}
