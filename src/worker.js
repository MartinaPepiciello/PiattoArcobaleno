// Piatto Arcobaleno: Cloudflare Worker API.
// Static files in /public are served automatically; this handles /api/*.
// No passwords: everything belongs to a nickname (case-insensitive).
//   GET    /api/entries/:nick?from=DAY&to=DAY  -> { name, entries: [...] }
//   PUT    /api/entries/:nick/:id               -> creates or updates one entry
//   DELETE /api/entries/:nick/:id               -> deletes one entry
//   GET    /api/push/key                        -> { key } public key for push subscriptions
//   PUT    /api/push/:nick                      -> { subscription, time, tz } turns on daily reminders for a device
//   POST   /api/push/remove                     -> { endpoint } turns them off
//   POST   /api/push/test                       -> { endpoint } sends one reminder right away
// Every 5 minutes (cron) the reminders that are due are sent.

const CATS = ['carne-rossa', 'carne-bianca', 'pesce', 'latticini', 'farinacei', 'frutta', 'verdura', 'legumi', 'malefatte'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
const idOf = (name) => cleanName(name).toLowerCase();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const isId = (v) => /^[A-Za-z0-9_-]{8,64}$/.test(String(v ?? ''));

async function touchPerson(env, name) {
  await env.DB.prepare(
    `INSERT INTO people (id, name, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`
  ).bind(idOf(name), name, Date.now()).run();
}

async function listEntries(env, name, from, to) {
  if (!isDay(from) || !isDay(to)) return json({ error: 'date non valide' }, 400);
  const { results } = await env.DB.prepare(
    `SELECT id, day, cat, portions, note, created_at, updated_at FROM entries
     WHERE uid = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day, created_at`
  ).bind(idOf(name), from, to).all();
  const person = await env.DB.prepare('SELECT name FROM people WHERE id = ?1').bind(idOf(name)).first();
  return json({ name: person?.name || name, entries: results });
}

async function putEntry(env, name, id, body) {
  const cat = String(body.cat ?? '');
  const portions = Math.round(Number(body.portions) * 100) / 100;
  const note = String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!isDay(body.day) || !CATS.includes(cat) || !(portions > 0 && portions <= 50)) {
    return json({ error: 'dati non validi' }, 400);
  }
  const owner = await env.DB.prepare('SELECT uid FROM entries WHERE id = ?1').bind(id).first();
  if (owner && owner.uid !== idOf(name)) return json({ error: 'non tuo' }, 403);
  const now = Date.now();
  await touchPerson(env, name);
  await env.DB.prepare(
    `INSERT INTO entries (id, uid, day, cat, portions, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(id) DO UPDATE SET day = excluded.day, cat = excluded.cat, portions = excluded.portions,
       note = excluded.note, updated_at = excluded.updated_at`
  ).bind(id, idOf(name), body.day, cat, portions, note, now).run();
  const row = await env.DB.prepare(
    'SELECT id, day, cat, portions, note, created_at, updated_at FROM entries WHERE id = ?1'
  ).bind(id).first();
  return json(row);
}

async function deleteEntry(env, name, id) {
  await env.DB.prepare('DELETE FROM entries WHERE id = ?1 AND uid = ?2').bind(id, idOf(name)).run();
  return json({ ok: true });
}

// ---------- promemoria (Web Push) ----------
// Reminders carry no payload, so nothing needs encrypting: the service worker (public/sw.js)
// shows the same message every time. We only sign a VAPID token to prove the push comes from us.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''));
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export async function vapidAuth(env, endpoint) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' +
    enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Returns the push service's HTTP status (201 = sent; 404/410 = the device unsubscribed).
async function sendPush(env, endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: await vapidAuth(env, endpoint), ttl: String(6 * 3600), urgency: 'normal', 'content-length': '0' },
  });
  return res.status;
}

function localNow(tz, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

async function putPush(env, name, body) {
  const sub = body.subscription;
  const endpoint = String(sub?.endpoint ?? '');
  if (!/^https:\/\//.test(endpoint) || !sub?.keys || !isTime(body.time) || !validTz(body.tz)) {
    return json({ error: 'dati non validi' }, 400);
  }
  // If the chosen time has already passed today, the first reminder is tomorrow.
  const now = localNow(body.tz);
  const lastDay = now.time >= body.time ? now.day : null;
  await touchPerson(env, name);
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, uid, sub, time, tz, last_day, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(endpoint) DO UPDATE SET uid = excluded.uid, sub = excluded.sub, time = excluded.time,
       tz = excluded.tz, last_day = excluded.last_day`
  ).bind(endpoint, idOf(name), JSON.stringify(sub), body.time, body.tz, lastDay, Date.now()).run();
  return json({ ok: true });
}

async function sendDue(env) {
  const { results } = await env.DB.prepare('SELECT endpoint, time, tz, last_day FROM push_subs').all();
  for (const r of results) {
    const now = localNow(r.tz);
    if (r.last_day === now.day || now.time < r.time) continue;
    try {
      const status = await sendPush(env, r.endpoint);
      if (status === 404 || status === 410) {
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(r.endpoint).run();
      } else if (status >= 200 && status < 300) {
        await env.DB.prepare('UPDATE push_subs SET last_day = ?1 WHERE endpoint = ?2').bind(now.day, r.endpoint).run();
      }
    } catch {}
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      const m = url.pathname.match(/^\/api\/entries\/([^/]+)(?:\/([^/]+))?$/);
      if (m) {
        const name = cleanName(decodeURIComponent(m[1]));
        if (!name) return json({ error: 'nome mancante' }, 400);
        const id = m[2];
        if (!id && request.method === 'GET') {
          return listEntries(env, name, url.searchParams.get('from'), url.searchParams.get('to'));
        }
        if (id && isId(id)) {
          if (request.method === 'PUT') return putEntry(env, name, id, await request.json());
          if (request.method === 'DELETE') return deleteEntry(env, name, id);
        }
      }
      if (url.pathname === '/api/push/key') return json({ key: env.VAPID_PUBLIC_KEY });
      if (url.pathname === '/api/push/remove' && request.method === 'POST') {
        const { endpoint } = await request.json();
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(String(endpoint ?? '')).run();
        return json({ ok: true });
      }
      if (url.pathname === '/api/push/test' && request.method === 'POST') {
        const { endpoint } = await request.json();
        const row = await env.DB.prepare('SELECT endpoint FROM push_subs WHERE endpoint = ?1').bind(String(endpoint ?? '')).first();
        if (!row) return json({ error: 'promemoria non attivo' }, 404);
        const status = await sendPush(env, row.endpoint);
        return json({ ok: status >= 200 && status < 300, status });
      }
      const pm = url.pathname.match(/^\/api\/push\/([^/]+)$/);
      if (pm && request.method === 'PUT') {
        const name = cleanName(decodeURIComponent(pm[1]));
        if (!name) return json({ error: 'nome mancante' }, 400);
        return putPush(env, name, await request.json());
      }
      return json({ error: 'non trovato' }, 404);
    } catch (err) {
      return json({ error: 'errore del server', detail: String(err?.message || err) }, 500);
    }
  },
};
