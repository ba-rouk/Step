import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")!, serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return json({error:"Authentication required"},401);
  const {data:{user},error:userError}=await admin.auth.getUser(token);
  if(userError||!user)return json({error:"Invalid session"},401);
  const {data:actor}=await admin.from("staff_profiles").select("role,is_active").eq("user_id",user.id).maybeSingle();
  if(!actor?.is_active||actor.role!=="manager")return json({error:"Manager access required"},403);
  const body=await req.json().catch(()=>null);
  if(!body||!["create","reset_password","deactivate","activate"].includes(body.action))return json({error:"Invalid action"},400);
  if(body.action==="create"){
    const role=body.role;
    if(!["accountant","cashier"].includes(role))return json({error:"Manager can create Accountant or Cashier accounts only"},400);
    if(!body.email||!body.password||String(body.password).length<12||!body.full_name)return json({error:"Name, email and a password of at least 12 characters are required"},400);
    let reportsTo=user.id;
    if(role==="cashier"){
      const {data:accountant}=await admin.from("staff_profiles").select("user_id").eq("user_id",body.reports_to).eq("role","accountant").eq("is_active",true).maybeSingle();
      if(!accountant)return json({error:"A Cashier must report to an active Accountant"},400);
      reportsTo=accountant.user_id;
    }
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:String(body.email).trim().toLowerCase(),password:String(body.password),email_confirm:true,user_metadata:{full_name:String(body.full_name).slice(0,100)}});
    if(createError)return json({error:createError.message},400);
    const {error:profileError}=await admin.from("staff_profiles").insert({user_id:created.user.id,full_name:String(body.full_name).slice(0,100),email:String(body.email).trim().toLowerCase(),role,reports_to:reportsTo,is_active:true,must_change_password:true,created_by:user.id});
    if(profileError){await admin.auth.admin.deleteUser(created.user.id);return json({error:"Profile creation failed: "+profileError.message},500);}
    await admin.from("audit_log").insert({actor_id:user.id,actor_role:"manager",action:"staff_created",entity_type:"staff_profile",entity_id:created.user.id,details:{role,email:body.email}});
    return json({ok:true,user_id:created.user.id});
  }
  const target=String(body.user_id||"");
  const {data:staff}=await admin.from("staff_profiles").select("user_id,role").eq("user_id",target).maybeSingle();
  if(!staff||staff.role==="manager")return json({error:"Target staff account not found or cannot be managed"},404);
  if(body.action==="reset_password"){
    if(String(body.password||"").length<12)return json({error:"New password must be at least 12 characters"},400);
    const {error}=await admin.auth.admin.updateUserById(target,{password:String(body.password)});
    if(error)return json({error:error.message},400);
    await admin.from("staff_profiles").update({must_change_password:true}).eq("user_id",target);
  }else{
    const active=body.action==="activate";
    await admin.from("staff_profiles").update({is_active:active}).eq("user_id",target);
    if(!active)await admin.auth.admin.updateUserById(target,{ban_duration:"876000h"});
    else await admin.auth.admin.updateUserById(target,{ban_duration:"none"});
  }
  await admin.from("audit_log").insert({actor_id:user.id,actor_role:"manager",action:"staff_"+body.action,entity_type:"staff_profile",entity_id:target,details:{}});
  return json({ok:true});
});
