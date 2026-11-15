import "./tracking.css";
const path=window.location.pathname.replace(/\/+$/,"");
if(path.startsWith("/order/")&&path!=="/order/confirmation"){
  const token=path.split("/").filter(Boolean).at(-1);
  const main=document.querySelector("main");
  if(main){
    main.innerHTML='<section class="order-tracking-page"><div class="order-tracking-card"><p class="eyebrow">VITANOVA ORDER</p><h1>Track your order.</h1><p id="tracking-status" role="status">Loading your order details…</p><div id="tracking-details"></div><a class="button button-dark" href="/categories">Browse the menu</a></div></section>';
    const status=main.querySelector("#tracking-status"),details=main.querySelector("#tracking-details");
    const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const money=v=>new Intl.NumberFormat("en-RW",{style:"currency",currency:"RWF",maximumFractionDigits:0}).format(Number(v));
    fetch("/api/orders/track/"+encodeURIComponent(token),{credentials:"same-origin",headers:{Accept:"application/json"}})
      .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Order tracking is unavailable.");return data.order;})
      .then(order=>{
        status.textContent="Order "+(order.order_number||"")+" · "+String(order.status||"new").replace(/_/g," ");
        const items=Array.isArray(order.items)?order.items:[];
        const lines=items.map(item=>'<article class="tracking-item"><strong>'+esc(item.name||"Menu item")+'</strong><span>× '+Math.max(1,Number(item.quantity||1))+'</span><b>'+(item.line_total==null?"Price to be confirmed":money(item.line_total))+'</b></article>').join("");
        const total=order.estimated_total==null?"To be confirmed":money(order.estimated_total);
        const delivery=[order.fulfillment,order.requested_date,order.requested_time,order.delivery_location].filter(Boolean).map(esc).join(" · ");
        details.innerHTML='<div class="tracking-items">'+lines+'</div><div class="tracking-total"><span>Estimated total</span><strong>'+esc(total)+'</strong></div><p class="tracking-delivery"><strong>Delivery details</strong><br>'+delivery+'</p><p class="tracking-private-note">This tracking page does not display your phone number or email address.</p>';
      })
      .catch(error=>{status.textContent=error.message||"We could not find this order.";});
  }
}
