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
function rateLimit(req,name,max,windowMs=900000) {
  const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").split(",")[0].trim();
  const key=name+":"+ip, now=Date.now(), bucket=limits.get(key);
  if(!bucket||bucket.reset<=now){limits.set(key,{count:1,reset:now+windowMs});return true;}
  bucket.count++;
  return bucket.count<=max;
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

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}
async function requireProductStaff(req) {
  const access = bearerToken(req);
  if (!access) throw Object.assign(new Error("Sign in with an active Step Town staff account."), { status: 401 });
  const user = await sb("/auth/v1/user", { access });
  if (!user?.id) throw Object.assign(new Error("Your staff session has expired. Sign in again."), { status: 401 });
  const profiles = await sb("/rest/v1/staff_profiles?select=user_id,role,is_active&user_id=eq." + encodeURIComponent(user.id) + "&limit=1", { access });
  const staff = profiles?.[0];
  if (!staff?.is_active || !["manager", "accountant"].includes(staff.role)) {
    throw Object.assign(new Error("Only an active Accountant or Manager can manage product images."), { status: 403 });
  }
  return { access, user, role: staff.role };
}
async function readMultipart(req, maxBytes = 21 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > maxBytes) throw Object.assign(new Error("The upload request is too large. Each image must be 5 MB or smaller."), { status: 413 });
    chunks.push(part);
  }
  const raw = Buffer.concat(chunks);
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw Object.assign(new Error("Expected a multipart image upload."), { status: 400 });
  }
  const request = new Request("http://step-town-upload.invalid/", {
    method: "POST",
    headers: { "content-type": contentType },
    body: raw
  });
  return request.formData();
}
function validProductUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function fileSignatureMatches(bytes, type) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}
function productStorageUrl(objectPath) {
  return SUPABASE_URL + "/storage/v1/object/public/step-town-media/" + objectPath.split("/").map(encodeURIComponent).join("/");
}
async function storageRemove(access, objectPath) {
  const response = await fetch(SUPABASE_URL + "/storage/v1/object/step-town-media", {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + access,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prefixes: [objectPath] })
  });
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status !== 404) throw Object.assign(new Error("The stored image could not be removed: " + (errorText || response.statusText)), { status: response.status });
  }
}
async function syncProductLegacyImages(productId, access) {
  const images = await sb("/rest/v1/product_images?select=url&product_id=eq." + encodeURIComponent(productId) + "&order=position.asc", { access });
  const urls = (images || []).map(row => row.url).filter(Boolean);
  await sb("/rest/v1/store_products?id=eq." + encodeURIComponent(productId), {
    method: "PATCH",
    access,
    headers: { Prefer: "return=minimal" },
    body: { image_urls: urls, image_url: urls[0] || null, updated_at: new Date().toISOString() }
  });
}
async function writeProductImageAudit(staff, action, productId, details = {}) {
  await sb("/rest/v1/audit_log", {
    method: "POST",
    access: staff.access,
    headers: { Prefer: "return=minimal" },
    body: {
      actor_id: staff.user.id,
      actor_role: staff.role,
      action,
      entity_type: "store_product_image",
      entity_id: String(productId),
      details
    }
  });
}
async function publicProducts(filters = {}) {
  const columns = "id,slug,category_id,name,description,price,image_url,image_urls,sort_order,is_available,is_visible,has_stock,created_at";
  let query = "?select=" + encodeURIComponent(columns) + "&is_available=eq.true&is_visible=eq.true&has_stock=eq.true&order=sort_order.asc,created_at.desc";
  if (filters.slug) query += "&slug=eq." + encodeURIComponent(filters.slug);
  if (Array.isArray(filters.ids)) {
    if (!filters.ids.length) return [];
    query += "&id=in.(" + filters.ids.map(encodeURIComponent).join(",") + ")";
  }
  const rows = await sb("/rest/v1/store_products" + query);
  if (!rows?.length) return [];
  const ids = rows.map(row => row.id);
  const [imageRows, categoryRows] = await Promise.all([
    sb("/rest/v1/product_images?select=id,product_id,url,public_id,variants,position,alt_text,created_at&product_id=in.(" + ids.map(encodeURIComponent).join(",") + ")&order=position.asc"),
    sb("/rest/v1/store_categories?select=id,name,slug")
  ]);
  const byProduct = new Map();
  for (const image of imageRows || []) {
    const list = byProduct.get(image.product_id) || [];
    list.push(image);
    byProduct.set(image.product_id, list);
  }
  const categories = new Map((categoryRows || []).map(category => [category.id, category]));
  return rows.map(row => {
    let images = byProduct.get(row.id) || [];
    if (!images.length) {
      const legacy = [];
      for (const url of [...(Array.isArray(row.image_urls) ? row.image_urls : []), row.image_url]) {
        if (typeof url === "string" && url && !legacy.some(item => item.url === url)) {
          legacy.push({
            id: null, product_id: row.id, url, public_id: null,
            position: legacy.length, alt_text: row.name + " product photo " + (legacy.length + 1)
          });
        }
      }
      images = legacy;
    }
    images = images.map(image => ({
      ...image,
      variants: Object.fromEntries(Object.entries(image.variants || {}).map(([width, objectPath]) => [width, productStorageUrl(objectPath)]))
    }));
    const category = categories.get(row.category_id) || null;
    return {
      ...row,
      slug: row.slug || row.id,
      category_name: category?.name || "Menu",
      category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
      images,
      cover: images[0] || null
    };
  });
}
async function profileFavourites(req, res, method) {
  const current = await currentUser(req, res);
  if (!current) return sendJson(res, 401, { error: "Sign in to sync and view your favourites." });
  const userId = current.user.id;
  if (method === "GET") {
    const rows = await sb("/rest/v1/customer_favourites?select=product_id,created_at&user_id=eq." + encodeURIComponent(userId) + "&order=created_at.desc", { access: current.session.access_token });
    const ids = (rows || []).map(row => row.product_id);
    const products = await publicProducts({ ids });
    return sendJson(res, 200, { ids, products });
  }
  const b = await body(req, 24 * 1024);
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).filter(validProductUuid))].slice(0, 200);
  if (Array.isArray(b.ids) && b.ids.length > 200) return sendJson(res, 400, { error: "You can save up to 200 favourites." });
  const access = current.session.access_token;
  if (b.merge !== true) {
    const existing = await sb("/rest/v1/customer_favourites?select=product_id&user_id=eq." + encodeURIComponent(userId), { access });
    const keep = new Set(ids);
    for (const row of existing || []) {
      if (!keep.has(row.product_id)) {
        await sb("/rest/v1/customer_favourites?user_id=eq." + encodeURIComponent(userId) + "&product_id=eq." + encodeURIComponent(row.product_id), {
          method: "DELETE", access, headers: { Prefer: "return=minimal" }
        });
      }
    }
  }
  if (ids.length) {
    await sb("/rest/v1/customer_favourites?on_conflict=user_id,product_id", {
      method: "POST", access,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: ids.map(productId => ({ user_id: userId, product_id: productId }))
    });
  }
  const mergedRows = await sb("/rest/v1/customer_favourites?select=product_id&user_id=eq." + encodeURIComponent(userId), { access });
  return sendJson(res, 200, { ok: true, ids: (mergedRows || []).map(row => row.product_id) });
}
async function staffProductImagesApi(req, res, url) {
  const route = url.pathname;
  const uploadMatch = route.match(/^\/api\/staff\/products\/([0-9a-f-]{36})\/images$/i);
  const deleteMatch = route.match(/^\/api\/staff\/products\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})$/i);
  const reorderMatch = route.match(/^\/api\/staff\/products\/([0-9a-f-]{36})\/images\/order$/i);
  if (!uploadMatch && !deleteMatch && !reorderMatch) return false;
  try {
    const staff = await requireProductStaff(req);
    if (uploadMatch && req.method === "POST") {
      const productId = uploadMatch[1];
      if (!validProductUuid(productId)) return sendJson(res, 400, { error: "Invalid product ID." });
      const form = await readMultipart(req);
      const file = form.get("file");
      const altText = String(form.get("alt_text") || "").trim().slice(0, 240);
      if (!file || typeof file.arrayBuffer !== "function") return sendJson(res, 400, { error: "Choose an image to upload." });
      if (!["image/webp"].includes(file.type)) return sendJson(res, 415, { error: "The primary image must be a compressed WEBP file." });
      if (!file.size || file.size > 5 * 1024 * 1024) return sendJson(res, 413, { error: "Each compressed image must be 5 MB or smaller." });
      const existing = await sb("/rest/v1/product_images?select=id&product_id=eq." + encodeURIComponent(productId), { access: staff.access });
      if ((existing || []).length >= 10) return sendJson(res, 400, { error: "A product can have no more than 10 images." });
      const variants = {};
      const uploads = [];
      const basePath = "products/" + productId + "/" + randomBytes(12).toString("hex");
      const primaryBytes = Buffer.from(await file.arrayBuffer());
      if (!fileSignatureMatches(primaryBytes, file.type)) return sendJson(res, 415, { error: "The uploaded file contents do not match an accepted image format." });
      uploads.push({ path: basePath + ".webp", bytes: primaryBytes, type: "image/webp", primary: true });

      for (const width of [480, 800, 1200]) {
        const variantFile = form.get("variant_" + width);
        if (!variantFile || typeof variantFile.arrayBuffer !== "function") continue;
        if (variantFile.type !== "image/webp" || !variantFile.size || variantFile.size > 5 * 1024 * 1024) {
          return sendJson(res, 415, { error: "Responsive image variants must be WEBP files no larger than 5 MB." });
        }
        const bytes = Buffer.from(await variantFile.arrayBuffer());
        if (!fileSignatureMatches(bytes, "image/webp")) return sendJson(res, 415, { error: "A responsive image variant is not a valid WEBP file." });
        uploads.push({ path: basePath + "-" + width + ".webp", bytes, type: "image/webp", width });
      }
      if (!uploads.some(item => item.width === 480) || !uploads.some(item => item.width === 800)) {
        return sendJson(res, 400, { error: "The 480px and 800px responsive image variants are required." });
      }

      const uploadedPaths = [];
      try {
        for (const object of uploads) {
          const upload = await fetch(SUPABASE_URL + "/storage/v1/object/step-town-media/" + object.path.split("/").map(encodeURIComponent).join("/"), {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: "Bearer " + staff.access,
              "Content-Type": object.type,
              "Cache-Control": "31536000",
              "x-upsert": "false"
            },
            body: object.bytes
          });
          if (!upload.ok) {
            const errorText = await upload.text();
            throw Object.assign(new Error(errorText || "Supabase Storage rejected an image."), { status: upload.status });
          }
          uploadedPaths.push(object.path);
          if (object.width) variants[String(object.width)] = object.path;
        }
      } catch (error) {
        for (const path of uploadedPaths) {
          try { await storageRemove(staff.access, path); }
          catch (cleanupError) { console.error("Image variant cleanup failed:", cleanupError.message); }
        }
        throw error;
      }

      const objectPath = basePath + ".webp";
      const urlValue = productStorageUrl(objectPath);
      let inserted;
      try {
        inserted = await sb("/rest/v1/product_images?select=id,product_id,url,public_id,variants,position,alt_text,created_at", {
          method: "POST",
          access: staff.access,
          headers: { Prefer: "return=representation" },
          body: {
            product_id: productId,
            url: urlValue,
            public_id: objectPath,
            variants,
            position: (existing || []).length,
            alt_text: altText || "Step Town product photo"
          }
        });
      } catch (error) {
        for (const path of uploadedPaths) {
          try { await storageRemove(staff.access, path); }
          catch (cleanupError) { console.error("Image cleanup failed:", cleanupError.message); }
        }
        throw error;
      }
      await syncProductLegacyImages(productId, staff.access);
      await writeProductImageAudit(staff, "product_image_added", productId, { image_id: inserted?.[0]?.id, position: (existing || []).length });
      return sendJson(res, 201, { image: inserted?.[0] || null });
    }

    if (reorderMatch && req.method === "PATCH") {
      const productId = reorderMatch[1];
      const b = await body(req, 12 * 1024);
      const imageIds = Array.isArray(b.imageIds) ? b.imageIds : [];
      if (imageIds.length > 10 || imageIds.some(id => !validProductUuid(id))) return sendJson(res, 400, { error: "The image order is invalid." });
      await sb("/rest/v1/rpc/staff_reorder_product_images", {
        method: "POST", access: staff.access,
        body: { p_product_id: productId, p_image_ids: imageIds }
      });
      await syncProductLegacyImages(productId, staff.access);
      await writeProductImageAudit(staff, "product_images_reordered", productId, { image_ids: imageIds });
      return sendJson(res, 200, { ok: true });
    }

    if (deleteMatch && req.method === "DELETE") {
      const productId = deleteMatch[1], imageId = deleteMatch[2];
      const rows = await sb("/rest/v1/product_images?select=id,public_id&product_id=eq." + encodeURIComponent(productId) + "&id=eq." + encodeURIComponent(imageId) + "&limit=1", { access: staff.access });
      const image = rows?.[0];
      if (!image) return sendJson(res, 404, { error: "That product image was not found." });
      const objectsToRemove = [...new Set([image.public_id, ...Object.values(image.variants || {})].filter(Boolean))];
      for (const objectPath of objectsToRemove) await storageRemove(staff.access, objectPath);
      await sb("/rest/v1/product_images?product_id=eq." + encodeURIComponent(productId) + "&id=eq." + encodeURIComponent(imageId), {
        method: "DELETE", access: staff.access, headers: { Prefer: "return=minimal" }
      });
      const remaining = await sb("/rest/v1/product_images?select=id&product_id=eq." + encodeURIComponent(productId) + "&order=position.asc", { access: staff.access });
      if ((remaining || []).length) {
        await sb("/rest/v1/rpc/staff_reorder_product_images", {
          method: "POST", access: staff.access,
          body: { p_product_id: productId, p_image_ids: remaining.map(row => row.id) }
        });
      }
      await syncProductLegacyImages(productId, staff.access);
      await writeProductImageAudit(staff, "product_image_removed", productId, { image_id: imageId });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: "Method not allowed for product images." });
  } catch (error) {
    console.error("Product image API:", error);
    return sendJson(res, error.status || 500, { error: error.message || "The product image request failed." });
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
  if(req.method==="GET"&&route==="/api/products"){
    try {
      const products = await publicProducts({
        ids: url.searchParams.has("ids") ? url.searchParams.get("ids").split(",").filter(Boolean) : undefined
      });
      return sendJson(res,200,{products});
    } catch(error) {
      console.error("Public product list:",error.message);
      return sendJson(res,error.status||502,{error:"The product catalogue could not be loaded."});
    }
  }
  if(req.method==="GET"&&route.startsWith("/api/products/")){
    try {
      const slug = decodeURIComponent(route.slice("/api/products/".length));
      const products = await publicProducts({slug});
      return products[0] ? sendJson(res,200,{product:products[0]}) : sendJson(res,404,{error:"That product was not found."});
    } catch(error) {
      console.error("Public product detail:",error.message);
      return sendJson(res,error.status||502,{error:"The product could not be loaded."});
    }
  }
  if(route==="/api/profile/favourites"&&req.method==="GET") {
    try { return await profileFavourites(req,res,"GET"); }
    catch(error) { return sendJson(res,error.status||502,{error:"Your favourites could not be loaded."}); }
  }
  if(route==="/api/profile/favourites"&&req.method==="POST") {
    try { return await profileFavourites(req,res,"POST"); }
    catch(error) { return sendJson(res,error.status||502,{error:error.message||"Your favourites could not be synced."}); }
  }
  if(route.startsWith("/api/staff/products/")) {
    const handled = await staffProductImagesApi(req,res,url);
    if(handled) return;
  }
  if(req.method==="GET"&&route==="/api/session"){
    if(!configured())return sendJson(res,503,{error:"Customer sign-in is not configured on the server."});
    const current=await currentUser(req,res);return sendJson(res,200,{authenticated:Boolean(current),user:current?.user||null});
  }
  if(req.method==="POST"&&route.startsWith("/api/auth/"))return authRoutes(req,res,url);

  if(req.method==="GET"&&(route==="/api/profile"||route==="/api/profile/orders")){
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Please sign in to view your account."});
    try{
      if(route==="/api/profile"){
        const rows=await sb("/rest/v1/customer_profiles?select=user_id,full_name,phone,created_at&user_id=eq."+encodeURIComponent(current.user.id)+"&limit=1",{access:current.session.access_token});
        return sendJson(res,200,{user:current.user,profile:rows[0]||null});
      }
      const orders=await sb("/rest/v1/store_orders?select=id,order_number,status,created_at,requested_date,requested_time,fulfillment,items,estimated_total,price_needs_confirmation&customer_id=eq."+encodeURIComponent(current.user.id)+"&order=created_at.desc&limit=50",{access:current.session.access_token});
      return sendJson(res,200,{orders:orders||[]});
    }catch(e){return sendJson(res,e.status||502,{error:"Your account data could not be loaded."});}
  }

  if(req.method==="POST"&&route==="/api/orders"){
    if(!rateLimit(req,"orders",8))return sendJson(res,429,{error:"Too many order requests. Please try again later."});
    const current=await currentUser(req,res);
    if(!current)return sendJson(res,401,{error:"Sign in before sending an order request."});
    const b=await body(req),name=String(b.customer_name||current.user.user_metadata?.full_name||"").trim();
    const phone=phoneNumber(b.customer_phone||current.user.phone),fulfillment=String(b.fulfillment||"pickup");
    const email=String(b.customer_email||current.user.email||"").trim();
    if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return sendJson(res,400,{error:"Enter a valid email address or leave it blank."});
    const incoming=Array.isArray(b.items)?b.items:[];
    if(name.length<2||name.length>120)return sendJson(res,400,{error:"Enter your name before sending the request."});
    if(!phone)return sendJson(res,400,{error:"Enter a valid contact phone number."});
    if(!["pickup","delivery","event"].includes(fulfillment))return sendJson(res,400,{error:"Choose a valid fulfilment option."});
    if(!incoming.length||incoming.length>50)return sendJson(res,400,{error:"Your cart must contain between 1 and 50 items."});
    const quantities=new Map();
    for(const item of incoming){
      const id=String(item.product_id||""),qty=Number(item.quantity);
      if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(qty)||qty<1||qty>20)return sendJson(res,400,{error:"A cart item is invalid. Refresh the menu and try again."});
      quantities.set(id,Math.min(20,(quantities.get(id)||0)+qty));
    }
    const ids=[...quantities.keys()];
    try{
      const products=await sb("/rest/v1/store_products?select=id,category_id,name,price&is_available=eq.true&is_visible=eq.true&id=in.("+ids.join(",")+")",{access:current.session.access_token});
      if(products.length!==ids.length)return sendJson(res,400,{error:"Some items are no longer available. Review your cart."});
      const catIds=[...new Set(products.map(p=>p.category_id))];
      const cats=await sb("/rest/v1/store_categories?select=id,name&id=in.("+catIds.join(",")+")",{access:current.session.access_token});
      const names=new Map(cats.map(c=>[c.id,c.name]));
      let priced=true,total=0;
      const clean=products.map(p=>{
        const qty=quantities.get(p.id),price=p.price==null?null:Number(p.price);
        if(!Number.isFinite(price))priced=false;else total+=price*qty;
        return {product_id:p.id,name:p.name,category:names.get(p.category_id)||"Menu",quantity:qty,unit_price:price,line_total:price==null?null:price*qty};
      });
      const date=b.requested_date?String(b.requested_date):null;
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,400,{error:"Choose a valid requested date."});
      const order={
        customer_id:current.user.id,customer_name:name,customer_phone:phone,customer_email:email||null,
        fulfillment,requested_date:date,requested_time:b.requested_time?String(b.requested_time).slice(0,5):null,
        delivery_location:b.delivery_location?String(b.delivery_location).trim().slice(0,180):null,
        notes:b.notes?String(b.notes).trim().slice(0,3000):null,
        items:clean,estimated_total:priced?total:null,price_needs_confirmation:!priced
      };
      const rows=await sb("/rest/v1/store_orders?select=id,order_number,estimated_total,created_at",{method:"POST",access:current.session.access_token,body:order,headers:{Prefer:"return=representation"}});
      const saved=rows[0];
      if(saved?.id){
        try{
          await fetch(SUPABASE_URL+"/functions/v1/send-order-push",{
            method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+current.session.access_token,"Content-Type":"application/json"},
            body:JSON.stringify({order_id:saved.id})
          });
        }catch(e){console.warn("Order saved; staff notification failed:",e.message);}
      }
      return sendJson(res,201,{order:saved});
    }catch(e){console.error("Order request:",e.message);return sendJson(res,e.status&&e.status<500?e.status:502,{error:"We couldn't save the order request. Please try again."});}
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
async function staticPage(res,pathname){
  const decoded=decodeURIComponent(pathname);
  const staffRoute=decoded==="/staff"||decoded.startsWith("/staff/");
  let file=staffRoute?path.join(DIST,"staff.html"):(decoded==="/" ? path.join(DIST,"index.html") : path.resolve(DIST,"."+decoded));
  if(!staffRoute&&file!==DIST&&!file.startsWith(DIST+path.sep))return sendJson(res,400,{error:"Invalid path."});
  try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,"index.html");}
  catch{file=path.join(DIST,staffRoute?"staff.html":"index.html");}
  let data;
  try{data=await fs.readFile(file);}
  catch{try{file=path.join(DIST,"index.html");data=await fs.readFile(file);}catch{return sendJson(res,503,{error:"The website is building. Refresh shortly."});}}
  const ext=path.extname(file).toLowerCase();
  const headers={"Content-Type":MIME[ext]||"application/octet-stream","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"SAMEORIGIN","Cache-Control":ext===".html"?"no-store":"public, max-age=3600"};
  if(ext===".html"&&path.basename(file)==="index.html"){
    data=Buffer.from(data.toString("utf8").replace(/<title>[\s\S]*?<\/title>/i,"<title>Step Town | "+pageTitle(pathname)+"</title>"));
  }
  res.writeHead(200,headers);res.end(data);
}
async function handle(req,res){
  const url=new URL(req.url||"/",origin(req)),route=decodeURIComponent(url.pathname);
  if(req.method==="GET"&&route==="/api/auth/google")return oauthStart(req,res,url);
  if(req.method==="GET"&&route==="/auth/callback")return oauthCallback(req,res,url);
  if(route.startsWith("/api/")){
    try{return await api(req,res,url);}
    catch(e){console.error("API:",e);return sendJson(res,e.status||500,{error:e.status===413?e.message:"The request could not be completed."});}
  }
  if(req.method==="GET"&&(route==="/profile"||route==="/profile/orders"||route==="/cart")){
    const current=await currentUser(req,res);
    if(!current){appendCookie(res,clearCookie(SESSION_COOKIE,req,true));res.writeHead(303,{Location:"/login?next="+encodeURIComponent(route+url.search),"Cache-Control":"no-store"});return res.end();}
  }
  if(req.method==="GET"&&(route==="/login"||route==="/register")){
    const current=await currentUser(req,res);
    if(current){res.writeHead(303,{Location:"/profile","Cache-Control":"no-store"});return res.end();}
  }
  if(req.method!=="GET"&&req.method!=="HEAD")return sendJson(res,405,{error:"Method not allowed."});
  return staticPage(res,route);
}
if(PROD&&!KEY)console.warn("SESSION_SECRET is missing: customer login remains disabled until configured.");
const server=http.createServer((req,res)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("X-Frame-Options","SAMEORIGIN");void handle(req,res).catch(e=>{console.error("Unhandled request:",e);if(!res.headersSent)sendJson(res,500,{error:"Unexpected server error."});else res.end();});});
server.listen(PORT,"0.0.0.0",()=>console.log("Step Town server listening on "+PORT));
setInterval(()=>{const now=Date.now();for(const [key,b] of limits)if(b.reset<=now)limits.delete(key);},60000).unref();
