import { notifyOwners } from '../functions/_lib/push.js';
const zone='Europe/Warsaw';
const localParts = timestamp => {
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp));
  const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {date:`${obj.year}-${obj.month}-${obj.day}`,time:`${obj.hour}:${obj.minute}`};
};
export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      const now=Date.now();
      for(const [kind,offset] of [['24h',24*60*60*1000],['1h',60*60*1000]]){
        // The cron runs every 5 min. Check the upcoming 5-minute interval in Polish local time.
        const stamps=[localParts(now+offset),localParts(now+offset+5*60*1000)];
        const from=`${stamps[0].date} ${stamps[0].time}`,to=`${stamps[1].date} ${stamps[1].time}`;
        const {results}=await env.DB.prepare("SELECT b.id,b.profile_id,b.date,b.time,p.name AS profile_name FROM bookings b JOIN profiles p ON p.id=b.profile_id WHERE b.status='confirmed' AND (b.date || ' ' || b.time)>=? AND (b.date || ' ' || b.time)<?").bind(from,to).all();
        for(const booking of results||[]){
          const existing=await env.DB.prepare('SELECT 1 FROM push_reminders WHERE booking_id=? AND kind=?').bind(booking.id,kind).first();if(existing)continue;
          await notifyOwners(env,[booking.profile_id],{title:kind==='24h'?'Spotkanie jutro ❤️':'Spotkanie za godzinę ⏰',body:`${booking.date} o ${booking.time} · ${booking.profile_name}`,url:'/owner',tag:`reminder-${kind}-${booking.id}`});
          await env.DB.prepare('INSERT OR IGNORE INTO push_reminders(booking_id,kind) VALUES(?,?)').bind(booking.id,kind).run();
        }
      }
    })());
  }
};
