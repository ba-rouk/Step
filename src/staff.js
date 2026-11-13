import { supabase, supabaseConfigured } from "./supabase.js";
import "../staff.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
if (!path.startsWith("/staff")) {
  // Public storefront is left untouched.
} else {
  document.body.innerHTML = '<div id="staff-app" class="staff-app"><div class="staff-loading">Opening secure staff workspace…</div></div>';
  const app = document.querySelector("#staff-app");
  const params = new URLSearchParams(window.location.search);
  const requestedNext = params.get("next") || "/staff/dashboard";
  const safeNext = requestedNext.startsWith("/staff/") && !requestedNext.startsWith("//") ? requestedNext : "/staff/dashboard";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const money = v => v == null ? "To confirm" : new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(v));
  const roleTitle = role => ({manager:"Manager",accountant:"Accountant",cashier:"Cashier"}[role] || "Staff");
  const current = () => supabase.auth.getUser();
  let profile = null;
  let activeOrder = null;

  function decodeVapidKey(value){const padding="=".repeat((4-value.length%4)%4);const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  function shell(title, body) {
    app.innerHTML = '<header class="staff-top"><a class="staff-brand" href="/"><span class="staff-mark">ST</span><span><b>STEP TOWN</b><small>STAFF WORKSPACE</small></span></a><div class="staff-user"><span>'+esc(profile?.full_name || "Staff")+' · '+esc(roleTitle(profile?.role))+'</span><button id="staff-enable-push" class="staff-quiet" type="button">Enable alerts</button><button id="staff-logout" class="staff-quiet">Sign out</button></div></header><main class="staff-main"><div class="staff-title-row"><div><p class="staff-eyebrow">STEP TOWN · RUNDA, RWANDA</p><h1>'+esc(title)+'</h1></div><a class="staff-home" href="/"> Public website</a></div><nav class="staff-nav">'+navLinks()+'</nav>'+body+'</main>';
    document.querySelector("#staff-logout")?.addEventListener("click", async()=>{await supabase.auth.signOut(); location.assign("/staff/login");});
    document.querySelector("#staff-enable-push")?.addEventListener("click", async (event)=>{
      const button=event.currentTarget;
      const publicKey=import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if(!("serviceWorker" in navigator)||!("PushManager" in window)){alert("Push notifications are not supported by this browser. On iPhone, install Step Town to your Home Screen first.");return;}
      if(!publicKey){alert("VITE_VAPID_PUBLIC_KEY is not configured on the site yet.");return;}
      const permission=await Notification.requestPermission();
      if(permission!=="granted"){alert("Notification permission was not granted.");return;}
      button.disabled=true;button.textContent="Enabling…";
      try{
        const registration=await navigator.serviceWorker.register("/sw.js");
        const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(publicKey)});
        const json=subscription.toJSON();
        const {error}=await supabase.from("push_subscriptions").upsert({user_id:profile.user_id,endpoint:json.endpoint,p256dh:json.keys.p256dh,auth_key:json.keys.auth,user_agent:navigator.userAgent,updated_at:new Date().toISOString()},{onConflict:"endpoint"});
        if(error)throw error;
        button.textContent="Alerts enabled";
      }catch(error){console.error(error);alert("Could not enable notifications: "+error.message);button.disabled=false;button.textContent="Enable alerts";}
    });
    app.querySelectorAll("[data-staff-nav]").forEach(a=>a.classList.toggle("active", a.getAttribute("href")===location.pathname));
  }
  function navLinks(){
    const items=[["/staff/dashboard","Overview",["manager","accountant","cashier"]],["/staff/orders","Orders",["manager","accountant","cashier"]],["/staff/products","Products",["manager","accountant"]],["/staff/gallery","Gallery",["manager","accountant"]],["/staff/enquiries","Enquiries",["manager","accountant","cashier"]],["/staff/reports","Reports",["manager","accountant"]],["/staff/team","Team",["manager"]],["/staff/audit","Audit log",["manager"]]];
    return items.filter(x=>x[2].includes(profile?.role)).map(x=>'<a data-staff-nav href="'+x[0]+'">'+x[1]+'</a>').join("");
  }
  function loginView(message=""){
    app.innerHTML='<div class="staff-login-wrap"><a class="staff-brand staff-login-brand" href="/"><span class="staff-mark">ST</span><span><b>STEP TOWN</b><small>STAFF ACCESS</small></span></a><section class="staff-login-card"><p class="staff-eyebrow">PRIVATE TEAM PORTAL</p><h1>Welcome back.</h1><p class="staff-muted">Sign in with the credentials issued by your manager.</p><form id="staff-login-form"><label>Email address<input name="email" type="email" autocomplete="username" required placeholder="name@steptown.rw"></label><label>Password<input name="password" type="password" autocomplete="current-password" required placeholder="Your password"></label><p id="staff-login-error" class="staff-error" role="alert">'+esc(message)+'</p><button class="staff-primary" type="submit">Sign in securely</button></form><p class="staff-login-foot">Staff accounts are invitation-only. There is no public staff registration.</p></section><a class="staff-cancel" href="/" aria-label="Cancel and return home">×</a></div>';
    document.querySelector("#staff-login-form")?.addEventListener("submit", async e=>{
      e.preventDefault(); const form=e.currentTarget; const data=new FormData(form); const button=form.querySelector("button"); const error=form.querySelector("#staff-login-error");
      button.disabled=true; button.textContent="Signing in…"; error.textContent="";
      const {error:authError}=await supabase.auth.signInWithPassword({email:String(data.get("email")).trim(),password:String(data.get("password"))});
      if(authError){error.textContent="Sign-in failed. Check your email and password, then try again.";button.disabled=false;button.innerHTML='Sign in securely';return;}
      location.assign(safeNext);
    });
  }
  async function requireProfile(){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){location.replace("/staff/login?next="+encodeURIComponent(location.pathname));return false;}
    const {data,error}=await supabase.from("staff_profiles").select("id,user_id,full_name,email,phone,role,reports_to,is_active,must_change_password").eq("user_id",session.user.id).maybeSingle();
    if(error || !data || !data.is_active || !["manager","accountant","cashier"].includes(data.role)){
      await supabase.auth.signOut(); loginView("This account does not have active Step Town staff access. Contact your Manager."); return false;
    }
    profile=data;
    if(data.must_change_password && !location.pathname.endsWith("/change-password")){location.assign("/staff/change-password");return false;}
    return true;
  }
  async function rows(table, query){const result=await query; if(result.error) throw result.error; return result.data||[];}
  function errorPanel(error){return '<div class="staff-alert">'+esc(error?.message || "Something went wrong. Refresh and try again.")+'</div>';}
  async function dashboard(){
    const [orders,enquiries,products]=await Promise.all([
      rows("orders",supabase.from("store_orders").select("id,order_number,status,customer_name,estimated_total,created_at").order("created_at",{ascending:false}).limit(8)),
      rows("enquiries",supabase.from("enquiries").select("id,name,service,status,created_at").order("created_at",{ascending:false}).limit(5)),
      rows("products",supabase.from("store_products").select("id",{count:"exact",head:true}))
    ]);
    shell("Good day, "+(profile.full_name||"team")+".",'<section class="staff-stats"><article><span>Recent orders</span><b>'+orders.length+'</b><small>Latest requests</small></article><article><span>Open enquiries</span><b>'+enquiries.filter(x=>x.status!=="closed").length+'</b><small>Need follow-up</small></article><article><span>Menu items</span><b>'+products.length+'</b><small>Catalog records</small></article></section><section class="staff-panel"><div class="staff-panel-head"><h2>Latest orders</h2><a href="/staff/orders">View all </a></div>'+orderTable(orders)+'</section><section class="staff-panel"><div class="staff-panel-head"><h2>Recent enquiries</h2><a href="/staff/enquiries">Open inbox </a></div>'+enquiryTable(enquiries)+'</section>');
  }
  function orderTable(data){return data.length?'<div class="staff-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>'+data.map(o=>'<tr><td><b>'+esc(o.order_number||o.id.slice(0,8))+'</b><small>'+new Date(o.created_at).toLocaleString()+'</small></td><td>'+esc(o.customer_name)+'</td><td><span class="staff-status">'+esc(o.status)+'</span></td><td>'+money(o.estimated_total)+'</td><td><a href="/staff/orders/'+encodeURIComponent(o.order_number||o.id)+'">Open </a></td></tr>').join("")+'</tbody></table></div>':'<p class="staff-empty">No orders yet.</p>';}
  function enquiryTable(data){return data.length?'<div class="staff-table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Status</th><th>Date</th></tr></thead><tbody>'+data.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.service)+'</td><td>'+esc(x.status)+'</td><td>'+new Date(x.created_at).toLocaleDateString()+'</td></tr>').join("")+'</tbody></table></div>':'<p class="staff-empty">No enquiries yet.</p>';}
  async function orderList(){
    const {data,error}=await supabase.from("store_orders").select("*").order("created_at",{ascending:false}).limit(200);
    shell("Orders",'<section class="staff-panel"><div class="staff-panel-head"><h2>Order inbox</h2><span>New · Confirmed · Preparing · Ready · Completed · Cancelled</span></div><div class="staff-filters"><input id="order-filter" placeholder="Search order or customer"><div class="staff-order-tabs"><button type="button" data-order-tab="pending" class="active">Pending</button><button type="button" data-order-tab="progress">In progress</button><button type="button" data-order-tab="finished">Finished</button><button type="button" data-order-tab="cancelled">Cancelled</button><button type="button" data-order-tab="all">All</button></div></div><div id="order-table">'+(error?errorPanel(error):orderTable(data||[]))+'</div></section>');
    let group="pending";
    const render=()=>{const term=app.querySelector("#order-filter").value.toLowerCase();const filtered=(data||[]).filter(o=>{const status=o.status;const inGroup=group==="all"||(group==="pending"&&status==="new")||(group==="progress"&&["confirmed","preparing","ready","in_progress"].includes(status))||(group==="finished"&&["completed","finished"].includes(status))||(group==="cancelled"&&status==="cancelled");return inGroup&&((o.order_number||"").toLowerCase().includes(term)||(o.customer_name||"").toLowerCase().includes(term));});app.querySelector("#order-table").innerHTML=orderTable(filtered);};
    app.querySelector("#order-filter")?.addEventListener("input",render);
    app.querySelectorAll("[data-order-tab]").forEach(button=>button.addEventListener("click",()=>{group=button.dataset.orderTab;app.querySelectorAll("[data-order-tab]").forEach(x=>x.classList.toggle("active",x===button));render();}));
    render();
  }
  async function orderDetail(key){
    const col=key.startsWith("ST-")?"order_number":"id";
    const {data:o,error}=await supabase.from("store_orders").select("*").eq(col,key).maybeSingle();
    if(error||!o){shell("Order not found",errorPanel(error||{message:"No order matches "+key}));return;}
    activeOrder=o;
    const {data:payments}=await supabase.from("store_order_payments").select("*").eq("order_id",o.id).order("recorded_at",{ascending:false});
    shell("Order "+esc(o.order_number||o.id.slice(0,8)),'<section class="staff-panel"><div class="staff-order-head"><div><p class="staff-eyebrow">ORDER DETAILS</p><h2>'+esc(o.customer_name)+'</h2><p>'+esc(o.customer_phone)+' · '+esc(o.customer_email||"No email")+'</p><div class="staff-actions"><a href="tel:'+esc(o.customer_phone)+'">Call customer</a><a target="_blank" rel="noopener" href="https://wa.me/'+esc(o.customer_phone.replace(/\D/g,""))+'">WhatsApp</a></div></div><span class="staff-status">'+esc(o.status)+'</span></div><div class="staff-detail-grid"><div><small>FULFILMENT</small><b>'+esc(o.fulfillment)+'</b></div><div><small>REQUESTED DATE</small><b>'+esc(o.requested_date||"Not specified")+' '+esc(o.requested_time||"")+'</b></div><div><small>LOCATION</small><b>'+esc(o.delivery_location||"Pickup")+'</b></div><div><small>ESTIMATED TOTAL</small><b>'+money(o.estimated_total)+'</b></div></div><h3>Items</h3><div class="staff-items">'+(Array.isArray(o.items)?o.items.map(i=>'<p><b>'+Number(i.quantity||1)+' × '+esc(i.name)+'</b><span>'+money(i.line_total)+'</span></p>').join(""):"")+'</div><p class="staff-notes">'+esc(o.notes||"No additional notes.")+'</p></section><section class="staff-panel"><h2>Update order</h2><form id="order-update-form" class="staff-inline-form"><label>Status<select name="status">'+["new","confirmed","preparing","ready","completed","cancelled"].map(s=>'<option value="'+s+'" '+(o.status===s?"selected":"")+'>'+s[0].toUpperCase()+s.slice(1)+'</option>').join("")+'</select></label><label>Payment method<select name="method"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label><label>Amount paid<input name="amount" type="number" min="0" step="1" placeholder="0"></label><label>Reference<input name="reference" placeholder="Optional transaction reference"></label><button class="staff-primary">Save update</button></form><div id="order-update-message" class="staff-muted"></div><h3>Payments</h3>'+(payments||[]).map(p=>'<p>'+esc(p.method)+' · '+money(p.amount)+' · '+esc(p.reference||"No reference")+'</p>').join("")+'</section><button class="staff-quiet" id="print-order">Print receipt</button>');
    app.querySelector("#order-update-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);const status=String(f.get("status"));const old=o.status;
      const {error:upErr}=await supabase.from("store_orders").update({status,acknowledged_at:o.acknowledged_at||(status!=="new"?new Date().toISOString():null),updated_at:new Date().toISOString(),updated_by:profile.user_id}).eq("id",o.id);
      if(upErr){app.querySelector("#order-update-message").textContent="Could not update order: "+upErr.message;return;}
      if(status!==old) await supabase.from("store_order_events").insert({order_id:o.id,actor_id:profile.user_id,event_type:"status_change",old_status:old,new_status:status,description:"Order status changed by "+profile.full_name});
      const amount=Number(f.get("amount"));if(amount>0){const {error:payErr}=await supabase.from("store_order_payments").insert({order_id:o.id,method:String(f.get("method")),amount,reference:String(f.get("reference")||"").trim()||null,recorded_by:profile.user_id});if(payErr){app.querySelector("#order-update-message").textContent="Status saved, but payment failed: "+payErr.message;return;}}
      await supabase.from("audit_log").insert({actor_id:profile.user_id,actor_role:profile.role,action:"order_updated",entity_type:"store_order",entity_id:o.id,details:{from:old,to:status}});
      app.querySelector("#order-update-message").textContent="Order saved.";setTimeout(()=>orderDetail(key),400);
    });
    app.querySelector("#print-order")?.addEventListener("click",()=>window.print());
  }
  async function productsPage(){
    const {data,error}=await supabase.from("store_products").select("*,store_categories(name)").order("created_at",{ascending:false});
    shell("Products",'<section class="staff-panel"><h2>Add a menu item</h2><form id="product-form" class="staff-form-grid"><label>Product name<input name="name" required maxlength="120"></label><label>Category<select name="category_id" id="product-category" required></select></label><label>Price (RWF)<input name="price" type="number" min="0" step="1"></label><label>Product photos<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple></label><label class="wide">Description<textarea name="description" rows="2"></textarea></label><label class="staff-check"><input type="checkbox" name="is_available" checked> Available</label><label class="staff-check"><input type="checkbox" name="has_stock" checked> In stock</label><button class="staff-primary">Publish product</button></form><p id="product-message" class="staff-muted"></p></section><section class="staff-panel"><h2>Menu catalogue</h2>'+(error?errorPanel(error):'<div class="staff-table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Visibility</th><th></th></tr></thead><tbody>'+(data||[]).map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.store_categories?.name||"")+'</td><td>'+money(p.price)+'</td><td>'+((p.is_visible&&p.is_available&&p.has_stock)?"Live":"Hidden")+'</td><td><button data-edit-product="'+p.id+'">Edit</button> <button data-hide-product="'+p.id+'">'+(p.is_visible?"Hide":"Show")+'</button> <button data-delete-product="'+p.id+'">Delete</button></td>').join("")+'</tbody></table></div>')+'</section>');
    const cats=await supabase.from("store_categories").select("id,name").order("sort_order");app.querySelector("#product-category").innerHTML=(cats.data||[]).map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join("");
    app.querySelector("#product-form")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={name:String(f.get("name")).trim(),category_id:f.get("category_id"),price:f.get("price")?Number(f.get("price")):null,image_url:null,image_urls:[],description:String(f.get("description")||"").trim()||null,is_available:f.has("is_available"),has_stock:f.has("has_stock"),is_visible:true,updated_by:profile.user_id};try{const files=Array.from(e.currentTarget.querySelector('[name="images"]').files||[]);const urls=[];for(const file of files){if(file.size>10*1024*1024)throw new Error("Each image must be 10 MB or smaller.");const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-");const objectPath="products/"+Date.now()+"-"+crypto.randomUUID()+"-"+safe;const {error:uploadError}=await supabase.storage.from("step-town-media").upload(objectPath,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;urls.push(supabase.storage.from("step-town-media").getPublicUrl(objectPath).data.publicUrl);}payload.image_urls=urls;payload.image_url=urls[0]||null;const {error:err}=await supabase.from("store_products").insert(payload);app.querySelector("#product-message").textContent=err?err.message:"Product published.";if(!err)setTimeout(productsPage,500);}catch(uploadError){app.querySelector("#product-message").textContent=uploadError.message;}});
    app.querySelectorAll("[data-hide-product]").forEach(b=>b.addEventListener("click",async()=>{const row=data.find(p=>p.id===b.dataset.hideProduct);const {error:err}=await supabase.from("store_products").update({is_visible:!row.is_visible,updated_by:profile.user_id}).eq("id",row.id);if(err)alert(err.message);else productsPage();}));
    app.querySelectorAll("[data-edit-product]").forEach(b=>b.addEventListener("click",async()=>{const row=data.find(p=>p.id===b.dataset.editProduct);const name=prompt("Product name:",row.name);if(name===null)return;const priceText=prompt("Price in RWF (leave blank for quote):",row.price??"");if(priceText===null)return;const description=prompt("Description:",row.description||"");if(description===null)return;const price=priceText.trim()===""?null:Number(priceText);if(price!==null&&(!Number.isFinite(price)||price<0)){alert("Enter a valid non-negative price.");return;}const {error:err}=await supabase.from("store_products").update({name:name.trim(),price,description:description.trim()||null,updated_by:profile.user_id}).eq("id",row.id);if(err)alert(err.message);else productsPage();}));
    app.querySelectorAll("[data-delete-product]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Permanently delete this product?"))return;const {error:err}=await supabase.from("store_products").delete().eq("id",b.dataset.deleteProduct);if(err)alert(err.message);else productsPage();}));
  }
  async function galleryPage(){
    const {data,error}=await supabase.from("gallery_items").select("*").order("sort_order");
    shell("Gallery",'<section class="staff-panel"><h2>Add gallery image</h2><form id="gallery-form" class="staff-form-grid"><label>Title<input name="title" required></label><label>Category<select name="category"><option>Catering</option><option>Staff</option><option>Barbecue</option><option>Cakes</option></select></label><label class="wide">Image file<input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required></label><label class="wide">Caption<input name="caption"></label><button class="staff-primary">Add image</button></form><p id="gallery-message"></p></section><section class="staff-panel"><h2>Gallery library</h2>'+(error?errorPanel(error):'<div class="staff-gallery">'+(data||[]).map(x=>'<article><img src="'+esc(x.image_url)+'" alt="'+esc(x.alt_text||x.title)+'"><b>'+esc(x.title)+'</b><small>'+esc(x.category)+'</small><button data-gallery-delete="'+x.id+'">Delete</button></article>').join("")+'</div>')+'</section>');
    app.querySelector("#gallery-form")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const file=e.currentTarget.querySelector('[name="image_file"]').files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error("Image must be 10 MB or smaller.");const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-");const objectPath="gallery/"+Date.now()+"-"+crypto.randomUUID()+"-"+safe;const {error:uploadError}=await supabase.storage.from("step-town-media").upload(objectPath,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;const imageUrl=supabase.storage.from("step-town-media").getPublicUrl(objectPath).data.publicUrl;const {error:err}=await supabase.from("gallery_items").insert({title:f.get("title"),category:f.get("category"),image_url:imageUrl,caption:f.get("caption")||null,created_by:profile.user_id,is_published:true});app.querySelector("#gallery-message").textContent=err?.message||"Image added.";if(!err)setTimeout(galleryPage,500);}catch(err){app.querySelector("#gallery-message").textContent=err.message;}});
    app.querySelectorAll("[data-gallery-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Delete this gallery image?"))return;const {error:err}=await supabase.from("gallery_items").delete().eq("id",b.dataset.galleryDelete);if(err)alert(err.message);else galleryPage();}));
  }
  async function enquiriesPage(){
    const {data,error}=await supabase.from("enquiries").select("*").order("created_at",{ascending:false}).limit(300);
    shell("Enquiries",'<section class="staff-panel"><h2>Website enquiry inbox</h2>'+(error?errorPanel(error):'<div class="staff-table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Event</th><th>Contact</th><th>Status</th></tr></thead><tbody>'+(data||[]).map(x=>'<tr><td><b>'+esc(x.name)+'</b><small>'+new Date(x.created_at).toLocaleString()+'</small></td><td>'+esc(x.service)+'</td><td>'+esc(x.event_date||"—")+'<small>'+esc(x.guest_count||"")+' guests · '+esc(x.event_location||"")+'</small></td><td><a href="tel:'+esc(x.phone)+'">'+esc(x.phone)+'</a></td><td><select data-enquiry-status="'+x.id+'">'+["new","contacted","quoted","closed"].map(s=>'<option '+(x.status===s?"selected":"")+'>'+s+'</option>').join("")+'</select></td></tr>').join("")+'</tbody></table></div>')+'</section>');
    app.querySelectorAll("[data-enquiry-status]").forEach(s=>s.addEventListener("change",async()=>{const {error:err}=await supabase.from("enquiries").update({status:s.value}).eq("id",s.dataset.enquiryStatus);if(err)alert(err.message);}));
  }
  async function reportsPage(){
    const since=new Date();since.setDate(since.getDate()-7);
    const {data,error}=await supabase.from("store_orders").select("order_number,customer_name,status,estimated_total,created_at").gte("created_at",since.toISOString()).order("created_at");
    const completed=(data||[]).filter(o=>["completed","finished"].includes(o.status));const total=completed.reduce((s,o)=>s+Number(o.estimated_total||0),0);const todayStart=new Date();todayStart.setHours(0,0,0,0);const todayCompleted=completed.filter(o=>new Date(o.created_at)>=todayStart);const todaySales=todayCompleted.reduce((s,o)=>s+Number(o.estimated_total||0),0);
    shell("Reports",'<section class="staff-stats"><article><span>Today · completed orders</span><b>'+todayCompleted.length+'</b></article><article><span>Today · sales</span><b>'+money(todaySales)+'</b></article><article><span>7-day orders</span><b>'+(data||[]).length+'</b></article><article><span>7-day completed</span><b>'+completed.length+'</b></article><article><span>7-day sales</span><b>'+money(total)+'</b></article></section><section class="staff-panel"><div class="staff-panel-head"><h2>Last 7 days</h2><button id="export-csv" class="staff-quiet">Export CSV </button></div>'+(error?errorPanel(error):orderTable(data||[]))+'</section>');
    app.querySelector("#export-csv")?.addEventListener("click",()=>{const lines=[["Order","Customer","Status","Total RWF","Created"],...(data||[]).map(o=>[o.order_number,o.customer_name,o.status,o.estimated_total,o.created_at])];const csv=lines.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="step-town-sales-last-7-days.csv";a.click();URL.revokeObjectURL(url);});
  }
  async function teamPage(){
    const {data,error}=await supabase.from("staff_profiles").select("id,user_id,full_name,email,role,is_active,reports_to,created_at").order("created_at");
    const accountants=(data||[]).filter(x=>x.role==="accountant"&&x.is_active);
    shell("Team",'<section class="staff-panel"><h2>Create a staff account</h2><form id="team-create-form" class="staff-form-grid"><label>Full name<input name="full_name" required maxlength="100"></label><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option value="accountant">Accountant</option><option value="cashier">Cashier</option></select></label><label>Temporary password<input name="password" type="password" minlength="12" required></label><label id="reports-to-wrap" class="wide" hidden>Reports to<select name="reports_to"><option value="">Choose an Accountant</option>'+accountants.map(x=>'<option value="'+x.id+'">'+esc(x.full_name)+'</option>').join("")+'</select></label><button class="staff-primary">Create account</button></form><p id="team-message" class="staff-muted">New accounts are required to change their password on first sign-in.</p></section><section class="staff-panel"><h2>Staff accounts</h2>'+(error?errorPanel(error):'<div class="staff-table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Reports to</th><th>Active</th><th>Actions</th></tr></thead><tbody>'+(data||[]).map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.email)+'</td><td>'+esc(roleTitle(x.role))+'</td><td>'+esc((data||[]).find(y=>y.id===x.reports_to)?.full_name||"—")+'</td><td>'+ (x.is_active?"Yes":"No")+'</td><td>'+(x.role!=="manager"?'<button data-staff-action="reset" data-user="'+x.user_id+'">Reset password</button> <button data-staff-action="'+(x.is_active?"deactivate":"activate")+'" data-user="'+x.user_id+'">'+(x.is_active?"Deactivate":"Activate")+'</button>':"—")+'</td></tr>').join("")+'</tbody></table></div>')+'</section>');
    const roleSelect=app.querySelector('[name="role"]'),reportsWrap=app.querySelector("#reports-to-wrap");
    roleSelect?.addEventListener("change",()=>{reportsWrap.hidden=roleSelect.value!=="cashier";});
    app.querySelector("#team-create-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);const payload={action:"create",full_name:String(f.get("full_name")).trim(),email:String(f.get("email")).trim(),password:String(f.get("password")),role:String(f.get("role")),reports_to:String(f.get("reports_to")||"")};
      const {data:result,error:fnError}=await supabase.functions.invoke("staff-admin",{body:payload});
      app.querySelector("#team-message").textContent=fnError?.message||result?.error||"Account created. Share the temporary password securely.";
      if(!fnError&&result?.ok)setTimeout(teamPage,700);
    });
    app.querySelectorAll("[data-staff-action]").forEach(button=>button.addEventListener("click",async()=>{
      const action=button.dataset.staffAction;let body={action,user_id:button.dataset.user};
      if(action==="reset"){const password=prompt("Enter a new temporary password (at least 12 characters):");if(!password)return;if(password.length<12){alert("Use at least 12 characters.");return;}body.password=password;}
      if(action==="deactivate"&&!confirm("Deactivate this staff account?"))return;
      const {data:result,error:fnError}=await supabase.functions.invoke("staff-admin",{body});
      if(fnError||result?.error)alert(fnError?.message||result.error);else teamPage();
    }));
  }
  async function auditPage(){
    const {data,error}=await supabase.from("audit_log").select("*").order("created_at",{ascending:false}).limit(300);
    shell("Audit log",'<section class="staff-panel"><h2>Recent activity</h2>'+(error?errorPanel(error):'<div class="staff-table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead><tbody>'+(data||[]).map(x=>'<tr><td>'+new Date(x.created_at).toLocaleString()+'</td><td>'+esc(x.actor_role)+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.entity_type)+' · '+esc(x.entity_id)+'</td></tr>').join("")+'</tbody></table></div>')+'</section>');
  }
  async function changePassword(){
    shell("Change password",'<section class="staff-panel staff-password"><p class="staff-eyebrow">FIRST SIGN-IN SECURITY</p><h2>Set a new password</h2><p>You must change the temporary password before using the staff workspace.</p><form id="change-password-form"><label>New password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label>Confirm password<input name="confirm" type="password" minlength="12" required autocomplete="new-password"></label><button class="staff-primary">Update password</button><p id="password-message" role="alert"></p></form></section>');
    app.querySelector("#change-password-form")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),password=String(f.get("password"));if(password!==f.get("confirm")){app.querySelector("#password-message").textContent="Passwords do not match.";return;}const {error}=await supabase.auth.updateUser({password});if(error){app.querySelector("#password-message").textContent=error.message;return;}const {data:complete,error:profileError}=await supabase.functions.invoke("staff-admin",{body:{action:"complete-password-change"}});if(profileError||complete?.error){app.querySelector("#password-message").textContent=profileError?.message||complete?.error||"Password changed, but the staff security flag could not be updated. Contact the Manager.";return;}location.assign("/staff/dashboard");});
  }
  async function start(){
    if(!supabaseConfigured){loginView("Staff authentication is not configured. Contact the site administrator.");return;}
    if(path==="/staff/login"){const {data:{session}}=await supabase.auth.getSession();if(session)location.assign(safeNext);else loginView();return;}
    if(!(await requireProfile()))return;
    if(path==="/staff"||path==="/staff/dashboard")return dashboard();
    if(path==="/staff/orders")return orderList();
    if(path.startsWith("/staff/orders/"))return orderDetail(decodeURIComponent(path.split("/").pop()));
    if(path==="/staff/products" && ["manager","accountant"].includes(profile.role))return productsPage();
    if(path==="/staff/gallery" && ["manager","accountant"].includes(profile.role))return galleryPage();
    if(path==="/staff/enquiries")return enquiriesPage();
    if(path==="/staff/reports" && ["manager","accountant"].includes(profile.role))return reportsPage();
    if(path==="/staff/team" && profile.role==="manager")return teamPage();
    if(path==="/staff/audit" && profile.role==="manager")return auditPage();
    if(path==="/staff/change-password")return changePassword();
    shell("Access restricted",'<section class="staff-panel"><h2>Your role cannot open this page.</h2><p>Sign in with an account that has the required permissions, or return to your dashboard.</p><a class="staff-primary" href="/staff/dashboard">Back to dashboard</a></section>');
  }
  start().catch(err=>{console.error(err);app.innerHTML='<div class="staff-login-wrap"><section class="staff-login-card"><h1>Workspace unavailable</h1><p>'+esc(err.message)+'</p><a href="/staff/login">Return to sign in</a></section></div>';});
}
