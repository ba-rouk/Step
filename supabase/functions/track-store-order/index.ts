import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!key)return json({error:"Tracking is unavailable"},503);
  const body=await req.json().catch(()=>({}));
  const token=String(body.token||"");
  if(!/^[0-9a-f]{32}$/.test(token))return json({error:"Order tracking link is invalid."},404);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data,error}=await db.from("store_orders")
    .select("order_number,status,items,estimated_total,fulfillment,requested_date,requested_time,delivery_location,created_at")
    .eq("tracking_token",token).maybeSingle();
  if(error||!data)return json({error:"We could not find this order. Check the tracking link and try again."},404);
  return json({order:{
    order_number:data.order_number,status:data.status,items:data.items||[],
    estimated_total:data.estimated_total,fulfillment:data.fulfillment,
    requested_date:data.requested_date,requested_time:data.requested_time,
    delivery_location:data.delivery_location,created_at:data.created_at
  }});
});
