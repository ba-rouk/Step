import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers:cors});
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{autoRefreshToken:false,persistSession:false}});
  let user=null;
  if(token){
    const auth=await db.auth.getUser(token);
    if(auth.error||!auth.data?.user)return Response.json({error:"Invalid session"},{status:401,headers:cors});
    user=auth.data.user;
  }
  const body=await req.json().catch(()=>({}));
  const order_id=String(body.order_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(order_id))return Response.json({error:"Invalid order reference"},{status:400,headers:cors});
  const {data:order,error}=await db.from("store_orders").select("*").eq("id",order_id).maybeSingle();
  if(error||!order)return Response.json({error:"Order not found"},{status:404,headers:cors});
  const isGuestOrder=!order.customer_id&&order.status==="new"&&!order.push_notified_at&&Date.now()-new Date(order.created_at).getTime()<20*60*1000;
  const isCustomerOrder=Boolean(user&&order.customer_id===user.id);
  let isAuthorizedGuest=isGuestOrder;
  let isAuthorizedStaff=false;
  if(user&&!isCustomerOrder){
    const staffCheck=await db.from("staff_profiles").select("user_id").eq("user_id",user.id).eq("is_active",true).maybeSingle();
    isAuthorizedStaff=Boolean(staffCheck.data);
  }
  if(!isAuthorizedGuest&&!isCustomerOrder&&!isAuthorizedStaff){
    return Response.json({error:"Not allowed to notify for this order"},{status:403,headers:cors});
  }
  const {data:staff}=await db.from("staff_profiles").select("user_id,phone,email").in("role",["manager","accountant","cashier"]).eq("is_active",true);
  const recipients=(staff||[]).map(x=>x.user_id);
  const {data:subscriptions}=await db.from("push_subscriptions").select("*").in("user_id",recipients);
  const items=Array.isArray(order.items)?order.items:[];
  const itemDescription=items.map(i=>Number(i.quantity||1)+" x "+String(i.name||"item")).join(", ");
  const orderDescription=String(order.order_description||"").trim().slice(0,900);
  const description=[itemDescription,orderDescription].filter(Boolean).join(" · ");
  const fulfillmentLabel=order.fulfillment==="event"?"Event service":order.fulfillment==="delivery"?"Delivery":"Pickup";
  const requestedSlot=[order.requested_date,order.requested_time].filter(Boolean).join(" ");
  const body=[description,order.estimated_total==null?"Price to confirm":"RWF "+Number(order.estimated_total).toLocaleString("en-US"),fulfillmentLabel,requestedSlot].filter(Boolean).join(" · ");
  // Staff detail routes look up records by UUID, not the customer-facing order number.
  const orderPath="/staff/orders/"+encodeURIComponent(order.id);
  const orderUrl="https://steptown.onrender.com"+orderPath;
  const payload=JSON.stringify({title:"New order "+order.order_number,body,url:orderPath,tag:"order-"+order.id});
  const pub=Deno.env.get("VAPID_PUBLIC_KEY"),priv=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT")||"mailto:orders@steptown.rw";
  const outcomes:boolean[]=[];
  if(pub&&priv){
    webpush.setVapidDetails(subject,pub,priv);
    outcomes.push(...await Promise.all((subscriptions||[]).map(async s=>{
      try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload);return true;}
      catch(e){
        if(e.statusCode===404||e.statusCode===410)await db.from("push_subscriptions").delete().eq("id",s.id);
        console.error("Staff push delivery failed:",e);
        return false;
      }
    })));
  }else{
    console.error("VAPID keys are not configured; checking the alert webhook fallback.");
  }
  let fallbackSent=false;
  const webhook=Deno.env.get("ALERT_WEBHOOK_URL");
  if(webhook){
    try{
      const headers:Record<string,string>={"Content-Type":"application/json"};
      const webhookToken=Deno.env.get("ALERT_WEBHOOK_TOKEN");if(webhookToken)headers.Authorization="Bearer "+webhookToken;
      const response=await fetch(webhook,{method:"POST",headers,body:JSON.stringify({event:"step_town.new_order",title:"New order "+order.order_number,body,order_number:order.order_number,order_url:orderUrl,recipients:(staff||[]).map(x=>({phone:x.phone,email:x.email}))})});
      fallbackSent=response.ok;
    }catch(error){console.error("Fallback alert webhook failed",error);}
  }
  const sent=outcomes.filter(Boolean).length;
  const ok=sent>0||fallbackSent;
  if(ok){
    const {error:markError}=await db.from("store_orders").update({push_notified_at:new Date().toISOString()}).eq("id",order.id).is("push_notified_at",null);
    if(markError)console.error("Push delivery succeeded but order notification marker failed:",markError);
  }
  return Response.json({ok,sent,attempted:outcomes.length,fallback_sent:fallbackSent,error:ok?undefined:"No staff alert channel accepted this order notification."},{status:ok?200:503,headers:cors});
});
