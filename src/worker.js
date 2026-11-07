// Piatto Arcobaleno: Cloudflare Worker API.
// Static files in /public are served automatically; this handles /api/*.
// No passwords: everything belongs to a nickname (case-insensitive).
//   GET    /api/entries/:nick?from=DAY&to=DAY  -> { name, entries: [...] }
//   PUT    /api/entries/:nick/:id               -> creates or updates one entry
//   DELETE /api/entries/:nick/:id               -> deletes one entry

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

export default {
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
      return json({ error: 'non trovato' }, 404);
    } catch (err) {
      return json({ error: 'errore del server', detail: String(err?.message || err) }, 500);
    }
  },
};
