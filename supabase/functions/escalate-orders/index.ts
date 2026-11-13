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
  const {data:cashierStage,error:a}=await db.from("store_orders").select("id,order_number,items,estimated_total,fulfillment,requested_time").eq("status","new").is("acknowledged_at",null).is("escalated_at",null).lt("created_at",cutoff).limit(100);
  if(a)return Response.json({error:a.message},{status:500});
  const {data:accountantStage,error:b}=await db.from("store_orders").select("id,order_number,items,estimated_total,fulfillment,requested_time").eq("status","new").is("acknowledged_at",null).not("escalated_at","is",null).is("accountant_notified_at",null).lt("escalated_at",cutoff).limit(100);
  if(b)return Response.json({error:b.message},{status:500});
  async function notify(order,role,title){
    const {data:staff}=await db.from("staff_profiles").select("user_id").eq("role",role).eq("is_active",true);
    const ids=(staff||[]).map(x=>x.user_id);if(!ids.length)return 0;
    const {data:subs}=await db.from("push_subscriptions").select("*").in("user_id",ids);
    const items=Array.isArray(order.items)?order.items:[];
    const summary=items.map(i=>Number(i.quantity||1)+" x "+String(i.name||"item")).join(", ");
    const body=summary+" - "+(order.estimated_total==null?"Price to confirm":"RWF "+Number(order.estimated_total).toLocaleString("en-US"))+" - "+(order.fulfillment==="pickup"?"Pickup":"Delivery")+(order.requested_time?" "+order.requested_time:"");
    const payload=JSON.stringify({title:title+" "+order.order_number,body,url:"/staff/orders/"+encodeURIComponent(order.order_number),tag:"escalation-"+role+"-"+order.id});
    let sent=0;
    for(const s of subs||[]){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},payload);sent++;}catch(e){if(e.statusCode===404||e.statusCode===410)await db.from("push_subscriptions").delete().eq("id",s.id);}}
    return sent;
  }
  let cashierNotifications=0,accountantNotifications=0;
  for(const order of cashierStage||[]){
    cashierNotifications+=await notify(order,"cashier","Order still awaiting acknowledgement");
    await db.from("store_orders").update({escalated_at:new Date().toISOString()}).eq("id",order.id);
    await db.from("store_order_events").insert({order_id:order.id,event_type:"cashier_escalation",description:"Cashier re-notified after 10 minutes without acknowledgement"});
  }
  for(const order of accountantStage||[]){
    accountantNotifications+=await notify(order,"accountant","Manager attention required for order");
    await db.from("store_orders").update({accountant_notified_at:new Date().toISOString()}).eq("id",order.id);
    await db.from("store_order_events").insert({order_id:order.id,event_type:"accountant_escalation",description:"Accountant notified after Cashier did not acknowledge"});
  }
  return Response.json({cashier_orders:cashierStage?.length||0,accountant_orders:accountantStage?.length||0,cashier_notifications:cashierNotifications,accountant_notifications:accountantNotifications});
});
