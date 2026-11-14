import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function hash(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",pepper=Deno.env.get("LOGIN_CODE_PEPPER")||"";
  if(!url||!key||pepper.length<32)return json({error:"Login code service is not configured"},503);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const body=await req.json().catch(()=>({}));
  const email=String(body.email||"").trim().toLowerCase(),code=String(body.code||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{6}$/.test(code))return json({error:"That code is invalid or expired."},400);
  const ip=String(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",").at(-1)!.trim();
  const ipHash=await hash("ip:"+ip);
  const {data:row,error}=await db.from("login_codes").select("id,code_hash,expires_at,attempts,consumed_at").eq("email",email).is("consumed_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error||!row||row.consumed_at||new Date(row.expires_at).getTime()<Date.now()||Number(row.attempts)>=5){
    await db.from("email_verification_events").insert({email_normalized:email,event_type:"code_rejected",ip_hash:ipHash,details:{reason:"missing_expired_or_locked"}});
    return json({error:"That code is invalid or expired."},400);
  }
  const candidate=await hash(pepper+":"+email+":"+code);
  if(candidate!==row.code_hash){
    const attempts=Number(row.attempts)+1;
    await db.from("login_codes").update({attempts,consumed_at:attempts>=5?new Date().toISOString():null}).eq("id",row.id);
    await db.from("email_verification_events").insert({email_normalized:email,event_type:attempts>=5?"code_locked":"code_invalid",ip_hash:ipHash,details:{attempts}});
    return json({error:attempts>=5?"Too many incorrect codes. Request a new code.":"That code is invalid or expired."},400);
  }
  await db.from("login_codes").update({consumed_at:new Date().toISOString()}).eq("id",row.id);
  let user:any=null;
  for(let page=1;page<=100&&!user;page++){
    const {data:list,error:listError}=await db.auth.admin.listUsers({page,perPage:1000});
    if(listError)throw listError;
    const users=list.users||[];
    user=users.find((u:any)=>String(u.email||"").toLowerCase()===email)||null;
    if(users.length<1000)break;
  }
  if(!user){
    const created=await db.auth.admin.createUser({email,email_confirm:true,password:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join(""),user_metadata:{email_verified_via_code:true}});
    if(created.error)throw created.error;
    user=created.data.user;
  }else{
    const updated=await db.auth.admin.updateUserById(user.id,{email_confirm:true});
    if(updated.error)throw updated.error;
    user=updated.data.user||user;
  }
  const generated=await db.auth.admin.generateLink({type:"magiclink",email});
  if(generated.error)throw generated.error;
  const tokenHash=(generated.data as any)?.properties?.hashed_token;
  if(!tokenHash)throw new Error("Could not create a secure sign-in session.");
  const verified=await db.auth.verifyOtp({token_hash:tokenHash,type:"magiclink"});
  if(verified.error||!verified.data.session)throw verified.error||new Error("Could not complete sign-in.");
  await db.from("customer_profiles").upsert({user_id:user.id,email_verified_at:new Date().toISOString()},{onConflict:"user_id"});
  const claimed=await db.from("store_orders").update({user_id:user.id,customer_id:user.id})
    .eq("customer_email_normalized",email).is("user_id",null).is("customer_id",null);
  if(claimed.error)console.error("Verified email order claim deferred",claimed.error);
  await db.from("email_verification_events").insert({email_normalized:email,event_type:"email_verified_login",user_id:user.id,ip_hash:ipHash});
  return json({authenticated:true,session:verified.data.session,user:{id:user.id,email}});
});
