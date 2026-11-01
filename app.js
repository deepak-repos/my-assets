'use strict';
/* =====================================================================
   My Asset – static front end (GitHub Pages) + Google Apps Script backend
   Data model
     asset   : { id, cat, type, data:{...}, docs:[{name,url}], created, updated }
     history : { ts, assetId, cat, type, current, invested, premium }
               -> one snapshot is written on every save / bulk update so the
                  Analytics section can chart trends later.
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('ma.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ma.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('ma.' + k); } catch {} }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const money = n => '₹' + nf.format(Math.round(n || 0));
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };
const fmtDT = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------------------------------------------------------------
   Asset type definitions
   --------------------------------------------------------------------- */
const m  = (k, l, o) => ({ k, l, t:'number', pre:'₹', ...o });
const tx = (k, l, o) => ({ k, l, t:'text', ...o });
const dt = (k, l, o) => ({ k, l, t:'date', ...o });
const sel = (k, l, opts, o) => ({ k, l, t:'select', opts, ...o });
const NOTES = { k:'notes', l:'Notes', t:'textarea' };
const DOCS  = { k:'_docs', l:'Documents', t:'file' };

const premiumFields = [
  tx('provider','Policy Provider',{req:1}), tx('policyNo','Policy Number'),
  m('cover','Cover Amount'), m('premium','Premium Amount'),
  { k:'months', l:'Premium Months', t:'months' }, NOTES, DOCS
];
const companyBase = [tx('provider','Policy Provider',{req:1}), tx('companyId','Company ID'), m('cover','Cover Amount')];

