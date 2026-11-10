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
async function refreshAll(){await Promise.all([loadProfiles(),loadCalendar()]);await loadUsers();}
async function loadProfiles(){
  state.profiles=await api("admin/profiles");
  $("profileFilter").innerHTML='<option value="">Wszystkie profile</option>'+state.profiles.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("blockProfile").innerHTML='<option value="">Wszystkie profile</option>'+state.profiles.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const previousScheduleProfile=$("scheduleProfile").value;
  $("scheduleProfile").innerHTML=state.profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  if(state.profiles.some(p=>p.id===previousScheduleProfile)) $("scheduleProfile").value=previousScheduleProfile;
  await loadSchedule();
  $("profileList").innerHTML=state.profiles.map(p=>`<div class="manage-item"><div><strong>${esc(p.name)}</strong><small>${p.active?"Aktywny":"Nieaktywny"} · ${esc(p.description)}</small></div><button class="secondary" data-toggle="${p.id}" data-active="${p.active}">${p.active?"Dezaktywuj":"Aktywuj"}</button><button class="danger" data-delete="${p.id}">Usuń profil</button></div>`).join("")||'<p class="muted">Brak profili.</p>';
  $("profileList").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const p=state.profiles.find(x=>x.id===b.dataset.toggle);await api(`admin/profiles/${p.id}`,{method:"PATCH",body:JSON.stringify({...p,active:!p.active})});refreshAll();});
  $("profileList").querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{
    const p=state.profiles.find(x=>x.id===b.dataset.delete);
    if(!confirm(`Usunąć profil „${p.name}”? Zniknie z list i rezerwacji. Historia spotkań zostanie zachowana.`))return;
    try{await api(`admin/profiles/${p.id}`,{method:"DELETE"});$("profileStatus").textContent="Profil usunięty.";await refreshAll();}
    catch(e){$("profileStatus").textContent=e.message;}
  });
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
function eventHTML(b){return `<div class="event-item"><div><strong>${esc(b.time)} · </strong><small>${esc(b.profile_name)} · ${esc(b.place||"Bez podanego miejsca")} · ${esc(b.food||"")}</small><small>Ubiór: ${esc(b.outfit||"—")} · ${esc(b.message||"")}</small></div>${b.status==="confirmed"?`<button class="danger" data-cancel="${b.id}">Anuluj</button>`:'<span class="muted">Anulowano</span>'}</div>`;}
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

const dayNames=["Poniedziałek","Wtorek","Środa","Czwartek","Piątek","Sobota","Niedziela"];
let scheduleSlots=[];
const timeOptions=(selected)=>{
  let options="";
  for(let mins=0;mins<24*60;mins+=15){
    const time=`${pad(Math.floor(mins/60))}:${pad(mins%60)}`;
    options+=`<option value="${time}" ${time===selected?"selected":""}>${time}</option>`;
  }
  options+=`<option value="23:59" ${selected==="23:59"?"selected":""}>23:59 (koniec dnia)</option>`;
  return options;
};
async function loadSchedule(){
  const profileId=$("scheduleProfile").value;
  $("scheduleStatus").textContent="";
  if(!profileId){scheduleSlots=[];renderSchedule();return;}
  try{scheduleSlots=await api(`admin/schedule?profileId=${encodeURIComponent(profileId)}`);renderSchedule();}
  catch(err){$("scheduleStatus").textContent=err.message;}
}
function renderSchedule(){
  $("scheduleDays").innerHTML=dayNames.map((name,day)=>`<div class="schedule-day"><div class="schedule-day-head"><strong>${name}</strong><button type="button" class="secondary" data-add-day="${day}">+ Dodaj przedział</button></div><div class="schedule-ranges">${scheduleSlots.map((slot,index)=>slot.weekday===day?`<div class="schedule-range"><label>Od <select data-start="${index}">${timeOptions(slot.start_time)}</select></label><label>Do <select data-end="${index}">${timeOptions(slot.end_time)}</select></label><button type="button" class="danger" data-remove="${index}">Usuń</button></div>`:"").join("")||'<span class="muted">Niedostępny</span>'}</div></div>`).join("");
  $("scheduleDays").querySelectorAll("[data-add-day]").forEach(b=>b.onclick=()=>{scheduleSlots.push({weekday:Number(b.dataset.addDay),start_time:"09:00",end_time:"12:00"});renderSchedule();});
  $("scheduleDays").querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{scheduleSlots.splice(Number(b.dataset.remove),1);renderSchedule();});
  $("scheduleDays").querySelectorAll("[data-start]").forEach(el=>el.onchange=()=>{scheduleSlots[Number(el.dataset.start)].start_time=el.value;});
  $("scheduleDays").querySelectorAll("[data-end]").forEach(el=>el.onchange=()=>{scheduleSlots[Number(el.dataset.end)].end_time=el.value;});
}
$("scheduleProfile").onchange=loadSchedule;
$("saveSchedule").onclick=async()=>{
  const btn=$("saveSchedule");btn.disabled=true;$("scheduleStatus").textContent="Zapisywanie…";
  try{await api("admin/schedule",{method:"PUT",body:JSON.stringify({profileId:$("scheduleProfile").value,slots:scheduleSlots})});$("scheduleStatus").textContent="Grafik zapisany.";await loadSchedule();$("scheduleStatus").textContent="Grafik zapisany.";}
  catch(err){$("scheduleStatus").textContent=err.message;}
  finally{btn.disabled=false;}
};

