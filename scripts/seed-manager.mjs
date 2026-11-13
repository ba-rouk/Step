import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MANAGER_EMAIL", "MANAGER_PASSWORD", "MANAGER_NAME"];
for (const key of required) {
  if (!process.env[key]) throw new Error("Missing required environment variable: " + key);
}
const password = process.env.MANAGER_PASSWORD;
if (password.length < 14) throw new Error("MANAGER_PASSWORD must be at least 14 characters.");

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: managers, error: managerError } = await admin
  .from("staff_profiles")
  .select("id,email,is_active")
  .eq("role", "manager")
  .limit(1);
if (managerError) throw managerError;
if (managers?.length) {
  throw new Error("A Manager profile already exists. This seed is one-time and will not create another Manager.");
}

const email = process.env.MANAGER_EMAIL.trim().toLowerCase();
const fullName = process.env.MANAGER_NAME.trim();
const phone = process.env.MANAGER_PHONE?.trim() || null;
if (!email.includes("@") || fullName.length < 2) throw new Error("MANAGER_EMAIL or MANAGER_NAME is invalid.");

const { data: authData, error: authError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
  app_metadata: { staff: true, staff_role: "manager" },
});
if (authError || !authData.user) throw authError || new Error("Could not create Manager auth user.");

const { data: profile, error: profileError } = await admin.from("staff_profiles").insert({
  user_id: authData.user.id,
  full_name: fullName,
  email,
  phone,
  role: "manager",
  reports_to: null,
  is_active: true,
  must_change_password: true,
}).select("id,email,role").single();

if (profileError) {
  await admin.auth.admin.deleteUser(authData.user.id);
  throw profileError;
}

console.log("First Manager created:", profile);
console.log("Sign in at https://steptown.onrender.com/staff/login");
console.log("The Manager must change the temporary password on first login. Keep this password private.");