const T = {
  /* ---- Investments ---- */
  mf: { cat:'investment', label:'Mutual Fund', ico:'📈', c:'#5e5ce6',
    title:d => [d.fundHouse, d.fundGroup].filter(Boolean).join(' ') || 'Mutual Fund',
    sub:d => [d.fundType, d.folio && 'Folio ' + d.folio].filter(Boolean).join(' · '),
    fields:[
      tx('fundType','Fund Type',{list:['Equity','Debt','Hybrid','Index','ELSS','Liquid','Other']}),
      tx('fundGroup','Fund Group'), tx('fundHouse','Fund House',{req:1}),
      m('invested','Invested Amount'), m('current','Current Amount',{req:1}),
      tx('folio','Folio Number'), tx('purpose','Purpose'),
      sel('freq','Contribution Frequency',['Monthly','Adhoc','Once']),
      m('monthlyAmt','Monthly Contribution Amount',{show:d => d.freq === 'Monthly'}),
      NOTES, DOCS ] },
  fd: { cat:'investment', label:'Fixed Deposit', ico:'🏦', c:'#ff9f0a',
    title:d => (d.bank || 'Fixed') + ' FD',
    sub:d => [d.owner, d.accountNo && '•••• ' + String(d.accountNo).slice(-4)].filter(Boolean).join(' · '),
    fields:[
      tx('owner','Owner'), tx('bank','Bank Name',{req:1}), tx('accountNo','Account Number'),
      m('invested','Invested Amount',{req:1}), m('maturityAmt','Maturity Amount'),
      dt('investDate','Investment Date'), dt('maturityDate','Maturity Date'),
      m('rate','Interest Rate',{pre:'',suf:'%',step:'0.01'}), tx('purpose','Purpose'), NOTES, DOCS ] },
  sa: { cat:'investment', label:'Saving Account', ico:'💰', c:'#30b0c7',
    title:d => (d.bank || 'Savings') + ' Savings',
    sub:d => [d.owner, d.accountNo && '•••• ' + String(d.accountNo).slice(-4)].filter(Boolean).join(' · '),
    fields:[
      tx('owner','Owner'), tx('bank','Bank Name',{req:1}), tx('accountNo','Account Number'),
      m('current','Current Amount',{req:1}), m('rate','Interest Rate',{pre:'',suf:'%',step:'0.01'}),
      tx('purpose','Purpose'), NOTES, DOCS ] },
  epf: { cat:'investment', label:'EPF', ico:'🧾', c:'#34c759',
    title:() => 'EPF', sub:d => d.accountNo || '',
    fields:[
      tx('accountNo','Account Number'), m('current','Current Amount',{req:1}), dt('maturityDate','Maturity Date'),
      tx('purpose','Purpose'), m('monthly','Monthly Contribution Amount'), NOTES, DOCS ] },
  ppf: { cat:'investment', label:'PPF', ico:'🏛️', c:'#ff6482',
    title:d => ((d.bank || '') + ' PPF').trim(), sub:d => d.accountNo || '',
    fields:[
      tx('bank','Bank Name'), tx('accountNo','Account Number'), m('invested','Investment Amount'),
      m('current','Current Amount',{req:1}), dt('maturityDate','Maturity Date'), tx('purpose','Purpose'),
      m('yearly','Yearly Contribution Amount'), sel('contribMonth','Contribution Month',MONTHS), NOTES, DOCS ] },
  nps: { cat:'investment', label:'NPS', ico:'🌅', c:'#af52de',
    title:() => 'NPS', sub:d => d.accountNo || '',
    fields:[
      tx('accountNo','Account Number'), m('invested','Investment Amount'), m('current','Current Amount',{req:1}),
      dt('maturityDate','Maturity Date'), tx('purpose','Purpose'), m('monthly','Monthly Contribution Amount'), NOTES, DOCS ] },
  gratuity: { cat:'investment', label:'Gratuity', ico:'🎁', c:'#64d2ff',
    title:() => 'Gratuity', sub:d => d.companyId ? 'Company ID ' + d.companyId : '',
    fields:[ tx('companyId','Company ID'), m('current','Current Amount',{req:1}), tx('purpose','Purpose'), NOTES, DOCS ] },

  /* ---- Insurance : personal ---- */
  term:   { cat:'insurance', group:'personal', label:'Term Insurance',    ico:'🛡️', c:'#0a84ff', fields:premiumFields },
  pmed:   { cat:'insurance', group:'personal', label:'Medical Insurance', ico:'🏥', c:'#ff375f', fields:premiumFields },
  car:    { cat:'insurance', group:'personal', label:'Car Insurance',     ico:'🚗', c:'#ff9f0a', fields:premiumFields },
  bike:   { cat:'insurance', group:'personal', label:'Bike Insurance',    ico:'🏍️', c:'#30b0c7', fields:premiumFields },
  pother: { cat:'insurance', group:'personal', label:'Others',            ico:'📄', c:'#8e8e93', fields:premiumFields },
  /* ---- Insurance : company ---- */
  clife:  { cat:'insurance', group:'company', label:'Life Insurance',     ico:'🛡️', c:'#0a84ff', fields:[...companyBase, NOTES, DOCS] },
  cacc:   { cat:'insurance', group:'company', label:'Accidental Insurance', ico:'🩹', c:'#ff9f0a', fields:[...companyBase, NOTES, DOCS] },
  cmed:   { cat:'insurance', group:'company', label:'Medical Insurance',  ico:'🏥', c:'#ff375f',
    fields:[...companyBase, tx('people','People Covered'), sel('renewal','Renewal Month',MONTHS), NOTES, DOCS] },
  cother: { cat:'insurance', group:'company', label:'Others',             ico:'📄', c:'#8e8e93', fields:[...companyBase, NOTES, DOCS] },

  /* ---- Self use ---- */
  house: { cat:'selfuse', label:'House', ico:'🏠', c:'#ff9f0a', title:d => d.name || 'House', sub:d => d.location || '',
    fields:[tx('name','House Name',{req:1}), m('purchase','Purchase Amount'), m('current','Approx Current Value',{req:1}), tx('location','Location'), NOTES, DOCS] },
  land:  { cat:'selfuse', label:'Land',  ico:'🌳', c:'#34c759', title:d => d.name || 'Land', sub:d => d.location || '',
    fields:[tx('name','Land Name',{req:1}), m('purchase','Purchase Amount'), m('current','Approx Current Value',{req:1}), tx('location','Location'), NOTES, DOCS] },
  gold:  { cat:'selfuse', label:'Gold',  ico:'🪙', c:'#ffcc00', title:() => 'Gold', sub:() => '',
    fields:[m('purchase','Purchase Amount'), m('current','Approx Current Value',{req:1}), DOCS] }
};
const ORDER = {
  investment:['mf','fd','sa','epf','ppf','nps','gratuity'],
  personal:['term','pmed','car','bike','pother'],
  company:['clife','cacc','cmed','cother'],
  selfuse:['house','land','gold']
};
const GROUPS = { mf:['mf'], fd:['fd'], sa:['sa'], epf:['epf'], ppf:['ppf'], nps:['nps'], gratuity:['gratuity'],
  realestate:['house','land','gold'], personal:ORDER.personal, company:ORDER.company };
const CAT_META = {
  investment:{ label:'Investment', ico:'📊', c:'#0a84ff', sub:'Funds, deposits, retirement' },
  insurance: { label:'Insurance',  ico:'🛡️', c:'#ff375f', sub:'Personal & company policies' },
  selfuse:   { label:'Self Use',   ico:'🏠', c:'#ff9f0a', sub:'House, land, gold' }
};

/* ---------------------------------------------------------------------
   State & persistence
   --------------------------------------------------------------------- */
const S = { assets: store.get('assets', []), history: store.get('history', []), cfg: store.get('cfg', null) };
const remote = () => !!(S.cfg && S.cfg.url && S.cfg.key);
const persist = () => { store.set('assets', S.assets); store.set('history', S.history); };

const typeOf = a => T[a.type];
const ttl = a => { const t = typeOf(a); let s = t.title ? t.title(a.data) : t.label; if (t.group === 'company') s += ' (Company)'; return s; };
const subOf = a => { const t = typeOf(a); if (t.sub) return t.sub(a.data); return [a.data.provider, a.data.policyNo && '#' + a.data.policyNo].filter(Boolean).join(' · '); };

