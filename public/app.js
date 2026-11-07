// Piatto Arcobaleno: il diario di famiglia di quello che mangiamo.
'use strict';

const CATS = [
  { k: 'carne-rossa',  name: 'Carne rossa',  icon: '🥩', color: '#d63f3a' },
  { k: 'carne-bianca', name: 'Carne bianca', icon: '🍗', color: '#ee8a3c' },
  { k: 'pesce',        name: 'Pesce',        icon: '🐟', color: '#2f7fd0' },
  { k: 'latticini',    name: 'Latticini',    icon: '🧀', color: '#d6a91e' },
  { k: 'farinacei',    name: 'Farinacei',    icon: '🍝', color: '#b8732a' },
  { k: 'frutta',       name: 'Frutta',       icon: '🍎', color: '#e0609a' },
  { k: 'verdura',      name: 'Verdura',      icon: '🥦', color: '#3a9d5a' },
  { k: 'legumi',       name: 'Legumi',       icon: '🫘', color: '#8a5fd0' },
  { k: 'malefatte',    name: 'Malefatte',    icon: '🍩', color: '#14a0a0' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.k, c]));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
const idOf = (n) => cleanName(n).toLowerCase();
const num = (n) => Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

function portionsLabel(p) {
  if (p === 1) return '1 porzione';
  if (p === 0.5) return '½ porzione';
  return num(p) + ' porzioni';
}

// ---------- memoria locale ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('piatto:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('piatto:' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('piatto:' + k); } catch {} },
};

