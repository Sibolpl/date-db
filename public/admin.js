const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,"0");
const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse=s=>new Date(`${s}T12:00:00`);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={date:new Date(new Date().getFullYear(),new Date().getMonth(),1),view:"month",profiles:[],bookings:[],blocks:[]};
const api=async(path,options={})=>{const r=await fetch(`/api/${path}`,{headers:{"Content-Type":"application/json"},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Błąd");return d;};
function showDashboard(){ $("loginPanel").classList.add("hidden");$("dashboard").classList.remove("hidden");refreshAll(); }
async function checkSession(){try{await api("admin/session");showDashboard();}catch{$("loginPanel").classList.remove("hidden");}}
$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginStatus").textContent="";try{await api("admin/login",{method:"POST",body:JSON.stringify({password:$("adminPassword").value})});showDashboard();}catch(err){$("loginStatus").textContent=err.message;}};
$("logoutBtn").onclick=async()=>{await api("admin/logout",{method:"POST"});location.reload();};
async function refreshAll(){await Promise.all([loadProfiles(),loadCalendar()]);}
async function loadProfiles(){
  state.profiles=await api("admin/profiles");
  $("profileFilter").innerHTML='<option value="">Wszystkie profile</option>'+state.profiles.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("blockProfile").innerHTML='<option value="">Wszystkie profile</option>'+state.profiles.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("profileList").innerHTML=state.profiles.map(p=>`<div class="manage-item"><div><strong>${esc(p.name)}</strong><small>${p.active?"Aktywny":"Nieaktywny"} · ${esc(p.description)}</small></div><button class="secondary" data-toggle="${p.id}" data-active="${p.active}">${p.active?"Dezaktywuj":"Aktywuj"}</button></div>`).join("")||'<p class="muted">Brak profili.</p>';
  $("profileList").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const p=state.profiles.find(x=>x.id===b.dataset.toggle);await api(`admin/profiles/${p.id}`,{method:"PATCH",body:JSON.stringify({...p,active:!p.active})});refreshAll();});
}
function range(){
  if(state.view==="day")return [key(state.date),key(state.date)];
  if(state.view==="week"){const d=new Date(state.date);d.setDate(d.getDate()-((d.getDay()+6)%7));const e=new Date(d);e.setDate(e.getDate()+6);return [key(d),key(e)];}
  const s=new Date(state.date.getFullYear(),state.date.getMonth(),1);s.setDate(s.getDate()-((s.getDay()+6)%7));const e=new Date(state.date.getFullYear(),state.date.getMonth()+1,0);e.setDate(e.getDate()+(6-((e.getDay()+6)%7)));return [key(s),key(e)];
}
async function loadCalendar(){
  const [from,to]=range();const profile=$("profileFilter").value;
  const data=await api(`admin/calendar?from=${from}&to=${to}${profile?"&profileId="+encodeURIComponent(profile):""}`);
  state.bookings=data.bookings;state.blocks=data.blocks;renderCalendar();
  $("adminMonthLabel").textContent=state.view==="day"?parse(from).toLocaleDateString("pl-PL",{dateStyle:"full"}):state.view==="week"?`${parse(from).toLocaleDateString("pl-PL")} – ${parse(to).toLocaleDateString("pl-PL")}`:state.date.toLocaleDateString("pl-PL",{month:"long",year:"numeric"});
  renderEvents();
}
function renderCalendar(){
  const cal=$("adminCalendar");cal.innerHTML="";
  const [from,to]=range();const start=parse(from),end=parse(to);
  if(state.view==="day"){renderDay(cal,from);return;}
  ["Pn","Wt","Śr","Cz","Pt","So","Nd"].forEach(x=>{const d=document.createElement("div");d.className="weekday";d.textContent=x;cal.append(d);});
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const k=key(d),b=document.createElement("div");b.className="day";
    const items=state.bookings.filter(x=>x.date===k&&x.status==="confirmed");
    const blocks=state.blocks.filter(x=>x.date===k);
    b.innerHTML=`<span class="day-num">${d.getDate()}</span>${items.slice(0,3).map(x=>`<span class="day-events">♥ ${esc(x.time)} ${esc(x.guest_name)} · ${esc(x.profile_name)}</span>`).join("")}${items.length>3?`<span class="day-events">+${items.length-3} więcej</span>`:""}${blocks.length?`<span class="day-events">▣ ${blocks.length} blokad</span>`:""}`;
    b.title=`${items.length} spotkań, ${blocks.length} blokad`;b.onclick=()=>{state.date=parse(k);state.view="day";setViewButtons();loadCalendar();};cal.append(b);
  }
}
function renderDay(cal,date){
  const items=state.bookings.filter(x=>x.date===date);
  const blocks=state.blocks.filter(x=>x.date===date);
  cal.style.gridTemplateColumns="1fr";
  cal.innerHTML=`<div class="event-list">${items.map(eventHTML).join("")||'<p class="muted">Brak spotkań tego dnia.</p>'}${blocks.map(blockHTML).join("")}</div>`;
}
function eventHTML(b){return `<div class="event-item"><div><strong>${esc(b.time)} · ${esc(b.guest_name)}</strong><small>${esc(b.profile_name)} · ${esc(b.place||"Bez podanego miejsca")} · ${esc(b.food||"")}</small><small>Ubiór: ${esc(b.outfit||"—")} · ${esc(b.message||"")}</small></div>${b.status==="confirmed"?`<button class="danger" data-cancel="${b.id}">Anuluj</button>`:'<span class="muted">Anulowano</span>'}</div>`;}
function blockHTML(b){return `<div class="event-item"><div><strong>▣ Blokada · ${esc(b.time||"Cały dzień")}</strong><small>${esc(b.profile_name||"Wszystkie profile")} · ${esc(b.reason||"")}</small></div><button class="danger" data-unblock="${b.id}">Usuń blokadę</button></div>`;}
function renderEvents(){
  $("adminEvents").innerHTML=[...state.bookings.map(b=>({...b,_type:"booking"})),...state.blocks.map(b=>({...b,_type:"block"}))].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(x=>x._type==="booking"?eventHTML(x):blockHTML(x)).join("")||'<p class="muted">Brak spotkań i blokad w tym zakresie.</p>';
  $("adminEvents").querySelectorAll("[data-cancel]").forEach(b=>b.onclick=async()=>{if(confirm("Anulować to spotkanie?")){await api(`admin/bookings/${b.dataset.cancel}/cancel`,{method:"POST"});loadCalendar();}});
  $("adminEvents").querySelectorAll("[data-unblock]").forEach(b=>b.onclick=async()=>{if(confirm("Usunąć blokadę?")){await api(`admin/blocks/${b.dataset.unblock}`,{method:"DELETE"});loadCalendar();}});
}
$("profileForm").onsubmit=async e=>{e.preventDefault();try{await api("admin/profiles",{method:"POST",body:JSON.stringify({name:$("profileName").value,description:$("profileDescription").value,photo_url:$("profilePhoto").value})});e.target.reset();$("profileStatus").textContent="Profil dodany.";await loadProfiles();}catch(err){$("profileStatus").textContent=err.message;}};
$("blockForm").onsubmit=async e=>{e.preventDefault();try{await api("admin/blocks",{method:"POST",body:JSON.stringify({profileId:$("blockProfile").value,date:$("blockDate").value,time:$("blockTime").value,reason:$("blockReason").value})});$("blockStatus").textContent="Termin zablokowany.";e.target.reset();loadCalendar();}catch(err){$("blockStatus").textContent=err.message;}};
$("adminPrev").onclick=()=>{if(state.view==="day")state.date.setDate(state.date.getDate()-1);else if(state.view==="week")state.date.setDate(state.date.getDate()-7);else state.date.setMonth(state.date.getMonth()-1);loadCalendar();};
$("adminNext").onclick=()=>{if(state.view==="day")state.date.setDate(state.date.getDate()+1);else if(state.view==="week")state.date.setDate(state.date.getDate()+7);else state.date.setMonth(state.date.getMonth()+1);loadCalendar();};
$("profileFilter").onchange=loadCalendar;
function setViewButtons(){document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{state.view=b.dataset.view;setViewButtons();loadCalendar();});
$("blockDate").value=key(new Date());
checkSession().catch(e=>{$("loginStatus").textContent=e.message;});