function fdValue(d) {
  const inv = num(d.invested), mat = num(d.maturityAmt);
  const s = new Date(d.investDate), e = new Date(d.maturityDate);
  if (!mat || isNaN(s) || isNaN(e) || e <= s) return inv;
  const f = Math.min(1, Math.max(0, (Date.now() - s) / (e - s)));
  return inv + (mat - inv) * f;           // accrued value, straight-line to maturity
}
const curVal = a => a.type === 'fd' ? fdValue(a.data) : num(a.data.current);
const invVal = a => num(a.data.invested ?? a.data.purchase);
const ofTypes = types => S.assets.filter(a => types.includes(a.type));
const sum = (list, fn) => list.reduce((t, a) => t + fn(a), 0);
const byCat = c => S.assets.filter(a => T[a.type].cat === c);

function snap(a) {
  return { ts: new Date().toISOString(), assetId: a.id, cat: a.cat, type: a.type,
           current: curVal(a), invested: invVal(a), premium: num(a.data.premium) };
}

/* ---------------------------------------------------------------------
   Backend (Google Apps Script)
   --------------------------------------------------------------------- */
async function api(action, payload = {}) {
  const c = S.cfg;
  const res = await fetch(c.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // avoids CORS pre-flight
    body: JSON.stringify({ key: c.key, action, ...payload })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Request failed');
  return j;
}
async function sync(quiet) {
  if (!remote()) return;
  try {
    const r = await api('list');
    S.assets = r.assets || []; S.history = r.history || []; persist();
    if (!/^#\/(form|update)/.test(location.hash)) render();
    if (!quiet) toast('Synced');
  } catch (e) { toast(quiet ? 'Offline – showing saved data' : e.message); }
}
const b64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

async function saveAsset(asset) {
  asset.updated = new Date().toISOString();
  asset.created = asset.created || asset.updated;
  const h = [snap(asset)];
  if (remote()) await api('save', { asset, history: h });
  const i = S.assets.findIndex(x => x.id === asset.id);
  if (i >= 0) S.assets[i] = asset; else S.assets.push(asset);
  S.history.push(...h); persist();
}
async function bulkSave(list) {
  const now = new Date().toISOString();
  list.forEach(a => a.updated = now);
  const h = list.map(snap);
  if (remote()) await api('bulk', { assets: list, history: h });
  list.forEach(a => { const i = S.assets.findIndex(x => x.id === a.id); if (i >= 0) S.assets[i] = a; });
  S.history.push(...h); persist();
}
async function removeAsset(id) {
  if (remote()) await api('delete', { id });
  S.assets = S.assets.filter(a => a.id !== id); persist();
}

/* ---------------------------------------------------------------------
   UI helpers
   --------------------------------------------------------------------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
const busy = on => { $('#busy').hidden = !on; };
async function run(fn) { busy(true); try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong'); return null; } finally { busy(false); } }

function applyTheme() {
  const th = store.get('theme', 'auto');
  if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  $('meta[name=theme-color]').setAttribute('content', dark ? '#000000' : '#f2f2f7');
}
matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change', applyTheme);

const chev = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>';
const item = (href, ico, c, title, val, sub) =>
  `<a class="item" href="${href}">${ico ? `<span class="ico" style="background:${c}">${ico}</span>` : ''}<span class="t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${val ? `<span class="v">${esc(val)}</span>` : ''}</a>`;

/* ---------------------------------------------------------------------
   Date logic: upcoming premiums & next-month contributions
   --------------------------------------------------------------------- */
function upcomingPremiums() {
  const now = new Date(), cm = now.getMonth(), out = [];
  byCat('insurance').forEach(a => {
    const d = a.data; let ms = [];
    if (d.months) ms = d.months.split(',').map(s => MONTHS.indexOf(s.trim())).filter(i => i >= 0);
    else if (d.renewal) ms = [MONTHS.indexOf(d.renewal)].filter(i => i >= 0);
    if (!ms.length) return;
    const diff = Math.min(...ms.map(i => (i - cm + 12) % 12));
    const idx = (cm + diff) % 12, yr = now.getFullYear() + (cm + diff > 11 ? 1 : 0);
    out.push({ a, diff, when: MONTHS[idx] + ' ' + yr, amt: num(d.premium), renewal: !d.months });
  });
  return out.sort((x, y) => x.diff - y.diff);
}
function nextMonthPayments() {
  const nm = (new Date().getMonth() + 1) % 12, out = [];
  ofTypes(['mf']).forEach(a => { if (a.data.freq === 'Monthly' && num(a.data.monthlyAmt)) out.push({ n: ttl(a), t: 'Mutual Fund', amt: num(a.data.monthlyAmt) }); });
  ofTypes(['epf']).forEach(a => { if (num(a.data.monthly)) out.push({ n: 'EPF', t: 'Monthly', amt: num(a.data.monthly) }); });
  ofTypes(['nps']).forEach(a => { if (num(a.data.monthly)) out.push({ n: 'NPS', t: 'Monthly', amt: num(a.data.monthly) }); });
  ofTypes(['ppf']).forEach(a => { if (num(a.data.yearly) && MONTHS.indexOf(a.data.contribMonth) === nm) out.push({ n: ttl(a), t: 'Yearly contribution', amt: num(a.data.yearly) }); });
  return { month: MONTHS[nm], items: out };
}

/* ---------------------------------------------------------------------
   Views – each returns { title, back, right, html, after, tab, large, nobar, notabs }
   --------------------------------------------------------------------- */
function home() {
  const inv = byCat('investment'), selfuse = byCat('selfuse');
  const funds = sum(inv, curVal);
  const liquid = sum(ofTypes(['mf', 'fd', 'sa']), curVal);
  const real = sum(selfuse, curVal);
  const last = S.assets.reduce((mx, a) => (a.updated > mx ? a.updated : mx), '');
  let h = `<div class="head"><div><h1>My Assets</h1><small>${last ? 'Last updated ' + esc(fmtDT(last)) : 'No assets added yet'}</small></div>
    <button class="iconbtn" data-act="refresh" aria-label="Refresh">${chev}</button></div>`;

  if (!remote()) h += `<div class="warn">Running in <b>local mode</b> – data stays on this device only. Connect Google Sheets in <a href="#/settings/keys">Settings › Add Keys</a>.</div>`;

  if (!S.assets.length) {
    h += `<div class="card hero-empty"><div class="big">🪙</div><h2>Start tracking</h2><p>Add your investments, insurance, property and gold.</p><a class="btn sm" href="#/add">Add your first asset</a></div>`;
    return { html: h, tab: 'home', nobar: true };
  }

  h += `<section class="hero"><div class="lbl">Your Net Worth</div><div class="amt">${money(funds + real)}</div>
    <div class="cols"><div><span>Total Funds</span><b>${money(funds)}</b></div><div><span>Liquid Funds</span><b>${money(liquid)}</b></div></div>
    <div class="rw"><span>Real Estate &amp; Gold</span><b>${money(real)}</b></div></section>`;

  const up = upcomingPremiums().slice(0, 6);
  h += `<div class="card"><h3>Upcoming Insurance Premiums</h3>` + (up.length ? up.map(u =>
    `<div class="li"><div><b>${esc(ttl(u.a))}</b><small>${u.renewal ? 'Renewal' : 'Due'} ${esc(u.when)}</small></div>
     <div class="r">${u.amt ? money(u.amt) : '—'}<small><span class="pill ${u.diff === 0 ? 'soon' : u.diff === 1 ? 'next' : ''}">${u.diff === 0 ? 'This month' : u.diff === 1 ? 'Next month' : 'In ' + u.diff + ' months'}</span></small></div></div>`).join('')
    : `<div class="empty">No premium months added yet.</div>`) + `</div>`;

  const np = nextMonthPayments();
  h += `<div class="card"><h3>Investments due in ${np.month}</h3>` + (np.items.length ? np.items.map(p =>
    `<div class="li"><div><b>${esc(p.n)}</b><small>${esc(p.t)}</small></div><div class="r">${money(p.amt)}</div></div>`).join('') +
    `<div class="tot"><span>Total</span><span>${money(sum(np.items, x => x.amt))}</span></div>`
    : `<div class="empty">No contributions scheduled.</div>`) + `</div>`;

  const rows = ORDER.investment.filter(t => ofTypes([t]).length).map(t =>
    item('#/list/' + t, T[t].ico, T[t].c, T[t].label, money(sum(ofTypes([t]), curVal)), ofTypes([t]).length + (ofTypes([t]).length > 1 ? ' items' : ' item'))).join('');
  if (rows) h += `<div class="gtitle">Investments</div><div class="group">${rows}</div>`;
  h += `<div class="group">${item('#/insurance', '🛡️', '#ff375f', 'Insurance', '', byCat('insurance').length + ' policies')}
    ${item('#/realestate', '🏡', '#ff9f0a', 'Real Estate & Gold', money(real))}</div>`;
  return { html: h, tab: 'home', nobar: true };
}

function summaryTile(items, types) {
  const hasInv = types.some(t => T[t].fields.some(f => f.k === 'invested' || f.k === 'purchase'));
  const inv = sum(items, invVal), cur = sum(items, curVal);
  if (!hasInv) return `<div class="summary one"><div><span>Current Value</span><b>${money(cur)}</b></div></div>`;
  const g = cur - inv, p = inv ? (g / inv * 100) : 0;
  return `<div class="summary"><div><span>Invested</span><b>${money(inv)}</b></div><div><span>Current Value</span><b>${money(cur)}</b></div>
    ${inv ? `<div class="gain">${g >= 0 ? '▲' : '▼'} ${money(Math.abs(g))} (${p.toFixed(1)}%) ${g >= 0 ? 'gain' : 'loss'}</div>` : ''}</div>`;
}
function showVal(f, v) {
  if (f.t === 'number') return f.pre ? money(num(v)) : v + (f.suf || '');
  if (f.t === 'date') return fmtDate(v);
  return v;
}
function card(a) {
  const t = typeOf(a), d = a.data;
  const right = t.cat === 'insurance' ? (num(d.cover) ? money(num(d.cover)) : '') : money(curVal(a));
  const rows = t.fields.filter(f => f.t !== 'file' && d[f.k] !== '' && d[f.k] != null)
    .map(f => `<div class="kv"><span>${esc(f.l)}</span><b>${esc(showVal(f, d[f.k]))}</b></div>`).join('');
  const docs = (a.docs || []).filter(x => /^https:\/\//.test(x.url)).map(x => `<a class="doc" href="${esc(x.url)}" target="_blank" rel="noopener">📎 ${esc(x.name)}</a>`).join('');
  return `<details class="acard"><summary><span class="ico" style="background:${t.c}">${t.ico}</span>
    <span class="ttl"><b>${esc(ttl(a))}</b><small>${esc(subOf(a))}</small></span><span class="val">${esc(right)}</span></summary>
    <div class="body">${rows}${docs}<div class="acts"><a class="btn sm" href="#/form/${a.type}/${a.id}">Edit</a>
    <button class="btn sm danger" data-del="${a.id}">Delete</button></div></div></details>`;
}

const UPDATABLE = ['mf', 'sa', 'epf', 'ppf', 'nps', 'gratuity', 'realestate'];
function listPage(key) {
  const types = GROUPS[key]; if (!types) return notFound();
  const items = ofTypes(types);
  const title = key === 'realestate' ? 'Real Estate & Gold' : T[key].label;
  const back = '#/home';
  const addHref = key === 'realestate' ? '#/add/selfuse' : '#/form/' + key;
  let h = `<div class="large">${esc(title)}</div>` + (items.length ? summaryTile(items, types) + items.map(card).join('') : `<div class="card"><div class="empty">Nothing here yet.</div></div>`);
  if (items.length && UPDATABLE.includes(key)) h += `<a class="btn" href="#/update/${key}">Update Current Values</a>`;
  return { title, back, right: `<a class="plus" href="${addHref}" aria-label="Add">+</a>`, html: h, tab: 'home' };
}

function insuranceMenu() {
  const pc = ofTypes(ORDER.personal).length, cc = ofTypes(ORDER.company).length;
  return { title: 'Insurance', back: '#/home', large: 'Insurance', tab: 'home',
    html: `<div class="group">${item('#/insurance/personal', '👤', '#0a84ff', 'Personal', '', pc + (pc === 1 ? ' policy' : ' policies'))}
      ${item('#/insurance/company', '🏢', '#5e5ce6', 'Company', '', cc + (cc === 1 ? ' policy' : ' policies'))}</div>` };
}
function insuranceList(group) {
  if (!['personal', 'company'].includes(group)) return notFound();
  const items = ofTypes(ORDER[group]);
  const cover = sum(items, a => num(a.data.cover));
  const annual = sum(items, a => num(a.data.premium) * (a.data.months ? a.data.months.split(',').filter(Boolean).length : 0));
  let h = items.length ? `<div class="summary ${group === 'company' ? 'one' : ''}"><div><span>Total Cover</span><b>${money(cover)}</b></div>${group === 'personal' ? `<div><span>Yearly Premium</span><b>${money(annual)}</b></div>` : ''}</div>` + items.map(card).join('')
    : `<div class="card"><div class="empty">No policies added yet.</div></div>`;
  return { title: group === 'personal' ? 'Personal' : 'Company', back: '#/insurance', large: (group === 'personal' ? 'Personal' : 'Company') + ' Insurance',
    right: `<a class="plus" href="#/add/insurance/${group}">+</a>`, html: h, tab: 'home' };
}

function updatePage(key) {
  if (!UPDATABLE.includes(key)) return notFound();
  const items = ofTypes(GROUPS[key]);
  const title = key === 'realestate' ? 'Real Estate & Gold' : T[key].label;
  const back = key === 'realestate' ? '#/realestate' : '#/list/' + key;
  const h = `<div class="large">Update Values</div><div class="gtitle">${esc(title)} – current value</div>
    <form id="f"><div class="group">${items.map(a => `<label class="upd"><span class="t"><b>${esc(ttl(a))}</b><small>Was ${money(curVal(a))}</small></span>
      <input name="${a.id}" type="number" inputmode="decimal" step="any" value="${esc(a.data.current ?? '')}" placeholder="0"></label>`).join('')}</div>
      <div class="gfoot">Each update is saved as a dated snapshot so Analytics can show your trend.</div></form>`;
  return { title: 'Update', back, right: `<button class="link" type="submit" form="f">Save</button>`, html: h, notabs: true,
    after() {
      $('#f').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target), changed = [];
        items.forEach(a => { const v = fd.get(a.id); if (v !== '' && v !== null && String(v) !== String(a.data.current ?? '')) changed.push({ ...a, data: { ...a.data, current: Number(v) } }); });
        if (!changed.length) { toast('Nothing changed'); return; }
        if (await run(async () => { await bulkSave(changed); return true; })) { toast('Values updated'); location.hash = back; }
      });
    } };
}

