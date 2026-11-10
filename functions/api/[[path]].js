const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

const id = () => crypto.randomUUID();
const readBody = async (request) => {
  try { return await request.json(); } catch { return {}; }
};
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const validQuarter = (s) => validTime(s) && Number(s.slice(3)) % 15 === 0;
// Poniedziałek=0, niedziela=6; wszystkie terminy są interpretowane jako czas lokalny strony.
const weekday = (date) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const scheduleAllows = (ranges, date, time) => ranges.some(r => r.weekday === weekday(date) && r.start_time <= time && time < r.end_time);


async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)date_admin=([^;]+)/);
  if (!match) return false;
  const [stamp, signature] = decodeURIComponent(match[1]).split(".");
  if (!stamp || !signature || Date.now() - Number(stamp) > 8 * 60 * 60 * 1000) return false;
  return (await sign(stamp, env.ADMIN_PASSWORD)) === signature;
}
const cookieHeader = (value, maxAge) =>
  `date_admin=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

// Owner accounts: PBKDF2 password hashes and signed, revocable, short-lived sessions.
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
async function hashPassword(password, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:enc.encode(salt), iterations:100000, hash:"SHA-256"}, material, 256);
  return b64(bits);
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}
const ownerCookie = (value, age) => `date_owner=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
async function ownerSession(request, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)date_owner=([^;]+)/);
  if(!m)return null;
  try {
    const [uid, version, expires, sig] = decodeURIComponent(m[1]).split(".");
    if(!uid || !/^\d+$/.test(version) || !/^\d+$/.test(expires) || Number(expires)<Date.now())return null;
    const value=`${uid}.${version}.${expires}`;
    if((await sign(value,env.ADMIN_PASSWORD))!==sig)return null;
    const user=await env.DB.prepare("SELECT id, username, display_name, active, session_version FROM owner_users WHERE id=?").bind(uid).first();
    return user && user.active && String(user.session_version)===version ? user : null;
  }catch{return null;}
}
async function permissions(env, userId) {
  const {results}=await env.DB.prepare("SELECT profile_id, can_view, can_cancel, can_block FROM owner_permissions WHERE user_id=?").bind(userId).all();
  return results||[];
}
async function allowed(env, userId, profileId, permission) {
  const row=await env.DB.prepare(`SELECT ${permission} AS allowed FROM owner_permissions WHERE user_id=? AND profile_id=?`).bind(userId,profileId).first();
  return !!row?.allowed;
}

