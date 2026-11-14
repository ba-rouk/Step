import "./cart-page.css";
import { apiFetch } from "./api.js";

const path=window.location.pathname.replace(/\/+$/,"")||"/";
const params=new URLSearchParams(window.location.search);
const html=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=value=>value==null?"Price to be confirmed":new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(value));
const cartKey="step-town-cart-v1";
let selectedProduct=null,quantity=1,accountUser=null,savedItems=[];
let lastOrderMessage="";

function clearLegacyLocalCart(){
  try{localStorage.removeItem(cartKey);}catch{}
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
function updateProductSummaryTotals(){
  const quantityOutput=document.querySelector("#order-quantity-value");
  const totalLabel=document.querySelector("#cart-selected-total-label");
  const totalValue=document.querySelector("#cart-selected-line-total");
  if(quantityOutput)quantityOutput.textContent=String(quantity);
  if(totalLabel)totalLabel.textContent="Estimated total · "+quantity+" "+(quantity===1?"item":"items");
  if(totalValue){
    const hasPrice=selectedProduct&&selectedProduct.price!==null&&selectedProduct.price!==undefined&&selectedProduct.price!==""&&Number.isFinite(Number(selectedProduct.price));
    totalValue.textContent=hasPrice?money(Number(selectedProduct.price)*quantity):"To be confirmed";
  }
}
function renderProductSummary(product){
  const host=document.querySelector("#cart-product-summary");
  if(!host)return;
  if(!product){
    host.innerHTML='<div class="cart-empty"><strong>Choose a product from the Step Town menu to start an order.</strong><p><a class="text-link" href="/categories">Browse the menu</a></p></div>';
    return;
  }
  const image=imageFor(product);
  const unit=product.price_unit_label||product.price_unit||"unit";
  const hasPrice=product.price!==null&&product.price!==undefined&&product.price!==""&&Number.isFinite(Number(product.price));
  host.innerHTML=(image?'<img class="cart-selected-product-image" src="'+html(image)+'" alt="'+html(product.name||"Selected Step Town product")+'" width="800" height="1000">':'<div class="product-image-placeholder cart-selected-product-image">STEP TOWN</div>')+
    '<div class="cart-product-summary-copy">'+
    '<p class="eyebrow">YOUR SELECTED PRODUCT · '+html(product.category_name||product.category?.name||"STEP TOWN MENU")+'</p>'+
    '<h2>'+html(product.name||"Selected Step Town product")+'</h2>'+
    '<p class="cart-summary-description">'+html(product.description||"Prepared with care by Step Town.")+'</p>'+
    '<div class="cart-summary-price-row"><span>Price per '+html(unit)+'</span><strong>'+html(money(hasPrice?Number(product.price):null))+'</strong></div>'+
    '<div class="cart-summary-line-total"><span id="cart-selected-total-label">Estimated total · '+quantity+' item</span><strong id="cart-selected-line-total">'+(hasPrice?html(money(Number(product.price)*quantity)):"To be confirmed")+'</strong></div>'+
    '<div class="order-quantity" aria-label="Order quantity"><button type="button" id="order-quantity-minus" aria-label="Decrease quantity">−</button><output id="order-quantity-value" aria-live="polite">'+quantity+'</output><button type="button" id="order-quantity-plus" aria-label="Increase quantity">+</button></div></div>';
  document.querySelector("#order-quantity-minus")?.addEventListener("click",()=>{quantity=Math.max(1,quantity-1);updateProductSummaryTotals();});
  document.querySelector("#order-quantity-plus")?.addEventListener("click",()=>{quantity=Math.min(20,quantity+1);updateProductSummaryTotals();});
  updateProductSummaryTotals();
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
  if(response.status===401)return null;
  throw new Error(data.error||"We couldn't verify your account. Check your connection and retry.");
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
    host.hidden=true;lock.hidden=false;
    const loginLink=lock.querySelector("a");
    if(loginLink)loginLink.href="/login?next="+encodeURIComponent(location.pathname+location.search);
    return;
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
      '<div class="saved-cart-actions"><button type="button" data-action="decrease" aria-label="Decrease quantity">−</button><b>'+Number(item.quantity||1)+'</b><button type="button" data-action="increase" aria-label="Increase quantity">+</button><button type="button" data-action="order">Order this</button><button type="button" data-action="remove">Remove</button></div></article>';
  }).join("")+'</div>':'<p class="cart-empty">Your saved cart list is empty. Add items from the menu using the cart icon.</p>';
}
async function syncSavedCart(){
  if(!accountUser)return;
  const items=savedItems.map(item=>({product_id:item.product_id||item.id,quantity:item.quantity}));
  const {response,data}=await apiFetch("/api/profile/cart",{method:"PUT",body:{items}}).then(async r=>({response:r,data:await r.json().catch(()=>({}))}));
  if(!response.ok)throw new Error(data.error||"Your cart list could not be saved.");
}
async function rememberSelectedProduct(){
  if(!accountUser||!selectedProduct?.id)return;
  const productId=String(selectedProduct.id);
  const existing=savedItems.find(item=>String(item.product_id||item.id)===productId);
  if(existing){
    existing.quantity=Math.min(20,Math.max(1,Number(existing.quantity)||1)+1);
    quantity=existing.quantity;
  }else{
    savedItems.push({
      ...selectedProduct,
      product_id:productId,
      category_name:selectedProduct.category_name||selectedProduct.category?.name||"Menu",
      quantity:1
    });
    quantity=1;
  }
  await syncSavedCart();
  drawSavedCart();
  renderProductSummary(selectedProduct);
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
  clearLegacyLocalCart();
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
  let account=null;
  let accountCheckFailed=false;
  try{account=await getAccount();}
  catch(error){
    accountCheckFailed=true;
    const status=document.querySelector("#product-order-error");
    if(status)status.textContent=error.message||"We couldn't verify your account. Your selected product will stay on this page.";
  }
  if(account){
    const name=form.elements.customer_name,phone=form.elements.customer_phone;
    const savedName=account.profile?.full_name||account.user?.user_metadata?.full_name||account.user?.user_metadata?.name;
    const savedPhone=account.profile?.phone||account.user?.phone;
    if(savedName&&name)name.value=savedName;
    if(savedPhone&&phone)phone.value=savedPhone;
  }
  await renderSavedCart();
  if(params.get("product")&&!accountCheckFailed){
    if(accountUser&&selectedProduct){
      try{
        await rememberSelectedProduct();
        history.replaceState(null,"","/cart");
      }catch(error){
        const status=document.querySelector("#product-order-error");
        if(status)status.textContent="Your product is selected, but we could not save it to your cart history: "+(error.message||"Please retry.");
      }
    }else{
      // A guest's selection exists only for this page view; refreshing starts with an empty cart.
      clearLegacyLocalCart();
      history.replaceState(null,"","/cart");
    }
  }
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
      items:[{product_id:selectedProduct.id,slug:selectedProduct.slug||params.get("product"),quantity}],
      product_slug:selectedProduct.slug||params.get("product"),
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
      if(accountUser){
        const orderedId=String(selectedProduct.id||selectedProduct.product_id||"");
        savedItems=savedItems.filter(item=>String(item.product_id||item.id)!==orderedId);
        try{await syncSavedCart();drawSavedCart();}
        catch(error){console.warn("Could not refresh the saved cart after ordering:",error.message);}
      }
      window.location.assign("/order/confirmation?order="+encodeURIComponent(data.order?.order_number||""));
    }catch(error){status.textContent="Connection problem. Check your internet and try again.";}
    finally{button.disabled=false;button.textContent="Send order";}
  });
  document.querySelector("#saved-cart-list")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-action]");if(!button)return;
    const row=button.closest("[data-saved-product]"),id=row?.dataset.savedProduct;
    const item=savedItems.find(x=>String(x.product_id||x.id)===id);if(!item)return;
    if(button.dataset.action==="order"){
      selectedProduct=item;
      quantity=Math.max(1,Math.min(20,Number(item.quantity)||1));
      renderProductSummary(selectedProduct);
      document.querySelector("#cart-product-summary")?.scrollIntoView({behavior:"smooth",block:"start"});
      return;
    }
    if(button.dataset.action==="increase")item.quantity=Math.min(20,item.quantity+1);
    else if(button.dataset.action==="decrease")item.quantity=Math.max(1,item.quantity-1);
    else if(button.dataset.action==="remove"){
      savedItems=savedItems.filter(x=>String(x.product_id||x.id)!==id);
      if(selectedProduct&&String(selectedProduct.id||selectedProduct.product_id)===id){
        selectedProduct=null;
        renderProductSummary(null);
      }
    }
    if(selectedProduct&&String(selectedProduct.id||selectedProduct.product_id)===id){
      quantity=Number(item.quantity)||1;
      updateProductSummaryTotals();
    }
    drawSavedCart();
    try{await syncSavedCart();}catch(error){const host=document.querySelector("#saved-cart-list");host.insertAdjacentHTML("afterbegin",'<p class="checkout-status">'+html(error.message)+'</p>');}
  });
}
if(path==="/cart")void startCart();
if(path==="/order/confirmation")renderConfirmation();
