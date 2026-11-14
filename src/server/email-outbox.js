import { createHash, createDecipheriv } from "node:crypto";
import { Buffer } from "node:buffer";
import { sendEmail } from "./email-provider.js";
import { loginCodeTemplate, orderConfirmationTemplate } from "./email-templates.js";

const base = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
let running = false;

async function db(path, options = {}) {
  if (!base || !serviceKey) throw new Error("Supabase service-role configuration is missing for the email outbox.");
  const response = await fetch(base + "/rest/v1/" + path, {
    method:options.method || "GET",
    headers:{
      apikey:serviceKey, Authorization:"Bearer " + serviceKey,
      "Content-Type":"application/json",
      ...(options.headers || {})
    },
    ...(options.body ? {body:JSON.stringify(options.body)} : {})
  });
  const text = await response.text();
  if (!response.ok) throw new Error("Email outbox database request failed: " + response.status + " " + text.slice(0, 300));
  return text ? JSON.parse(text) : [];
}

function unseal(value) {
  const secret = String(process.env.SESSION_SECRET || "");
  if (!secret || !value) throw new Error("SESSION_SECRET is required to decrypt email jobs.");
  try {
    const key = createHash("sha256").update(secret).digest();
    const packed = Buffer.from(String(value), "base64url");
    if (packed.length < 30) throw new Error("Invalid encrypted payload.");
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    throw new Error("The protected email payload could not be decrypted.");
  }
}

async function sendJob(job) {
  if (job.job_type === "order_confirmation") return sendEmail({to:job.recipient,...orderConfirmationTemplate(job.payload || {})});
  if (job.job_type === "login_code") {
    const secret = unseal(job.payload?.encrypted_code);
    return sendEmail({to:job.recipient,...loginCodeTemplate({code:secret.code})});
  }
  throw new Error("Unknown email job type.");
}

async function processOne(job) {
  const claimed = await db("email_jobs?id=eq." + encodeURIComponent(job.id) + "&status=in.(pending,failed)", {
    method:"PATCH",
    body:{status:"processing",locked_at:new Date().toISOString()},
    headers:{Prefer:"return=representation"}
  });
  if (!claimed.length) return false;
  try {
    const result = await sendJob(claimed[0]);
    await db("email_jobs?id=eq." + encodeURIComponent(job.id), {
      method:"PATCH",
      body:{status:"sent",sent_at:new Date().toISOString(),last_error:null,locked_at:null},
      headers:{Prefer:"return=minimal"}
    });
    console.info("Step Town email sent:",job.job_type,job.recipient,result.provider);
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1;
    const dead = attempts >= Number(job.max_attempts || 6);
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
    await db("email_jobs?id=eq." + encodeURIComponent(job.id), {
      method:"PATCH",
      body:{
        status:dead ? "dead" : "failed",
        attempts,
        available_at:new Date(Date.now() + delaySeconds * 1000).toISOString(),
        locked_at:null,
        last_error:String(error?.message || error).slice(0, 1000)
      },
      headers:{Prefer:"return=minimal"}
    });
    console.error("Step Town email job failed:",job.id,error?.message || error);
  }
  return true;
}

export async function processEmailOutbox() {
  if (running || !base || !serviceKey || !process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM) return;
  running = true;
  try {
    const jobs = await db("email_jobs?select=id,job_type,recipient,payload,status,attempts,max_attempts&status=in.(pending,failed)&available_at=lte." +
      encodeURIComponent(new Date().toISOString()) + "&order=created_at.asc&limit=10");
    for (const job of jobs) await processOne(job);
  } catch (error) {
    console.error("Step Town email outbox poll failed:",error?.message || error);
  } finally {
    running = false;
  }
}
