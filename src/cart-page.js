import "./cart-page.css";
import { apiFetch } from "./api.js";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const params = new URLSearchParams(window.location.search);
const CART_KEY = "step-town-cart-v1";
const CART_OWNER_KEY = "step-town-cart-owner-v1";
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => new Intl.NumberFormat("en-RW", {style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
const moneyLabel = value => value == null ? "To be confirmed" : money(value);
let cartItems = [];
let quickProduct = null;
let quickQuantity = 1;
let accountData = null;
let accountUser = false;
let requireLoginForCartList = false;
let cartSaveQueue = Promise.resolve();

function imageFor(product) {
  const first = Array.isArray(product?.images) ? product.images[0] : null;
  return (typeof first === "string" ? first : first?.url) ||
    (Array.isArray(product?.image_urls) ? product.image_urls[0] : "") ||
    product?.image_url || "";
}
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.product_id || raw.id || "");
  const quantity = Math.floor(Number(raw.quantity || 1));
  if (!id || !Number.isFinite(quantity) || quantity < 1) return null;
  const value = raw.price;
  const price = value == null || value === "" ? null : Number(value);
  return {
    ...raw, id, product_id:id,
    slug:String(raw.slug || ""),
    name:String(raw.name || "Menu item"),
    description:String(raw.description || ""),
    category_name:String(raw.category_name || raw.category?.name || raw.category || "Menu"),
    price:Number.isFinite(price) ? price : null,
    price_unit:String(raw.price_unit || "unit"),
    price_unit_label:String(raw.price_unit_label || raw.price_unit || "unit"),
    image_url:String(raw.image_url || imageFor(raw) || ""),
    quantity:Math.min(20,Math.max(1,quantity))
  };
}
function readSavedCart() {
  try {
    const saved=JSON.parse(localStorage.getItem(CART_KEY)||"[]");
    return Array.isArray(saved)?saved.map(normalizeItem).filter(Boolean).slice(0,50):[];
  } catch { return []; }
}
function writeSavedCart() {
  try { localStorage.setItem(CART_KEY,JSON.stringify(cartItems)); }
  catch(error) { console.warn("Could not persist the Step Town cart:",error); }
}
async function jsonRequest(url,options={}) {
  const response=await fetch(url,{credentials:"same-origin",...options});
  const data=await response.json().catch(()=>({}));
  return {response,data};
}
async function getAccount() {
  const {response,data}=await jsonRequest("/api/profile");
  if(response.ok){accountData=data;accountUser=true;return true;}
  if(response.status===401){accountData=null;accountUser=false;return false;}
  throw new Error(data.error||"We couldn't verify your account.");
}
async function getAccountCart() {
  const {response,data}=await jsonRequest("/api/profile/cart");
  if(!response.ok)throw new Error(data.error||"Your saved cart could not be loaded.");
  return Array.isArray(data.items)?data.items.map(normalizeItem).filter(Boolean):[];
}
function mergeCarts(primary,secondary) {
  const map=new Map();
  for(const raw of [...primary,...secondary]){
    const item=normalizeItem(raw);if(!item)continue;
    const previous=map.get(item.product_id);
    map.set(item.product_id,previous?{...previous,...item,quantity:Math.min(20,previous.quantity+item.quantity)}:item);
  }
  return [...map.values()].slice(0,50);
}
async function persistCart() {
  writeSavedCart();
  if(!accountUser)return;
  const items=cartItems.map(item=>({product_id:item.product_id,quantity:item.quantity}));
  cartSaveQueue=cartSaveQueue.then(async()=>{
    const response=await apiFetch("/api/profile/cart",{method:"PUT",body:{items}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Your account cart could not be saved.");
  });
  return cartSaveQueue;
}
async function getSelectedProduct(reference) {
  if(!reference)return null;
  const embedded=document.querySelector("#step-menu-initial-data");
  if(embedded){
    try{
      const initial=JSON.parse(embedded.textContent||"{}");
      const found=(initial.products||[]).find(product=>String(product.id)===reference||String(product.slug||"")===reference);
      if(found)return normalizeItem({...found,quantity:1});
    }catch{}
  }
  const isId=/^[0-9a-f-]{36}$/i.test(reference);
  const query=isId?"product_id=":"slug=";
  const {response,data}=await jsonRequest("/api/catalog?limit=1&"+query+encodeURIComponent(reference));
  if(!response.ok)throw new Error(data.error||"The product could not be loaded.");
  const found=(Array.isArray(data.products)?data.products:[]).find(product=>String(product.id)===reference||String(product.slug||"")===reference);
  return found?normalizeItem({...found,quantity:1}):null;
}
function currentOrderItems() {
  return quickProduct?[{...quickProduct,quantity:quickQuantity}]:cartItems;
}
function estimate(items) {
  const priced=items.filter(item=>item.price!=null&&Number.isFinite(Number(item.price)));
  const subtotal=priced.reduce((sum,item)=>sum+Number(item.price)*item.quantity,0);
  return {subtotal,allPriced:items.length>0&&priced.length===items.length,pricedCount:priced.length};
}
function totalLabel(items) {
  const e=estimate(items);
  return e.allPriced?money(e.subtotal):(e.pricedCount?money(e.subtotal)+" + quote":"Quote required");
}
function renderQuickProduct() {
  const section=document.querySelector("#quick-order-section");
  const host=document.querySelector("#quick-product-summary");
  if(!section||!host)return;
  section.hidden=!quickProduct;
  if(!quickProduct){host.innerHTML="";return;}
  const image=imageFor(quickProduct);
  const line=quickProduct.price==null?"Quote required":money(Number(quickProduct.price)*quickQuantity);
  host.innerHTML=
    '<article class="quick-product-card">'+
      '<div class="quick-product-image">'+(image?'<img src="'+html(image)+'" alt="'+html(quickProduct.name)+'">':'<div class="product-image-placeholder">STEP TOWN</div>')+'</div>'+
      '<div class="quick-product-copy"><span class="cart-selected-category">'+html(quickProduct.category_name)+'</span>'+
      '<h3>'+html(quickProduct.name)+'</h3>'+
      '<p class="quick-unit-price">'+html(moneyLabel(quickProduct.price))+' per '+html(quickProduct.price_unit_label)+'</p>'+
      '<div class="quick-product-footer"><div class="order-quantity" aria-label="Quick order quantity">'+
      '<button type="button" data-quick-action="decrease" aria-label="Decrease quantity">−</button><output aria-live="polite">'+quickQuantity+'</output>'+
      '<button type="button" data-quick-action="increase" aria-label="Increase quantity">+</button></div>'+
      '<div class="cart-line-total"><span>Line total</span><strong>'+html(line)+'</strong></div></div></div></article>'+
      '<p class="quick-order-note">This quick order is separate from the items saved in Your cart.</p>';
}
function renderSavedCart() {
  const host=document.querySelector("#cart-product-summary");
  const submit=document.querySelector("#product-order-submit");
  const status=document.querySelector("#product-order-error");
  if(!host)return;
  if(!cartItems.length){
    host.innerHTML='<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your cart is empty.</strong><p>Choose catering, barbecue or a celebration cake to start an order.</p><a class="button button-light" href="/categories">Browse the menu</a></div>';
  }else{
    const itemsHtml=cartItems.map(item=>{
      const image=imageFor(item),priced=item.price!=null&&Number.isFinite(Number(item.price));
      const unit=item.price_unit_label||item.price_unit||"unit";
      const line=priced?money(Number(item.price)*item.quantity):"Quote required";
      return '<article class="cart-selected-item" data-cart-product="'+html(item.product_id)+'">'+
        '<div class="cart-selected-image">'+(image?'<img src="'+html(image)+'" alt="'+html(item.name)+'" loading="lazy">':'<div class="product-image-placeholder">STEP TOWN</div>')+'</div>'+
        '<div class="cart-selected-copy"><div class="cart-selected-head"><span class="cart-selected-category">'+html(item.category_name)+'</span>'+
        '<button class="cart-item-remove" type="button" data-cart-action="remove" aria-label="Remove '+html(item.name)+'">Remove</button></div>'+
        '<h2>'+html(item.name)+'</h2>'+
        (item.description?'<p class="cart-summary-description">'+html(item.description)+'</p>':'')+
        '<div class="cart-unit-price"><span>Price per '+html(unit)+'</span><strong>'+html(priced?money(item.price):"To be confirmed")+'</strong></div>'+
        '<div class="cart-item-footer"><div class="order-quantity" aria-label="Quantity for '+html(item.name)+'">'+
        '<button type="button" data-cart-action="decrease" aria-label="Decrease quantity">−</button><output aria-live="polite">'+item.quantity+'</output>'+
        '<button type="button" data-cart-action="increase" aria-label="Increase quantity">+</button></div>'+
        '<div class="cart-line-total"><span>Item total</span><strong>'+html(line)+'</strong></div></div></div></article>';
    }).join("");
    const total=totalLabel(cartItems);
    const e=estimate(cartItems);
    const note=e.allPriced?"Estimated total only. Step Town will confirm availability and final pricing.":"This estimate includes priced items only. Items marked “To be confirmed” will be quoted by Step Town.";
    host.innerHTML='<div class="cart-selected-items">'+itemsHtml+'</div><div class="cart-estimate-bar"><div><span>Estimated cart total</span><strong>'+html(total)+'</strong></div><p>'+html(note)+'</p></div>';
  }
  if(submit){
    submit.disabled=currentOrderItems().length===0;
    submit.textContent="Send order";
  }
  if(status&&status.dataset.clearOnRender==="true")status.textContent="";
}
function positionOrderForm() {
  const form=document.querySelector("#product-order-form");
  const quickMount=document.querySelector("#quick-order-form-mount");
  const cartMount=document.querySelector("#saved-order-form-mount");
  if(!form)return;
  if(quickProduct&&quickMount)quickMount.append(form);
  else if(cartMount)cartMount.append(form);
}
function updateDeliveryField() {
  const select=document.querySelector("#order-fulfillment");
  const label=document.querySelector("#order-location-label");
  const input=document.querySelector("#order-delivery-location");
  const delivery=select?.value==="delivery";
  if(label)label.hidden=!delivery;
  if(input)input.required=Boolean(delivery);
}
async function initialiseCart() {
  const config=await jsonRequest("/api/config").catch(()=>({response:{ok:false},data:{}}));
  requireLoginForCartList=Boolean(config.response?.ok&&config.data?.requireLoginForCartList);
  let localItems=readSavedCart();
  try {
    const signedIn=await getAccount();
    if(requireLoginForCartList&&!signedIn){window.location.replace("/login?next="+encodeURIComponent("/cart"+window.location.search));return false;}
    if(signedIn){
      const accountCart=await getAccountCart();
      let owner=localStorage.getItem(CART_OWNER_KEY)||"";
      if(owner&&owner!==accountData.user.id){
        // The previous snapshot belonged to another account, not a guest.
        localStorage.removeItem(CART_KEY);
        localStorage.removeItem(CART_OWNER_KEY);
        localItems=[];
        owner="";
      }
      if(!owner){
        cartItems=mergeCarts(accountCart,localItems);
        if(localItems.length)await persistCart();
        else cartItems=accountCart;
      }else{
        cartItems=accountCart;
      }
      localStorage.setItem(CART_OWNER_KEY,accountData.user.id);
      writeSavedCart();
    }else{
      if(localStorage.getItem(CART_OWNER_KEY)){
        localStorage.removeItem(CART_OWNER_KEY);
        localStorage.removeItem(CART_KEY);
        localItems=[];
      }
      cartItems=localItems;
      writeSavedCart();
    }
  }catch(error){
    cartItems=localItems;
    const status=document.querySelector("#product-order-error");
    if(status)status.textContent=error.message||"Your saved cart could not be loaded.";
  }

  const dateInput=document.querySelector("#order-preferred-date");
  if(dateInput)dateInput.min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  if(accountUser&&accountData){
    const form=document.querySelector("#product-order-form");
    const name=form?.elements.customer_name;
    const phone=form?.elements.customer_phone;
    const email=form?.elements.customer_email;
    const savedName=accountData.profile?.full_name||accountData.user?.user_metadata?.full_name||accountData.user?.user_metadata?.name;
    const savedPhone=accountData.profile?.phone||accountData.user?.phone;
    if(savedName&&name)name.value=savedName;
    if(savedPhone&&phone)phone.value=savedPhone;
    if(accountData.user?.email&&email){email.value=accountData.user.email;email.readOnly=true;email.setAttribute("aria-readonly","true");}
  }

  const selectedReference=params.get("product");
  if(selectedReference){
    try {
      quickProduct=await getSelectedProduct(selectedReference);
      if(!quickProduct)throw new Error("This product is no longer available. Please browse the menu and try again.");
      quickQuantity=1;
      document.querySelector("#cart-page-title").textContent="Place an order.";
    } catch(error) {
      const status=document.querySelector("#product-order-error");
      if(status)status.textContent=error.message||"The selected product could not be loaded.";
    }
  }
  renderQuickProduct();
  renderSavedCart();
  positionOrderForm();
  updateDeliveryField();
  return true;
}
function renderConfirmation() {
  document.body.classList.add("route-confirmation");
  const cart=document.querySelector("#cart-page");
  const confirm=document.querySelector("#order-confirmation-page");
  const tracking=document.querySelector("#tracking-page");
  if(cart)cart.hidden=true;
  if(confirm)confirm.hidden=false;
  if(tracking)tracking.hidden=true;
  const saved=sessionStorage.getItem("step-town-last-order");
  let detail=null;try{detail=saved?JSON.parse(saved):null;}catch{}
  const order=detail?.order||{};
  const number=document.querySelector("#confirmed-order-number");
  if(number)number.textContent=order.order_number||params.get("order")||"";
  const items=Array.isArray(order.items)?order.items:[];
  const summary=document.querySelector("#confirmation-summary");
  if(summary){
    summary.innerHTML=items.length?'<div class="confirmation-items">'+items.map(item=>
      '<p><span>'+html(item.name)+' × '+Number(item.quantity||1)+'</span><b>'+html(item.line_total==null?"Quote to be confirmed":money(item.line_total))+'</b></p>'
    ).join("")+'</div><p class="confirmation-total"><span>Estimated total</span><b>'+html(order.estimated_total==null?"To be confirmed":money(order.estimated_total))+'</b></p>':"";
  }
  const track=document.querySelector("#confirmation-tracking-link");
  const url=detail?.tracking_url|| (detail?.tracking_token?"/order/"+detail.tracking_token:"");
  if(track&&url){track.href=url;track.hidden=false;}
  const next=document.querySelector("#confirmation-create-account");
  if(next)next.href="/login?next="+encodeURIComponent("/profile/orders");
  const message=sessionStorage.getItem("step-town-last-order-message")||"";
  const whatsapp=document.querySelector("#confirmation-whatsapp");
  if(message&&whatsapp){whatsapp.href="https://wa.me/250780382589?text="+encodeURIComponent(message);whatsapp.hidden=false;}
}
async function renderTracking() {
  document.body.classList.add("route-confirmation");
  const cart=document.querySelector("#cart-page");
  const confirm=document.querySelector("#order-confirmation-page");
  const tracking=document.querySelector("#tracking-page");
  if(cart)cart.hidden=true;if(confirm)confirm.hidden=true;if(tracking)tracking.hidden=false;
  const token=path.split("/").pop();
  const status=document.querySelector("#tracking-status");
  try{
    const {response,data}=await jsonRequest("/api/orders/track/"+encodeURIComponent(token));
    if(!response.ok)throw new Error(data.error||"This tracking link could not be loaded.");
    const order=data.order||{};
    document.querySelector("#tracking-order-number").textContent=order.order_number||"";
    status.textContent="Status: "+String(order.status||"new").replace(/_/g," ");
    const items=Array.isArray(order.items)?order.items:[];
    document.querySelector("#tracking-summary").innerHTML=
      '<div class="confirmation-items">'+items.map(item=>'<p><span>'+html(item.name)+' × '+Number(item.quantity||1)+'</span><b>'+html(item.line_total==null?"Quote to be confirmed":money(item.line_total))+'</b></p>').join("")+'</div>'+
      '<p class="confirmation-total"><span>Estimated total</span><b>'+html(order.estimated_total==null?"To be confirmed":money(order.estimated_total))+'</b></p>';
    const delivery=[order.fulfillment==="delivery"?"Delivery":"Pickup",order.delivery_location,order.requested_date,order.requested_time].filter(Boolean).join(" · ");
    document.querySelector("#tracking-delivery").textContent="Delivery details: "+delivery;
  }catch(error){if(status)status.textContent=error.message||"Tracking is temporarily unavailable.";}
}
async function submitOrder(form) {
  const status=document.querySelector("#product-order-error");
  const button=document.querySelector("#product-order-submit");
  if(status)status.textContent="";
  const items=currentOrderItems();
  if(!items.length){if(status)status.textContent="Add at least one menu item before sending your order.";return;}
  if(!form.reportValidity())return;
  const fields=new FormData(form);
  const order={
    customer_name:String(fields.get("customer_name")||"").trim(),
    customer_phone:String(fields.get("customer_phone")||"").trim(),
    customer_email:String(fields.get("customer_email")||"").trim(),
    fulfillment:String(fields.get("fulfillment")||"pickup"),
    requested_date:String(fields.get("requested_date")||"")||null,
    requested_time:String(fields.get("requested_time")||"")||null,
    delivery_location:String(fields.get("delivery_location")||"").trim()||null,
    order_description:String(fields.get("order_description")||"").trim(),
    notes:String(fields.get("notes")||"").trim(),
    website:String(fields.get("website")||""),
    items:items.map(item=>({product_id:item.product_id,slug:item.slug,quantity:item.quantity}))
  };
  if(button){button.disabled=true;button.textContent="Sending order…";}
  try{
    const response=await apiFetch("/api/orders",{method:"POST",body:order});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(status)status.textContent=data.error||"We couldn't save your order. Please check the details and try again.";return;}
    const savedOrder=data.order||{};
    const message=[
      "Hello Step Town, I have placed an order request.",
      "Order: "+(savedOrder.order_number||""),
      "Name: "+order.customer_name,
      "Phone: "+order.customer_phone,
      "Email: "+order.customer_email,
      "Items:",...items.map(item=>"- "+item.name+" × "+item.quantity),
      "Estimated total: "+(savedOrder.estimated_total==null?"To be confirmed":money(savedOrder.estimated_total)),
      order.order_description?"Describe your order: "+order.order_description:"",
      "Fulfilment: "+order.fulfillment,
      order.requested_date?"Preferred date: "+order.requested_date:"",
      order.requested_time?"Preferred time: "+order.requested_time:"",
      order.delivery_location?"Location: "+order.delivery_location:"",
      order.notes?"Notes: "+order.notes:""
    ].filter(Boolean).join("\n");
    sessionStorage.setItem("step-town-last-order-message",message);
    sessionStorage.setItem("step-town-last-order",JSON.stringify({
      order:savedOrder,tracking_url:data.tracking_url||"",
      tracking_token:savedOrder.tracking_token||""
    }));
    if(!quickProduct){
      cartItems=[];
      await persistCart().catch(error=>console.warn("Order saved; cart clearing was deferred:",error.message));
    }
    window.location.assign("/order/confirmation?order="+encodeURIComponent(savedOrder.order_number||""));
  }catch(error){
    if(status)status.textContent=error.message||"Connection problem. Check your internet and try again.";
  }finally{
    if(button){button.disabled=false;button.textContent="Send order";}
  }
}
function startCartPage() {
  document.body.classList.add("route-cart");
  const cartPage=document.querySelector("#cart-page");
  if(cartPage)cartPage.hidden=false;
  document.querySelector("#cart-page-close")?.addEventListener("click",()=>window.location.assign("/categories"));
  document.querySelector("#cart-product-summary")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-cart-action]");
    if(!button)return;
    const row=button.closest("[data-cart-product]");
    const id=row?.dataset.cartProduct;
    const item=cartItems.find(entry=>entry.product_id===id);
    if(!item)return;
    if(button.dataset.cartAction==="increase")item.quantity=Math.min(20,item.quantity+1);
    else if(button.dataset.cartAction==="decrease")item.quantity=Math.max(1,item.quantity-1);
    else if(button.dataset.cartAction==="remove")cartItems=cartItems.filter(entry=>entry.product_id!==id);
    renderSavedCart();
    await persistCart().catch(error=>{
      const status=document.querySelector("#product-order-error");
      if(status)status.textContent=error.message||"Your cart change could not be saved.";
    });
  });
  document.querySelector("#quick-product-summary")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-quick-action]");
    if(!button||!quickProduct)return;
    quickQuantity=button.dataset.quickAction==="increase"?Math.min(20,quickQuantity+1):Math.max(1,quickQuantity-1);
    renderQuickProduct();
  });
  document.querySelector("#order-fulfillment")?.addEventListener("change",updateDeliveryField);
  const form=document.querySelector("#product-order-form");
  form?.addEventListener("submit",event=>{event.preventDefault();void submitOrder(form);});
  void initialiseCart().then(ok=>{if(!ok)return;renderQuickProduct();renderSavedCart();positionOrderForm();});
}

if(path==="/cart")startCartPage();
if(path==="/order/confirmation")renderConfirmation();
if(path.startsWith("/order/")&&path!=="/order/confirmation")void renderTracking();
