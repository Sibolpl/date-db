(() => {
  const el=id=>document.getElementById(id), status=el('pushStatus');
  const supported=()=>('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
  async function registration(){return navigator.serviceWorker.register('/push-sw.js',{scope:'/'}).then(()=>navigator.serviceWorker.ready);}
  async function refresh(){
    if(!supported()){status.textContent='Ta przeglądarka nie obsługuje powiadomień push.';el('pushEnable').disabled=true;return;}
    const reg=await registration(), sub=await reg.pushManager.getSubscription();
    el('pushEnable').classList.toggle('hidden',!!sub);
    el('pushDisable').classList.toggle('hidden',!sub);
    el('pushTest').classList.toggle('hidden',!sub);
    status.textContent=sub?'Powiadomienia są włączone na tym urządzeniu.':'Powiadomienia są wyłączone na tym urządzeniu.';
  }
  el('pushEnable').onclick=async()=>{
    try{
      if(!supported())throw Error('Ta przeglądarka nie obsługuje powiadomień.');
      const {publicKey}=await (await fetch('/api/owner/push/config')).json();
      if(!publicKey)throw Error('Brak klucza publicznego VAPID w Cloudflare.');
      const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Nie przyznano zgody na powiadomienia.');
      const reg=await registration();const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(publicKey)});
      const response=await fetch('/api/owner/push/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON()})});
      if(!response.ok){const d=await response.json().catch(()=>({}));await sub.unsubscribe();throw Error(d.error||'Nie udało się zapisać urządzenia.');}
      await refresh();
    }catch(e){status.textContent=e.message;}
  };
  el('pushDisable').onclick=async()=>{
    try{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(sub){await fetch('/api/owner/push/subscriptions',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}await refresh();}catch(e){status.textContent=e.message;}
  };
  el('pushTest').onclick=async()=>{
    try{const r=await fetch('/api/owner/push/test',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||'Błąd testu');status.textContent='Wysłano test. Sprawdź powiadomienia telefonu.';}catch(e){status.textContent=e.message;}
  };
  // Buttons are visible after login; no push permission prompt without user action.
  refresh().catch(e=>{status.textContent=e.message;});
})();