async function discord(env, title, fields) {
  if (!env.DISCORD_WEBHOOK) return;
  try {
    await fetch(env.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title,
          color: 15158332,
          fields: fields.map(([name, value]) => ({
            name, value: clean(value || "—", 900) || "—", inline: false
          })),
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (e) {
    console.error("Discord notification failed", e);
  }
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;

  if (!env.DB) return json({ error: "Brak podłączenia bazy D1." }, 500);
  if (method !== "GET" && !sameOrigin(request)) return json({error:"Nieprawidłowe pochodzenie żądania."},403);

  if (path === "profiles" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, description, photo_url FROM profiles WHERE active = 1 AND deleted_at IS NULL ORDER BY name"
    ).all();
    return json(results || []);
  }

  if (path === "availability" && method === "GET") {
    const profileId = clean(url.searchParams.get("profileId"), 80);
    const month = clean(url.searchParams.get("month"), 7);
    if (!profileId || !/^\d{4}-\d{2}$/.test(month)) return json({ error: "Nieprawidłowe parametry." }, 400);
    const start = `${month}-01`;
    const endDate = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1));
    const end = endDate.toISOString().slice(0,10);
    const [booked, blocked] = await Promise.all([
      env.DB.prepare("SELECT date, time FROM bookings WHERE profile_id = ? AND date >= ? AND date < ? AND status = 'confirmed'").bind(profileId, start, end).all(),
      env.DB.prepare("SELECT date, time FROM blocked_slots WHERE (profile_id = ? OR profile_id IS NULL) AND date >= ? AND date < ?").bind(profileId, start, end).all()
    ]);
    const schedule = await env.DB.prepare(
      "SELECT weekday, start_time, end_time FROM weekly_availability WHERE profile_id = ? ORDER BY weekday, start_time"
    ).bind(profileId).all();
    return json({ booked: booked.results || [], blocked: blocked.results || [], schedule: schedule.results || [] });
  }

  if (path === "bookings" && method === "POST") {
    const data = await readBody(request);
    // Backwards-compatible: accept a single profileId or multiple profileIds.
    const rawIds = Array.isArray(data.profileIds) ? data.profileIds : [data.profileId];
    const profileIds = [...new Set(rawIds.map(x => clean(x, 80)).filter(Boolean))];
    const guestName = clean(data.guestName, 100);
    const date = clean(data.date, 10);
    const time = clean(data.time, 5);
    if (!profileIds.length || profileIds.length > 20 || !guestName || !validDate(date) || !validQuarter(time)) {
      return json({ error: "Wybierz od 1 do 20 osób, podaj imię, datę i godzinę." }, 400);
    }
    if (date < new Date().toISOString().slice(0,10)) return json({ error: "Nie można rezerwować dat z przeszłości." }, 400);
    const profiles = [];
    for (const profileId of profileIds) {
      const profile = await env.DB.prepare("SELECT id, name FROM profiles WHERE id = ? AND active = 1 AND deleted_at IS NULL").bind(profileId).first();
      if (!profile) return json({ error: "Jedna z wybranych osób jest niedostępna. Odśwież stronę." }, 409);
      const schedule = await env.DB.prepare("SELECT weekday, start_time, end_time FROM weekly_availability WHERE profile_id = ?").bind(profileId).all();
      if (!scheduleAllows(schedule.results || [], date, time)) return json({ error: `Osoba ${profile.name} nie jest dostępna o tej godzinie.` }, 409);
      const blocked = await env.DB.prepare("SELECT id FROM blocked_slots WHERE date = ? AND (profile_id = ? OR profile_id IS NULL) AND (time IS NULL OR time = ?)").bind(date, profileId, time).first();
      if (blocked) return json({ error: `Termin osoby ${profile.name} jest zablokowany.` }, 409);
      profiles.push(profile);
    }
    const groupId = id();
    const statements = profiles.map(profile => env.DB.prepare(
      "INSERT INTO bookings (id, profile_id, guest_name, date, time, place, outfit, food, message, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id(), profile.id, guestName, date, time, clean(data.place), clean(data.outfit), clean(data.food), clean(data.message, 1500), groupId));
    try {
      // D1 batch executes as one transaction: no partial group bookings.
      await env.DB.batch(statements);
    } catch (e) {
      return json({ error: "Co najmniej jeden termin został już zajęty. Wybierz inną godzinę." }, 409);
    }

    await discord(env, "❤️ Nowa rezerwacja spotkania", [
      ["Osoby", profiles.map(p=>p.name).join(", ")], ["Imię rezerwującego", guestName],
      ["Data", date], ["Godzina", time], ["Gdzie chcemy iść", data.place],
      ["Jak się ubieramy", data.outfit], ["Co chcemy jeść", data.food],
      ["Wiadomość", data.message]
    ]);
    return json({ success: true, id: groupId, count: profiles.length });
  }

  if (path === "owner/login" && method === "POST") {
    const data=await readBody(request), username=clean(data.username,80).toLowerCase(), password=String(data.password||"");
    if(!username || password.length>300)return json({error:"Nieprawidłowy login lub hasło."},401);
    const user=await env.DB.prepare("SELECT * FROM owner_users WHERE username=? AND active=1").bind(username).first();
    // Also perform an expensive hash for missing users to reduce username enumeration.
    const salt=user?.password_salt||"missing-account-salt";
    const candidate=await hashPassword(password,salt);
    if(!user || candidate!==user.password_hash)return json({error:"Nieprawidłowy login lub hasło."},401);
    const expires=String(Date.now()+8*60*60*1000);
    const value=`${user.id}.${user.session_version}.${expires}`;
    return json({success:true},200,{"Set-Cookie":ownerCookie(`${value}.${await sign(value,env.ADMIN_PASSWORD)}`,8*60*60)});
  }
  if(path==="owner/logout" && method==="POST")return json({success:true},200,{"Set-Cookie":ownerCookie("",0)});
  if(path.startsWith("owner/")) {
    const user=await ownerSession(request,env);
    if(!user)return json({error:"Zaloguj się ponownie."},401);
    const route=path.slice(6);
    if(route==="session" && method==="GET") {
      return json({user:{username:user.username,display_name:user.display_name},permissions:await permissions(env,user.id)});
    }
    if(route==="profiles" && method==="GET") {
      const {results}=await env.DB.prepare("SELECT p.id,p.name,op.can_view,op.can_cancel,op.can_block FROM owner_permissions op JOIN profiles p ON p.id=op.profile_id WHERE op.user_id=? AND op.can_view=1 AND p.deleted_at IS NULL ORDER BY p.name").bind(user.id).all();
      return json(results||[]);
    }
    if(route==="calendar" && method==="GET") {
      const from=clean(url.searchParams.get("from"),10), to=clean(url.searchParams.get("to"),10), profileId=clean(url.searchParams.get("profileId"),80);
      if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>1000*60*60*24*62)return json({error:"Nieprawidłowy zakres dat (maksymalnie 62 dni)."},400);
      if(profileId && !(await allowed(env,user.id,profileId,"can_view")))return json({error:"Brak dostępu do kalendarza."},403);
      const extra=profileId?" AND b.profile_id=?":"";
      const bookings=await env.DB.prepare(`SELECT b.*,p.name AS profile_name FROM bookings b JOIN profiles p ON p.id=b.profile_id JOIN owner_permissions op ON op.profile_id=b.profile_id AND op.user_id=? AND op.can_view=1 WHERE b.date>=? AND b.date<=?${extra} ORDER BY b.date,b.time`).bind(user.id,from,to,...(profileId?[profileId]:[])).all();
      const blockSql=`SELECT bs.*,p.name AS profile_name FROM blocked_slots bs LEFT JOIN profiles p ON p.id=bs.profile_id WHERE bs.date>=? AND bs.date<=? AND (bs.profile_id IS NULL OR bs.profile_id IN (SELECT profile_id FROM owner_permissions WHERE user_id=? AND can_view=1)) ${profileId?"AND (bs.profile_id=? OR bs.profile_id IS NULL)":""} ORDER BY bs.date,bs.time`;
      const blocks=await env.DB.prepare(blockSql).bind(from,to,user.id,...(profileId?[profileId]:[])).all();
      return json({bookings:bookings.results||[],blocks:blocks.results||[]});
    }
    if(route==="blocks" && method==="POST") {
      const d=await readBody(request), profileId=clean(d.profileId,80), date=clean(d.date,10), time=clean(d.time,5);
      if(!profileId || !validDate(date) || (time&&!validTime(time)))return json({error:"Wybierz profil, datę i poprawną godzinę."},400);
      if(!(await allowed(env,user.id,profileId,"can_block")))return json({error:"Brak uprawnienia do blokowania."},403);
      const blockId=id();
      await env.DB.prepare("INSERT INTO blocked_slots (id,profile_id,date,time,reason) VALUES (?,?,?,?,?)").bind(blockId,profileId,date,time||null,clean(d.reason,200)).run();
      return json({success:true,id:blockId});
    }
    const blockMatch=route.match(/^blocks\/([^/]+)$/);
    if(blockMatch && method==="DELETE") {
      const block=await env.DB.prepare("SELECT profile_id FROM blocked_slots WHERE id=?").bind(blockMatch[1]).first();
      if(!block)return json({error:"Nie znaleziono blokady."},404);
      if(!block.profile_id || !(await allowed(env,user.id,block.profile_id,"can_block")))return json({error:"Brak uprawnienia do usunięcia blokady."},403);
      await env.DB.prepare("DELETE FROM blocked_slots WHERE id=?").bind(blockMatch[1]).run();
      return json({success:true});
    }
    const cancel=route.match(/^bookings\/([^/]+)\/cancel$/);
    if(cancel && method==="POST") {
      const booking=await env.DB.prepare("SELECT b.*,p.name AS profile_name FROM bookings b JOIN profiles p ON p.id=b.profile_id WHERE b.id=?").bind(cancel[1]).first();
      if(!booking)return json({error:"Nie znaleziono rezerwacji."},404);
      if(!(await allowed(env,user.id,booking.profile_id,"can_cancel")))return json({error:"Brak uprawnienia do anulowania."},403);
      await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'").bind(cancel[1]).run();
      await discord(env,"❌ Anulowanie spotkania",[["Osoba",booking.profile_name],["Rezerwujący",booking.guest_name],["Data",booking.date],["Godzina",booking.time]]);
      return json({success:true});
    }
    return json({error:"Nie znaleziono endpointu."},404);
  }

  if (path === "admin/login" && method === "POST") {
    const data = await readBody(request);
    if (!env.ADMIN_PASSWORD || clean(data.password, 200) !== env.ADMIN_PASSWORD) {
      return json({ error: "Nieprawidłowe hasło." }, 401);
    }
    const stamp = String(Date.now());
    const token = `${stamp}.${await sign(stamp, env.ADMIN_PASSWORD)}`;
    return json({ success: true }, 200, { "Set-Cookie": cookieHeader(token, 8 * 60 * 60) });
  }

  if (path === "admin/logout" && method === "POST") {
    return json({ success: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }

  if (path.startsWith("admin/")) {
    if (!(await isAdmin(request, env))) return json({ error: "Brak dostępu." }, 401);
    const route = path.slice(6);

    if (route === "session" && method === "GET") return json({ authenticated: true });

    if(route==="users" && method==="GET") {
      const {results}=await env.DB.prepare("SELECT id,username,display_name,active,created_at FROM owner_users ORDER BY created_at DESC").all();
      const {results:perms}=await env.DB.prepare("SELECT user_id,profile_id,can_view,can_cancel,can_block FROM owner_permissions").all();
      return json({users:results||[],permissions:perms||[]});
    }
    if(route==="users" && method==="POST") {
      const d=await readBody(request), username=clean(d.username,80).toLowerCase(), display=clean(d.display_name,100), password=String(d.password||"");
      if(!/^[a-z0-9._-]{3,80}$/.test(username)||!display||password.length<12||password.length>200)return json({error:"Login: 3–80 znaków (litery, cyfry, . _ -). Hasło: minimum 12 znaków."},400);
      const uid=id(),salt=id(),hash=await hashPassword(password,salt);
      try {await env.DB.prepare("INSERT INTO owner_users(id,username,display_name,password_salt,password_hash) VALUES(?,?,?,?,?)").bind(uid,username,display,salt,hash).run();}
      catch{return json({error:"Login jest już zajęty."},409);}
      return json({success:true,id:uid});
    }
    const userMatch=route.match(/^users\/([^/]+)$/);
    if(userMatch && method==="PATCH") {
      const d=await readBody(request), user=await env.DB.prepare("SELECT id FROM owner_users WHERE id=?").bind(userMatch[1]).first();
      if(!user)return json({error:"Nie znaleziono konta."},404);
      if(typeof d.active==="boolean")await env.DB.prepare("UPDATE owner_users SET active=?,session_version=session_version+1 WHERE id=?").bind(d.active?1:0,user.id).run();
      if(d.password!==undefined){const pw=String(d.password);if(pw.length<12||pw.length>200)return json({error:"Hasło musi mieć 12–200 znaków."},400);const salt=id();await env.DB.prepare("UPDATE owner_users SET password_salt=?,password_hash=?,session_version=session_version+1 WHERE id=?").bind(salt,await hashPassword(pw,salt),user.id).run();}
      return json({success:true});
    }
    const permissionMatch=route.match(/^users\/([^/]+)\/permissions$/);
    if(permissionMatch && method==="PUT") {
      const d=await readBody(request), uid=permissionMatch[1], profileId=clean(d.profileId,80);
      if(!profileId || !(await env.DB.prepare("SELECT id FROM owner_users WHERE id=?").bind(uid).first()) || !(await env.DB.prepare("SELECT id FROM profiles WHERE id=?").bind(profileId).first()))return json({error:"Nieprawidłowe konto lub profil."},400);
      const view=!!d.can_view, cancel=view&&!!d.can_cancel, block=view&&!!d.can_block;
      await env.DB.prepare("INSERT INTO owner_permissions(user_id,profile_id,can_view,can_cancel,can_block) VALUES(?,?,?,?,?) ON CONFLICT(user_id,profile_id) DO UPDATE SET can_view=excluded.can_view,can_cancel=excluded.can_cancel,can_block=excluded.can_block").bind(uid,profileId,view?1:0,cancel?1:0,block?1:0).run();
      return json({success:true});
    }

    if (route === "profiles" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC").all();
      return json(results || []);
    }

    if (route === "profiles" && method === "POST") {
      const data = await readBody(request);
      const name = clean(data.name, 100);
      if (!name) return json({ error: "Podaj nazwę profilu." }, 400);
      const profileId = id();
      await env.DB.prepare("INSERT INTO profiles (id, name, description, photo_url) VALUES (?, ?, ?, ?)")
        .bind(profileId, name, clean(data.description, 300), clean(data.photo_url, 500)).run();
      return json({ success: true, id: profileId });
    }

    const profileMatch = route.match(/^profiles\/([^/]+)$/);
    if (profileMatch && method === "PATCH") {
      const data = await readBody(request);
      await env.DB.prepare("UPDATE profiles SET name = ?, description = ?, photo_url = ?, active = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(clean(data.name,100), clean(data.description,300), clean(data.photo_url,500), data.active ? 1 : 0, profileMatch[1]).run();
      return json({ success: true });
    }

    if (profileMatch && method === "DELETE") {
      const profile = await env.DB.prepare("SELECT id FROM profiles WHERE id=? AND deleted_at IS NULL").bind(profileMatch[1]).first();
      if (!profile) return json({ error: "Nie znaleziono profilu." }, 404);
      // Soft delete preserves booking history, permissions and related records.
      await env.DB.prepare("UPDATE profiles SET active=0, deleted_at=CURRENT_TIMESTAMP WHERE id=?").bind(profileMatch[1]).run();
      return json({ success: true });
    }

    if (route === "schedule" && method === "GET") {
      const profileId = clean(url.searchParams.get("profileId"), 80);
      if (!profileId) return json({ error: "Wybierz profil." }, 400);
      const profile = await env.DB.prepare("SELECT id FROM profiles WHERE id = ?").bind(profileId).first();
      if (!profile) return json({ error: "Nie znaleziono profilu." }, 404);
      const { results } = await env.DB.prepare("SELECT weekday, start_time, end_time FROM weekly_availability WHERE profile_id = ? ORDER BY weekday, start_time").bind(profileId).all();
      return json(results || []);
    }

    if (route === "schedule" && method === "PUT") {
      const data = await readBody(request);
      const profileId = clean(data.profileId, 80);
      const slots = data.slots;
      if (!profileId || !Array.isArray(slots) || slots.length > 100) return json({ error: "Nieprawidłowy grafik." }, 400);
      const profile = await env.DB.prepare("SELECT id FROM profiles WHERE id = ?").bind(profileId).first();
      if (!profile) return json({ error: "Nie znaleziono profilu." }, 404);
      const parsed = [];
      for (const slot of slots) {
        const day = Number(slot.weekday), start = clean(slot.start_time, 5), end = clean(slot.end_time, 5);
        if (!Number.isInteger(day) || day < 0 || day > 6 || !validQuarter(start) || !(validQuarter(end) || end === "23:59") || start >= end) {
          return json({ error: "Podaj poprawne przedziały od 00:00 do 23:59, co 15 minut (23:59 jako koniec dnia)." }, 400);
        }
        parsed.push({ weekday: day, start_time: start, end_time: end });
      }
      parsed.sort((a,b) => a.weekday-b.weekday || a.start_time.localeCompare(b.start_time));
      for (let i=1; i<parsed.length; i++) {
        if (parsed[i].weekday === parsed[i-1].weekday && parsed[i].start_time < parsed[i-1].end_time) {
          return json({ error: "Przedziały jednego dnia nie mogą na siebie nachodzić." }, 400);
        }
      }
      const statements = [env.DB.prepare("DELETE FROM weekly_availability WHERE profile_id = ?").bind(profileId),
        ...parsed.map(slot => env.DB.prepare("INSERT INTO weekly_availability (id, profile_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)").bind(id(), profileId, slot.weekday, slot.start_time, slot.end_time))];
      await env.DB.batch(statements);
      return json({ success: true });
    }

    if (route === "calendar" && method === "GET") {
      const from = clean(url.searchParams.get("from"), 10);
      const to = clean(url.searchParams.get("to"), 10);
      const profileId = clean(url.searchParams.get("profileId"), 80);
      if (!validDate(from) || !validDate(to)) return json({ error: "Nieprawidłowy zakres dat." }, 400);
      let sql = `SELECT b.*, p.name AS profile_name FROM bookings b JOIN profiles p ON p.id = b.profile_id WHERE b.date >= ? AND b.date <= ?`;
      const args = [from, to];
      if (profileId) { sql += " AND b.profile_id = ?"; args.push(profileId); }
      sql += " ORDER BY b.date, b.time";
      const bookings = await env.DB.prepare(sql).bind(...args).all();
      const blocks = await env.DB.prepare(
        "SELECT bs.*, p.name AS profile_name FROM blocked_slots bs LEFT JOIN profiles p ON p.id = bs.profile_id WHERE bs.date >= ? AND bs.date <= ? ORDER BY bs.date, bs.time"
      ).bind(from, to).all();
      return json({ bookings: bookings.results || [], blocks: blocks.results || [] });
    }

    if (route === "blocks" && method === "POST") {
      const data = await readBody(request);
      const date = clean(data.date, 10);
      const time = clean(data.time, 5);
      if (!validDate(date) || (time && !validTime(time))) return json({ error: "Nieprawidłowa data lub godzina." }, 400);
      const blockId = id();
      await env.DB.prepare("INSERT INTO blocked_slots (id, profile_id, date, time, reason) VALUES (?, ?, ?, ?, ?)")
        .bind(blockId, clean(data.profileId,80) || null, date, time || null, clean(data.reason,200)).run();
      return json({ success: true, id: blockId });
    }

    const blockMatch = route.match(/^blocks\/([^/]+)$/);
    if (blockMatch && method === "DELETE") {
      await env.DB.prepare("DELETE FROM blocked_slots WHERE id = ?").bind(blockMatch[1]).run();
      return json({ success: true });
    }

    const cancelMatch = route.match(/^bookings\/([^/]+)\/cancel$/);
    if (cancelMatch && method === "POST") {
      const booking = await env.DB.prepare(
        "SELECT b.*, p.name AS profile_name FROM bookings b JOIN profiles p ON p.id = b.profile_id WHERE b.id = ?"
      ).bind(cancelMatch[1]).first();
      if (!booking) return json({ error: "Nie znaleziono rezerwacji." }, 404);
      await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(cancelMatch[1]).run();
      await discord(env, "❌ Anulowanie spotkania", [
        ["Osoba", booking.profile_name], ["Rezerwujący", booking.guest_name],
        ["Data", booking.date], ["Godzina", booking.time]
      ]);
      return json({ success: true });
    }
  }

  return json({ error: "Nie znaleziono endpointu." }, 404);
}