/* ---- Add flow ---- */
function addPage(a, b) {
  if (!a) return { title: 'Add Asset', back: '#/home', large: 'Add Asset', tab: 'more',
    html: `<div class="group">${Object.entries(CAT_META).map(([k, v]) => item('#/add/' + k, v.ico, v.c, v.label, '', v.sub)).join('')}</div>` };
  if (a === 'insurance' && !b) return { title: 'Insurance', back: '#/add', large: 'Insurance', tab: 'more',
    html: `<div class="group">${item('#/add/insurance/personal', '👤', '#0a84ff', 'Personal')}${item('#/add/insurance/company', '🏢', '#5e5ce6', 'Company')}</div>` };
  const key = a === 'insurance' ? b : a;
  const list = ORDER[key]; if (!list) return notFound();
  return { title: 'Select Type', back: a === 'insurance' ? '#/add/insurance' : '#/add', large: 'Select Type', tab: 'more',
    html: `<div class="group">${list.map(t => item('#/form/' + t, T[t].ico, T[t].c, T[t].label)).join('')}</div>` };
}

function fieldHTML(f, v) {
  const val = v ?? '';
  const row = (inner, cls = '') => `<div class="row ${cls}" data-k="${f.k}"${f.show ? ' data-cond="1"' : ''}>${inner}</div>`;
  const lbl = `<span class="l">${esc(f.l)}${f.req ? ' <span style="color:var(--red)">*</span>' : ''}</span>`;
  switch (f.t) {
    case 'textarea': return row(`${lbl}<textarea name="${f.k}" rows="3" placeholder="Add notes…">${esc(val)}</textarea>`, 'col');
    case 'select': return row(`${lbl}<select name="${f.k}"><option value="">Select</option>${f.opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    case 'months': {
      const on = String(val).split(',').map(s => s.trim()).filter(Boolean);
      return row(`${lbl}<div class="chips">${MONTHS.map(mo => `<button type="button" class="chip ${on.includes(mo) ? 'on' : ''}" data-chip="${mo}">${mo}</button>`).join('')}</div><input type="hidden" name="months" value="${esc(on.join(','))}">`, 'col');
    }
    case 'file': return row(`${lbl}<input type="file" name="_docs" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx">`, 'col');
    default: {
      const type = f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text';
      const dl = f.list ? `list="dl_${f.k}"` : '';
      return row(`${lbl}${f.pre ? `<span class="pre">${f.pre}</span>` : ''}<input name="${f.k}" type="${type}" ${f.t === 'number' ? `inputmode="decimal" step="${f.step || 'any'}"` : ''} ${dl} value="${esc(val)}" ${f.req ? 'required' : ''} placeholder="${f.t === 'number' ? '0' : ''}" autocomplete="off">${f.suf ? `<span class="suf">${f.suf}</span>` : ''}${f.list ? `<datalist id="dl_${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`);
    }
  }
}
function formPage(type, id) {
  const t = T[type]; if (!t) return notFound();
  const existing = id ? S.assets.find(a => a.id === id) : null;
  if (id && !existing) return notFound();
  const d = existing ? existing.data : {};
  const back = existing ? (t.cat === 'insurance' ? '#/insurance/' + t.group : t.cat === 'selfuse' ? '#/realestate' : '#/list/' + type) : '#/add';
  const home = t.cat === 'insurance' ? '#/insurance/' + t.group : t.cat === 'selfuse' ? '#/realestate' : '#/list/' + type;
  const label = t.group === 'company' ? t.label + ' (Company)' : t.label;
  const docs = existing && (existing.docs || []).length ? `<div class="gtitle">Attached documents</div><div class="group"><div class="row col">${existing.docs.filter(x => /^https:\/\//.test(x.url)).map(x => `<a class="file" target="_blank" rel="noopener" href="${esc(x.url)}">📎 ${esc(x.name)}</a>`).join('')}</div></div>` : '';
  const h = `<div class="large">${existing ? 'Edit' : 'Add'} ${esc(label)}</div>
    <form id="f" autocomplete="off"><div class="group">${t.fields.map(f => fieldHTML(f, d[f.k])).join('')}</div>${docs}
    ${existing ? '' : ''}</form>${remote() ? '' : '<div class="gfoot">Local mode: document uploads need Google Drive keys (Settings › Add Keys).</div>'}`;
  return { title: label, back, right: `<button class="link" type="submit" form="f">Save</button>`, html: h, notabs: true,
    after() {
      const form = $('#f');
      const raw = () => { const o = {}; new FormData(form).forEach((v, k) => { if (k !== '_docs') o[k] = v; }); return o; };
      const cond = () => { const r = raw(); t.fields.forEach(f => { if (f.show) { const el = form.querySelector(`[data-k="${f.k}"]`); const vis = f.show(r); el.hidden = !vis; } }); };
      form.addEventListener('input', cond); form.addEventListener('change', cond); cond();
      form.addEventListener('click', e => {
        const c = e.target.closest('[data-chip]'); if (!c) return;
        c.classList.toggle('on');
        form.elements.months.value = MONTHS.filter(mo => form.querySelector(`[data-chip="${mo}"]`)?.classList.contains('on')).join(',');
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const r = raw(), data = {};
        t.fields.forEach(f => {
          if (f.t === 'file') return;
          let v = r[f.k] ?? '';
          if (f.show && !f.show(r)) v = '';
          if (f.t === 'number' && v !== '') v = Number(v);
          data[f.k] = typeof v === 'string' ? v.trim() : v;
        });
        const files = [...(form.elements._docs?.files || [])];
        const ok = await run(async () => {
          const docsOut = existing ? [...(existing.docs || [])] : [];
          if (files.length) {
            if (!remote()) toast('Documents need Drive keys – saved without files');
            else for (const f of files) {
              if (f.size > 8 * 1024 * 1024) throw new Error(f.name + ' is larger than 8 MB');
              const up = await api('upload', { name: f.name, mime: f.type || 'application/octet-stream', data: await b64(f), folder: t.label });
              docsOut.push({ name: f.name, url: up.url });
            }
          }
          const asset = { id: existing ? existing.id : uid(), cat: t.cat, type, data, docs: docsOut, created: existing?.created };
          await saveAsset(asset); return true;
        });
        if (ok) { toast('Saved'); location.hash = home; }
      });
    } };
}

/* ---- Analytics / Goals placeholders ---- */
const analytics = () => ({ title: 'Analytics', large: 'Analytics', tab: 'analytics',
  html: `<div class="soon-page"><div class="big">📊</div><h2>Coming next</h2><p>Trends for net worth, funds, premiums and property values will appear here.</p>
    <p><b>${S.history.length}</b> value snapshot${S.history.length === 1 ? '' : 's'} recorded so far – every update you make is being saved with its date.</p></div>` });
const goals = () => ({ title: 'Goals', large: 'Goals', tab: 'goals',
  html: `<div class="soon-page"><div class="big">🎯</div><h2>Coming next</h2><p>Set targets and link them to your investments.</p></div>` });
const notFound = () => ({ title: 'Not found', back: '#/home', html: `<div class="soon-page"><div class="big">🤷</div><h2>Page not found</h2></div>`, tab: 'home' });

/* ---- Settings ---- */
function settingsPage(sub) {
  const theme = store.get('theme', 'auto');
  if (!sub) return { title: 'Settings', back: '#/home', large: 'Settings', tab: 'more',
    html: `<div class="group">${item('#/settings/appearance', '🎨', '#5e5ce6', 'Appearance', theme[0].toUpperCase() + theme.slice(1))}
      ${item('#/settings/keys', '🔑', '#ff9f0a', 'Add Keys', remote() ? 'Connected' : 'Not connected')}
      ${item('#/settings/lock', '🔒', '#34c759', 'App Lock', store.get('lock') ? 'On' : 'Off')}</div>` };
  if (sub === 'appearance') return { title: 'Appearance', back: '#/settings', large: 'Appearance', tab: 'more',
    html: `<div class="seg">${['auto', 'light', 'dark'].map(x => `<button class="${theme === x ? 'on' : ''}" data-theme="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
      <div class="gfoot">Auto follows your phone's light/dark setting.</div>` };
  if (sub === 'keys') return { title: 'Add Keys', back: '#/settings', large: 'Add Keys', tab: 'more',
    html: `<form id="f"><div class="group">
      <div class="row col"><span class="l">Apps Script Web App URL</span><input name="url" style="text-align:left" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.cfg?.url || '')}" autocapitalize="off" autocorrect="off"></div>
      <div class="row col"><span class="l">Secret Key</span><input name="key" type="password" style="text-align:left" placeholder="Same as SECRET_KEY in the script" value="${esc(S.cfg?.key || '')}" autocapitalize="off"></div></div>
      <div class="gfoot">Keys are stored only in this browser. Your Google Sheet and Drive folder are created by the script in your own Google account.</div>
      <button class="btn" type="submit">Save &amp; Test Connection</button></form>
      ${remote() ? '<button class="btn redtxt" data-act="disconnect">Disconnect</button>' : ''}`,
    after() {
      $('#f').addEventListener('submit', async e => {
        e.preventDefault(); const fd = new FormData(e.target);
        const prev = S.cfg; S.cfg = { url: String(fd.get('url')).trim(), key: String(fd.get('key')).trim() };
        const ok = await run(async () => { await api('ping'); return true; });
        if (ok) { store.set('cfg', S.cfg); toast('Connected'); await sync(true); location.hash = '#/settings'; }
        else S.cfg = prev;
      });
    } };
  if (sub === 'lock') {
    const on = !!store.get('lock');
    return { title: 'App Lock', back: '#/settings', large: 'App Lock', tab: 'more',
      html: `<form id="f"><div class="group"><div class="row"><span class="l">${on ? 'New PIN' : '4-digit PIN'}</span>
        <input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="••••" required></div></div>
        <div class="gfoot">The lock asks for your PIN when you reopen the app. It hides the screen only – it is not encryption.</div>
        <button class="btn" type="submit">${on ? 'Change PIN' : 'Turn On'}</button></form>
        ${on ? '<button class="btn redtxt" data-act="lockoff">Turn Off App Lock</button>' : ''}`,
      after() {
        $('#f').addEventListener('submit', async e => {
          e.preventDefault(); const pin = new FormData(e.target).get('pin');
          if (!/^\d{4}$/.test(pin)) return toast('Enter 4 digits');
          store.set('lock', await hashPin(pin)); toast('App lock on'); location.hash = '#/settings';
        });
      } };
  }
  return notFound();
}

/* ---------------------------------------------------------------------
   Router / renderer
   --------------------------------------------------------------------- */
function view(p) {
  const [a, b, c] = p;
  switch (a) {
    case undefined: case 'home': return home();
    case 'analytics': return analytics();
    case 'goals': return goals();
    case 'list': return listPage(b);
    case 'insurance': return b ? insuranceList(b) : insuranceMenu();
    case 'realestate': return listPage('realestate');
    case 'update': return updatePage(b);
    case 'add': return addPage(b, c);
    case 'form': return formPage(b, c);
    case 'settings': return settingsPage(b);
    default: return notFound();
  }
}
function render() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const v = view(p);
  const bar = v.nobar ? '' : `<div class="bar"><a class="back" href="${v.back || '#/home'}" ${v.back ? '' : 'style="visibility:hidden"'}>‹ Back</a><div class="bt">${esc(v.title || '')}</div><div class="right">${v.right || ''}</div></div>`;
  $('#app').innerHTML = `<div class="page">${bar}${v.large ? `<div class="large">${esc(v.large)}</div>` : ''}${v.html}</div>`;
  // list pages already include their own large title in html
  document.querySelectorAll('#tabbar [data-tab]').forEach(el => el.classList.toggle('on', el.dataset.tab === v.tab));
  $('#tabbar').classList.toggle('off', !!v.notabs);
  window.scrollTo(0, 0);
  v.after && v.after();
}

/* ---------------------------------------------------------------------
   App lock
   --------------------------------------------------------------------- */
async function hashPin(p) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('my-asset:' + p));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
let pin = '';
function showLock() {
  if (!store.get('lock')) return;
  pin = ''; const L = $('#lock'); L.hidden = false;
  const draw = (err) => {
    L.innerHTML = `<div style="font-size:42px">🔒</div><h2>Enter PIN</h2><div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div><div class="err">${err || ''}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<span></span><button data-n="0">0</button><button class="x" data-n="del">⌫</button></div>`;
  };
  draw();
  L.onclick = async e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    if (b.dataset.n === 'del') pin = pin.slice(0, -1); else if (pin.length < 4) pin += b.dataset.n;
    if (pin.length === 4) {
      if (await hashPin(pin) === store.get('lock')) { L.hidden = true; L.innerHTML = ''; return; }
      pin = ''; return draw('Wrong PIN');
    }
    draw();
  };
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 30000) { showLock(); sync(true); }
});

