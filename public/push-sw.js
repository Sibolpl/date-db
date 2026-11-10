self.addEventListener('push',event=>{
  let data={title:'Date Booking',body:'Masz nowe powiadomienie o spotkaniu.',url:'/owner'};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag||'date-booking',icon:'/icons/booking-192.png',badge:'/icons/booking-192.png',data:{url:data.url||'/owner'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const target=windows.find(w=>new URL(w.url).pathname==='/owner');
    return target?target.focus():clients.openWindow('/owner');
  }));
});
