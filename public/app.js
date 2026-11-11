const $ = (id) => document.getElementById(id);
const state = { profiles: [], profileIds: [], month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selectedDate: "", selectedTime: "", availability: {} };
const pad = n => String(n).padStart(2,"0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
const monthName = d => d.toLocaleDateString("pl-PL",{month:"long",year:"numeric"});
const api = async (path, options={}) => {
  const r = await fetch(`/api/${path}`, {headers:{"Content-Type":"application/json"},...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || "Wystąpił błąd.");
  return data;
};
function renderProfiles(){
  $("profiles").innerHTML = "";
  if(!state.profiles.length){$("profiles").innerHTML='<p class="muted">Nie ma jeszcze aktywnych profili. Spróbuj ponownie później.</p>';return;}
  state.profiles.forEach(p=>{
    const el=document.createElement("button");el.type="button";el.className="profile-card"+(state.profileIds.includes(p.id)?" selected":"");
    el.innerHTML=`${p.photo_url?`<img src="${escapeHtml(p.photo_url)}" alt="">`:""}<strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.description||"Wybierz tę osobę")}</small>`;
    el.setAttribute("aria-pressed",String(state.profileIds.includes(p.id)));
    el.onclick=()=>{state.profileIds=state.profileIds.includes(p.id)?state.profileIds.filter(x=>x!==p.id):[...state.profileIds,p.id];state.selectedDate="";state.selectedTime="";renderProfiles();loadAvailability();};
    $("profiles").append(el);
  });
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function isScheduled(date,time){
  const weekday=(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7;
  return state.profileIds.length>0 && state.profileIds.every(pid=>(state.availability[pid]?.schedule||[]).some(s=>Number(s.weekday)===weekday && s.start_time<=time && time<s.end_time));
}
function isBusy(date,time=null){
  const booked=state.profileIds.some(pid=>(state.availability[pid]?.booked||[]).some(x=>x.date===date&&(!time||x.time===time)));
  const blocked=state.profileIds.some(pid=>(state.availability[pid]?.blocked||[]).some(x=>x.date===date&&(!x.time||!time||x.time===time)));
  return booked||blocked;
}
let availabilityRequest=0;
async function loadAvailability(){
  const requestId=++availabilityRequest;
  $("monthLabel").textContent=monthName(state.month);
  if(!state.profileIds.length){state.availability={};renderCalendar();$("timePanel").classList.add("hidden");return;}
  try{
    const ids=[...state.profileIds];
    const values=await Promise.all(ids.map(pid=>api(`availability?profileId=${encodeURIComponent(pid)}&month=${monthKey(state.month)}`)));
    if(requestId!==availabilityRequest)return;
    state.availability=Object.fromEntries(ids.map((pid,i)=>[pid,values[i]]));
  }
  catch(e){if(requestId!==availabilityRequest)return;$("bookingStatus").textContent=e.message;state.availability={};}
  renderCalendar();
  if(state.selectedDate) renderTimes();
}
function renderCalendar(){
  const cal=$("publicCalendar");cal.innerHTML="";
  ["Pn","Wt","Śr","Cz","Pt","So","Nd"].forEach(x=>{const d=document.createElement("div");d.className="weekday";d.textContent=x;cal.append(d);});
  const first=new Date(state.month.getFullYear(),state.month.getMonth(),1);
  const offset=(first.getDay()+6)%7;
  for(let i=0;i<offset;i++){const blank=document.createElement("div");cal.append(blank);}
  const days=new Date(state.month.getFullYear(),state.month.getMonth()+1,0).getDate();
  for(let n=1;n<=days;n++){
    const d=new Date(state.month.getFullYear(),state.month.getMonth(),n), key=dateKey(d);
    const b=document.createElement("button");b.type="button";b.className="day";
    const past=key<dateKey(new Date());
    const fullyBusy=Array.from({length:96},(_,i)=>`${pad(Math.floor(i/4))}:${pad((i%4)*15)}`).every(t=>!isScheduled(key,t)||isBusy(key,t));
    b.innerHTML=`<span class="day-num">${n}</span>`;
    if(key===dateKey(new Date()))b.classList.add("today");
    if(key===state.selectedDate)b.classList.add("selected");
    if(fullyBusy)b.classList.add("busy");else b.classList.add("available");
    b.disabled=!state.profileIds.length||past||fullyBusy;
    b.onclick=()=>{state.selectedDate=key;state.selectedTime="";renderCalendar();renderTimes();};
    cal.append(b);
  }
}
function renderTimes(){
  $("timePanel").classList.remove("hidden");
  $("selectedDateLabel").textContent=new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long"});
  const slots=$("timeSlots");slots.innerHTML="";
  let visible=0;
  for(let i=0;i<96;i++){
    const hour=Math.floor(i/4), time=`${pad(hour)}:${pad((i%4)*15)}`;
    // Pokazujemy wyłącznie godziny z grafiku, które nie są zablokowane.
    if(!isScheduled(state.selectedDate,time))continue;
    if(state.profileIds.some(pid=>(state.availability[pid]?.blocked||[]).some(x=>x.date===state.selectedDate&&(!x.time||x.time===time))))continue;
    const past=state.selectedDate===dateKey(new Date())&&time<=`${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    if(past)continue;
    const booked=state.profileIds.some(pid=>(state.availability[pid]?.booked||[]).some(x=>x.date===state.selectedDate&&x.time===time));
    const btn=document.createElement("button");btn.type="button";
    btn.className="time-slot"+(state.selectedTime===time?" selected":"");
    btn.textContent=time;
    // Przekreślenie dotyczy tylko godzin zajętych przez rezerwację.
    btn.disabled=booked;
    btn.onclick=()=>{state.selectedTime=time;renderTimes();};
    slots.append(btn);
    visible++;
  }
  if(!visible){
    const msg=document.createElement("p");msg.className="muted";
    msg.textContent="Brak dostępnych godzin w tym dniu.";
    slots.append(msg);
  }
}

// Dropdowns for booking details; "Inne" reveals a custom text field.
const bookingFields=["place","outfit","food"];
function renderDetailOptions(options){
  for(const field of bookingFields){
    const select=$(field), other=$(field+"Other"), previous=select.value;
    select.replaceChildren(new Option("Wybierz propozycję (opcjonalnie)",""));
    for(const value of options[field]||[])select.add(new Option(value,value));
    select.add(new Option("Inne — wpisz własną odpowiedź","__other__"));
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    const update=()=>{const custom=select.value==="__other__";other.classList.toggle("hidden",!custom);other.required=custom;if(!custom)other.value="";};
    select.onchange=update;update();
  }
}
function detailValue(field){
  return $(field).value==="__other__"?$(field+"Other").value.trim():$(field).value;
}
async function loadDetailOptions(){
  try{renderDetailOptions(await api("booking-options"));}
  catch(e){$("bookingStatus").textContent="Nie udało się wczytać propozycji. Odśwież stronę.";renderDetailOptions({});}
}

$("prevMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()-1);state.selectedDate="";state.selectedTime="";loadAvailability();};
$("nextMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()+1);state.selectedDate="";state.selectedTime="";loadAvailability();};
$("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();$("bookingStatus").textContent="";
  if(!state.profileIds.length)return $("bookingStatus").textContent="Najpierw wybierz co najmniej jedną osobę.";
  if(!state.selectedDate||!state.selectedTime)return $("bookingStatus").textContent="Wybierz dzień i godzinę w kalendarzu.";
  const btn=$("submitBooking");btn.disabled=true;btn.textContent="Wysyłanie…";
  try{
    await api("bookings",{method:"POST",body:JSON.stringify({
      profileIds:state.profileIds,date:state.selectedDate,time:state.selectedTime,
      place:detailValue("place"),outfit:detailValue("outfit"),food:detailValue("food"),message:$("message").value
    })});
    $("bookingPanel").innerHTML='<div class="success-screen"><p class="eyebrow">REZERWACJA ZAPISANA</p><h1>Dziękujemy! <em>♥</em></h1><p class="muted">Spotkanie zostało zapisane. Do zobaczenia!</p></div>';
  }catch(err){$("bookingStatus").textContent=err.message;await loadAvailability();}
  finally{btn.disabled=false;btn.textContent="Potwierdzam spotkanie ♥";}
});
(async()=>{await loadDetailOptions();try{state.profiles=await api("profiles");renderProfiles();await loadAvailability();}catch(e){$("profiles").textContent=e.message;}})();
