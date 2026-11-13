import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "https://steptown.onrender.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Access-Control-Allow-Origin": origin === "https://steptown.onrender.com" || origin === "http://localhost:5173"
        ? origin : cors["Access-Control-Allow-Origin"],
      "Content-Type": "application/json",
    },
  });

const clean = (value: unknown, max = 160) => String(value ?? "").trim().slice(0, max);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" || (origin && ![ "https://steptown.onrender.com", "http://localhost:5173" ].includes(origin))) {
    return reply({ error: "Origin or method not allowed." }, 403, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ error: "Supabase server configuration is missing." }, 500, origin);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Sign in first." }, 401, origin);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return reply({ error: "Your session is invalid. Sign in again." }, 401, origin);
  const user = authData.user;

  const { data: actor, error: actorError } = await admin.from("staff_profiles")
    .select("id,user_id,full_name,email,role,is_active,must_change_password")
    .eq("user_id", user.id).maybeSingle();
  if (actorError || !actor?.is_active) return reply({ error: "This is not an active Step Town staff account." }, 403, origin);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return reply({ error: "Invalid request body." }, 400, origin);
  const action = clean(body.action, 40);

  // A staff member may clear only their own first-login flag after Auth accepts the new password.
  if (action === "complete-password-change") {
    if (!actor.must_change_password) return reply({ ok: true }, 200, origin);
    const { error } = await admin.from("staff_profiles")
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq("id", actor.id);
    if (error) return reply({ error: "Password changed, but the security flag could not be updated: " + error.message }, 500, origin);
    await admin.from("audit_log").insert({
      actor_id: user.id, actor_role: actor.role, action: "first_login_password_changed",
      entity_type: "staff_profile", entity_id: actor.id, details: {},
    });
    return reply({ ok: true }, 200, origin);
  }

  if (action === "touch") {
    await admin.from("staff_profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", actor.id);
    return reply({ ok: true }, 200, origin);
  }

  if (actor.role !== "manager") return reply({ error: "Manager access required." }, 403, origin);

  if (action === "team") {
    const { data, error } = await admin.from("staff_profiles")
      .select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password,last_seen_at,created_at")
      .order("role").order("full_name");
    if (error) return reply({ error: "Could not load the staff team." }, 500, origin);
    return reply({ staff: data || [] }, 200, origin);
  }

  if (action === "create") {
    const role = clean(body.role, 20);
    const email = clean(body.email, 254).toLowerCase();
    const fullName = clean(body.full_name, 100);
    const password = String(body.password || "");
    if (!["accountant", "cashier"].includes(role)) return reply({ error: "Only Accountant and Cashier accounts can be created." }, 400, origin);
    if (!email.includes("@") || fullName.length < 2 || password.length < 12) {
      return reply({ error: "Enter a valid name, email and a temporary password of at least 12 characters." }, 400, origin);
    }

    let reportsTo = actor.id;
    if (role === "cashier") {
      const parentId = clean(body.reports_to, 80);
      const { data: parent, error } = await admin.from("staff_profiles")
        .select("id,role,is_active,reports_to")
        .eq("id", parentId).maybeSingle();
      if (error || !parent || parent.role !== "accountant" || !parent.is_active || parent.reports_to !== actor.id) {
        return reply({ error: "Select an active Accountant who reports to this Manager." }, 400, origin);
      }
      reportsTo = parent.id;
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { staff: true, staff_role: role },
    });
    if (createError || !created.user) return reply({ error: createError?.message || "Could not create the login." }, 400, origin);

    const { data: profile, error: profileError } = await admin.from("staff_profiles").insert({
      user_id: created.user.id, full_name: fullName, email,
      phone: clean(body.phone, 40) || null,
      role, reports_to: reportsTo, is_active: true,
      must_change_password: true, created_by: user.id,
    }).select("id,user_id,full_name,email,role,reports_to,is_active").single();

    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply({ error: "Could not create the staff profile: " + (profileError?.message || "Unknown error") }, 400, origin);
    }
    await admin.from("audit_log").insert({
      actor_id: user.id, actor_role: "manager", action: "staff_created",
      entity_type: "staff_profile", entity_id: profile.id,
      details: { role, email, reports_to: reportsTo },
    });
    return reply({ ok: true, staff: profile }, 201, origin);
  }

  const targetUserId = clean(body.user_id, 80);
  if (!targetUserId) return reply({ error: "Staff user ID is required." }, 400, origin);
  const { data: target } = await admin.from("staff_profiles")
    .select("id,user_id,role,is_active").eq("user_id", targetUserId).maybeSingle();
  if (!target || target.role === "manager") return reply({ error: "The target staff account cannot be managed here." }, 404, origin);


  if (action === "update-profile") {
    const fullName = clean(body.full_name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const phone = clean(body.phone, 40) || null;
    const role = clean(body.role, 20);
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["accountant", "cashier"].includes(role)) {
      return reply({ error: "Enter a valid name, email address and select Accountant or Cashier." }, 400, origin);
    }

    let reportsTo = actor.id;
    if (role === "cashier") {
      const parentId = clean(body.reports_to, 80);
      const { data: parent, error } = await admin.from("staff_profiles")
        .select("id,role,is_active,reports_to")
        .eq("id", parentId).maybeSingle();
      if (error || !parent || parent.role !== "accountant" || !parent.is_active || parent.reports_to !== actor.id) {
        return reply({ error: "Select an active Accountant who reports to this Manager." }, 400, origin);
      }
      reportsTo = parent.id;
    }

    if (target.role === "accountant" && role === "cashier") {
      const { data: reports } = await admin.from("staff_profiles")
        .select("id").eq("reports_to", target.id).limit(1);
      if (reports?.length) {
        return reply({ error: "This Accountant has Cashiers reporting to them. Reassign those Cashiers before changing this role." }, 409, origin);
      }
    }

    const { data: authTarget, error: authFetchError } = await admin.auth.admin.getUserById(target.user_id);
    if (authFetchError || !authTarget?.user) return reply({ error: "Could not load the staff login to update it." }, 500, origin);
    const nextMetadata = {
      ...(authTarget.user.app_metadata || {}),
      staff: true,
      staff_role: role
    };
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(target.user_id, {
      email,
      email_confirm: true,
      app_metadata: nextMetadata,
      user_metadata: {
        ...(authTarget.user.user_metadata || {}),
        full_name: fullName
      }
    });
    if (authUpdateError) return reply({ error: "Could not update the staff login: " + authUpdateError.message }, 400, origin);

    const { error: profileError } = await admin.from("staff_profiles").update({
      full_name: fullName,
      email,
      phone,
      role,
      reports_to: reportsTo,
      updated_at: new Date().toISOString()
    }).eq("id", target.id);
    if (profileError) {
      console.error("Auth email updated but staff profile update failed:", profileError.message);
      return reply({ error: "Login email was updated, but the staff profile update failed. Retry saving the profile: " + profileError.message }, 500, origin);
    }

    await admin.from("audit_log").insert({
      actor_id: user.id,
      actor_role: "manager",
      action: "staff_profile_updated",
      entity_type: "staff_profile",
      entity_id: target.id,
      details: { role, reports_to: reportsTo, full_name: fullName },
    });
    return reply({ ok: true }, 200, origin);
  }

  if (action === "reset") {
    const password = String(body.password || "");
    if (password.length < 12) return reply({ error: "Temporary passwords must be at least 12 characters." }, 400, origin);
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
    if (error) return reply({ error: error.message }, 400, origin);
    await admin.from("staff_profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", target.id);
  } else if (action === "deactivate" || action === "activate") {
    const active = action === "activate";
    const { error } = await admin.from("staff_profiles")
      .update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", target.id);
    if (error) return reply({ error: error.message }, 400, origin);
    await admin.auth.admin.updateUserById(target.user_id, { ban_duration: active ? "none" : "876000h" });
  } else {
    return reply({ error: "Unknown staff administration action." }, 400, origin);
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_role: "manager", action: "staff_" + action,
    entity_type: "staff_profile", entity_id: target.id, details: {},
  });
  return reply({ ok: true }, 200, origin);
});
