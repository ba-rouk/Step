import "./cart-page.css";
import { apiFetch } from "./api.js";
import { REQUIRE_LOGIN_FOR_CART_LIST, GUEST_CART_STORAGE_KEY } from "./cart-config.js";

const route = window.location.pathname.replace(/\/+$/, "") || "/";
const params = new URLSearchParams(window.location.search);
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
let quickItem = null;
let savedItems = [];
let account = null;
let isSignedIn = false;
let sending = false;

function setPage(page) {
  document.body.classList.toggle("route-cart",page==="cart");
  document.body.classList.toggle("route-confirmation",page==="confirmation");
  const cart=document.querySelector("#cart-page"),confirmation=document.querySelector("#order-confirmation-page");
  if(cart)cart.hidden=page!=="cart";
  if(confirmation)confirmation.hidden=page!=="confirmation";
}
function imageFor(item) {
  const first=Array.isArray(item?.images)?item.images[0]:null;
  return (typeof first==="string"?first:first?.url)||(Array.isArray(item?.image_urls)?item.image_urls[0]:"")||item?.image_url||"";
}
function normalize(item) {
  if(!item||typeof item!=="object")return null;
  const id=String(item.product_id||item.id||"");
  const quantity=Math.max(1,Math.min(20,Math.floor(Number(item.quantity)||1)));
  if(!id)return null;
  const price=item.price==null||item.price===""?null:Number(item.price);
  return {...item,id,product_id:id,slug:String(item.slug||""),name:String(item.name||"Menu item"),
    description:String(item.description||""),category_name:String(item.category_name||item.category?.name||"Menu"),
    price:Number.isFinite(price)?price:null,price_unit:String(item.price_unit||"unit"),
    price_unit_label:String(item.price_unit_label||item.price_unit||"unit"),
    image_url:String(item.image_url||imageFor(item)||""),quantity};
}
function readGuestCart() {
  try {const rows=JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY)||"[]");return Array.isArray(rows)?rows.map(normalize).filter(Boolean).slice(0,50):[];}
  catch{return [];}
}
function writeGuestCart() {
  try {localStorage.setItem(GUEST_CART_STORAGE_KEY,JSON.stringify(savedItems));return true;}
  catch{return false;}
}
function merge(primary,secondary) {
  const map=new Map();
  for(const raw of [...primary,...secondary]){
    const item=normalize(raw);if(!item)continue;
    const old=map.get(item.product_id);
    map.set(item.product_id,old?{...old,...item,quantity:Math.min(20,old.quantity+item.quantity)}:item);
  }
  return [...map.values()].slice(0,50);
}
async function request(url,options={}) {
  const response=await fetch(url,{credentials:"same-origin",...options});
  const data=await response.json().catch(()=>({}));
  return {response,data};
}
async function loadAccount() {
  const {response,data}=await request("/api/profile");
  if(response.ok){account=data;isSignedIn=true;return true;}
  if(response.status===401){account=null;isSignedIn=false;return false;}
  throw new Error(data.error||"Your account could not be checked.");
}
async function loadAccountCart() {
  const {response,data}=await request("/api/profile/cart");
  if(!response.ok)throw new Error(data.error||"Your saved cart could not be loaded.");
  return Array.isArray(data.items)?data.items.map(normalize).filter(Boolean):[];
}
async function saveAccountCart() {
  if(!isSignedIn)return;
  const response=await apiFetch("/api/profile/cart",{method:"PUT",body:{items:savedItems.map(item=>({product_id:item.product_id,quantity:item.quantity}))}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Your saved cart could not be updated.");
}
async function loadProduct(reference) {
  if(!reference)return null;
  const embedded=document.querySelector("#step-menu-initial-data");
  if(embedded){try{const data=JSON.parse(embedded.textContent||"{}");const item=(data.products||[]).find(p=>String(p.slug||"")===reference||String(p.id)===reference);if(item)return normalize({...item,quantity:1});}catch{}}
  const isId=/^[0-9a-f-]{36}$/i.test(reference);
  const {response,data}=await request("/api/catalog?limit=1&"+(isId?"product_id=":"slug=")+encodeURIComponent(reference));
  if(!response.ok)throw new Error(data.error||"The selected menu item could not be loaded.");
  const item=(data.products||[]).find(p=>String(p.id)===reference||String(p.slug||"")===reference);
  return item?normalize({...item,quantity:1}):null;
}
function itemMarkup(item,kind) {
  const price=item.price==null?"Price to be confirmed":money(item.price)+" per "+html(item.price_unit_label||item.price_unit||"unit");
  const line=item.price==null?"Quote required":money(item.price*item.quantity);
  return '<article class="cart-selected-item" data-cart-product="'+html(item.product_id)+'" data-cart-kind="'+kind+'">'+
    '<div class="cart-selected-image">'+(imageFor(item)?'<img src="'+html(imageFor(item))+'" alt="'+html(item.name)+'" loading="lazy">':'<div class="product-image-placeholder">STEP TOWN</div>')+'</div>'+
    '<div class="cart-selected-copy"><div class="cart-selected-head"><span class="cart-selected-category">'+html(item.category_name)+'</span>'+
    (kind==="saved"?'<button type="button" class="cart-item-remove" data-action="remove">Remove</button>':'')+'</div>'+
    '<h2>'+html(item.name)+'</h2>'+(item.description?'<p class="cart-summary-description">'+html(item.description)+'</p>':'')+
    '<div class="cart-unit-price"><span>'+price+'</span><strong>'+line+'</strong></div>'+
    '<div class="cart-item-footer"><div class="order-quantity"><button type="button" data-action="decrease" aria-label="Decrease quantity">−</button><output>'+item.quantity+'</output><button type="button" data-action="increase" aria-label="Increase quantity">+</button></div>'+
    '<div class="cart-line-total"><span>Line total</span><strong>'+line+'</strong></div></div></div></article>';
}
function total(items) {
  const known=items.filter(item=>item.price!=null&&Number.isFinite(Number(item.price)));
  const subtotal=known.reduce((sum,item)=>sum+Number(item.price)*item.quantity,0);
  return {subtotal,allPriced:items.length>0&&known.length===items.length,known:known.length};
}
function updateCartBadge() {
  const count=savedItems.reduce((n,item)=>n+item.quantity,0);
  const badge=document.querySelector("#mobile-cart-count");
  if(badge){badge.textContent=count>99?"99+":String(count);badge.hidden=count===0;}
}
function render() {
  const host=document.querySelector("#cart-product-summary");
  const quickHost=document.querySelector("#quick-order-summary");
  const savedHost=document.querySelector("#saved-cart-summary");
  const submit=document.querySelector("#product-order-submit");
  if(quickHost){
    quickHost.hidden=!quickItem;
    quickHost.innerHTML=quickItem?'<p class="eyebrow">ORDER THIS ITEM</p>'+itemMarkup(quickItem,"quick"):"";
  }
  if(host){
    host.hidden=Boolean(quickItem);
    if(!quickItem){
      if(!savedItems.length){
        host.innerHTML='<div class="cart-empty"><span aria-hidden="true">✳</span><strong>Your cart is empty.</strong><p>Browse the menu and add something you love.</p><a class="button button-dark" href="/categories">Browse the menu</a></div>';
      }else{
        const t=total(savedItems);
        host.innerHTML='<p class="eyebrow">YOUR CART</p><div class="cart-selected-items">'+savedItems.map(item=>itemMarkup(item,"saved")).join("")+'</div>'+
          '<div class="cart-estimate-bar"><div><span>Estimated cart total</span><strong>'+(t.allPriced?money(t.subtotal):(t.known?money(t.subtotal)+" + quote":"Quote required"))+'</strong></div><p>Final pricing is confirmed by Step Town before your order is accepted.</p></div>';
      }
    }
  }
  if(savedHost){
    savedHost.hidden=!quickItem;
    if(quickItem)savedHost.innerHTML='<h2 class="saved-cart-heading">Your saved cart</h2>'+(savedItems.length?'<div class="cart-selected-items">'+savedItems.map(item=>itemMarkup(item,"saved")).join("")+'</div>':'<p class="saved-cart-empty">Your saved cart is empty.</p>');
  }
  if(submit){submit.disabled=sending||(!quickItem&&!savedItems.length);submit.textContent=sending?"Sending order…":"Send order";}
  updateCartBadge();
}
function activeOrderItems(){return quickItem?[{product_id:quickItem.product_id,slug:quickItem.slug,quantity:quickItem.quantity}]:savedItems.map(item=>({product_id:item.product_id,slug:item.slug,quantity:item.quantity}));}
function updateDeliveryField() {
  const select=document.querySelector("#order-fulfillment"),label=document.querySelector("#order-location-label"),input=document.querySelector("#order-delivery-location");
  const delivery=select?.value==="delivery";
  if(label)label.hidden=!delivery;
  if(input)input.required=Boolean(delivery);
}
function prefillForm(form) {
  const profile=account?.profile||{},user=account?.user||{};
  const name=profile.full_name||user.user_metadata?.full_name||user.user_metadata?.name||"";
  const phone=profile.phone||user.phone||"";
  if(name&&form.elements.customer_name)form.elements.customer_name.value=name;
  if(phone&&form.elements.customer_phone)form.elements.customer_phone.value=phone;
  if(user.email&&form.elements.customer_email)form.elements.customer_email.value=user.email;
}
function showConfirmation(data) {
  sessionStorage.setItem("step-town-order-confirmation",JSON.stringify(data||{}));
  window.location.assign("/order/confirmation?order="+encodeURIComponent(data?.order_number||""));
}
async function startCart() {
  setPage("cart");
  const form=document.querySelector("#product-order-form");
  if(!form)return;
  const status=document.querySelector("#product-order-error");
  const date=form.elements.requested_date;
  if(date)date.min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  savedItems=readGuestCart();
  const reference=params.get("product");
  try{
    const signed=await loadAccount();
    if(signed){
      const accountCart=await loadAccountCart();
      savedItems=merge(accountCart,savedItems);
      await saveAccountCart();
      try{localStorage.removeItem(GUEST_CART_STORAGE_KEY);}catch{}
    }else if(REQUIRE_LOGIN_FOR_CART_LIST&&!reference){
      window.location.assign("/login?next="+encodeURIComponent("/cart"));return;
    }else writeGuestCart();
  }catch(error){if(status)status.textContent=error.message||"Your cart could not be loaded.";}
  if(reference){
    try{quickItem=await loadProduct(reference);if(!quickItem)throw new Error("This product is no longer available. Please return to the menu.");}
    catch(error){if(status)status.textContent=error.message;}
  }
  prefillForm(form);
  render();
  updateDeliveryField();
  document.querySelector("#order-fulfillment")?.addEventListener("change",updateDeliveryField);
  document.querySelector("#cart-page-close")?.addEventListener("click",()=>window.location.assign("/categories"));
  document.querySelector("#cart-close")?.addEventListener("click",()=>window.location.assign("/categories"));
  document.querySelector("#cart-product-summary")?.addEventListener("click",event=>handleItemAction(event));
  document.querySelector("#quick-order-summary")?.addEventListener("click",event=>handleItemAction(event));
  document.querySelector("#saved-cart-summary")?.addEventListener("click",event=>handleItemAction(event));
  async function handleItemAction(event){
    const button=event.target.closest("[data-action]");if(!button)return;
    const row=button.closest("[data-cart-product]");if(!row)return;
    const item=row.dataset.cartKind==="quick"?quickItem:savedItems.find(x=>x.product_id===row.dataset.cartProduct);
    if(!item)return;
    if(button.dataset.action==="increase")item.quantity=Math.min(20,item.quantity+1);
    if(button.dataset.action==="decrease")item.quantity=Math.max(1,item.quantity-1);
    if(button.dataset.action==="remove")savedItems=savedItems.filter(x=>x.product_id!==item.product_id);
    if(row.dataset.cartKind==="saved"){
      if(isSignedIn){try{await saveAccountCart();}catch(error){if(status)status.textContent=error.message;}}
      else writeGuestCart();
    }
    render();
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(sending)return;
    if(status)status.textContent="";
    const items=activeOrderItems();
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
      cart_source:quickItem?"quick":"saved_cart",
      items
    };
    sending=true;render();
    try{
      const response=await apiFetch("/api/orders",{method:"POST",body:order});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){if(status)status.textContent=data.error||"We could not save your order. Please check the details and try again.";return;}
      if(!quickItem){savedItems=[];if(isSignedIn){try{await saveAccountCart();}catch(clearError){console.warn("Order saved; cart cleanup will retry on the next visit:",clearError.message);}}else writeGuestCart();}
      showConfirmation(data.order||{});
    }catch(error){if(status)status.textContent=error.message||"Connection problem. Please try again.";}
    finally{sending=false;render();}
  });
}
function renderConfirmation() {
  setPage("confirmation");
  let data={};try{data=JSON.parse(sessionStorage.getItem("step-town-order-confirmation")||"{}");}catch{}
  const number=document.querySelector("#confirmed-order-number");
  if(number)number.textContent=params.get("order")||data.order_number||"";
  const details=document.querySelector("#confirmation-details");
  if(details)details.textContent="Your request has been saved. Final pricing is confirmed by Step Town before your order is accepted.";
  const summary=document.querySelector("#confirmation-order-summary");
  if(summary){
    const items=Array.isArray(data.items)?data.items:[];
    const itemRows=items.map(item=>'<div class="confirmation-order-item"><span>'+html(item.name||"Menu item")+' × '+Math.max(1,Number(item.quantity||1))+'</span><strong>'+(item.line_total==null?"Price to be confirmed":money(item.line_total))+'</strong></div>').join("");
    summary.innerHTML=itemRows+'<div class="confirmation-order-total"><span>Estimated total</span><strong>'+(data.estimated_total==null?"To be confirmed":money(data.estimated_total))+'</strong></div>';
  }
  const track=document.querySelector("#confirmation-tracking-link");
  if(track&&data.tracking_token){track.href="/order/"+encodeURIComponent(data.tracking_token);track.hidden=false;}
  const create=document.querySelector("#confirmation-create-account");
  if(create){create.href="/login?next="+encodeURIComponent("/profile/orders");}
}
if(route==="/cart")void startCart();
if(route==="/order/confirmation")renderConfirmation();
