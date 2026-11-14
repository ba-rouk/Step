import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function hash(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",pepper=Deno.env.get("LOGIN_CODE_PEPPER")||"";
  if(!url||!key||pepper.length<32)return json({error:"Login code service is not configured"},503);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const body=await req.json().catch(()=>({}));
  const email=String(body.email||"").trim().toLowerCase();
  if(email.length<5||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({message:"If the address can receive mail, a sign-in code will be sent shortly."});
  const ip=String(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",").at(-1)!.trim();
  const emailHash=await hash("email:"+email),ipHash=await hash("ip:"+ip);
  const [emailLimit,ipLimit]=await Promise.all([
    db.rpc("consume_step_order_rate_limit",{p_bucket_key:"login-email:"+emailHash,p_max_hits:3,p_window_seconds:3600}),
    db.rpc("consume_step_order_rate_limit",{p_bucket_key:"login-ip:"+ipHash,p_max_hits:3,p_window_seconds:3600})
  ]);
  await db.from("email_verification_events").insert({email_normalized:email,event_type:"code_requested",ip_hash:ipHash});
  if(emailLimit.error||ipLimit.error||!emailLimit.data||!ipLimit.data)return json({message:"If the address can receive mail, a sign-in code will be sent shortly."});
  await db.from("login_codes").update({consumed_at:new Date().toISOString()}).eq("email",email).is("consumed_at",null);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
  const codeHash=await hash(pepper+":"+email+":"+code);
  const {error}=await db.from("login_codes").insert({email,code_hash:codeHash,expires_at:new Date(Date.now()+10*60*1000).toISOString(),attempts:0,ip_hash:ipHash});
  if(error){console.error("Could not store login code",error);return json({message:"If the address can receive mail, a sign-in code will be sent shortly."});}
  const queued=await db.from("email_outbox").insert({recipient:email,template_key:"login_code",payload:{code}});
  if(queued.error){console.error("Could not queue login code",queued.error);return json({message:"If the address can receive mail, a sign-in code will be sent shortly."});}
  const outboxSecret=Deno.env.get("EMAIL_OUTBOX_SECRET")||"";
  if(outboxSecret){
    try{await fetch(url+"/functions/v1/process-email-outbox",{method:"POST",headers:{Authorization:"Bearer "+outboxSecret,"Content-Type":"application/json"},body:"{}"});}catch(e){console.error("Login email queued; delivery will retry",e);}
  }
  return json({message:"If the address can receive mail, a sign-in code will be sent shortly."});
});
