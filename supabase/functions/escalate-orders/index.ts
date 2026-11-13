import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async req=>{
  const secret=Deno.env.get("ESCALATION_SECRET");
  if(!secret||req.headers.get("Authorization")!=="Bearer "+secret)return new Response("Unauthorized",{status:401});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{autoRefreshToken:false,persistSession:false}});
  const pub=Deno.env.get("VAPID_PUBLIC_KEY"),priv=Deno.env.get("VAPID_PRIVATE_KEY");
  if(!pub||!priv)return Response.json({error:"VAPID keys missing"},{status:503});
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")||"mailto:orders@steptown.rw",pub,priv);
  const cutoff=new Date(Date.now()-10*60*1000).toISOString();
  const {data:orders,error}=await db.from("store_orders").select("id,order_number,items,estimated_total,fulfillment,requested_time,created_at").eq("status","new").is("acknowledged_at",null).is("escalated_at",null).lt("created_at",cutoff).limit(100);
  if(error)return Response.json({error:error.message},{status:500});
  let notified=0;
  for(const order of orders||[]){
    const {data:cashiers}=await db.from("staff_profiles").select("user_id").eq("role","cashier").eq("is_active",true);
    const {data:accountants}=await db.from("staff_profiles").select("user_id").eq("role","accountant").eq("is_active",true);
    const {data:subs}=await db.from("push_subscriptions").select("*").in("user_id",(cashiers||[]).map(x=>x.user_id));
    const items=Array.isArray(order.items)?order.items:[];
    const summary=items.map(i=>Number(i.quantity||1)+" x "+String(i.name||"item")).join(", ");
    const payload=JSON.stringify({title:"Unacknowledged order "+order.order_number,body:summary+" - RWF "+Number(order.estimated_total||0).toLocaleString("en-US"),url:"/staff/orders/"+encodeURIComponent(order.order_number),tag:"escalation-"+order.id});
    let sent=0;
    for(const s of subs||[]){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload);sent++;}catch(e){if(e.statusCode===404||e.statusCode===410)await db.from("push_subscriptions").delete().eq("id",s.id);}}
    // Second-stage notification goes to Accountant devices as well.
    if(sent===0){
      const {data:asubs}=await db.from("push_subscriptions").select("*").in("user_id",(accountants||[]).map(x=>x.user_id));
      for(const s of asubs||[]){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload);sent++;}catch(e){if(e.statusCode===404||e.statusCode===410)await db.from("push_subscriptions").delete().eq("id",s.id);}}
    }
    await db.from("store_orders").update({escalated_at:new Date().toISOString()}).eq("id",order.id);
    await db.from("store_order_events").insert({order_id:order.id,event_type:"escalation",description:"Order escalated after 10 minutes without acknowledgement"});
    notified+=sent;
  }
  return Response.json({checked:orders?.length||0,notifications_sent:notified});
});
