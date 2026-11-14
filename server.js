import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 10000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const APP_URL = String(process.env.APP_URL || "https://steptown.onrender.com").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const KEY = SESSION_SECRET ? createHash("sha256").update(SESSION_SECRET).digest() : null;
const SESSION_COOKIE = "step_customer_session";
const CSRF_COOKIE = "step_csrf";
const OAUTH_COOKIE = "step_customer_oauth";
const PROD = process.env.NODE_ENV === "production";
const MIME = { ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".avif":"image/avif",".ico":"image/x-icon",".woff2":"font/woff2",".mp4":"video/mp4",".webm":"video/webm",".webmanifest":"application/manifest+json" };
const limits = new Map();
const catalogCache = new Map();
const CATALOG_TTL_MS = 30000;

function sendJson(res,status,data,extra={}) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...extra});
  res.end(JSON.stringify(data));
}
function cookies(req) {
  const out={};
  for (const part of String(req.headers.cookie||"").split(";")) {
    const i=part.indexOf("=");
    if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function secure(req) { return PROD || req.headers["x-forwarded-proto"]==="https"; }
function cookie(name,value,req,opts={}) {
  const p=[name+"="+encodeURIComponent(value),"Path=/","SameSite="+(opts.sameSite||"Lax")];
  if(opts.httpOnly) p.push("HttpOnly");
  if(secure(req)) p.push("Secure");
  if(opts.maxAge!==undefined) p.push("Max-Age="+opts.maxAge);
  return p.join("; ");
}
function appendCookie(res,value) {
  const existing=res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie",existing?[...(Array.isArray(existing)?existing:[existing]),value]:[value]);
}
function clearCookie(name,req,httpOnly=true) { return cookie(name,"",req,{httpOnly,maxAge:0}); }
function seal(value) {
  if(!KEY) throw new Error("SESSION_SECRET is not configured.");
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",KEY,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString("base64url");
}
function unseal(value) {
  if(!KEY||!value) return null;
  try {
    const b=Buffer.from(value,"base64url");
    if(b.length<30) return null;
    const d=createDecipheriv("aes-256-gcm",KEY,b.subarray(0,12));
    d.setAuthTag(b.subarray(12,28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString("utf8"));
  } catch { return null; }
}
function setSession(res,req,s) {
  appendCookie(res,cookie(SESSION_COOKIE,seal({
    access_token:s.access_token,refresh_token:s.refresh_token,
    expires_at:Number(s.expires_at||Date.now()/1000+Number(s.expires_in||3600))
  }),req,{httpOnly:true,maxAge:2592000}));
}
function clearSession(res,req) {
  appendCookie(res,clearCookie(SESSION_COOKIE,req,true));
  appendCookie(res,clearCookie(OAUTH_COOKIE,req,true));
}
function origin(req) {
  return (secure(req)?"https":"http")+"://"+(req.headers.host||"localhost");
}
function isSameOrigin(req) {
  if(!req.headers.origin) return true;
  try { return new URL(req.headers.origin).origin===origin(req); } catch { return false; }
}
function safeNext(v) {
  if(typeof v!=="string"||!v.startsWith("/")||v.startsWith("//")||v.includes("\\")||/[\u0000-\u001f]/.test(v)) return "/profile";
  try {
    const u=new URL(v,"https://step-town.invalid");
    if(u.origin!=="https://step-town.invalid"||u.pathname.startsWith("/staff")) return "/profile";
    return u.pathname+u.search+u.hash;
  } catch { return "/profile"; }
}
function csrfValid(req) {
  const a=req.headers["x-csrf-token"], b=cookies(req)[CSRF_COOKIE];
  if(typeof a!=="string"||typeof b!=="string"||!isSameOrigin(req)) return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function rateLimitIdentity(identity,max,windowMs=900000) {
  const key=String(identity), now=Date.now(), bucket=limits.get(key);
  if(!bucket||bucket.reset<=now){limits.set(key,{count:1,reset:now+windowMs});return true;}
  bucket.count++;
  return bucket.count<=max;
}
function rateLimit(req,name,max,windowMs=900000) {
  const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").split(",")[0].trim();
  return rateLimitIdentity(name+":"+ip,max,windowMs);
}
async function body(req,max=32768) {
  const chunks=[];let size=0;
  for await(const part of req){size+=part.length;if(size>max)throw Object.assign(new Error("Request body is too large."),{status:413});chunks.push(part);}
  const text=Buffer.concat(chunks).toString("utf8");
  if(!text)return {};
  try{return JSON.parse(text);}catch{throw Object.assign(new Error("Invalid JSON body."),{status:400});}
}
function phoneNumber(v) {
  let p=String(v||"").trim().replace(/[()\s.-]/g,"");
  if(/^0\d{8,10}$/.test(p))p="+250"+p.slice(1);
  else if(/^250\d{8,12}$/.test(p))p="+"+p;
  return /^\+[1-9]\d{7,14}$/.test(p)?p:null;
}
async function sb(endpoint,opts={}) {
  if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error("Supabase server configuration is missing.");
  const r=await fetch(SUPABASE_URL+endpoint,{
    method:opts.method||"GET",
    headers:{apikey:SUPABASE_KEY,...(opts.access?{Authorization:"Bearer "+opts.access}:{}),...(opts.body!==undefined?{"Content-Type":"application/json"}:{}),...(opts.headers||{})},
    ...(opts.body!==undefined?{body:JSON.stringify(opts.body)}:{})
  });
  const txt=await r.text();let data={};try{data=txt?JSON.parse(txt):{};}catch{data={message:txt};}
  if(!r.ok){const e=new Error(data.msg||data.message||data.error_description||data.error||"Supabase request failed.");e.status=r.status;throw e;}
  return data;
}
async function currentUser(req,res) {
  const saved=unseal(cookies(req)[SESSION_COOKIE]);
  if(!saved?.access_token||!saved?.refresh_token)return null;
  let session=saved;
  if(Number(saved.expires_at||0)<Date.now()/1000+90){
    try{session=await sb("/auth/v1/token?grant_type=refresh_token",{method:"POST",body:{refresh_token:saved.refresh_token}});setSession(res,req,session);}
    catch{clearSession(res,req);return null;}
  }
  try{return {session,user:await sb("/auth/v1/user",{access:session.access_token})};}
  catch{clearSession(res,req);return null;}
}
async function profileUpsert(session,user,name,phone) {
  try {
    await sb("/rest/v1/customer_profiles?on_conflict=user_id",{
      method:"POST",access:session.access_token,
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:{user_id:user.id,full_name:String(name||user.user_metadata?.full_name||user.user_metadata?.name||"").trim(),phone:phone||user.phone||null}
    });
  } catch(e) { console.warn("Customer profile sync:",e.message); }
}
function configured(){return Boolean(KEY&&SUPABASE_URL&&SUPABASE_KEY);}
async function readPublicCatalog({limit=12,offset=0,categorySlug="",productSlug="",search=""}={}) {
  const safeLimit=Math.min(24,Math.max(1,Number(limit)||12));
  const safeOffset=Math.max(0,Number(offset)||0);
  const term=String(search||"").trim().slice(0,80).replace(/[(),]/g," ").replace(/\s+/g," ").trim();
  const cacheable=!safeOffset&&!categorySlug&&!productSlug&&!term;
  const cacheKey=[safeLimit,safeOffset,categorySlug,productSlug,term].join("|");
  const cached=catalogCache.get(cacheKey);
  if(cacheable&&cached&&cached.expires>Date.now())return cached.value;
  const select="id,slug,category_id,name,description,price,price_unit,price_unit_label,image_url,image_urls,sort_order,is_available,is_visible,category:store_categories(id,name,slug,description,cover_image_url,sort_order),images:product_images(id,product_id,url,position,alt_text,variants)";
  const params=new URLSearchParams({
    select,
    is_available:"eq.true",
    is_visible:"eq.true",
    order:"sort_order.asc,created_at.desc",
    limit:String(safeLimit),
    offset:String(safeOffset)
  });
  if(categorySlug)params.set("category.slug","eq."+categorySlug);
  if(productSlug)params.set("slug","eq."+productSlug);
  if(term)params.set("or","(name.ilike.*"+term+"*,description.ilike.*"+term+"*)");
  const [rows,categories]=await Promise.all([
    sb("/rest/v1/store_products?"+params.toString()),
    sb("/rest/v1/store_categories?select=id,name,slug,description,cover_image_url,sort_order&is_active=eq.true&order=sort_order.asc")
  ]);
  const products=(rows||[]).map(product=>{
    const category=product.category||null;
    const images=Array.isArray(product.images)?product.images.slice().sort((a,b)=>Number(a.position||0)-Number(b.position||0)):[];
    return {...product,category_name:category?.name||"Menu",category_slug:category?.slug||"",images};
  });
  const value={products,categories:categories||[],offset:safeOffset,nextOffset:safeOffset+products.length,hasMore:products.length===safeLimit};
  if(cacheable)catalogCache.set(cacheKey,{value,expires:Date.now()+CATALOG_TTL_MS});
  return value;
}
async function authRoutes(req,res,url) {
  if(!csrfValid(req))return sendJson(res,403,{error:"Your security check expired. Refresh and try again."});
  if(!configured())return sendJson(res,503,{error:"Customer sign-in is not configured on the server."});
  const route=url.pathname;
  if(route==="/api/auth/register"){
    if(!rateLimit(req,"register",5))return sendJson(res,429,{error:"Too many registration attempts. Try again in 15 minutes."});
    const b=await body(req),name=String(b.name||"").trim(),phone=phoneNumber(b.phone),password=String(b.password||"");
    if(name.length<2||name.length>120)return sendJson(res,400,{error:"Enter your full name (2–120 characters)."});
    if(!phone)return sendJson(res,400,{error:"Enter a valid phone number with country code, for example +250780382589."});
    if(password.length<10||password.length>128)return sendJson(res,400,{error:"Use a password between 10 and 128 characters."});
    try{
      const result=await sb("/auth/v1/signup",{method:"POST",body:{phone,password,data:{full_name:name,name,phone}}});
      if(result.session?.access_token){
        setSession(res,req,result.session);await profileUpsert(result.session,result.user,name,phone);
        return sendJson(res,201,{authenticated:true,next:safeNext(b.next)});
      }
      return sendJson(res,202,{requiresVerification:true,phone,message:"A verification code was sent to your phone. Enter it below to finish registration."});
    }catch(e){return sendJson(res,e.status&&e.status<500?400:502,{error:e.message});}
  }
  if(route==="/api/auth/verify"){
    if(!rateLimit(req,"verify",8))return sendJson(res,429,{error:"Too many verification attempts. Request a new code later."});
    const b=await body(req),phone=phoneNumber(b.phone),token=String(b.token||"").trim();
    if(!phone||!/^\d{6,8}$/.test(token))return sendJson(res,400,{error:"Enter the phone number and verification code."});
    try{
      const session=await sb("/auth/v1/verify",{method:"POST",body:{phone,token,type:"sms"}});
      if(!session.access_token||!session.user)return sendJson(res,400,{error:"The verification code could not be confirmed."});
      setSession(res,req,session);await profileUpsert(session,session.user,b.name,phone);
      return sendJson(res,200,{authenticated:true,next:safeNext(b.next)});
    }catch(e){return sendJson(res,e.status&&e.status<500?400:502,{error:e.message});}
  }
  if(route==="/api/auth/login"){
    if(!rateLimit(req,"login",10))return sendJson(res,429,{error:"Too many sign-in attempts. Try again in 15 minutes."});
    const b=await body(req),identifier=String(b.phone||b.email||"").trim(),password=String(b.password||"");
    const emailLogin=identifier.includes("@")&&identifier.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const phone=phoneNumber(identifier);
    if((!emailLogin&&!phone)||!password||password.length>128)return sendJson(res,400,{error:"Enter a valid phone number or email address and password."});
    try{
      const credentials=emailLogin?{email:identifier.toLowerCase(),password}:{phone,password};
      const session=await sb("/auth/v1/token?grant_type=password",{method:"POST",body:credentials});
      if(!session.access_token||!session.user)return sendJson(res,401,{error:"The phone number/email or password is incorrect."});
      setSession(res,req,session);if(phone)await profileUpsert(session,session.user,session.user.user_metadata?.full_name,phone);
      return sendJson(res,200,{authenticated:true,next:safeNext(b.next)});
    }catch(e){return sendJson(res,e.status&&e.status<500?401:502,{error:e.status===400?"The phone number/email or password is incorrect.":e.message});}
  }
  if(route==="/api/auth/logout"){
    const current=await currentUser(req,res);
    if(current?.session?.access_token){
      try{await sb("/auth/v1/logout",{method:"POST",access:current.session.access_token});}catch(e){console.warn("Session revoke:",e.message);}
    }
    appendCookie(res,clearCookie(SESSION_COOKIE,req,true));
    return sendJson(res,200,{authenticated:false});
  }
  return sendJson(res,404,{error:"Authentication endpoint not found."});
}
async function oauthStart(req,res,url) {
  if(!configured())return res.writeHead(303,{Location:"/login?error=unavailable"}).end();
  if(!isSameOrigin(req))return res.writeHead(303,{Location:"/login?error=origin"}).end();
  const verifier=randomBytes(48).toString("base64url"),challenge=createHash("sha256").update(verifier).digest("base64url");
  appendCookie(res,cookie(OAUTH_COOKIE,seal({verifier,next:safeNext(url.searchParams.get("next")||"/profile"),created:Date.now()}),req,{httpOnly:true,maxAge:600}));
  const u=new URL(SUPABASE_URL+"/auth/v1/authorize");
  u.searchParams.set("provider","google");u.searchParams.set("redirect_to",APP_URL+"/auth/callback");
  u.searchParams.set("code_challenge",challenge);u.searchParams.set("code_challenge_method","s256");
  res.writeHead(303,{Location:u.toString(),"Cache-Control":"no-store"}).end();
}
async function oauthCallback(req,res,url) {
  const saved=unseal(cookies(req)[OAUTH_COOKIE]),code=url.searchParams.get("code");
  if(!saved||!code||Date.now()-Number(saved.created||0)>600000){
    clearSession(res,req);return res.writeHead(303,{Location:"/login?error=oauth"}).end();
  }
  try{
    const session=await sb("/auth/v1/token?grant_type=pkce",{method:"POST",body:{auth_code:code,code_verifier:saved.verifier}});
    if(!session.access_token||!session.user)throw new Error("Google sign-in could not be completed.");
    setSession(res,req,session);await profileUpsert(session,session.user,session.user.user_metadata?.full_name,null);
    appendCookie(res,clearCookie(OAUTH_COOKIE,req,true));
    res.writeHead(303,{Location:safeNext(saved.next),"Cache-Control":"no-store"}).end();
  }catch(e){
    appendCookie(res,clearCookie(OAUTH_COOKIE,req,true));
    res.writeHead(303,{Location:"/login?error="+encodeURIComponent(e.message||"oauth")}).end();
  }
}
async function api(req,res,url) {
  const route=url.pathname;
  if(req.method==="GET"&&route==="/api/csrf"){
    const token=randomBytes(32).toString("base64url");
    appendCookie(res,cookie(CSRF_COOKIE,token,req,{httpOnly:false,maxAge:28800,sameSite:"Strict"}));
    return sendJson(res,200,{csrfToken:token});
  }
  if(["POST","PUT","PATCH","DELETE"].includes(req.method)&&route.startsWith("/api/")&&!csrfValid(req))
    return sendJson(res,403,{error:"Your security check expired. Refresh and try again."});
  if(req.method==="GET"&&route==="/api/catalog"){
    try{
      const catalog=await readPublicCatalog({
        limit:url.searchParams.get("limit")||12,
        offset:url.searchParams.get("offset")||0,
        categorySlug:url.searchParams.get("category")||"",
        productSlug:url.searchParams.get("product")||"",
        search:url.searchParams.get("search")||""
      });
      return sendJson(res,200,catalog,{"Cache-Control":"public, max-age=15, s-maxage=30, stale-while-revalidate=120","CDN-Cache-Control":"public, max-age=30, stale-while-revalidate=120","Vary":"Accept-Encoding"});
    }catch(e){console.error("Public catalogue:",e.message);return sendJson(res,e.status||502,{error:"The menu could not be loaded."});}
  }
  if(req.method==="POST"&&route==="/api/catalog/invalidate"){
    catalogCache.clear();
    return sendJson(res,200,{ok:true});
  }
  if(req.method==="GET"&&route==="/api/cart"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Sign in to view your saved cart."});
    try{
      const rows=await sb("/rest/v1/customer_cart_items?select=product_id,quantity,product:store_products(id,slug,name,description,price,price_unit,price_unit_label,image_url,image_urls,category:store_categories(name,slug),images:product_images(url,position,alt_text,variants))&user_id=eq."+encodeURIComponent(current.user.id)+"&order=updated_at.desc",{access:current.session.access_token});
      const items=(rows||[]).filter(row=>row.product).map(row=>({...row.product,quantity:Number(row.quantity||1),category_name:row.product.category?.name||"Menu",category_slug:row.product.category?.slug||"",images:row.product.images||[]}));
      return sendJson(res,200,{items});
    }catch(e){return sendJson(res,e.status||502,{error:"Your saved cart could not be loaded."});}
  }
  if(req.method==="PUT"&&route==="/api/cart"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Sign in to save your cart."});
    const b=await body(req,12000),incoming=Array.isArray(b.items)?b.items:[];
    if(incoming.length>50)return sendJson(res,400,{error:"Your cart is too large."});
    const merged=new Map();
    for(const item of incoming){
      const id=String(item.product_id||"");
      const quantity=Number(item.quantity);
      if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(quantity)||quantity<1||quantity>20)
        return sendJson(res,400,{error:"A saved cart item is invalid."});
      merged.set(id,Math.min(20,(merged.get(id)||0)+quantity));
    }
    try{
      await sb("/rest/v1/customer_cart_items?user_id=eq."+encodeURIComponent(current.user.id),{method:"DELETE",access:current.session.access_token,headers:{Prefer:"return=minimal"}});
      const rows=[...merged].map(([product_id,quantity])=>({user_id:current.user.id,product_id,quantity,updated_at:new Date().toISOString()}));
      if(rows.length)await sb("/rest/v1/customer_cart_items",{method:"POST",access:current.session.access_token,body:rows,headers:{Prefer:"return=minimal"}});
      return sendJson(res,200,{ok:true,count:rows.length});
    }catch(e){return sendJson(res,e.status||502,{error:"Your saved cart could not be updated."});}
  }
  if(req.method==="GET"&&route==="/api/session"){
    if(!configured())return sendJson(res,503,{error:"Customer sign-in is not configured on the server."});
    const current=await currentUser(req,res);return sendJson(res,200,{authenticated:Boolean(current),user:current?.user||null});
  }
  if(req.method==="POST"&&route.startsWith("/api/auth/"))return authRoutes(req,res,url);

  if(req.method==="GET"&&route==="/api/profile/favourites"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Please sign in to view favourites."});
    try{
      const rows=await sb("/rest/v1/customer_favourites?select=product_id&user_id=eq."+encodeURIComponent(current.user.id),{access:current.session.access_token});
      return sendJson(res,200,{product_ids:(rows||[]).map(row=>row.product_id)});
    }catch(e){return sendJson(res,e.status||502,{error:"Favourites could not be loaded."});}
  }
  if(req.method==="PUT"&&route==="/api/profile/favourites"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Please sign in to sync favourites."});
    const b=await body(req),ids=Array.isArray(b.product_ids)?[...new Set(b.product_ids.map(String))]:[];
    if(ids.length>200||ids.some(id=>! /^[0-9a-f-]{36}$/i.test(id)))return sendJson(res,400,{error:"The favourites list is invalid."});
    try{
      await sb("/rest/v1/customer_favourites?user_id=eq."+encodeURIComponent(current.user.id),{method:"DELETE",access:current.session.access_token,headers:{Prefer:"return=minimal"}});
      if(ids.length)await sb("/rest/v1/customer_favourites",{method:"POST",access:current.session.access_token,body:ids.map(product_id=>({user_id:current.user.id,product_id})),headers:{Prefer:"return=minimal"}});
      return sendJson(res,200,{ok:true,count:ids.length});
    }catch(e){return sendJson(res,e.status||502,{error:"Favourites could not be synced."});}
  }
  if(req.method==="GET"&&(route==="/api/profile"||route==="/api/profile/orders")){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Please sign in to view your account."});
    try{
      if(route==="/api/profile"){
        const rows=await sb("/rest/v1/customer_profiles?select=user_id,full_name,phone,created_at&user_id=eq."+encodeURIComponent(current.user.id)+"&limit=1",{access:current.session.access_token});
        return sendJson(res,200,{user:current.user,profile:rows[0]||null});
      }
      const orders=await sb("/rest/v1/store_orders?select=id,order_number,status,created_at,requested_date,requested_time,fulfillment,items,order_description,estimated_total,price_needs_confirmation&customer_id=eq."+encodeURIComponent(current.user.id)+"&order=created_at.desc&limit=50",{access:current.session.access_token});
      return sendJson(res,200,{orders:orders||[]});
    }catch(e){return sendJson(res,e.status||502,{error:"Your account data could not be loaded."});}
  }

  if(req.method==="POST"&&route==="/api/orders"){
    if(!rateLimit(req,"orders-ip",8))return sendJson(res,429,{error:"Too many order requests. Please try again later."});
    const b=await body(req,18000);
    // Quietly discard automated submissions that trip the off-screen honeypot.
    if(String(b.website||"").trim())return sendJson(res,202,{accepted:true});
    const current=await currentUser(req,res);
    const name=String(b.customer_name||current?.user?.user_metadata?.full_name||"").trim();
    const phone=phoneNumber(b.customer_phone||current?.user?.phone);
    const email=String(b.customer_email||current?.user?.email||"").trim();
    const fulfillment=String(b.fulfillment||"pickup");
    const description=String(b.order_description||"").trim();
    const notes=String(b.notes||"").trim();
    const location=String(b.delivery_location||"").trim();
    const incoming=Array.isArray(b.items)?b.items:[];
    if(name.length<2||name.length>120)return sendJson(res,400,{error:"Enter your name (2–120 characters)."});
    if(!phone)return sendJson(res,400,{error:"Enter a valid phone number, including +250."});
    if(!rateLimitIdentity("orders-phone:"+phone,4))return sendJson(res,429,{error:"Too many order requests were sent from this phone number. Please try again later."});
    if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return sendJson(res,400,{error:"Enter a valid email address or leave it blank."});
    if(!["pickup","delivery"].includes(fulfillment))return sendJson(res,400,{error:"Choose pickup or delivery."});
    if(fulfillment==="delivery"&&(location.length<3||location.length>180))return sendJson(res,400,{error:"Add the delivery location so the team knows where to bring your order."});
    if(fulfillment==="pickup"&&location.length>180)return sendJson(res,400,{error:"Keep the pickup location note under 180 characters."});
    if(description.length>4000||notes.length>1500)return sendJson(res,400,{error:"Your order description or notes are too long."});
    if(!incoming.length||incoming.length>50)return sendJson(res,400,{error:"Choose at least one product before sending the order."});
    const quantities=new Map();
    for(const item of incoming){
      const id=String(item.product_id||"");
      const qty=Number(item.quantity);
      if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(qty)||qty<1||qty>20)
        return sendJson(res,400,{error:"A product or quantity is invalid. Refresh the menu and try again."});
      quantities.set(id,Math.min(20,(quantities.get(id)||0)+qty));
    }
    const ids=[...quantities.keys()];
    try{
      const products=await sb("/rest/v1/store_products?select=id,category_id,name,description,price,price_unit,price_unit_label&is_available=eq.true&is_visible=eq.true&id=in.("+ids.join(",")+")",current?.session?.access_token?{access:current.session.access_token}:{});
      if(products.length!==ids.length)return sendJson(res,400,{error:"One or more selected products are no longer available. Refresh the menu and try again."});
      const catIds=[...new Set(products.map(p=>p.category_id))];
      const cats=catIds.length?await sb("/rest/v1/store_categories?select=id,name,slug&id=in.("+catIds.join(",")+")"):[];
      const names=new Map((cats||[]).map(c=>[c.id,c.name]));
      let priced=true,total=0;
      const clean=products.map(p=>{
        const quantity=quantities.get(p.id),unitPrice=p.price==null?null:Number(p.price);
        if(!Number.isFinite(unitPrice))priced=false;else total+=unitPrice*quantity;
        return {product_id:p.id,name:p.name,description:p.description||"",category:names.get(p.category_id)||"Menu",quantity,price_unit:p.price_unit||"unit",price_unit_label:p.price_unit_label||p.price_unit||"unit",unit_price:unitPrice,line_total:unitPrice==null?null:unitPrice*quantity};
      });
      const date=b.requested_date?String(b.requested_date):null;
      const time=b.requested_time?String(b.requested_time):null;
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{error:"Choose a valid preferred date."});
      if(time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))return sendJson(res,400,{error:"Choose a valid preferred time."});
      const order={
        customer_id:current?.user?.id||null,
        customer_name:name,customer_phone:phone,customer_email:email||null,
        fulfillment,requested_date:date,requested_time:time,
        delivery_location:location||null,order_description:description||null,notes:notes||null,
        items:clean,estimated_total:priced?total:null,price_needs_confirmation:!priced
      };
      const rows=await sb("/rest/v1/store_orders?select=id,order_number,estimated_total,created_at",{method:"POST",...(current?.session?.access_token?{access:current.session.access_token}:{}),body:order,headers:{Prefer:"return=representation"}});
      const saved=rows[0];
      if(saved?.id){
        try{
          const headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"};
          if(current?.session?.access_token)headers.Authorization="Bearer "+current.session.access_token;
          await fetch(SUPABASE_URL+"/functions/v1/send-order-push",{method:"POST",headers,body:JSON.stringify({order_id:saved.id})});
        }catch(e){console.warn("Order saved; staff notification failed:",e.message);}
      }
      return sendJson(res,201,{order:saved});
    }catch(e){
      console.error("Order request:",e.status||502,e.message);
      const status=e.status&&e.status<500?e.status:502;
      const cause=String(e.message||"The order database rejected the request.").replace(/[\r\n]+/g," ").slice(0,240);
      const suggestion=status===429?"Please wait before trying again.":status===502?"The order was not confirmed by the database; retry shortly or contact Step Town on WhatsApp.":"Check the required details and selected products, then retry.";
      return sendJson(res,status,{error:"Order request failed: "+cause,suggestion});
    }
  }
  return sendJson(res,404,{error:"API endpoint not found."});
}
function pageTitle(pathname){
  const titles={"/":"Food · Celebrations · Cakes","/categories":"Categories","/gallery":"Gallery","/cart":"Cart","/profile":"Profile","/profile/orders":"Order history","/login":"Customer login","/register":"Create an account"};
  if(pathname.startsWith("/categories/"))return "Menu category";
  if(pathname.startsWith("/staff"))return "Staff workspace";
  return titles[pathname]||"Food · Celebrations · Cakes";
}
// Keep staff URLs on their own HTML entry instead of falling through to the storefront.
async function staticPage(res,pathname,requestUrl=null){
  const decoded=decodeURIComponent(pathname);
  const staffRoute=decoded==="/staff"||decoded.startsWith("/staff/");
  let file=staffRoute?path.join(DIST,"staff.html"):(decoded==="/" ? path.join(DIST,"index.html") : path.resolve(DIST,"."+decoded));
  if(!staffRoute&&file!==DIST&&!file.startsWith(DIST+path.sep))return sendJson(res,400,{error:"Invalid path."});
  const requestedExt=path.extname(file).toLowerCase();
  try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,"index.html");}
  catch{
    // Never turn a missing script, stylesheet, manifest or image into index.html.
    // That fallback caused /sw.js to be served as text/html, which Chrome rejects.
    if(staffRoute){file=path.join(DIST,"staff.html");}
    else if(decoded==="/"||requestedExt===".html"||!requestedExt){file=path.join(DIST,"index.html");}
    else return sendJson(res,404,{error:"Static asset not found."});
  }
  let data;
  try{data=await fs.readFile(file);}
  catch{return sendJson(res,staffRoute?503:404,{error:staffRoute?"The staff workspace is building. Refresh shortly.":"Static asset not found."});}
  const ext=path.extname(file).toLowerCase();
  const headers={"Content-Type":MIME[ext]||"application/octet-stream","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"SAMEORIGIN","Cache-Control":ext===".html"?"no-store":"public, max-age=3600"};
  if(ext===".html"&&path.basename(file)==="index.html"){
    let html=data.toString("utf8").replace(/<title>[\s\S]*?<\/title>/i,"<title>Step Town | "+pageTitle(pathname)+"</title>");
    if(pathname==="/"||pathname==="/categories"||pathname.startsWith("/categories/")||pathname==="/cart"){
      try{
        const categorySlug=pathname.startsWith("/categories/")?pathname.split("/").filter(Boolean).at(-1):"";
        const initial=await readPublicCatalog({limit:12,offset:0,categorySlug});
        const json=JSON.stringify(initial).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
        html=html.replace("</head>",'<script id="step-town-initial-catalog" type="application/json">'+json+"</script></head>");
      }catch(error){console.warn("Initial menu HTML cache unavailable:",error.message);}
    }
    data=Buffer.from(html);
  }
  res.writeHead(200,headers);res.end(data);
}
async function handle(req,res){
  const url=new URL(req.url||"/",origin(req)),route=decodeURIComponent(url.pathname);
  if(req.method==="GET"&&route==="/categories/wedding-cakes"){res.writeHead(301,{Location:"/categories/cake","Cache-Control":"public, max-age=86400"});return res.end();}
  if(req.method==="GET"&&route.startsWith("/product/")){const legacySlug=route.slice("/product/".length).split("/")[0];res.writeHead(301,{Location:"/cart?product="+encodeURIComponent(legacySlug),"Cache-Control":"public, max-age=86400"});return res.end();}
  if(req.method==="GET"&&route==="/api/auth/google")return oauthStart(req,res,url);
  if(req.method==="GET"&&route==="/auth/callback")return oauthCallback(req,res,url);
  if(route.startsWith("/api/")){
    try{return await api(req,res,url);}
    catch(e){console.error("API:",e);return sendJson(res,e.status||500,{error:e.status===413?e.message:"The request could not be completed."});}
  }
  if(req.method==="GET"&&(route==="/profile"||route==="/profile/orders"||route==="/cart")){
    const current=await currentUser(req,res);
    const guestProductOrder=route==="/cart"&&Boolean(String(url.searchParams.get("product")||"").trim());
    if(!current&&!(route==="/cart"&&guestProductOrder)){appendCookie(res,clearCookie(SESSION_COOKIE,req,true));res.writeHead(303,{Location:"/login?next="+encodeURIComponent(route+url.search),"Cache-Control":"no-store"});return res.end();}
  }
  if(req.method==="GET"&&(route==="/login"||route==="/register")){
    const current=await currentUser(req,res);
    if(current){res.writeHead(303,{Location:"/profile","Cache-Control":"no-store"});return res.end();}
  }
  if(req.method!=="GET"&&req.method!=="HEAD")return sendJson(res,405,{error:"Method not allowed."});
  return staticPage(res,route,url);
}
if(PROD&&!KEY)console.warn("SESSION_SECRET is missing: customer login remains disabled until configured.");
const server=http.createServer((req,res)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("X-Frame-Options","SAMEORIGIN");void handle(req,res).catch(e=>{console.error("Unhandled request:",e);if(!res.headersSent)sendJson(res,500,{error:"Unexpected server error."});else res.end();});});
server.listen(PORT,"0.0.0.0",()=>console.log("Step Town server listening on "+PORT));
setInterval(()=>{const now=Date.now();for(const [key,b] of limits)if(b.reset<=now)limits.delete(key);},60000).unref();
