import { supabase, supabaseConfigured } from "./supabase.js";

const grid=document.querySelector(".gallery-grid");
if(grid&&supabaseConfigured&&supabase){
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const filters=["All","Catering","Staff","Barbecue","Cakes"];
  supabase.from("gallery_items").select("id,title,category,image_url,alt_text,caption,sort_order").eq("is_published",true).order("sort_order").then(({data,error})=>{
    if(error){console.warn("Step Town gallery could not load",error);return;}
    if(!data?.length)return;
    const wrap=grid.parentElement;
    const bar=document.createElement("div");bar.className="gallery-filters";bar.setAttribute("aria-label","Filter gallery images");
    bar.innerHTML=filters.map((f,i)=>'<button type="button" data-gallery-filter="'+f+'" class="'+(i===0?"active":"")+'">'+f+'</button>').join("");
    grid.before(bar);
    const render=category=>{
      const items=category==="All"?data:data.filter(x=>String(x.category).toLowerCase()===category.toLowerCase());
      grid.innerHTML=items.map((x,i)=>'<figure class="gallery-item '+(i===0?"gallery-large":"")+'"><img class="live-gallery-image" src="'+esc(x.image_url)+'" alt="'+esc(x.alt_text||x.title)+'" loading="lazy"><figcaption><span>'+String(i+1).padStart(2,"0")+'</span>'+esc(x.title||x.category)+(x.caption?' · '+esc(x.caption):'')+'</figcaption></figure>').join("")||'<p class="gallery-empty">New Step Town moments will appear here soon.</p>';
    };
    bar.addEventListener("click",e=>{const b=e.target.closest("[data-gallery-filter]");if(!b)return;bar.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render(b.dataset.galleryFilter);});
    render("All");
  });
}
