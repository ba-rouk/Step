import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers:cors});
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required"},{status:401,headers:cors});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user)return Response.json({error:"Invalid session"},{status:401,headers:cors});
  const {order_id}=await req.json();
  const {data:order,error}=await db.from("store_orders").select("*").eq("id",order_id).maybeSingle();
  if(error||!order)return Response.json({error:"Order not found"},{status:404,headers:cors});
  const {data:staff}=await db.from("staff_profiles").select("user_id,phone,email").in("role",["manager","accountant","cashier"]).eq("is_active",true);
  const isStaff=await db.from("staff_profiles").select("user_id").eq("user_id",user.id).eq("is_active",true).maybeSingle();
  if(order.customer_id!==user.id&&!isStaff.data)return Response.json({error:"Not allowed to notify for this order"},{status:403,headers:cors});
  const recipients=(staff||[]).map(x=>x.user_id);
  const {data:subscriptions}=await db.from("push_subscriptions").select("*").in("user_id",recipients);
  const items=Array.isArray(order.items)?order.items:[];
  const description=items.map(i=>Number(i.quantity||1)+" x "+String(i.name||"item")).join(", ");
  const body=description+" - "+(order.estimated_total==null?"Price to confirm":"RWF "+Number(order.estimated_total).toLocaleString("en-US"))+" - "+(order.fulfillment==="pickup"?"Pickup":"Delivery")+(order.requested_time?" "+order.requested_time:"");
  const payload=JSON.stringify({title:"New order "+order.order_number,body,url:"/staff/orders/"+encodeURIComponent(order.order_number),tag:"order-"+order.id});
  const pub=Deno.env.get("VAPID_PUBLIC_KEY"),priv=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT")||"mailto:orders@steptown.rw";
  if(!pub||!priv)return Response.json({error:"VAPID keys are not configured",sent:0},{status:503,headers:cors});
  webpush.setVapidDetails(subject,pub,priv);
  const outcomes=await Promise.all((subscriptions||[]).map(async s=>{
    try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload);return true;}
    catch(e){if(e.statusCode===404||e.statusCode===410)await db.from("push_subscriptions").delete().eq("id",s.id);return false;}
  }));
  let fallbackSent=false;
  const webhook=Deno.env.get("ALERT_WEBHOOK_URL");
  if(webhook){
    try{
      const headers:Record<string,string>={"Content-Type":"application/json"};
      const webhookToken=Deno.env.get("ALERT_WEBHOOK_TOKEN");if(webhookToken)headers.Authorization="Bearer "+webhookToken;
      const response=await fetch(webhook,{method:"POST",headers,body:JSON.stringify({event:"step_town.new_order",title:"New order "+order.order_number,body,order_number:order.order_number,order_url:"https://steptown.onrender.com/staff/orders/"+encodeURIComponent(order.order_number),recipients:(staff||[]).map(x=>({phone:x.phone,email:x.email}))})});
      fallbackSent=response.ok;
    }catch(error){console.error("Fallback alert webhook failed",error);}
  }
  return Response.json({ok:true,sent:outcomes.filter(Boolean).length,attempted:outcomes.length,fallback_sent:fallbackSent},{headers:cors});
});
