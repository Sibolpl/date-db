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

  if (path === "profiles" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, description, photo_url FROM profiles WHERE active = 1 ORDER BY name"
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
    return json({ booked: booked.results || [], blocked: blocked.results || [] });
  }

  if (path === "bookings" && method === "POST") {
    const data = await readBody(request);
    const profileId = clean(data.profileId, 80);
    const guestName = clean(data.guestName, 100);
    const date = clean(data.date, 10);
    const time = clean(data.time, 5);
    if (!profileId || !guestName || !validDate(date) || !validTime(time)) {
      return json({ error: "Uzupełnij imię, datę i godzinę." }, 400);
    }
    if (date < new Date().toISOString().slice(0,10)) return json({ error: "Nie można rezerwować dat z przeszłości." }, 400);
    const profile = await env.DB.prepare("SELECT id, name FROM profiles WHERE id = ? AND active = 1").bind(profileId).first();
    if (!profile) return json({ error: "Wybrany profil jest niedostępny." }, 404);
    const blocked = await env.DB.prepare(
      "SELECT id FROM blocked_slots WHERE date = ? AND (profile_id = ? OR profile_id IS NULL) AND (time IS NULL OR time = ?)"
    ).bind(date, profileId, time).first();
    if (blocked) return json({ error: "Ten termin jest zablokowany. Wybierz inny." }, 409);

    const bookingId = id();
    try {
      await env.DB.prepare(
        "INSERT INTO bookings (id, profile_id, guest_name, date, time, place, outfit, food, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        bookingId, profileId, guestName, date, time,
        clean(data.place), clean(data.outfit), clean(data.food), clean(data.message, 1500)
      ).run();
    } catch (e) {
      return json({ error: "Ten termin został już zajęty. Wybierz inną godzinę." }, 409);
    }

    await discord(env, "❤️ Nowa rezerwacja spotkania", [
      ["Osoba", profile.name], ["Imię rezerwującego", guestName],
      ["Data", date], ["Godzina", time], ["Gdzie chcemy iść", data.place],
      ["Jak się ubieramy", data.outfit], ["Co chcemy jeść", data.food],
      ["Wiadomość", data.message]
    ]);
    return json({ success: true, id: bookingId });
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

    if (route === "profiles" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM profiles ORDER BY created_at DESC").all();
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
      await env.DB.prepare("UPDATE profiles SET name = ?, description = ?, photo_url = ?, active = ? WHERE id = ?")
        .bind(clean(data.name,100), clean(data.description,300), clean(data.photo_url,500), data.active ? 1 : 0, profileMatch[1]).run();
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
