import { supabase, supabaseConfigured } from "./supabase.js";
import "../customer.css";

const path=location.pathname.replace(/\/+$/,"")||"/";
if(path==="/account/login"||path==="/account"){
  const app=document.createElement("div");app.id="customer-account";document.body.innerHTML="";document.body.append(app);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const q=new URLSearchParams(location.search);const next=q.get("next")||"/";
  const safeNext=next.startsWith("/")&&!next.startsWith("//")?next:"/";
  const view=(message="")=>{
    app.innerHTML='<main class="customer-auth"><a class="customer-close" href="/">×</a><a class="customer-brand" href="/"><span>ST</span><b>STEP TOWN</b></a><section class="customer-auth-card"><p class="customer-kicker">YOUR STEP TOWN ACCOUNT</p><h1>Welcome to the table.</h1><p>Sign in to place orders and keep your details together.</p><div class="customer-tabs"><button type="button" class="active" data-mode="login">Sign in</button><button type="button" data-mode="signup">Create account</button></div><form id="customer-auth-form"><label>Full name<input name="name" autocomplete="name" placeholder="Your name" hidden></label><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="At least 8 characters"></label><p class="customer-error" role="alert">'+esc(message)+'</p><button class="customer-submit" type="submit">Sign in securely ↗</button></form><div class="customer-or"><span>OR</span></div><button id="google-signin" class="customer-google" type="button"><span>G</span> Continue with Google</button><p class="customer-note">Your account is for customer orders only. Staff use the <a href="/staff/login">staff sign-in</a>.</p></section></main>';
    let mode="login";
    const name=app.querySelector('input[name="name"]');
    const form=app.querySelector("#customer-auth-form");
    app.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>{mode=b.dataset.mode;app.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x===b));name.hidden=mode!=="signup";name.required=mode==="signup";form.querySelector('input[name="password"]').autocomplete=mode==="signup"?"new-password":"current-password";form.querySelector(".customer-submit").textContent=mode==="signup"?"Create account ↗":"Sign in securely ↗";}));
    form.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(form);const button=form.querySelector("button[type=submit]");button.disabled=true;const email=String(f.get("email")).trim(),password=String(f.get("password"));let result;
      if(mode==="signup")result=await supabase.auth.signUp({email,password,options:{data:{full_name:String(f.get("name")||"").trim()}}});
      else result=await supabase.auth.signInWithPassword({email,password});
      if(result.error){form.querySelector(".customer-error").textContent=result.error.message;button.disabled=false;return;}
      if(mode==="signup"&&!result.data.session){form.querySelector(".customer-error").textContent="Account created. Check your email to confirm, then sign in.";button.disabled=false;return;}
      location.assign(safeNext);
    });
    app.querySelector("#google-signin").addEventListener("click",async()=>{const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+safeNext}});if(error)form.querySelector(".customer-error").textContent=error.message;});
  };
  const start=async()=>{if(!supabaseConfigured){view("Customer sign-in is temporarily unavailable. Please contact Step Town.");return;}const {data:{session}}=await supabase.auth.getSession();if(path==="/account"&&session){const user=session.user;app.innerHTML='<main class="customer-auth"><a class="customer-close" href="/">×</a><section class="customer-auth-card"><p class="customer-kicker">MY PROFILE</p><h1>Hello there.</h1><p>'+esc(user.email)+'</p><a class="customer-submit" href="/#menu">Browse the menu ↗</a><button class="customer-google" id="customer-signout">Sign out</button></section></main>';app.querySelector("#customer-signout").onclick=async()=>{await supabase.auth.signOut();location.assign("/");};return;}if(path==="/account"&&!session){location.assign("/account/login");return;}if(path==="/account/login"&&session){location.assign(safeNext);return;}view();};
  start().catch(e=>view(e.message));
}
