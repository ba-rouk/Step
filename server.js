import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CAKE_CATEGORY_LABEL } from "./src/catalog-config.js";

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
function rateLimitKey(key,max,windowMs=900000) {
  const now=Date.now(),bucket=limits.get(key);
  if(!bucket||bucket.reset<=now){limits.set(key,{count:1,reset:now+windowMs});return true;}
  bucket.count++;
  return bucket.count<=max;
}
function requestIp(req) {
  return String(req.headers["cf-connecting-ip"]||req.headers["x-real-ip"]||req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").split(",").at(-1).trim();
}
function rateLimit(req,name,max,windowMs=900000) {
  return rateLimitKey(name+":"+requestIp(req),max,windowMs);
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

const publicMenuCache = new Map();
const publicMenuInflight = new Map();
const PUBLIC_MENU_PAGE_SIZE = 12;
const PUBLIC_MENU_TTL_MS = 25000;
const PUBLIC_MENU_STALE_MS = 240000;

async function fetchPublicMenu(options={}) {
  const limit=Math.min(36,Math.max(1,Number(options.limit)||PUBLIC_MENU_PAGE_SIZE));
  const offset=Math.max(0,Number(options.offset)||0);
  const categorySlug=String(options.category||"").trim().slice(0,80);
  const productSlug=String(options.slug||"").trim().slice(0,160);
  const search=String(options.search||"").trim().slice(0,80).replace(/[\\%_*(),]/g," ");
  const categoriesPromise=sb("/rest/v1/store_categories?select=id,name,slug,description,cover_image_url,sort_order,is_active&is_active=eq.true&order=sort_order.asc");
  const params=new URLSearchParams();
  params.set("select","id,category_id,name,description,price,price_unit,price_unit_label,image_url,image_urls,sort_order,is_available,is_visible,slug,created_at,category:store_categories!store_products_category_id_fkey!inner(id,name,slug),images:product_images!product_images_product_id_fkey(id,url,public_id,position,alt_text,variants)");
  params.set("is_available","eq.true");
  params.set("is_visible","eq.true");
  if(categorySlug)params.set("category.slug","eq."+categorySlug);
  if(productSlug)params.set("slug","eq."+productSlug);
  if(search){
    if(search.toLowerCase()===CAKE_CATEGORY_LABEL.toLowerCase())params.set("category.slug","eq.cake");
    else params.set("or","(name.ilike.*"+search+"*,description.ilike.*"+search+"*)");
  }
  params.set("order","sort_order.asc,created_at.desc");
  const productsPromise=(async()=>{
    const response=await fetch(SUPABASE_URL+"/rest/v1/store_products?"+params.toString(),{
      headers:{apikey:SUPABASE_KEY,Prefer:"count=exact",Range:offset+"-"+(offset+limit-1)}
    });
    const raw=await response.text();
    let rows=[];try{rows=raw?JSON.parse(raw):[];}catch{throw new Error("The menu service returned invalid data.");}
    if(!response.ok)throw Object.assign(new Error(rows?.message||"The public menu could not be loaded."),{status:response.status});
    const countText=(response.headers.get("content-range")||"").split("/").pop();
    const total=Number(countText);
    return {rows:Array.isArray(rows)?rows:[],total:Number.isFinite(total)?total:(Array.isArray(rows)?rows.length:0)};
  })();
  const [categories,productPage]=await Promise.all([categoriesPromise,productsPromise]);
  const products=(productPage.rows||[]).map(product=>({
    ...product,
    category_name:product.category?.name||"Menu",
    images:Array.isArray(product.images)?product.images:[]
  }));
  return {categories:categories||[],products,total:productPage.total,limit,offset,hasMore:offset+products.length<productPage.total};
}
async function getPublicMenu(options={}) {
  const normalized={
    limit:Math.min(36,Math.max(1,Number(options.limit)||PUBLIC_MENU_PAGE_SIZE)),
    offset:Math.max(0,Number(options.offset)||0),
    category:String(options.category||""),
    slug:String(options.slug||""),
    search:String(options.search||"").trim().slice(0,80)
  };
  const key=JSON.stringify(normalized),now=Date.now(),cached=publicMenuCache.get(key);
  if(cached&&now<cached.expiresAt)return cached.data;
  const refresh=()=>{
    if(publicMenuInflight.has(key))return publicMenuInflight.get(key);
    const task=fetchPublicMenu(normalized).then(data=>{
      publicMenuCache.set(key,{data,expiresAt:Date.now()+PUBLIC_MENU_TTL_MS,staleUntil:Date.now()+PUBLIC_MENU_STALE_MS});
      return data;
    }).finally(()=>publicMenuInflight.delete(key));
    publicMenuInflight.set(key,task);
    return task;
  };
  if(cached){
    if(now>=cached.expiresAt)void refresh().catch(error=>console.warn("Stale menu refresh failed:",error.message));
    return cached.data;
  }
  return refresh();
}
function invalidatePublicMenu(){publicMenuCache.clear();}
function publicMenuHeaders(){
  return {
    "Cache-Control":"public, max-age=20, stale-while-revalidate=180",
    "CDN-Cache-Control":"public, s-maxage=60, stale-while-revalidate=300",
    "Surrogate-Control":"max-age=60, stale-while-revalidate=300"
  };
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
      const menu=await getPublicMenu({
        limit:url.searchParams.get("limit")||PUBLIC_MENU_PAGE_SIZE,
        offset:url.searchParams.get("offset")||0,
        category:url.searchParams.get("category")||"",
        slug:url.searchParams.get("slug")||"",
        search:url.searchParams.get("q")||""
      });
      return sendJson(res,200,menu,publicMenuHeaders());
    }catch(error){
      console.error("Public catalogue:",error.message);
      return sendJson(res,error.status||502,{error:"The menu could not be loaded."});
    }
  }
  if(req.method==="POST"&&route==="/api/catalog/invalidate"){
    const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(!token)return sendJson(res,401,{error:"Staff authentication is required."});
    try{
      const user=await sb("/auth/v1/user",{access:token});
      const staff=await sb("/rest/v1/staff_profiles?select=user_id&user_id=eq."+encodeURIComponent(user.id)+"&is_active=eq.true",{access:token});
      if(!staff?.length)return sendJson(res,403,{error:"Active staff access is required."});
      invalidatePublicMenu();
      return sendJson(res,200,{ok:true});
    }catch(error){return sendJson(res,error.status||401,{error:"The catalogue cache could not be refreshed."});}
  }
  if(req.method==="GET"&&route==="/api/session"){
    if(!configured())return sendJson(res,503,{error:"Customer sign-in is not configured on the server."});
    const current=await currentUser(req,res);return sendJson(res,200,{authenticated:Boolean(current),user:current?.user||null});
  }
  if(req.method==="POST"&&route.startsWith("/api/auth/"))return authRoutes(req,res,url);

  if(req.method==="GET"&&route==="/api/profile/cart"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Sign in to view your saved cart."});
    try{
      const rows=await sb("/rest/v1/customer_cart_items?select=product_id,quantity,product:store_products!customer_cart_items_product_id_fkey(id,slug,name,description,price,price_unit,price_unit_label,image_url,image_urls,category:store_categories!store_products_category_id_fkey(name,slug),images:product_images!product_images_product_id_fkey(id,url,position,alt_text,variants))&user_id=eq."+encodeURIComponent(current.user.id)+"&order=created_at.asc",{access:current.session.access_token});
      return sendJson(res,200,{items:(rows||[]).map(row=>({...row.product,quantity:row.quantity,product_id:row.product_id,category_name:row.product?.category?.name||"Menu",images:row.product?.images||[]}))});
    }catch(error){return sendJson(res,error.status||502,{error:"Your saved cart could not be loaded."});}
  }
  if(req.method==="PUT"&&route==="/api/profile/cart"){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Sign in to save your cart list."});
    const b=await body(req,12000),incoming=Array.isArray(b.items)?b.items:[];
    if(incoming.length>50)return sendJson(res,400,{error:"Your cart can contain up to 50 different products."});
    const normalized=new Map();
    for(const item of incoming){
      const id=String(item.product_id||item.id||"");
      const quantity=Number(item.quantity);
      if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(quantity)||quantity<1||quantity>20)return sendJson(res,400,{error:"A cart item is invalid."});
      normalized.set(id,Math.min(20,(normalized.get(id)||0)+quantity));
    }
    try{
      await sb("/rest/v1/customer_cart_items?user_id=eq."+encodeURIComponent(current.user.id),{method:"DELETE",access:current.session.access_token,headers:{Prefer:"return=minimal"}});
      if(normalized.size)await sb("/rest/v1/customer_cart_items",{method:"POST",access:current.session.access_token,body:[...normalized].map(([product_id,quantity])=>({user_id:current.user.id,product_id,quantity})),headers:{Prefer:"return=minimal"}});
      return sendJson(res,200,{ok:true,count:normalized.size});
    }catch(error){return sendJson(res,error.status||502,{error:"Your saved cart could not be updated."});}
  }
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
      const orders=await sb("/rest/v1/store_orders?select=id,order_number,status,created_at,requested_date,requested_time,fulfillment,items,estimated_total,price_needs_confirmation,order_description,notes,delivery_location&customer_id=eq."+encodeURIComponent(current.user.id)+"&order=created_at.desc&limit=50",{access:current.session.access_token});
      return sendJson(res,200,{orders:orders||[]});
    }catch(e){return sendJson(res,e.status||502,{error:"Your account data could not be loaded."});}
  }

  if(req.method==="POST"&&route==="/api/orders"){
    const b=await body(req,16000);
    if(!rateLimit(req,"orders-ip",8,900000))return sendJson(res,429,{error:"Too many order requests from this connection. Try again in 15 minutes."});
    if(String(b.website||b.company_website||"").trim())return sendJson(res,400,{error:"We could not process this request. Please try again."});

    const current=await currentUser(req,res);
    const name=String(b.customer_name||current?.user.user_metadata?.full_name||current?.user.user_metadata?.name||"").trim();
    const phone=phoneNumber(b.customer_phone||current?.user.phone);
    const email=String(b.customer_email||current?.user.email||"").trim();
    const fulfillment=String(b.fulfillment||"pickup");
    const description=String(b.order_description||"").trim();
    const notes=String(b.notes||"").trim();
    const location=String(b.delivery_location||"").trim();

    if(name.length<2||name.length>120)return sendJson(res,400,{error:"Enter your name (2–120 characters)."});
    if(!phone)return sendJson(res,400,{error:"Enter a valid phone number, including the +250 country code."});
    if(!rateLimitKey("orders-phone:"+phone,5,900000))return sendJson(res,429,{error:"Too many orders have been sent from this phone number. Try again in 15 minutes."});
    if(email&&(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)))return sendJson(res,400,{error:"Enter a valid email address or leave it blank."});
    if(!["pickup","delivery","event"].includes(fulfillment))return sendJson(res,400,{error:"Choose pickup, delivery or event service for this order."});
    if((fulfillment==="delivery"||fulfillment==="event")&&location.length<3)return sendJson(res,400,{error:"Add the delivery or event location before sending."});
    if(location.length>180||description.length>5000||notes.length>3000)return sendJson(res,400,{error:"One of your order details is too long. Shorten it and try again."});

    const date=b.requested_date?String(b.requested_date):null;
    const time=b.requested_time?String(b.requested_time):null;
    if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{error:"Choose a valid preferred date."});
    if(time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))return sendJson(res,400,{error:"Choose a valid preferred time."});

    const incoming=Array.isArray(b.items)?b.items:(b.product_slug?[{slug:b.product_slug,quantity:b.quantity||1}]:[]);
    if(!incoming.length||incoming.length>50)return sendJson(res,400,{error:"Choose at least one menu item before sending your order."});
    const normalizedItems=[];
    for(const item of incoming){
      const quantity=Number(item.quantity||1);
      const id=String(item.product_id||item.id||"");
      const slug=String(item.slug||item.product_slug||"").trim().slice(0,160);
      if(!Number.isInteger(quantity)||quantity<1||quantity>20)return sendJson(res,400,{error:"Each product quantity must be between 1 and 20."});
      if(id&&/^[0-9a-f-]{36}$/i.test(id))normalizedItems.push({product_id:id,quantity});
      else if(slug&&/^[a-z0-9-]+$/i.test(slug))normalizedItems.push({slug,quantity});
      else return sendJson(res,400,{error:"A selected product is invalid. Refresh the menu and try again."});
    }
    try{
      const headers={
        apikey:SUPABASE_KEY,
        "Content-Type":"application/json",
        ...(current?.session?.access_token?{Authorization:"Bearer "+current.session.access_token}:{})
      };
      const response=await fetch(SUPABASE_URL+"/functions/v1/submit-store-order",{
        method:"POST",
        headers,
        body:JSON.stringify({
          customer_name:name,
          customer_phone:phone,
          customer_email:email||null,
          fulfillment,
          requested_date:date,
          requested_time:time,
          delivery_location:location||null,
          order_description:description||null,
          notes:notes||null,
          website:String(b.website||b.company_website||""),
          items:normalizedItems
        })
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok){
        const status=[400,401,403,413,429].includes(response.status)?response.status:502;
        return sendJson(res,status,{error:result.error||"We could not save your order just now. Please try again."});
      }
      if(current?.session?.access_token){
        const orderedProductIds=[...new Set(normalizedItems.map(item=>item.product_id).filter(Boolean))];
        if(orderedProductIds.length){
          try{
            await sb("/rest/v1/customer_cart_items?user_id=eq."+encodeURIComponent(current.user.id)+"&product_id=in.("+orderedProductIds.map(encodeURIComponent).join(",")+")",{
              method:"DELETE",
              access:current.session.access_token,
              headers:{Prefer:"return=minimal"}
            });
          }catch(cartError){
            console.warn("Could not clear ordered products from the saved cart:",cartError.message);
          }
        }
      }
      return sendJson(res,201,{
        ok:true,
        order:result.order||null,
        alert_queued:Boolean(result.alert_queued)
      });
    }catch(error){
      console.error("Order request:",error.status||502,error.message);
      const status=error.status&&error.status<500?error.status:502;
      const message=status===400?"Some order details were invalid. Check the form and try again.":status===403?"The order service could not accept this request. Refresh the page and retry.":status===429?"Too many requests. Wait before sending another order.":"We could not save your order just now. Please retry or contact Step Town on WhatsApp.";
      return sendJson(res,status,{error:message});
    }
  }
  return sendJson(res,404,{error:"API endpoint not found."});
}
function pageTitle(pathname){
  const titles={"/":"Food · Celebrations · "+CAKE_CATEGORY_LABEL,"/categories":"Categories","/categories/cake":CAKE_CATEGORY_LABEL,"/gallery":"Gallery","/cart":"Place an order","/order/confirmation":"Order confirmation","/profile":"Profile","/profile/orders":"Order history","/login":"Customer login","/register":"Create an account"};
  if(pathname==="/categories/cake")return CAKE_CATEGORY_LABEL;
  if(pathname.startsWith("/categories/")){
    const slug=pathname.split("/").filter(Boolean).at(-1);
    if(slug==="cake")return CAKE_CATEGORY_LABEL;
    return "Menu category";
  }
  if(pathname.startsWith("/staff"))return "Staff workspace";
  return titles[pathname]||"Food · Celebrations · Cakes";
}
async function staticPage(res,pathname,url=new URL(pathname,APP_URL)){
  const decoded=decodeURIComponent(pathname);
  const staffRoute=decoded==="/staff"||decoded.startsWith("/staff/");
  let file=staffRoute?path.join(DIST,"staff.html"):(decoded==="/" ? path.join(DIST,"index.html") : path.resolve(DIST,"."+decoded));
  if(!staffRoute&&file!==DIST&&!file.startsWith(DIST+path.sep))return sendJson(res,400,{error:"Invalid path."});
  const requestedExt=path.extname(file).toLowerCase();
  try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,"index.html");}
  catch{
    if(staffRoute){file=path.join(DIST,"staff.html");}
    else if(decoded==="/"||requestedExt===".html"||!requestedExt){file=path.join(DIST,"index.html");}
    else return sendJson(res,404,{error:"Static asset not found."});
  }
  let data;
  try{data=await fs.readFile(file);}
  catch{return sendJson(res,staffRoute?503:404,{error:staffRoute?"The staff workspace is building. Refresh shortly.":"Static asset not found."});}
  const ext=path.extname(file).toLowerCase();
  const menuPage=!staffRoute&&(decoded==="/"||decoded==="/categories"||decoded.startsWith("/categories/")||decoded==="/cart");
  if(ext===".html"&&path.basename(file)==="index.html"){
    let html=data.toString("utf8");
    const lowerHtml=html.toLowerCase();
    const titleStart=lowerHtml.indexOf("<title>");
    const titleEnd=lowerHtml.indexOf("</title>",titleStart);
    if(titleStart>=0&&titleEnd>titleStart)html=html.slice(0,titleStart)+"<title>Step Town | "+pageTitle(pathname)+"</title>"+html.slice(titleEnd+8);
    if(menuPage){
      try{
        const category=decoded.startsWith("/categories/")?decoded.split("/").filter(Boolean).at(-1):"";
        const productSlug=decoded==="/cart"?String(url.searchParams.get("product")||""):"";
        const menu=await getPublicMenu({limit:PUBLIC_MENU_PAGE_SIZE,offset:0,category:category==="wedding-cakes"?"cake":category,slug:productSlug});
        const payload=JSON.stringify({...menu,embeddedAt:Date.now()})
          .replace(/</g,"\\u003c")
          .replace(/\u2028/g,"\\u2028")
          .replace(/\u2029/g,"\\u2029");
        const initial='<script id="step-menu-initial-data" type="application/json">'+payload+'</script>';
        // Inject before </head> so this works with Vite's hashed production bundle
        // as well as the development /src/main.js entry.
        html=html.replace(/<\/head>/i,initial+'</head>');
      }catch(error){console.warn("Initial menu embedding was skipped:",error.message);}
    }
    data=Buffer.from(html);
  }
  const headers={
    "Content-Type":MIME[ext]||"application/octet-stream",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"strict-origin-when-cross-origin",
    "X-Frame-Options":"SAMEORIGIN",
    "Cache-Control":menuPage&&ext===".html"?"public, max-age=15, stale-while-revalidate=180":ext===".html"?"no-store":"public, max-age=3600",
    ...(menuPage&&ext===".html"?{"CDN-Cache-Control":"public, s-maxage=30, stale-while-revalidate=240"}:{})
  };
  res.writeHead(200,headers);res.end(data);
}
async function handle(req,res){
  const url=new URL(req.url||"/",origin(req)),route=decodeURIComponent(url.pathname).replace(/\/+$/,"")||"/";
  if(req.method==="GET"&&route==="/api/auth/google")return oauthStart(req,res,url);
  if(req.method==="GET"&&route==="/auth/callback")return oauthCallback(req,res,url);
  if(req.method==="GET"&&route==="/categories/wedding-cakes"){
    res.writeHead(301,{Location:"/categories/cake","Cache-Control":"public, max-age=31536000, immutable"}).end();return;
  }
  if(req.method==="GET"&&route.startsWith("/product/")){
    const slug=route.split("/").filter(Boolean).at(-1);
    res.writeHead(301,{Location:"/cart?product="+encodeURIComponent(slug),"Cache-Control":"public, max-age=31536000, immutable"}).end();return;
  }
  if(route.startsWith("/api/")){
    try{return await api(req,res,url);}
    catch(e){console.error("API:",e);return sendJson(res,e.status||500,{error:e.status===413?e.message:"The request could not be completed."});}
  }
  if(req.method==="GET"&&(route==="/profile"||route==="/profile/orders")){
    const current=await currentUser(req,res);
    if(!current){appendCookie(res,clearCookie(SESSION_COOKIE,req,true));res.writeHead(303,{Location:"/login?next="+encodeURIComponent(route+url.search),"Cache-Control":"no-store"});return res.end();}
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
