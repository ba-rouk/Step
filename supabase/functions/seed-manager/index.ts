import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

Deno.serve(async req=>{
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  const email=Deno.env.get("SEED_MANAGER_EMAIL"),password=Deno.env.get("SEED_MANAGER_PASSWORD"),name=Deno.env.get("SEED_MANAGER_NAME")||"Step Town Manager";
  if(!email||!password||password.length<16)return Response.json({error:"Set SEED_MANAGER_EMAIL and a SEED_MANAGER_PASSWORD of at least 16 characters."},{status:400});
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{autoRefreshToken:false,persistSession:false}});
  const {count,error:countError}=await supabase.from("staff_profiles").select("*",{count:"exact",head:true}).eq("role","manager");
  if(countError)return Response.json({error:countError.message},{status:500});
  if((count||0)>0)return Response.json({error:"A Manager already exists. Seed is one-time only."},{status:409});
  const {data,error}=await supabase.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
  if(error)return Response.json({error:error.message},{status:400});
  const {error:profileError}=await supabase.from("staff_profiles").insert({user_id:data.user.id,full_name:name,email,role:"manager",is_active:true,must_change_password:true});
  if(profileError){await supabase.auth.admin.deleteUser(data.user.id);return Response.json({error:profileError.message},{status:500});}
  return Response.json({ok:true,user_id:data.user.id,message:"Manager seeded. Remove seed credentials from function secrets now."});
});