/* ---------------------------------------------------------------------
   Global events
   --------------------------------------------------------------------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-del],[data-theme],#moreBtn,#sheet');
  if (!t) return;
  if (t.id === 'moreBtn') return openSheet();
  if (t.id === 'sheet') { if (e.target === t) closeSheet(); return; }
  if (t.dataset.theme) { store.set('theme', t.dataset.theme); applyTheme(); return render(); }
  if (t.dataset.del) {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    if (await run(async () => { await removeAsset(t.dataset.del); return true; })) { toast('Deleted'); render(); }
    return;
  }
  switch (t.dataset.act) {
    case 'refresh': return remote() ? sync() : toast('Local mode – nothing to sync');
    case 'disconnect': S.cfg = null; store.del('cfg'); toast('Disconnected'); return render();
    case 'lockoff': store.del('lock'); toast('App lock off'); return render();
  }
});
function openSheet() {
  const s = $('#sheet'); s.hidden = false;
  s.innerHTML = `<div class="pane"><div class="group">
    <a class="item" href="#/add"><span class="ico" style="background:#0a84ff">＋</span><span class="t"><b>Add Asset</b></span></a>
    <a class="item" href="#/settings"><span class="ico" style="background:#8e8e93">⚙️</span><span class="t"><b>Settings</b></span></a></div>
    <button class="cancel" type="button" onclick="closeSheet()">Cancel</button></div>`;
  s.querySelectorAll('a').forEach(a => a.addEventListener('click', closeSheet));
}
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
window.closeSheet = closeSheet;

window.addEventListener('hashchange', () => { closeSheet(); render(); });
applyTheme();
showLock();
render();
sync(true);