$("blockDate").value=key(new Date());
checkSession().catch(e=>{$("loginStatus").textContent=e.message;});

// Administrator: accounts and per-profile permissions.
async function loadUsers(){
  try {
    const data=await api("admin/users"), profiles=state.profiles;
    $("userList").innerHTML=data.users.map(u=>{
      const rows=profiles.map(p=>{
        const perm=data.permissions.find(x=>x.user_id===u.id&&x.profile_id===p.id)||{};
        return `<div class="manage-item" style="flex-wrap:wrap;gap:10px"><strong>${esc(p.name)}</strong><label><input type="checkbox" data-perm="view" data-user="${u.id}" data-profile="${p.id}" ${perm.can_view?"checked":""}> Podgląd</label><label><input type="checkbox" data-perm="cancel" data-user="${u.id}" data-profile="${p.id}" ${perm.can_cancel?"checked":""}> Anulowanie</label><label><input type="checkbox" data-perm="block" data-user="${u.id}" data-profile="${p.id}" ${perm.can_block?"checked":""}> Blokady</label><button class="secondary" data-saveperm="${u.id}" data-profile="${p.id}">Zapisz prawa</button></div>`;
      }).join("");
      return `<div class="panel" style="margin:12px 0;padding:18px"><h3>${esc(u.display_name)} <small>(${esc(u.username)})</small></h3><p class="muted">${u.active?"Aktywne konto":"Konto wyłączone"}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="secondary" data-toggleuser="${u.id}" data-active="${u.active}">${u.active?"Wyłącz konto":"Włącz konto"}</button><button class="secondary" data-resetuser="${u.id}">Zmień hasło</button></div><h4>Uprawnienia do kalendarzy</h4>${rows||"Najpierw dodaj profil."}</div>`;
    }).join("")||'<p class="muted">Nie utworzono jeszcze kont.</p>';
    $("userList").querySelectorAll("[data-saveperm]").forEach(b=>b.onclick=async()=>{
      const uid=b.dataset.saveperm,pid=b.dataset.profile;
      const checked=name=>!!$("userList").querySelector(`[data-perm="${name}"][data-user="${uid}"][data-profile="${pid}"]`).checked;
      try{await api(`admin/users/${uid}/permissions`,{method:"PUT",body:JSON.stringify({profileId:pid,can_view:checked("view"),can_cancel:checked("cancel"),can_block:checked("block")})});$("userStatus").textContent="Uprawnienia zapisane.";await loadUsers();}
      catch(e){$("userStatus").textContent=e.message;}
    });
    $("userList").querySelectorAll("[data-toggleuser]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Zmienić stan konta?"))return;
      try{await api(`admin/users/${b.dataset.toggleuser}`,{method:"PATCH",body:JSON.stringify({active:!Number(b.dataset.active)})});await loadUsers();}catch(e){$("userStatus").textContent=e.message;}
    });
    $("userList").querySelectorAll("[data-resetuser]").forEach(b=>b.onclick=async()=>{
      const password=prompt("Wpisz nowe hasło (minimum 12 znaków). Nie podawaj go nikomu poza właścicielem konta.");
      if(password===null)return;
      try{await api(`admin/users/${b.dataset.resetuser}`,{method:"PATCH",body:JSON.stringify({password})});$("userStatus").textContent="Hasło zmienione; poprzednie sesje wylogowane.";}catch(e){$("userStatus").textContent=e.message;}
    });
  }catch(e){$("userStatus").textContent=e.message;}
}
$("userForm").onsubmit=async e=>{
  e.preventDefault();
  try{await api("admin/users",{method:"POST",body:JSON.stringify({username:$("userLogin").value,display_name:$("userDisplay").value,password:$("userPassword").value})});e.target.reset();$("userStatus").textContent="Konto utworzone. Nadaj mu teraz uprawnienia poniżej.";await loadUsers();}
  catch(err){$("userStatus").textContent=err.message;}
};
