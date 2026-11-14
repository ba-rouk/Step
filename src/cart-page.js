import "./cart-page.css";
import { apiFetch } from "./api.js";

const path=window.location.pathname.replace(/\/+$/,"")||"/";
const params=new URLSearchParams(window.location.search);
const html=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=value=>value==null?"Price to be confirmed":new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
const cartKey="step-town-cart-v1";
let selectedProduct=null,quantity=1,accountUser=null,savedItems=[];
let lastOrderMessage="";

function readLocalCart(){
  try{const items=JSON.parse(localStorage.getItem(cartKey)||"[]");return Array.isArray(items)?items.filter(x=>x&&x.product_id&&Number(x.quantity)>0):[];}catch{return [];}
}
function imageFor(product){
  return product?.images?.[0]?.url||product?.image_urls?.[0]||product?.image_url||"";
}
async function jsonRequest(url,options={}){
  const response=await fetch(url,{credentials:"same-origin",...options});
  const data=await response.json().catch(()=>({}));
  return {response,data};
}
function setPage(route){
  document.body.classList.toggle("route-cart",route==="cart");
  document.body.classList.toggle("route-confirmation",route==="confirmation");
  const cartPage=document.querySelector("#cart-page");
  const confirmPage=document.querySelector("#order-confirmation-page");
  if(cartPage)cartPage.hidden=route!=="cart";
  if(confirmPage)confirmPage.hidden=route!=="confirmation";
}
function renderProductSummary(product){
  const host=document.querySelector("#cart-product-summary");
  if(!host)return;
  if(!product){
    host.innerHTML='<div class="cart-empty"><strong>Choose something from the menu to start an order.</strong><p><a class="text-link" href="/categories">Browse the menu</a></p></div>';
    return;
  }
  const image=imageFor(product);
  host.innerHTML=(image?'<img src="'+html(image)+'" alt="'+html(product.name)+'" width="800" height="1000">':'<div class="product-image-placeholder">STEP TOWN</div>')+
    '<div><p class="eyebrow">'+html(product.category_name||product.category?.name||"STEP TOWN MENU")+'</p>'+
    '<h2>'+html(product.name)+'</h2><p class="cart-summary-price">'+html(money(product.price))+(product.price!=null?' per '+html(product.price_unit_label||product.price_unit||"unit"):"")+'</p>'+
    '<details><summary>Read full description</summary><p>'+html(product.description||"Prepared with care by Step Town.")+'</p></details>'+
    '<div class="order-quantity" aria-label="Order quantity"><button type="button" id="order-quantity-minus" aria-label="Decrease quantity">−</button><output id="order-quantity-value">'+quantity+'</output><button type="button" id="order-quantity-plus" aria-label="Increase quantity">+</button></div></div>';
  document.querySelector("#order-quantity-minus")?.addEventListener("click",()=>{quantity=Math.max(1,quantity-1);document.querySelector("#order-quantity-value").textContent=quantity;});
  document.querySelector("#order-quantity-plus")?.addEventListener("click",()=>{quantity=Math.min(20,quantity+1);document.querySelector("#order-quantity-value").textContent=quantity;});
}
async function getSelectedProduct(){
  const slug=params.get("product");
  if(!slug)return null;
  const embedded=document.querySelector("#step-menu-initial-data");
  if(embedded){
    try{const data=JSON.parse(embedded.textContent||"{}");const found=(data.products||[]).find(p=>p.slug===slug);if(found)return found;}catch{}
  }
  const {response,data}=await jsonRequest("/api/catalog?limit=1&slug="+encodeURIComponent(slug));
  if(!response.ok)throw new Error(data.error||"The product could not be loaded.");
  return data.products?.[0]||null;
}
async function getAccount(){
  const {response,data}=await jsonRequest("/api/profile");
  if(response.ok){accountUser=data;return data;}
  return null;
}
function updateDeliveryField(){
  const select=document.querySelector("#order-fulfillment");
  const label=document.querySelector("#order-location-label");
  const input=document.querySelector("#order-delivery-location");
  const delivery=select?.value==="delivery";
  if(label)label.hidden=!delivery;
  if(input)input.required=Boolean(delivery);
}
async function renderSavedCart(){
  const host=document.querySelector("#saved-cart-list");
  const lock=document.querySelector("#guest-cart-lock");
  if(!host||!lock)return;
  if(!accountUser){
    host.hidden=true;lock.hidden=false;return;
  }
  lock.hidden=true;host.hidden=false;
  const {response,data}=await jsonRequest("/api/profile/cart");
  if(!response.ok){host.innerHTML='<p class="checkout-status">Your cart list could not be loaded. Refresh and try again.</p>';return;}
  savedItems=Array.isArray(data.items)?data.items:[];
  drawSavedCart();
}
function drawSavedCart(){
  const host=document.querySelector("#saved-cart-list");
  if(!host)return;
  host.innerHTML=savedItems.length?'<div class="saved-cart-list">'+savedItems.map(item=>{
    const image=imageFor(item);
    return '<article class="saved-cart-item" data-saved-product="'+html(item.product_id)+'">'+
      (image?'<img src="'+html(image)+'" alt="'+html(item.name)+'" width="160" height="160" loading="lazy">':'<div class="product-image-placeholder">ST</div>')+
      '<div><strong>'+html(item.name)+'</strong><small>'+html(money(item.price))+' · '+html(item.category_name||"Menu")+'</small></div>'+
      '<div class="saved-cart-actions"><button type="button" data-action="decrease" aria-label="Decrease quantity">−</button><b>'+Number(item.quantity||1)+'</b><button type="button" data-action="increase" aria-label="Increase quantity">+</button><button type="button" data-action="remove">Remove</button></div></article>';
  }).join("")+'</div>':'<p class="cart-empty">Your saved cart list is empty. Add items from the menu using the cart icon.</p>';
}
async function syncSavedCart(){
  if(!accountUser)return;
  const items=savedItems.map(item=>({product_id:item.product_id,quantity:item.quantity}));
  const {response,data}=await apiFetch("/api/profile/cart",{method:"PUT",body:{items}}).then(async r=>({response:r,data:await r.json().catch(()=>({}))}));
  if(!response.ok)throw new Error(data.error||"Your cart list could not be saved.");
}
async function mergeGuestCart(){
  if(!accountUser)return;
  const guest=readLocalCart();
  if(!guest.length)return;
  const {response,data}=await jsonRequest("/api/profile/cart");
  if(!response.ok)return;
  const combined=new Map((data.items||[]).map(item=>[item.product_id,{product_id:item.product_id,quantity:Number(item.quantity)||1}]));
  for(const item of guest){
    const current=combined.get(item.product_id);
    combined.set(item.product_id,{product_id:item.product_id,quantity:Math.min(20,(current?.quantity||0)+(Number(item.quantity)||1))});
  }
  const saved=await apiFetch("/api/profile/cart",{method:"PUT",body:{items:[...combined.values()]}}).then(async r=>({response:r,data:await r.json().catch(()=>({}))}));
  if(!saved.response.ok)throw new Error(saved.data.error||"Guest cart items could not be merged.");
  localStorage.removeItem(cartKey);
}
function renderConfirmation(){
  setPage("confirmation");
  const orderNo=params.get("order")||"";
  document.querySelector("#confirmed-order-number").textContent=orderNo;
  const message=sessionStorage.getItem("step-town-last-order-message")||"";
  const link=document.querySelector("#confirmation-whatsapp");
  if(message&&link){link.href="https://wa.me/250780382589?text="+encodeURIComponent(message);link.hidden=false;}
  const details=document.querySelector("#confirmation-details");
  if(details)details.textContent="Your request has been saved. Step Town will contact you to confirm the details.";
}
async function startCart(){
  setPage("cart");
  const form=document.querySelector("#product-order-form");
  if(!form)return;
  document.querySelector("#order-preferred-date").min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  try{
    selectedProduct=await getSelectedProduct();
    if(params.get("product")&&!selectedProduct)throw new Error("This product is no longer available. Please choose another item from the menu.");
  }catch(error){
    const host=document.querySelector("#product-order-error");if(host)host.textContent=error.message||"The selected product could not be loaded.";
  }
  renderProductSummary(selectedProduct);
  updateDeliveryField();
  document.querySelector("#order-fulfillment")?.addEventListener("change",updateDeliveryField);
  const account=await getAccount();
  if(account){
    const name=form.elements.customer_name,phone=form.elements.customer_phone;
    const savedName=account.profile?.full_name||account.user?.user_metadata?.full_name||account.user?.user_metadata?.name;
    const savedPhone=account.profile?.phone||account.user?.phone;
    if(savedName&&name)name.value=savedName;
    if(savedPhone&&phone)phone.value=savedPhone;
    try{await mergeGuestCart();}catch(error){console.warn("Cart merge:",error.message);}
  }
  await renderSavedCart();
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const status=document.querySelector("#product-order-error");
    const button=document.querySelector("#product-order-submit");
    status.textContent="";
    if(!selectedProduct){status.textContent="Choose a menu item before sending your order.";return;}
    if(!form.reportValidity())return;
    const fields=new FormData(form);
    const order={
      customer_name:String(fields.get("customer_name")||"").trim(),
      customer_phone:String(fields.get("customer_phone")||"").trim(),
      fulfillment:String(fields.get("fulfillment")||"pickup"),
      requested_date:String(fields.get("requested_date")||"")||null,
      requested_time:String(fields.get("requested_time")||"")||null,
      delivery_location:String(fields.get("delivery_location")||"").trim()||null,
      order_description:String(fields.get("order_description")||"").trim(),
      notes:String(fields.get("notes")||"").trim(),
      website:String(fields.get("website")||""),
      items:[{slug:selectedProduct.slug,quantity}],
      product_slug:selectedProduct.slug,
      quantity
    };
    button.disabled=true;button.textContent="Sending order…";
    try{
      const {response,data}=await apiFetch("/api/orders",{method:"POST",body:order}).then(async r=>({response:r,data:await r.json().catch(()=>({}))}));
      if(!response.ok){status.textContent=data.error||"We could not save your order. Please try again.";return;}
      const message=[
        "Hello Step Town, I have placed an order request.",
        "Order: "+(data.order?.order_number||""),
        "Name: "+order.customer_name,
        "Phone: "+order.customer_phone,
        "Product: "+selectedProduct.name+" × "+quantity,
        order.order_description?"Order description: "+order.order_description:"",
        "Fulfilment: "+order.fulfillment,
        order.requested_date?"Preferred date: "+order.requested_date:"",
        order.requested_time?"Preferred time: "+order.requested_time:"",
        order.delivery_location?"Delivery location: "+order.delivery_location:"",
        order.notes?"Notes: "+order.notes:""
      ].filter(Boolean).join("\n");
      sessionStorage.setItem("step-town-last-order-message",message);
      window.location.assign("/order/confirmation?order="+encodeURIComponent(data.order?.order_number||""));
    }catch(error){status.textContent="Connection problem. Check your internet and try again.";}
    finally{button.disabled=false;button.textContent="Send order";}
  });
  document.querySelector("#saved-cart-list")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-action]");if(!button)return;
    const row=button.closest("[data-saved-product]"),id=row?.dataset.savedProduct;
    const item=savedItems.find(x=>x.product_id===id);if(!item)return;
    if(button.dataset.action==="increase")item.quantity=Math.min(20,item.quantity+1);
    else if(button.dataset.action==="decrease")item.quantity=Math.max(1,item.quantity-1);
    else if(button.dataset.action==="remove")savedItems=savedItems.filter(x=>x.product_id!==id);
    drawSavedCart();
    try{await syncSavedCart();}catch(error){const host=document.querySelector("#saved-cart-list");host.insertAdjacentHTML("afterbegin",'<p class="checkout-status">'+html(error.message)+'</p>');}
  });
}
if(path==="/cart")void startCart();
if(path==="/order/confirmation")renderConfirmation();
