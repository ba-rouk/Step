import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigin = (origin: string | null) =>
  origin === "https://steptown.onrender.com" ||
  origin === "http://localhost:5173" ||
  origin === "http://127.0.0.1:5173";

function headers(origin: string | null) {
  const ok = allowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://steptown.onrender.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

async function writeAudit(actorId: string, actorRole: string, action: string, entityType: string, entityId: string, details: unknown = {}) {
  await admin.from("audit_log").insert({
    actor_id: actorId, actor_role: actorRole, action, entity_type: entityType,
    entity_id: entityId, details,
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST" || !allowedOrigin(origin)) return json({ error: "Origin or method not allowed." }, 403, origin);

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication is required." }, 401, origin);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401, origin);
  const actor = authData.user;

  const { data: actorProfile, error: profileError } = await admin
    .from("staff_profiles")
    .select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password")
    .eq("user_id", actor.id)
    .maybeSingle();

  if (profileError || !actorProfile?.is_active) return json({ error: "This account is not an active Step Town staff account." }, 403, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400, origin);
  }

  const action = clean(body.action, 40);

  // First-login password completion: the authenticated user can clear only their own flag.
  if (action === "complete-password-change") {
    if (!actorProfile.must_change_password) return json({ success: true }, 200, origin);
    const { error } = await admin.from("staff_profiles")
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq("id", actorProfile.id);
    if (error) return json({ error: "Could not update the password-change flag." }, 500, origin);
    await writeAudit(actor.id, actorProfile.role, "password_changed", "staff_profile", actorProfile.id);
    return json({ success: true }, 200, origin);
  }

  if (action === "touch") {
    await admin.from("staff_profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", actorProfile.id);
    return json({ success: true }, 200, origin);
  }

  if (actorProfile.role !== "manager") {
    return json({ error: "Only a Manager can manage staff accounts." }, 403, origin);
  }

  if (action === "team") {
    const { data, error } = await admin.from("staff_profiles")
      .select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password,last_seen_at,created_at")
      .order("role").order("full_name");
    if (error) return json({ error: "Could not load the staff directory." }, 500, origin);
    return json({ staff: data || [] }, 200, origin);
  }

  if (action === "create") {
    const email = clean(body.email, 254).toLowerCase();
    const fullName = clean(body.full_name, 120);
    const phone = clean(body.phone, 40) || null;
    const role = clean(body.role, 20);
    const temporaryPassword = clean(body.temporary_password, 128);
    if (!email.includes("@") || fullName.length < 2 || !["accountant", "cashier"].includes(role)) {
      return json({ error: "Enter a valid name, email and role. Only Accountant and Cashier accounts can be created here." }, 400, origin);
    }
    if (temporaryPassword.length < 12) {
      return json({ error: "Temporary passwords must be at least 12 characters." }, 400, origin);
    }

    let reportsTo = actorProfile.id;
    if (role === "cashier") {
      reportsTo = clean(body.reports_to, 80);
      const { data: parent } = await admin.from("staff_profiles")
        .select("id,role,is_active,reports_to")
        .eq("id", reportsTo).maybeSingle();
      if (!parent || parent.role !== "accountant" || !parent.is_active || parent.reports_to !== actorProfile.id) {
        return json({ error: "Choose an active Accountant who reports to this Manager." }, 400, origin);
      }
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { staff_role: role, staff: true },
    });
    if (createError || !created.user) return json({ error: createError?.message || "Could not create staff login." }, 400, origin);

    const { data: profile, error: insertError } = await admin.from("staff_profiles").insert({
      user_id: created.user.id,
      full_name: fullName,
      email,
      phone,
      role,
      reports_to: reportsTo,
      is_active: true,
      must_change_password: true,
      created_by: actor.id,
    }).select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password,created_at").single();

    if (insertError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: insertError?.message || "Could not create the staff profile." }, 400, origin);
    }

    await writeAudit(actor.id, actorProfile.role, "staff_created", "staff_profile", profile.id, {
      role, email, reports_to: reportsTo,
    });
    return json({ staff: profile }, 201, origin);
  }

  if (action === "update") {
    const id = clean(body.id, 80);
    const changes: Record<string, unknown> = {};
    if (body.full_name !== undefined) {
      const value = clean(body.full_name, 120);
      if (value.length < 2) return json({ error: "Name must contain at least two characters." }, 400, origin);
      changes.full_name = value;
    }
    if (body.phone !== undefined) changes.phone = clean(body.phone, 40) || null;
    if (body.reports_to !== undefined) {
      const parentId = clean(body.reports_to, 80);
      const { data: target } = await admin.from("staff_profiles").select("id,role,is_active,reports_to").eq("id", id).maybeSingle();
      const { data: parent } = await admin.from("staff_profiles").select("id,role,is_active,reports_to").eq("id", parentId).maybeSingle();
      if (!target || !parent || !parent.is_active) return json({ error: "Select a valid active reporting manager." }, 400, origin);
      if (target.role === "accountant" && (parent.role !== "manager" || parent.id !== actorProfile.id)) {
        return json({ error: "Accountants must report to this Manager." }, 400, origin);
      }
      if (target.role === "cashier" && (parent.role !== "accountant" || parent.reports_to !== actorProfile.id)) {
        return json({ error: "Cashiers must report to an Accountant under this Manager." }, 400, origin);
      }
      changes.reports_to = parentId;
    }
    if (!Object.keys(changes).length) return json({ error: "No changes supplied." }, 400, origin);
    changes.updated_at = new Date().toISOString();
    const { data: updated, error } = await admin.from("staff_profiles").update(changes)
      .eq("id", id).select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password").single();
    if (error) return json({ error: error.message }, 400, origin);
    await writeAudit(actor.id, actorProfile.role, "staff_updated", "staff_profile", id, changes);
    return json({ staff: updated }, 200, origin);
  }

  if (action === "deactivate") {
    const id = clean(body.id, 80);
    const { data: target } = await admin.from("staff_profiles").select("id,user_id,role,is_active").eq("id", id).maybeSingle();
    if (!target || target.role === "manager") return json({ error: "That staff account cannot be deactivated here." }, 400, origin);
    const { error } = await admin.from("staff_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: error.message }, 400, origin);
    await admin.auth.admin.updateUserById(target.user_id, { ban_duration: "876000h" });
    await writeAudit(actor.id, actorProfile.role, "staff_deactivated", "staff_profile", id, { role: target.role });
    return json({ success: true }, 200, origin);
  }

  if (action === "reset-password") {
    const id = clean(body.id, 80);
    const password = clean(body.temporary_password, 128);
    if (password.length < 12) return json({ error: "Temporary passwords must be at least 12 characters." }, 400, origin);
    const { data: target } = await admin.from("staff_profiles").select("id,user_id,role,is_active").eq("id", id).maybeSingle();
    if (!target || !target.is_active || target.role === "manager") return json({ error: "Only active Accountant and Cashier passwords can be reset here." }, 400, origin);
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
    if (error) return json({ error: error.message }, 400, origin);
    await admin.from("staff_profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", id);
    await writeAudit(actor.id, actorProfile.role, "staff_password_reset", "staff_profile", id);
    return json({ success: true }, 200, origin);
  }

  return json({ error: "Unknown staff administration action." }, 400, origin);
});