// ---------- date (ora locale) ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000) + 1;
const longDay = (s) => parseDay(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (s) => parseDay(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
function dayTitle(s) {
  if (s === today()) return 'Oggi, ' + longDay(s).replace(/^\S+\s/, '');
  if (s === addDays(today(), -1)) return 'Ieri, ' + longDay(s).replace(/^\S+\s/, '');
  return longDay(s);
}

// ---------- stato ----------
let me = null;               // nickname
let entries = new Map();     // id -> entry
let month = null;            // primo giorno del mese mostrato (YYYY-MM-DD)
let selDay = today();
let view = 'v-cal';
let range = '7';
let metric = 'portions';

function saveCache() {
  if (me) store.set('e:' + idOf(me), [...entries.values()]);
}

// ---------- server ----------
const api = (path, opts) => fetch('/api/entries/' + encodeURIComponent(me) + path, { cache: 'no-store', ...opts });

async function loadRange(from, to) {
  const who = me;
  try {
    const res = await api(`?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (who !== me) return false;
    for (const [id, e] of entries) if (e.day >= from && e.day <= to && !e.pending) entries.delete(id);
    for (const e of data.entries) if (!entries.get(e.id)?.pending) entries.set(e.id, e);
    saveCache();
    return true;
  } catch {
    toast('📴 Sei offline: vedi i dati salvati su questo dispositivo');
    return false;
  }
}

async function saveEntry(entry, previous) {
  entry.pending = true;
  entries.set(entry.id, entry);
  saveCache();
  renderAll();
  try {
    const res = await api('/' + entry.id, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ day: entry.day, cat: entry.cat, portions: entry.portions, note: entry.note }),
    });
    if (!res.ok) throw new Error(res.status);
    entries.set(entry.id, await res.json());
  } catch {
    if (previous) entries.set(previous.id, previous); else entries.delete(entry.id);
    toast('Non salvato: controlla la connessione e riprova');
  }
  saveCache();
  renderAll();
}

async function removeEntry(entry) {
  entries.delete(entry.id);
  saveCache();
  renderAll();
  try {
    const res = await api('/' + entry.id, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status);
    toast(`${CAT[entry.cat].icon} Eliminato`);
  } catch {
    entries.set(entry.id, entry);
    saveCache();
    renderAll();
    toast('Non eliminato: controlla la connessione e riprova');
  }
}

const byDay = (from, to) => [...entries.values()]
  .filter((e) => e.day >= from && e.day <= to)
  .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.created_at || 0) - (b.created_at || 0)));

// ---------- calendario ----------
function gridRange() {
  const first = parseDay(month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // lunedì
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  return [ymd(start), ymd(end)];
}

function renderCalendar() {
  const [from, to] = gridRange();
  const m = parseDay(month);
  $('#m-title').textContent = m.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const list = byDay(from, to);
  const perDay = {};
  for (const e of list) (perDay[e.day] ||= []).push(e);
  const t = today();
  const wide = matchMedia('(min-width: 720px)').matches;
  const max = wide ? 4 : 6;
  let html = '';
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const items = perDay[d] || [];
    const cls = ['day'];
    if (parseDay(d).getMonth() !== m.getMonth()) cls.push('other');
    if (d === t) cls.push('today');
    if (d > t) cls.push('future');
    if (d === selDay) cls.push('sel');
    const shown = items.length > max ? items.slice(0, max - 1) : items;
    const chips = shown.map((e) => {
      const c = CAT[e.cat];
      const q = e.portions !== 1 ? ` ×${num(e.portions)}` : '';
      return `<span class="chip" style="--c:${c.color}" title="${esc(c.name + q)}">${c.icon}<span class="lbl">${esc(c.name)}${q}</span></span>`;
    }).join('') + (items.length > shown.length ? `<span class="chip more">+${items.length - shown.length}</span>` : '');
    const label = `${longDay(d)}${items.length ? `, ${items.length} ${items.length === 1 ? 'cosa' : 'cose'}` : ''}`;
    html += `<button class="${cls.join(' ')}" data-day="${d}" aria-label="${esc(label)}"><span class="n">${parseDay(d).getDate()}</span><span class="chips">${chips}</span></button>`;
  }
  $('#grid').innerHTML = html;
  renderDayPanel();
}

function renderDayPanel() {
  $('#d-title').textContent = dayTitle(selDay);
  const items = byDay(selDay, selDay);
  $('#d-list').innerHTML = items.length
    ? items.map((e) => {
      const c = CAT[e.cat];
      return `<li><button class="event" data-id="${e.id}" style="--c:${c.color}">
        <span class="ico">${c.icon}</span>
        <span class="txt"><b>${esc(c.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</span>
        <span class="qty">${portionsLabel(e.portions)}</span></button></li>`;
    }).join('')
    : `<li class="empty">${selDay > today() ? 'Ancora niente: questo giorno deve ancora arrivare.' : 'Niente segnato per questo giorno.<br>Tocca + per aggiungere.'}</li>`;
}

async function goMonth(day) {
  month = day.slice(0, 8) + '01';
  renderCalendar();
  const [from, to] = gridRange();
  if (await loadRange(from, to)) renderCalendar();
}

function selectDay(d) {
  selDay = d;
  if (d.slice(0, 7) !== month.slice(0, 7)) goMonth(d);
  else renderCalendar();
}

// ---------- foglio aggiungi / modifica ----------
let editing = null; // entry in modifica, o null
let pickedCat = null;

function buildCats() {
  $('#e-cats').innerHTML = CATS.map((c) =>
    `<button type="button" class="cat" role="radio" aria-checked="false" data-cat="${c.k}" style="--c:${c.color}"><span class="ico">${c.icon}</span>${esc(c.name)}</button>`
  ).join('');
}

function pickCat(k) {
  pickedCat = k;
  document.querySelectorAll('.cat').forEach((b) => {
    const on = b.dataset.cat === k;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  $('#e-error').hidden = true;
}

function parsePortions(v) {
  const s = String(v).trim().replace(',', '.').replace('½', '.5');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function setPortions(n) {
  n = Math.max(0.1, Math.min(50, Math.round(n * 100) / 100));
  $('#e-portions').value = num(n);
  syncQuick();
}
function syncQuick() {
  const p = parsePortions($('#e-portions').value);
  document.querySelectorAll('#p-quick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === p));
}

function openEntry(entry, day) {
  editing = entry || null;
  $('#e-title').textContent = entry ? 'Modifica' : 'Cosa hai mangiato?';
  $('#e-save').textContent = entry ? 'Salva' : 'Aggiungi';
  $('#e-delete').hidden = !entry;
  $('#e-day').value = entry ? entry.day : (day || selDay);
  pickCat(entry ? entry.cat : null);
  setPortions(entry ? entry.portions : 1);
  $('#e-note').value = entry ? entry.note : '';
  $('#e-error').hidden = true;
  $('#ov-entry').hidden = false;
}
function closeEntry() { $('#ov-entry').hidden = true; editing = null; }

function submitEntry(ev) {
  ev.preventDefault();
  const err = (msg) => { $('#e-error').textContent = msg; $('#e-error').hidden = false; };
  if (!pickedCat) return err('Scegli una categoria.');
  const portions = parsePortions($('#e-portions').value);
  if (!(portions > 0 && portions <= 50)) return err('Le porzioni devono essere un numero, per esempio 1 o 0,5.');
  const day = $('#e-day').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err('Scegli un giorno.');
  const prev = editing ? { ...editing } : null;
  const entry = {
    id: editing ? editing.id : newId(),
    day, cat: pickedCat, portions,
    note: $('#e-note').value.replace(/\s+/g, ' ').trim().slice(0, 140),
    created_at: editing ? editing.created_at : Date.now(),
  };
  closeEntry();
  if (!prev) toast(`${CAT[entry.cat].icon} ${CAT[entry.cat].name}: aggiunto!`);
  if (day !== selDay) selectDay(day);
  saveEntry(entry, prev);
}

// ---------- statistiche ----------
function statsRange() {
  const t = today();
  if (range === '7') return [addDays(t, -6), t];
  if (range === '30') return [addDays(t, -29), t];
  let a = $('#c-from').value || addDays(t, -6), b = $('#c-to').value || t;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}

let statsSeq = 0;
async function showStats() {
  const seq = ++statsSeq;
  renderStats();
  const [from, to] = statsRange();
  if (await loadRange(from, to) && seq === statsSeq) renderStats();
}

function renderStats() {
  const [from, to] = statsRange();
  const items = byDay(from, to);
  const days = daysBetween(from, to);
  const sums = Object.fromEntries(CATS.map((c) => [c.k, { portions: 0, count: 0 }]));
  for (const e of items) { sums[e.cat].portions += Number(e.portions); sums[e.cat].count += 1; }
  const loggedDays = new Set(items.map((e) => e.day)).size;
  const totalP = items.reduce((s, e) => s + Number(e.portions), 0);

  const period = range === 'custom' ? `dal ${shortDay(from)} al ${shortDay(to)}` : `negli ultimi ${days} giorni`;
  $('#summary').innerHTML = items.length
    ? `<b>${num(totalP)}</b> ${totalP === 1 ? 'porzione' : 'porzioni'} in <b>${items.length}</b> ${items.length === 1 ? 'voce' : 'voci'} ${period} · ${loggedDays} ${loggedDays === 1 ? 'giorno segnato' : 'giorni segnati'} su ${days}`
    : `Niente segnato ${period}.`;

  const val = (k) => (metric === 'portions' ? Math.round(sums[k].portions * 100) / 100 : sums[k].count);
  const max = Math.max(...CATS.map((c) => val(c.k)), 0);
  const unit = metric === 'portions' ? 'porzioni' : 'volte';
  $('#chart').setAttribute('aria-label', `Grafico a barre: ${unit} per categoria ${period}. ` +
    CATS.map((c) => `${c.name} ${num(val(c.k))}`).join(', '));
  $('#chart').innerHTML = CATS.map((c) => {
    const v = val(c.k);
    const w = max ? (v / max) * 100 : 0;
    return `<div class="bar-row" data-cat="${c.k}" style="--c:${c.color}">
      <div class="bar-label"><span class="ico">${c.icon}</span><span>${esc(c.name)}</span></div>
      <div class="bar-track"><div class="bar${v ? '' : ' zero'}" style="width:calc((100% - 52px) * ${w / 100})"></div><span class="bar-val${v ? '' : ' zero'}">${num(v)}</span></div>
    </div>`;
  }).join('');
  $('#chart-foot').textContent = metric === 'portions'
    ? 'Porzioni totali per categoria. Tocca una barra per i dettagli.'
    : 'Quante volte hai segnato ogni categoria. Tocca una barra per i dettagli.';
  renderStats.data = { sums, days };
}

function showTip(row, x, y) {
  const { sums, days } = renderStats.data || {};
  if (!sums) return;
  const c = CAT[row.dataset.cat], s = sums[c.k];
  const tip = $('#tip');
  tip.innerHTML = `<b>${c.icon} ${esc(c.name)}</b><br>${portionsLabel(Math.round(s.portions * 100) / 100)} · ${s.count} ${s.count === 1 ? 'volta' : 'volte'}<br>In media ${num(Math.round((s.portions / days) * 100) / 100)} al giorno, ${num(Math.round((s.portions / days) * 7 * 10) / 10)} a settimana`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px';
  tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  document.querySelectorAll('.bar-row').forEach((b) => b.classList.toggle('hot', b === row));
}
function hideTip() {
  $('#tip').hidden = true;
  document.querySelectorAll('.bar-row.hot').forEach((b) => b.classList.remove('hot'));
}

// ---------- viste ----------
function showView(id) {
  view = id;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === id));
  hideTip();
  if (id === 'v-stats') showStats();
  else goMonth(month || today());
  scrollTo(0, 0);
}

function renderAll() {
  if (view === 'v-cal') renderCalendar(); else renderStats();
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function login(name) {
  name = cleanName(name);
  if (!name) return;
  me = name;
  store.set('nick', name);
  entries = new Map((store.get('e:' + idOf(name)) || []).filter((e) => !e.pending).map((e) => [e.id, e]));
  $('#who-name').textContent = name;
  $('#who-name2').textContent = name;
  selDay = today();
  month = null;
  show('s-app');
  showView('v-cal');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- avvio ----------
function bind() {
  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); login($('#nick').value); });
  $('#btn-who').onclick = () => { $('#ov-who').hidden = false; };
  $('#btn-logout').onclick = () => {
    store.del('nick');
    me = null;
    entries = new Map();
    $('#ov-who').hidden = true;
    $('#nick').value = '';
    show('s-login');
  };

  $('#m-prev').onclick = () => { const d = parseDay(month); d.setMonth(d.getMonth() - 1); goMonth(ymd(d)); };
  $('#m-next').onclick = () => { const d = parseDay(month); d.setMonth(d.getMonth() + 1); goMonth(ymd(d)); };
  $('#m-today').onclick = () => selectDay(today());
  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('.day');
    if (b) selectDay(b.dataset.day);
  });
  $('#grid').addEventListener('dblclick', (e) => {
    const b = e.target.closest('.day');
    if (b) openEntry(null, b.dataset.day);
  });
  $('#d-list').addEventListener('click', (e) => {
    const b = e.target.closest('.event');
    if (b) openEntry(entries.get(b.dataset.id));
  });
  $('#d-add').onclick = () => openEntry(null, selDay);
  $('#fab').onclick = () => openEntry(null, selDay);

  $('#e-cats').addEventListener('click', (e) => {
    const b = e.target.closest('.cat');
    if (b) pickCat(b.dataset.cat);
  });
  $('#p-minus').onclick = () => {
    const p = parsePortions($('#e-portions').value) || 1;
    setPortions(p > 1 ? Math.ceil(p - 1) : p > 0.5 ? 0.5 : 0.25);
  };
  $('#p-plus').onclick = () => {
    const p = parsePortions($('#e-portions').value) || 0;
    setPortions(p < 1 ? (p < 0.5 ? 0.5 : 1) : Math.floor(p + 1));
  };
  $('#e-portions').addEventListener('input', syncQuick);
  $('#e-portions').addEventListener('focus', (e) => e.target.select());
  $('#p-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setPortions(Number(b.dataset.p));
  });
  $('#entry-form').addEventListener('submit', submitEntry);
  $('#e-delete').onclick = () => {
    const entry = editing;
    if (!entry) return;
    closeEntry();
    removeEntry(entry);
  };

  document.querySelectorAll('.tabbar button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  document.querySelectorAll('#range-seg button').forEach((b) => {
    b.onclick = () => {
      range = b.dataset.range;
      document.querySelectorAll('#range-seg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#custom').hidden = range !== 'custom';
      if (range === 'custom' && !$('#c-from').value) {
        $('#c-from').value = addDays(today(), -6);
        $('#c-to').value = today();
      }
      showStats();
    };
  });
  ['#c-from', '#c-to'].forEach((s) => $(s).addEventListener('change', showStats));
  document.querySelectorAll('#metric-seg button').forEach((b) => {
    b.onclick = () => {
      metric = b.dataset.metric;
      document.querySelectorAll('#metric-seg button').forEach((x) => x.classList.toggle('on', x === b));
      renderStats();
    };
  });
  const chart = $('#chart');
  chart.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const row = e.target.closest('.bar-row');
    if (row) showTip(row, e.clientX, e.clientY); else hideTip();
  });
  chart.addEventListener('pointerleave', hideTip);
  chart.addEventListener('click', (e) => {
    const row = e.target.closest('.bar-row');
    if (row && !row.classList.contains('hot')) showTip(row, e.clientX, e.clientY); else hideTip();
  });
  addEventListener('scroll', hideTip, { passive: true });

  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { b.closest('.overlay').hidden = true; }; });
  document.querySelectorAll('.overlay').forEach((ov) => ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; }));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach((ov) => { ov.hidden = true; });
  });
  matchMedia('(min-width: 720px)').addEventListener('change', () => { if (me && view === 'v-cal') renderCalendar(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && me) { if (view === 'v-cal') goMonth(month || today()); else showStats(); }
  });
}

buildCats();
bind();
const savedNick = store.get('nick');
if (savedNick) login(savedNick);
else show('s-login');
