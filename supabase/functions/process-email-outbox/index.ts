import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const secret=Deno.env.get("EMAIL_OUTBOX_SECRET")||"";
const appUrl=(Deno.env.get("APP_URL")||"https://steptown.onrender.com").replace(/\\/+$/,"");
const provider=(Deno.env.get("EMAIL_PROVIDER")||"resend").toLowerCase();
const apiKey=Deno.env.get("EMAIL_API_KEY")||Deno.env.get("RESEND_API_KEY")||"";
const from=Deno.env.get("EMAIL_FROM")||"Step Town <orders@steptown.rw>";
const fromName=Deno.env.get("EMAIL_FROM_NAME")||"Step Town";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});

function escapeHtml(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
function render(job:any){
  const p=job.payload||{};
  if(job.template_key==="login_code"){
    const code=String(p.code||"");
    return {subject:"Your Step Town login code",text:"Your Step Town login code is "+code+". It expires in 10 minutes and can only be used once. If you did not request it, you can ignore this email.",html:'<div style="background:#171313;color:#fff4eb;padding:32px;font-family:Arial,sans-serif;border-radius:18px"><p style="color:#ffbd8d;font-weight:bold;letter-spacing:3px">STEP TOWN</p><h1>Your login code</h1><p>Use this one-time code to sign in:</p><div style="font-size:34px;letter-spacing:9px;font-weight:bold;color:#ffbd8d;padding:18px 0">'+escapeHtml(code)+'</div><p>This code expires in 10 minutes and can only be used once.</p><p style="color:#c9b9ae">If you did not request this code, ignore this message.</p></div>'};
  }
  if(job.template_key==="order_confirmation"){
    const order=String(p.order_number||"your order");
    const tracking=String(p.tracking_url||appUrl);
    const items=Array.isArray(p.items)?p.items:[];
    const lines=items.map((i:any)=>String(i.name||"Item")+" × "+Number(i.quantity||1)+" — "+(i.line_total==null?"Price to be confirmed":"RWF "+Number(i.line_total).toLocaleString("en-US")));
    const summary=lines.join("\n");
    const total=p.estimated_total==null?"To be confirmed":"RWF "+Number(p.estimated_total).toLocaleString("en-US");
    return {subject:"Step Town order "+order+" received",text:"Thank you for ordering with Step Town.\n\nOrder: "+order+"\n"+summary+"\nEstimated total: "+total+"\n\nTrack your order: "+tracking+"\n\nFinal pricing is confirmed by Step Town before your order is accepted.",html:'<div style="background:#171313;color:#fff4eb;padding:32px;font-family:Arial,sans-serif;border-radius:18px"><p style="color:#ffbd8d;font-weight:bold;letter-spacing:3px">STEP TOWN</p><h1>We received your order</h1><p>Order <strong>'+escapeHtml(order)+'</strong></p><div style="padding:16px;border:1px solid #51443c;border-radius:12px">'+items.map((i:any)=>'<p>'+escapeHtml(i.name)+' × '+Number(i.quantity||1)+' — '+(i.line_total==null?'Price to be confirmed':'RWF '+Number(i.line_total).toLocaleString("en-US"))+'</p>').join("")+'</div><h2>Estimated total: '+escapeHtml(total)+'</h2><p>Final pricing is confirmed by Step Town before your order is accepted.</p><p><a href="'+escapeHtml(tracking)+'" style="display:inline-block;background:#ffbd8d;color:#211713;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Track your order</a></p></div>'};
  }
  throw new Error("Unknown email template.");
}
async function sendEmail(to:string,message:{subject:string;text:string;html:string}){
  if(!apiKey||!from)throw new Error("Email provider is not configured.");
  let url="",headers:Record<string,string>={"Content-Type":"application/json"},payload:any={};
  if(provider==="resend"){
    url="https://api.resend.com/emails";headers.Authorization="Bearer "+apiKey;
    payload={from,to:[to],subject:message.subject,html:message.html,text:message.text};
  }else if(provider==="brevo"){
    url="https://api.brevo.com/v3/smtp/email";headers["api-key"]=apiKey;
    payload={sender:{name:fromName,email:from.match(/<([^>]+)>/)?.[1]||from},to:[{email:to}],subject:message.subject,htmlContent:message.html,textContent:message.text};
  }else if(provider==="postmark"){
    url="https://api.postmarkapp.com/email";headers["X-Postmark-Server-Token"]=apiKey;
    payload={From:from,To:to,Subject:message.subject,HtmlBody:message.html,TextBody:message.text,MessageStream:"outbound"};
  }else if(provider==="sendgrid"){
    url="https://api.sendgrid.com/v3/mail/send";headers.Authorization="Bearer "+apiKey;
    payload={personalizations:[{to:[{email:to}]}],from:{email:from.match(/<([^>]+)>/)?.[1]||from,name:fromName},subject:message.subject,content:[{type:"text/plain",value:message.text},{type:"text/html",value:message.html}]};
  }else if(provider==="mailgun"){
    const domain=Deno.env.get("MAILGUN_DOMAIN")||"";
    url="https://api.mailgun.net/v3/"+domain+"/messages";
    headers.Authorization="Basic "+btoa("api:"+apiKey);
    headers["Content-Type"]="application/x-www-form-urlencoded";
    payload=new URLSearchParams({from,to,subject:message.subject,text:message.text,html:message.html});
  }else throw new Error("Unsupported EMAIL_PROVIDER.");
  const response=await fetch(url,{method:"POST",headers,body:provider==="mailgun"?payload.toString():JSON.stringify(payload)});
  if(!response.ok)throw new Error("Email provider returned HTTP "+response.status+": "+(await response.text()).slice(0,400));
}
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(!supabaseUrl||!serviceKey||!secret||req.headers.get("Authorization")!=="Bearer "+secret)return json({error:"Not authorized"},401);
  const db=createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:jobs,error}=await db.from("email_outbox").select("*").in("status",["pending","failed"]).lte("next_attempt_at",new Date().toISOString()).order("created_at").limit(10);
  if(error)return json({error:"Outbox could not be read"},500);
  let sent=0,failed=0;
  for(const job of jobs||[]){
    const claimed=await db.from("email_outbox").update({status:"processing",attempts:Number(job.attempts||0)+1}).eq("id",job.id).in("status",["pending","failed"]).select("id").maybeSingle();
    if(!claimed.data)continue;
    try{
      await sendEmail(job.recipient,render(job));
      await db.from("email_outbox").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",job.id);
      sent++;
    }catch(error){
      const attempts=Number(job.attempts||0)+1;
      const delay=Math.min(86400,60*Math.pow(2,Math.min(attempts,10)));
      await db.from("email_outbox").update({status:attempts>=8?"failed":"pending",next_attempt_at:new Date(Date.now()+delay*1000).toISOString(),last_error:String(error).slice(0,1000)}).eq("id",job.id);
      failed++;
    }
  }
  return json({ok:true,processed:sent+failed,sent,failed});
});
