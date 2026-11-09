const $ = (id) => document.getElementById(id);
const state = { profiles: [], profileId: "", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selectedDate: "", selectedTime: "", availability: {booked:[],blocked:[]} };
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
    const el=document.createElement("button");el.type="button";el.className="profile-card"+(state.profileId===p.id?" selected":"");
    el.innerHTML=`${p.photo_url?`<img src="${escapeHtml(p.photo_url)}" alt="">`:""}<strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.description||"Wybierz tę osobę")}</small>`;
    el.onclick=()=>{state.profileId=p.id;state.selectedDate="";state.selectedTime="";renderProfiles();loadAvailability();};
    $("profiles").append(el);
  });
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function isBusy(date,time=null){
  const booked=state.availability.booked.some(x=>x.date===date&&(!time||x.time===time));
  const blocked=state.availability.blocked.some(x=>x.date===date&&(!x.time||!time||x.time===time));
  return booked||blocked;
}
async function loadAvailability(){
  $("monthLabel").textContent=monthName(state.month);
  if(!state.profileId){renderCalendar();return;}
  try{state.availability=await api(`availability?profileId=${encodeURIComponent(state.profileId)}&month=${monthKey(state.month)}`);}
  catch(e){$("bookingStatus").textContent=e.message;}
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
    const fullyBusy=Array.from({length:21},(_,i)=>`${pad(9+Math.floor(i/2))}:${i%2?"30":"00"}`).every(t=>isBusy(key,t));
    b.innerHTML=`<span class="day-num">${n}</span>`;
    if(key===dateKey(new Date()))b.classList.add("today");
    if(key===state.selectedDate)b.classList.add("selected");
    if(fullyBusy)b.classList.add("busy");else b.classList.add("available");
    b.disabled=!state.profileId||past||fullyBusy;
    b.onclick=()=>{state.selectedDate=key;state.selectedTime="";renderCalendar();renderTimes();};
    cal.append(b);
  }
}
function renderTimes(){
  $("timePanel").classList.remove("hidden");
  $("selectedDateLabel").textContent=new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long"});
  const slots=$("timeSlots");slots.innerHTML="";
  for(let i=0;i<22;i++){
    const hour=9+Math.floor(i/2), time=`${pad(hour)}:${i%2?"30":"00"}`;
    const btn=document.createElement("button");btn.type="button";btn.className="time-slot"+(state.selectedTime===time?" selected":"");btn.textContent=time;
    const past=state.selectedDate===dateKey(new Date())&&time<=`${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    btn.disabled=isBusy(state.selectedDate,time)||past;
    btn.onclick=()=>{state.selectedTime=time;renderTimes();};
    slots.append(btn);
  }
}
$("prevMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()-1);state.selectedDate="";state.selectedTime="";loadAvailability();};
$("nextMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()+1);state.selectedDate="";state.selectedTime="";loadAvailability();};
$("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();$("bookingStatus").textContent="";
  if(!state.profileId)return $("bookingStatus").textContent="Najpierw wybierz osobę.";
  if(!state.selectedDate||!state.selectedTime)return $("bookingStatus").textContent="Wybierz dzień i godzinę w kalendarzu.";
  const btn=$("submitBooking");btn.disabled=true;btn.textContent="Wysyłanie…";
  try{
    await api("bookings",{method:"POST",body:JSON.stringify({
      profileId:state.profileId,guestName:$("guestName").value,date:state.selectedDate,time:state.selectedTime,
      place:$("place").value,outfit:$("outfit").value,food:$("food").value,message:$("message").value
    })});
    $("bookingPanel").innerHTML='<div class="success-screen"><p class="eyebrow">REZERWACJA ZAPISANA</p><h1>Dziękujemy! <em>♥</em></h1><p class="muted">Spotkanie zostało zapisane. Do zobaczenia!</p></div>';
  }catch(err){$("bookingStatus").textContent=err.message;await loadAvailability();}
  finally{btn.disabled=false;btn.textContent="Potwierdzam spotkanie ♥";}
});
(async()=>{try{state.profiles=await api("profiles");renderProfiles();await loadAvailability();}catch(e){$("profiles").textContent=e.message;}})();
