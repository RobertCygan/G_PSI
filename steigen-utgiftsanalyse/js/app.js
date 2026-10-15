/* =====================================================================
   Steigen kommune – Utgiftsanalyse 2016–2025
   G-PSI GovTech Solutions · app.js
   ===================================================================== */
(function () {
'use strict';

const D = window.STEIGEN_DATA;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const KPI = D.kpi.idx;
const KF = {}; YEARS.forEach(y => { KF[y] = KPI['2025'] / KPI[y]; });
const POP = {}; YEARS.forEach(y => { POP[y] = D.pop.dec31[y]; });

/* ---------------- Formatering (nb-NO) ---------------- */
const nf0 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isCap = m => m === 'cap' || m === 'capreal';
function money(v, m) {
  if (v == null || !isFinite(v)) return '–';
  if (isCap(m)) return nf0.format(Math.round(v)) + ' kr';
  const a = Math.abs(v);
  if (a >= 1e9) return nf2.format(v / 1e9) + ' mrd. kr';
  if (a >= 1e6) return nf1.format(v / 1e6) + ' mill. kr';
  if (a >= 1e3) return nf0.format(v / 1e3) + ' tusen kr';
  return nf0.format(v) + ' kr';
}
const mill = v => (v == null || !isFinite(v)) ? '–' : nf1.format(v / 1e6);
const pct = (v, signed = true) => (v == null || !isFinite(v)) ? '–' : (signed && v > 0 ? '+' : '') + nf1.format(v * 100) + ' %';
const unitDiv = m => isCap(m) ? 1 : 1e6;
const unitName = m => ({ nom: 'mill. kr', real: 'mill. 2025-kr', cap: 'kr per innbygger', capreal: 'kr per innbygger (2025-kr)' }[m]);
const measureLong = m => ({ nom: 'løpende kroner', real: 'faste 2025-kroner (KPI)', cap: 'kroner per innbygger', capreal: 'faste 2025-kroner per innbygger' }[m]);
const axisFmt = m => v => isCap(m) ? nf0.format(v) : (Math.abs(v) >= 10 ? nf0.format(v) : nf1.format(v));

/* ---------------- Forhåndsberegning av transaksjoner ---------------- */
const TX = D.tx, N = TX.a.length;
const Y = new Int16Array(N), M = new Int8Array(N), Q = new Int8Array(N), TOi = new Int8Array(N), SK = new Int8Array(N),
  AG = new Int8Array(N), INV = new Int8Array(N), VTG = new Int16Array(N), MG = new Int8Array(N), BR = new Int16Array(N), ART = new Int16Array(N);
for (let i = 0; i < N; i++) {
  const p = TX.p[i]; const y = Math.floor(p / 100); let m = p % 100; if (m < 1) m = 1;
  Y[i] = y; M[i] = m; Q[i] = Math.ceil(m / 3);
  const k = D.konto[TX.k[i]]; AG[i] = k.ag; INV[i] = k.inv; VTG[i] = k.v; ART[i] = k.art;
  const f = D.func[TX.f[i]]; TOi[i] = f.to; SK[i] = D.to[f.to].s; MG[i] = f.mg;
  BR[i] = D.lev[TX.l[i]].b;
}
const ANON = D.lev.findIndex(l => l.n.startsWith('Privatpersoner'));

/* ---------------- KOSTRA-hjelpere ---------------- */
const KY = D.kostra_meta.years.map(Number);
const kIdx = y => KY.indexOf(y);
// sum AGD10 (1000 kr) per tjenesteområde fra 3-sifrede funksjoner (konsern, 12362)
function kostraByTO(art) {
  const out = D.to.map(() => YEARS.map(() => null));
  Object.keys(D.kostra_func).forEach(f => {
    const x = D.kostra_func[f]; if (x.to == null || !x[art]) return;
    x[art].forEach((v, j) => { if (v != null) out[x.to][j] = (out[x.to][j] || 0) + v * 1000; });
  });
  return out;
}
// Faktura-dekning: drift art 100–480 ekskl. 429 vs KOSTRA AGD50+AGD51+AG34 (kommunekasse)
const covFak = YEARS.map(() => 0);
for (let i = 0; i < N; i++) if (!INV[i] && ART[i] >= 100 && ART[i] < 500 && ART[i] !== 429) covFak[Y[i] - 2016] += TX.a[i];
const covKos = YEARS.map((y, j) => ['AGD50', 'AGD51', 'AG34'].reduce((s, a) => s + (D.kostra_art[a].v[j] || 0) * 1000, 0));
const covPct = YEARS.map((y, j) => covFak[j] / covKos[j]);

/* ---------------- Tilstand ---------------- */
const S = {
  page: 'oversikt', year: null, q: null, to: null, reg: '', measure: 'nom', mva: false,
  ag: null, vtg: null, lev: null, gran: 'y',
  cat: { src: 'kostra', dim: 'to', from: 2016, to: 2025, sort: 'to', dir: -1 }, heat: 'abs',
  kArt: 'nom', kCmpArt: 'AGD10', kCmpYear: 2025,
  tx: { q: '', sort: 'p', dir: -1, page: 0 }, levQ: '', levSort: 'sum', levDir: -1,
  open: new Set()
};

function pass(i, ex) {
  if (!S.mva && AG[i] === 4) return false;
  if (S.reg === 'drift' && INV[i]) return false;
  if (S.reg === 'inv' && !INV[i]) return false;
  if (!ex) ex = {};
  if (S.year !== null && !ex.year && Y[i] !== S.year) return false;
  if (S.q !== null && !ex.q && Q[i] !== S.q) return false;
  if (S.to !== null && !ex.to && TOi[i] !== S.to) return false;
  if (S.ag !== null && !ex.ag && AG[i] !== S.ag) return false;
  if (S.vtg !== null && !ex.vtg && VTG[i] !== S.vtg) return false;
  if (S.lev !== null && !ex.lev && TX.l[i] !== S.lev) return false;
  return true;
}
function val(i, m) {
  const a = TX.a[i], y = Y[i];
  switch (m || S.measure) {
    case 'real': return a * KF[y];
    case 'cap': return a / POP[y];
    case 'capreal': return a * KF[y] / POP[y];
    default: return a;
  }
}

/* ---------------- Tema / farger ---------------- */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C = {};
function readColors() {
  C = {
    text: cssv('--text'), text2: cssv('--text-2'), muted: cssv('--muted'), grid: cssv('--grid'), axis: cssv('--axis'),
    panel: cssv('--panel'), panel2: cssv('--panel-2'), tooltip: cssv('--tooltip-bg'), line2: cssv('--line-2'),
    accent: cssv('--accent'), accent2: cssv('--accent-2'),
    s: [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssv('--s' + i)),
    seq: [0, 1, 2, 3, 4].map(i => cssv('--seq-' + i)),
    warn: cssv('--warn'), good: cssv('--good'), crit: cssv('--crit')
  };
}
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
function themeIcon() { const b = document.getElementById('themeBtn'); if (b) b.innerHTML = document.documentElement.getAttribute('data-theme') === 'light' ? ICON_MOON : ICON_SUN; }
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gpsi-theme', t); } catch (e) { /* ignore */ }
  readColors(); themeIcon();
  Object.keys(charts).forEach(id => { charts[id].dispose(); delete charts[id]; });
  renderPage(true);
}

/* ---------------- ECharts-hjelpere ---------------- */
const charts = {};
function chart(id) {
  if (charts[id]) return charts[id];
  const el = document.getElementById(id);
  const c = echarts.init(el, null, { renderer: 'canvas' });
  charts[id] = c; return c;
}
function baseOpt() {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: C.text2 },
    animationDuration: 650, animationEasing: 'cubicOut',
    tooltip: {
      backgroundColor: C.tooltip, borderColor: C.line2, borderWidth: 1, padding: [8, 10],
      textStyle: { color: C.text, fontSize: 12 }, confine: true,
      extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.35);border-radius:8px;'
    }
  };
}
const lw = (id, frac, max) => { const el = document.getElementById(id); return Math.max(70, Math.min(max, (el ? el.clientWidth : 600) * frac)); };
const axisCommon = () => ({
  axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
  axisLabel: { color: C.muted, fontSize: 11 }, splitLine: { lineStyle: { color: C.grid } }
});
function ttRows(title, rows, note) {
  let h = '<div class="tt"><div class="h">' + esc(title) + '</div>';
  rows.forEach(r => { h += '<div class="r"><span class="k"><i style="background:' + r.c + '"></i>' + esc(r.k) + '</span><span class="v">' + esc(r.v) + '</span></div>'; });
  if (note) h += '<div class="n">' + esc(note) + '</div>';
  return h + '</div>';
}
function legendOpt(extra) {
  return Object.assign({ textStyle: { color: C.text2, fontSize: 12 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect', inactiveColor: C.axis }, extra || {});
}
function legendLine(extra) {
  return Object.assign({ textStyle: { color: C.text2, fontSize: 12 }, itemWidth: 18, itemHeight: 3, icon: 'rect', inactiveColor: C.axis }, extra || {});
}

/* =====================================================================
   OVERSIKT
   ===================================================================== */
function renderKpis(animate) {
  let nom = 0, real = 0, cap = 0, n = 0; const levs = new Map();
  for (let i = 0; i < N; i++) {
    if (!pass(i)) continue;
    const a = TX.a[i], y = Y[i];
    nom += a; real += a * KF[y]; cap += a / POP[y]; n++;
    levs.set(TX.l[i], (levs.get(TX.l[i]) || 0) + a);
  }
  // fjoråret (samme filtre) for YoY
  let prevNom = null, prevReal = null;
  if (S.year !== null && S.year > 2016) {
    prevNom = 0; prevReal = 0;
    const save = S.year; S.year = save - 1;
    for (let i = 0; i < N; i++) if (pass(i)) { prevNom += TX.a[i]; prevReal += TX.a[i] * KF[Y[i]]; }
    S.year = save;
  }
  const sorted = Array.from(levs.values()).filter(v => v > 0).sort((a, b) => b - a);
  const pos = sorted.reduce((s, v) => s + v, 0);
  const top10 = sorted.slice(0, 10).reduce((s, v) => s + v, 0);
  const yrTxt = S.year ? String(S.year) : '2016–2025';
  const delta = (cur, prev) => {
    if (prev == null || !prev) return '';
    const d = cur / prev - 1; const cls = d > 0 ? 'up' : 'down';
    return '<span class="d ' + cls + '">' + (d > 0 ? '▲' : '▼') + ' ' + pct(d) + '</span> mot ' + (S.year - 1);
  };
  const cards = [
    { v: nom, f: 'mill', l: 'Utgifter, løpende kroner', s: delta(nom, prevNom) || (nf0.format(n) + ' fakturalinjer · ' + yrTxt) },
    { v: real, f: 'mill', l: 'Utgifter, faste 2025-kroner', s: delta(real, prevReal) ? ('Realt ' + delta(real, prevReal)) : 'Deflatert med KPI (SSB 03014)' },
    { v: cap, f: 'kr', l: S.year ? 'Per innbygger' : 'Per innbygger, sum for årene', s: S.year ? ('Folkemengde 31.12.' + S.year + ': ' + nf0.format(POP[S.year])) : 'Hvert år delt på folkemengde 31.12' },
    { v: levs.size, f: 'int', l: 'Leverandører', s: pos ? ('Topp 10 = ' + nf0.format(top10 / pos * 100) + ' % av beløpet') : '' }
  ];
  const host = $('#toolbarLeft');
  if (!host.querySelector('.kpis')) host.innerHTML = '<div class="kpis">' + cards.map(() => '<div class="kpi"><div class="v"></div><div class="l"></div><div class="s"></div></div>').join('') + '</div>';
  $$('.kpi', host).forEach((el, k) => {
    const c = cards[k];
    $('.l', el).textContent = c.l; $('.s', el).innerHTML = c.s;
    countUp($('.v', el), c.v, c.f, animate ? 1100 : 380);
  });
}
function kpiText(v, f) {
  if (f === 'mill') return nf1.format(v / 1e6) + '<span class="u">mill.</span>';
  if (f === 'kr') return nf0.format(Math.round(v)) + '<span class="u">kr</span>';
  return nf0.format(Math.round(v));
}
function countUp(el, to, f, ms) {
  const from = parseFloat(el.dataset.v || '0'); el.dataset.v = to;
  const t0 = performance.now();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = kpiText(to, f); return; }
  function step(t) {
    const p = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - p, 3);
    el.innerHTML = kpiText(from + (to - from) * e, f);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderOvWarn() {
  const el = $('#ovWarn');
  const y = S.year;
  const txt = y
    ? 'Fakturagrunnlaget for <b>' + y + '</b> tilsvarer <b>' + nf0.format(covPct[y - 2016] * 100) + ' %</b> av kommunens driftskjøp og overføringer i KOSTRA. '
    : 'Fakturagrunnlaget dekker <b>' + nf0.format(covPct[0] * 100) + ' %</b> av KOSTRA-kjøpene i 2016, bare <b>' + nf0.format(covPct[8] * 100) + ' %</b> i 2024 og <b>' + nf0.format(covPct[9] * 100) + ' %</b> i 2025 (ny bilagsserie fra feb. 2025). ';
  el.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 9.5a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z"/></svg><div><b>Brudd i datagrunnlaget.</b> ' + txt +
    'Endringer mellom år i fakturadataene viser derfor i stor grad <i>endret datadekning</i>, ikke reell utgiftsutvikling. Bruk siden <a href="#" data-goto="kostra">KOSTRA</a> for trender og <a href="#" data-goto="datakvalitet">Datakvalitet</a> for detaljer.</div>';
}

function renderBars() {
  const m = S.measure, div = unitDiv(m);
  const dr = D.to.map(() => 0), iv = D.to.map(() => 0);
  for (let i = 0; i < N; i++) { if (!pass(i, { to: 1 })) continue; (INV[i] ? iv : dr)[TOi[i]] += val(i); }
  let idx = D.to.map((t, k) => k).filter(k => Math.abs(dr[k]) + Math.abs(iv[k]) > 0.5);
  idx.sort((a, b) => (dr[a] + iv[a]) - (dr[b] + iv[b]));
  const cats = idx.map(k => D.to[k].n);
  const dim = k => S.to !== null && S.to !== k;
  const mk = (arr, col, name) => ({
    name, type: 'bar', stack: 't', barMaxWidth: 18, barCategoryGap: '34%',
    itemStyle: { borderRadius: 3, color: col },
    emphasis: { focus: 'none', itemStyle: { shadowBlur: 10, shadowColor: col } },
    data: idx.map(k => ({ value: arr[k] / div, itemStyle: { color: col, opacity: dim(k) ? 0.28 : 1, borderColor: C.panel, borderWidth: 1 } }))
  });
  const tot = idx.map(k => (dr[k] + iv[k]) / div);
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 14, right: 60, top: 30, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, data: ['Drift', 'Investering'] }),
    xAxis: Object.assign(axisCommon(), { type: 'value', axisLabel: { color: C.muted, fontSize: 11, formatter: axisFmt(m) } }),
    yAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.text2, fontSize: 12, width: lw('chBars', 0.34, 190), overflow: 'truncate' } },
    tooltip: Object.assign(o.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } },
      formatter: ps => { const k = idx[ps[0].dataIndex]; return ttRows(D.to[k].n, [
        { k: 'Drift', v: money(dr[k], m), c: C.s[0] }, { k: 'Investering', v: money(iv[k], m), c: C.s[1] }, { k: 'Totalt', v: money(dr[k] + iv[k], m), c: 'transparent' }], 'Klikk for å filtrere'); } }),
    series: [mk(dr, C.s[0], 'Drift'), mk(iv, C.s[1], 'Investering'),
      { type: 'bar', stack: 't', silent: true, data: tot.map(() => 0), itemStyle: { color: 'transparent' },
        label: { show: true, position: 'right', color: C.text, fontSize: 11, fontWeight: 600, formatter: p => isCap(m) ? nf0.format(tot[p.dataIndex]) : nf1.format(tot[p.dataIndex]) } }]
  });
  const c = chart('chBars'); c.setOption(o, true);
  c.off('click'); c.on('click', p => { const k = idx[p.dataIndex]; S.to = S.to === k ? null : k; syncControls(); renderPage(); });
  $('#srcBars').innerHTML = 'Kilde: <b>Ready2.xlsm</b> (fakturagrunnlag), ' + esc(S.year || '2016–2025') + '. Tjenesteområder etter KOSTRA-funksjon (se Datakvalitet).';
  $('#capBars').textContent = 'Drift og investering, ' + unitName(m) + ' · klikk en stolpe for å filtrere';
}

function renderDonut() {
  const m = S.measure, sums = D.ag.map(() => 0);
  for (let i = 0; i < N; i++) if (pass(i, { ag: 1 })) sums[AG[i]] += val(i);
  const neg = D.ag.map((a, k) => k).filter(k => sums[k] < 0);
  const items = D.ag.map((a, k) => ({ k, name: a.n, value: sums[k] })).filter(x => x.value > 0);
  const total = items.reduce((s, x) => s + x.value, 0);
  const o = baseOpt();
  Object.assign(o, {
    tooltip: Object.assign(o.tooltip, { trigger: 'item', formatter: p => ttRows(p.name, [{ k: 'Beløp', v: money(p.value, m), c: p.color }, { k: 'Andel', v: nf1.format(p.percent) + ' %', c: 'transparent' }], 'Art ' + D.ag[p.data.k].art) }),
    legend: legendOpt({ bottom: 0, left: 0, right: 0, type: 'plain', itemGap: 12 }),
    graphic: [{ type: 'text', left: 'center', top: '33%', style: { text: isCap(m) ? nf0.format(total) : nf1.format(total / 1e6), fill: C.text, font: '700 30px Rajdhani, Inter, sans-serif', textAlign: 'center' } },
              { type: 'text', left: 'center', top: '44%', style: { text: unitName(m), fill: C.muted, font: '500 11px Inter, sans-serif', textAlign: 'center' } }],
    series: [{
      type: 'pie', radius: ['46%', '68%'], center: ['50%', '40%'], avoidLabelOverlap: true, padAngle: 1.2,
      itemStyle: { borderColor: C.panel, borderWidth: 2, borderRadius: 4 },
      label: { color: C.text2, fontSize: 11, formatter: p => nf0.format(p.percent) + ' %' },
      labelLine: { lineStyle: { color: C.axis }, length: 8, length2: 8 },
      data: items.map(x => ({ name: x.name, value: x.value, k: x.k, itemStyle: { color: C.s[x.k], opacity: S.ag !== null && S.ag !== x.k ? 0.3 : 1 } }))
    }]
  });
  const c = chart('chDonut'); c.setOption(o, true);
  c.off('click'); c.on('click', p => { const k = p.data.k; S.ag = S.ag === k ? null : k; syncControls(); renderPage(); });
  let note = 'Kilde: <b>Ready2.xlsm</b>, artsgruppe etter KOSTRA-art (sifrene i kontonummeret).';
  if (!S.mva) note += ' Mva (art 429) er holdt utenfor – slå på «Inkl. mva».';
  if (neg.length) note += ' Negative grupper vises ikke i ringen: ' + neg.map(k => esc(D.ag[k].n) + ' ' + money(sums[k], m)).join(', ') + '.';
  $('#srcDonut').innerHTML = note;
}

function renderTree() {
  const m = S.measure;
  const g = new Map(); let tot = 0;
  for (let i = 0; i < N; i++) {
    if (!pass(i, { vtg: 1 })) continue;
    const v = val(i); tot += v;
    let e = g.get(VTG[i]); if (!e) { e = { v: 0, k: new Map() }; g.set(VTG[i], e); }
    e.v += v; const kk = TX.k[i]; e.k.set(kk, (e.k.get(kk) || 0) + v);
  }
  const rows = Array.from(g.entries()).sort((a, b) => b[1].v - a[1].v);
  const max = Math.max(1, ...rows.map(r => Math.abs(r[1].v)));
  let h = '<table><thead><tr><th>Gruppe / konto</th><th class="num">' + (isCap(m) ? 'kr/innb.' : 'Mill. kr') + '</th><th class="num">Andel</th></tr></thead><tbody>';
  const fv = v => isCap(m) ? nf0.format(v) : nf2.format(v / 1e6);
  rows.forEach(([vi, e]) => {
    const open = S.open.has(vi);
    h += '<tr class="grp' + (S.vtg === vi ? ' sel' : '') + '" data-v="' + vi + '"><td><span class="tg" data-t="' + vi + '">' + (open ? '−' : '+') + '</span>' + esc(D.vtg[vi]) +
      '<span class="bar" style="width:' + Math.max(2, Math.abs(e.v) / max * 100) + '%"></span></td><td class="num">' + fv(e.v) + '</td><td class="num">' + (tot ? nf1.format(e.v / tot * 100) : '–') + ' %</td></tr>';
    if (open) {
      Array.from(e.k.entries()).sort((a, b) => b[1] - a[1]).forEach(([ki, v]) => {
        const k = D.konto[ki];
        h += '<tr class="item"><td>' + esc(k.k + ' ' + k.n) + (k.inv ? ' <span class="muted small">(inv.)</span>' : '') + '</td><td class="num">' + fv(v) + '</td><td class="num">' + (tot ? nf1.format(v / tot * 100) : '–') + ' %</td></tr>';
      });
    }
  });
  h += '<tr class="total"><td>Totalt</td><td class="num">' + fv(tot) + '</td><td class="num">100,0 %</td></tr></tbody></table>';
  const host = $('#tree'); host.innerHTML = h;
  $('#srcTree').innerHTML = 'Kilde: <b>Ready2.xlsm</b>, kolonnene «Vare-/tjenestegruppe» og «Konto». Enhet: ' + unitName(m) + '.';
}

function renderTrend() {
  const m = S.measure, gran = S.gran;
  const keyOf = i => gran === 'y' ? Y[i] : gran === 'q' ? Y[i] * 10 + Q[i] : Y[i] * 100 + M[i];
  const keys = [];
  YEARS.forEach(y => { if (gran === 'y') keys.push(y); else if (gran === 'q') for (let q = 1; q <= 4; q++) keys.push(y * 10 + q); else for (let mm = 1; mm <= 12; mm++) keys.push(y * 100 + mm); });
  const pos = new Map(keys.map((k, j) => [k, j]));
  const a = keys.map(() => 0), b = keys.map(() => 0);
  const mA = isCap(m) ? 'cap' : 'nom', mB = isCap(m) ? 'capreal' : 'real';
  for (let i = 0; i < N; i++) { if (!pass(i, { year: 1, q: 1 })) continue; const j = pos.get(keyOf(i)); a[j] += val(i, mA); b[j] += val(i, mB); }
  const div = unitDiv(m);
  const lab = keys.map(k => gran === 'y' ? String(k) : gran === 'q' ? (Math.floor(k / 10) + ' K' + (k % 10)) : (Math.floor(k / 100) + '-' + String(k % 100).padStart(2, '0')));
  const breakIdx = gran === 'y' ? lab.indexOf('2025') : gran === 'q' ? lab.indexOf('2025 K1') : lab.indexOf('2025-02');
  const premIdx = gran === 'y' ? lab.indexOf('2020') : gran === 'q' ? lab.indexOf('2020 K4') : lab.indexOf('2020-12');
  const selIdx = S.year ? (gran === 'y' ? lab.indexOf(String(S.year)) : -1) : -1;
  const nameA = isCap(m) ? 'Per innb., løpende kr' : 'Løpende kroner', nameB = isCap(m) ? 'Per innb., 2025-kr' : 'Faste 2025-kroner';
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 8, right: 18, top: 34, bottom: 8, containLabel: true },
    legend: legendLine({ top: 0, right: 0, data: [nameA, nameB] }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: lab, boundaryGap: gran === 'y', splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true } }),
    yAxis: Object.assign(axisCommon(), { type: 'value', axisLabel: { color: C.muted, fontSize: 11, formatter: axisFmt(m) } }),
    tooltip: Object.assign(o.tooltip, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.accent2, width: 1, type: 'dashed' } },
      formatter: ps => { const j = ps[0].dataIndex; let note = '';
        if (j >= breakIdx && breakIdx >= 0) note = '2025: ny bilagsserie fra februar – ikke sammenlignbart med tidligere år.';
        if (j === premIdx) note = 'Inkluderer premieavvik −5,5 mill. kr (KLP, des. 2020).';
        return ttRows(lab[j], [{ k: nameA, v: money(a[j], m), c: C.s[0] }, { k: nameB, v: money(b[j], m), c: C.s[1] }], note || (S.year === null && gran === 'y' ? 'Klikk for å velge år' : '')); } }),
    series: [
      { name: nameA, type: 'line', data: a.map(v => v / div), symbol: 'circle', symbolSize: gran === 'm' ? 4 : 8, smooth: 0.25, lineStyle: { width: 2, color: C.s[0] }, itemStyle: { color: C.s[0], borderColor: C.panel, borderWidth: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(C.s[0], 0.28) }, { offset: 1, color: hexA(C.s[0], 0) }]) },
        markArea: breakIdx >= 0 ? { silent: true, itemStyle: { color: hexA(C.warn, 0.07), borderColor: hexA(C.warn, 0.35), borderWidth: 1, borderType: 'dashed' },
          label: { color: C.warn, fontSize: 11, position: 'insideTop', formatter: gran === 'y' ? 'Brudd i serien (2025)' : 'Brudd i serien' }, data: [[{ xAxis: lab[gran === 'y' ? breakIdx - 1 : breakIdx] }, { xAxis: lab[lab.length - 1] }]] } : undefined,
        markPoint: premIdx >= 0 ? { symbol: 'pin', symbolSize: 34, itemStyle: { color: C.s[7] }, label: { color: '#fff', fontSize: 9, formatter: 'P' },
          data: [{ coord: [lab[premIdx], a[premIdx] / div], name: 'Premieavvik' }] } : undefined,
        markLine: selIdx >= 0 ? { silent: true, symbol: 'none', lineStyle: { color: C.accent2, width: 1.5 }, label: { color: C.accent2, formatter: 'Valgt år' }, data: [{ xAxis: lab[selIdx] }] } : undefined
      },
      { name: nameB, type: 'line', data: b.map(v => v / div), symbol: 'circle', symbolSize: gran === 'm' ? 4 : 8, smooth: 0.25, lineStyle: { width: 2, color: C.s[1] }, itemStyle: { color: C.s[1], borderColor: C.panel, borderWidth: 2 } }
    ]
  });
  const c = chart('chTrend'); c.setOption(o, true);
  c.off('click'); c.on('click', p => { if (gran !== 'y') return; const y = Number(lab[p.dataIndex]); S.year = S.year === y ? null : y; syncControls(); renderPage(); });
  $('#trendCap').textContent = unitName(isCap(m) ? 'cap' : 'nom').replace('mill. kr', 'Mill. kr') + ' · løpende og faste 2025-kroner (KPI) · alle år vises uansett årsfilter';
  $('#srcTrend').innerHTML = 'Kilde: <b>Ready2.xlsm</b>; KPI <b>SSB 03014</b> (2025 = basis); folkemengde <b>SSB 07459</b>. «P» markerer premieavvik −5,5 mill. kr (des. 2020, engangspost). Skravert felt: ny bilagsserie fra feb. 2025.';
}
function textOn(hex) {
  const n = parseInt(hex.replace('#', ''), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return L > 0.33 ? '#0b1520' : '#ffffff';
}
function lerpHex(a, b, t) {
  const pa = parseInt(a.replace('#', ''), 16), pb = parseInt(b.replace('#', ''), 16);
  const ch = (x, sh) => (x >> sh) & 255; const mix = sh => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * t);
  return '#' + [16, 8, 0].map(sh => mix(sh).toString(16).padStart(2, '0')).join('');
}
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* =====================================================================
   KATEGORIANALYSE
   ===================================================================== */
const DIMS = {
  kostra: [['to', 'Tjenesteområde'], ['sektor', 'Sektor'], ['func', 'KOSTRA-funksjon'], ['art', 'Art (kommunekasse)']],
  faktura: [['to', 'Tjenesteområde'], ['sektor', 'Sektor'], ['func', 'KOSTRA-funksjon'], ['ag', 'Artsgruppe'], ['vtg', 'Vare-/tjenestegruppe'], ['bransje', 'Leverandørbransje'], ['mg', 'Mottakergruppe (lokal)']]
};
const KART = [['AG16', 'Lønnsutgifter (ekskl. sykelønnsrefusjon)'], ['AGD50', 'Kjøp av varer og tjenester (egenproduksjon)'], ['AGD51', 'Kjøp som erstatter egenproduksjon'], ['AG34', 'Overføringer (ekskl. mva)'], ['A590', 'Avskrivninger']];

function catSeries() {
  const c = S.cat, out = [];
  if (c.src === 'kostra') {
    if (c.dim === 'to' || c.dim === 'sektor') {
      const byTo = kostraByTO('AGD10');
      if (c.dim === 'to') D.to.forEach((t, k) => { if (byTo[k].some(v => v != null)) out.push({ n: t.n, v: byTo[k] }); });
      else D.sektor.forEach((s, si) => {
        const v = YEARS.map(() => null);
        D.to.forEach((t, k) => { if (t.s === si) byTo[k].forEach((x, j) => { if (x != null) v[j] = (v[j] || 0) + x; }); });
        if (v.some(x => x != null)) out.push({ n: s.n, v });
      });
    } else if (c.dim === 'func') {
      Object.keys(D.kostra_func).sort().forEach(f => { const x = D.kostra_func[f]; if (x.AGD10) out.push({ n: f + ' ' + x.n, v: x.AGD10.map(v => v == null ? null : v * 1000), note: (f === '254' ? 'Delt i 257/258 fra 2024' : (f === '257' || f === '258') ? 'Ny funksjon fra 2024' : '') }); });
    } else if (c.dim === 'art') {
      KART.forEach(([a, n]) => out.push({ n, v: D.kostra_art[a].v.map(v => v == null ? null : v * 1000) }));
    }
  } else {
    const keyF = { to: i => TOi[i], sektor: i => SK[i], func: i => TX.f[i], ag: i => AG[i], vtg: i => VTG[i], bransje: i => BR[i], mg: i => MG[i] }[c.dim];
    const nameF = { to: k => D.to[k].n, sektor: k => D.sektor[k].n, func: k => D.func[k].f + ' ' + D.func[k].n, ag: k => D.ag[k].n, vtg: k => D.vtg[k], bransje: k => D.bransje[k], mg: k => D.mg[k] }[c.dim];
    const map = new Map();
    for (let i = 0; i < N; i++) {
      if (!pass(i, { year: 1, q: 1 })) continue;
      const k = keyF(i); let v = map.get(k); if (!v) { v = YEARS.map(() => 0); map.set(k, v); }
      v[Y[i] - 2016] += TX.a[i];
    }
    map.forEach((v, k) => out.push({ n: nameF(k), v }));
  }
  return out;
}
function catMetrics(rows) {
  const c = S.cat, jf = c.from - 2016, jt = c.to - 2016, n = c.to - c.from;
  const totF = rows.reduce((s, r) => s + (r.v[jf] || 0), 0), totT = rows.reduce((s, r) => s + (r.v[jt] || 0), 0);
  const met = r => {
    const f = r.v[jf], t = r.v[jt];
    const ok = f != null && t != null && f > 0 && t > 0 && n > 0;
    const realF = f != null ? f * KF[c.from] : null, realT = t != null ? t * KF[c.to] : null;
    return {
      n: r.n, note: r.note, v: r.v, f, t,
      dn: (f != null && t != null) ? t - f : null,
      dp: ok ? t / f - 1 : null,
      dr: ok ? realT / realF - 1 : null,
      drAbs: (realF != null && realT != null) ? realT - realF : null,
      cn: ok ? Math.pow(t / f, 1 / n) - 1 : null,
      cr: ok ? Math.pow(realT / realF, 1 / n) - 1 : null,
      sh: (t != null && totT) ? t / totT : null
    };
  };
  const list = rows.map(met);
  const tot = met({ n: 'Totalt', v: YEARS.map((y, j) => rows.reduce((s, r) => s + (r.v[j] || 0), 0)) });
  tot.sh = 1;
  return { list, tot, totF, totT };
}
function spark(v, w, h) {
  w = w || 92; h = h || 22;
  const vals = v.map(x => x == null ? null : x); const nn = vals.filter(x => x != null);
  if (nn.length < 2) return '';
  const mn = Math.min(0, ...nn), mx = Math.max(...nn); const r = (mx - mn) || 1;
  let d = '', started = false;
  vals.forEach((x, j) => { if (x == null) { started = false; return; } const px = (j / (vals.length - 1)) * (w - 4) + 2, py = h - 2 - ((x - mn) / r) * (h - 4); d += (started ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); started = true; });
  const last = vals.length - 1; const lx = w - 2, ly = vals[last] != null ? h - 2 - ((vals[last] - mn) / r) * (h - 4) : null;
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + d + '" fill="none" stroke="' + C.s[0] + '" stroke-width="1.6" stroke-linejoin="round"/>' + (ly != null ? '<circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="2.4" fill="' + C.s[0] + '"/>' : '') + '</svg>';
}
function renderCategories() {
  const c = S.cat;
  // kontroller
  const dimSel = $('#catDim');
  const dims = DIMS[c.src];
  if (!dims.some(d => d[0] === c.dim)) c.dim = 'to';
  dimSel.innerHTML = dims.map(d => '<option value="' + d[0] + '"' + (d[0] === c.dim ? ' selected' : '') + '>' + esc(d[1]) + '</option>').join('');
  $('#catFrom').innerHTML = YEARS.slice(0, -1).map(y => '<option' + (y === c.from ? ' selected' : '') + '>' + y + '</option>').join('');
  $('#catTo').innerHTML = YEARS.slice(1).map(y => '<option' + (y === c.to ? ' selected' : '') + '>' + y + '</option>').join('');
  $$('#catSrc button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === c.src)));

  const rows = catSeries();
  const { list, tot } = catMetrics(rows);
  const key = c.sort, dir = c.dir;
  const sk = { n: r => r.n, f: r => r.f, t: r => r.t, dn: r => r.dn, dp: r => r.dp, dr: r => r.dr, cn: r => r.cn, cr: r => r.cr, sh: r => r.sh };
  list.sort((a, b) => {
    const x = sk[key] ? sk[key](a) : a.t, y = sk[key] ? sk[key](b) : b.t;
    if (typeof x === 'string') return dir * x.localeCompare(y, 'nb');
    return dir * (((x == null) ? -Infinity : x) - ((y == null) ? -Infinity : y));
  });
  const cols = [['n', 'Kategori', ''], ['f', String(c.from), 'num'], ['t', String(c.to), 'num'], ['dn', 'Endring nom.', 'num'], ['dp', 'Endring nom. %', 'num'], ['dr', 'Endring realt %', 'num'], ['cn', 'CAGR nom.', 'num'], ['cr', 'CAGR realt', 'num'], ['sh', 'Andel ' + c.to, 'num'], ['sp', 'Utvikling 2016–2025', '']];
  const cl = v => v == null ? 'na' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  const cell = (r) => '<td class="wrap">' + esc(r.n) + (r.note ? ' <span class="badge brudd">' + esc(r.note) + '</span>' : '') + '</td>' +
    '<td class="num">' + mill(r.f) + '</td><td class="num">' + mill(r.t) + '</td>' +
    '<td class="num ' + cl(r.dn) + '">' + (r.dn == null ? '–' : (r.dn > 0 ? '+' : '') + mill(r.dn)) + '</td>' +
    '<td class="num ' + cl(r.dp) + '">' + pct(r.dp) + '</td><td class="num ' + cl(r.dr) + '">' + pct(r.dr) + '</td>' +
    '<td class="num">' + pct(r.cn) + '</td><td class="num">' + pct(r.cr) + '</td><td class="num">' + (r.sh == null ? '–' : nf1.format(r.sh * 100) + ' %') + '</td>';
  let h = '<table class="dt"><thead><tr>' + cols.map(([k, n, cls]) => '<th class="' + cls + (k === key ? ' sorted' : '') + '" data-k="' + k + '">' + esc(n) + (k !== 'sp' ? '<span class="ar">' + (k === key ? (dir > 0 ? '▲' : '▼') : '↕') + '</span>' : '') + '</th>').join('') + '</tr></thead><tbody>';
  list.forEach(r => { h += '<tr>' + cell(r) + '<td>' + spark(r.v) + '</td></tr>'; });
  h += '</tbody><tfoot><tr>' + cell(tot) + '<td>' + spark(tot.v) + '</td></tr></tfoot></table>';
  $('#catTable').innerHTML = h;
  $$('#catTable th[data-k]').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; if (k === 'sp') return; if (c.sort === k) c.dir *= -1; else { c.sort = k; c.dir = k === 'n' ? 1 : -1; } renderCategories(); }));

  const dimName = dims.find(d => d[0] === c.dim)[1];
  $('#catCap').textContent = dimName + ' · ' + c.from + ' mot ' + c.to + ' · beløp i mill. kr (løpende) · realendring og real CAGR deflatert med KPI';
  let warn = '';
  if (c.src === 'faktura') {
    warn = '<div class="warnbox"><svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 9.5a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z"/></svg><div><b>Ikke sammenlignbare år.</b> Dekningsgrad mot KOSTRA-kjøp: ' + c.from + ' = ' + nf0.format(covPct[c.from - 2016] * 100) + ' %, ' + c.to + ' = ' + nf0.format(covPct[c.to - 2016] * 100) + ' %. Endringene under beskriver først og fremst endringer i uttrekket. Globale filtre (unntatt år/kvartal) gjelder.</div></div>';
  } else {
    warn = '<div class="infobox"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><div>KOSTRA-tall er offisielle regnskapstall og påvirkes ikke av filtrene. Tjenesteområde/sektor = brutto driftsutgifter (AGD10, kommunekonsern) summert etter funksjon. «Fellesutgifter og pensjon» inneholder premieavvik og premiefond og kan være negativ.</div></div>';
  }
  $('#catWarn').innerHTML = warn;
  $('#srcCat').innerHTML = c.src === 'kostra'
    ? 'Kilde: <b>' + (c.dim === 'art' ? 'SSB tabell 12367 (kommunekasse)' : 'SSB tabell 12362 (kommunekonsern)') + '</b>, ' + c.from + ' og ' + c.to + '; KPI <b>SSB 03014</b>. CAGR = (siste/første)^(1/år) − 1. «–» = ikke beregnbar (negativ/null verdi eller manglende tall).'
    : 'Kilde: <b>Ready2.xlsm</b> (fakturagrunnlag), ' + c.from + ' og ' + c.to + '; KPI <b>SSB 03014</b>. Mva: ' + (S.mva ? 'inkludert' : 'ekskludert (art 429)') + '.';
  renderHeat(list, tot);
  renderWaterfall(list);
}
function renderHeat(list, tot) {
  const mode = S.heat;
  const rows = list.filter(r => r.v.some(x => x)).slice().sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 18);
  const cats = rows.map(r => r.n).reverse();
  const data = []; let mn = Infinity, mx = -Infinity;
  rows.slice().reverse().forEach((r, ri) => {
    r.v.forEach((x, j) => {
      let v = null;
      if (x != null) {
        if (mode === 'abs') v = x / 1e6;
        else if (mode === 'share') v = tot.v[j] ? x / tot.v[j] * 100 : null;
        else v = (r.v[0] && r.v[0] > 0) ? x / r.v[0] * 100 : null;
      }
      if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      data.push([j, ri, v == null ? '-' : v]);
    });
  });
  const o = baseOpt();
  const fmt = v => v === '-' || v == null ? '–' : mode === 'abs' ? nf1.format(v) : nf0.format(v);
  Object.assign(o, {
    grid: { left: 8, right: 12, top: 8, bottom: 52, containLabel: true },
    xAxis: { type: 'category', data: YEARS.map(String), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 11 }, splitArea: { show: false } },
    yAxis: { type: 'category', data: cats, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.text2, fontSize: 11, width: lw('chHeat', 0.28, 210), overflow: 'truncate' } },
    visualMap: { min: isFinite(mn) ? Math.max(0, mn) : 0, max: isFinite(mx) ? mx : 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, itemHeight: 160,
      text: [mode === 'abs' ? 'mill. kr' : mode === 'share' ? '% av året' : 'indeks', ''], textStyle: { color: C.muted, fontSize: 11 }, inRange: { color: C.seq } },
    tooltip: Object.assign(o.tooltip, { formatter: p => ttRows(cats[p.data[1]] + ' · ' + YEARS[p.data[0]], [{ k: mode === 'abs' ? 'Mill. kr' : mode === 'share' ? 'Andel av året' : 'Indeks (2016 = 100)', v: fmt(p.data[2]) + (mode === 'share' ? ' %' : ''), c: 'transparent' }]) }),
    series: [{ type: 'heatmap', data, label: { show: true, fontSize: 10, color: C.text, formatter: p => fmt(p.data[2]), textBorderColor: C.panel, textBorderWidth: 2 },
      itemStyle: { borderColor: C.panel, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: C.accent2, borderWidth: 1 } } }]
  });
  const lo = isFinite(mn) ? Math.max(0, mn) : 0, hi = isFinite(mx) ? mx : 1;
  const darkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
  o.series[0].data = data.map(d => { const t = d[2] === '-' ? 0 : (d[2] - lo) / ((hi - lo) || 1); const lightCell = darkTheme ? t > 0.55 : t < 0.45;
    return { value: d, label: { color: lightCell ? '#0b1520' : '#f2f6fa' } }; });
  o.series[0].label = { show: true, fontSize: 10, formatter: p => fmt(p.data.value ? p.data.value[2] : p.data[2]) };
  o.tooltip.formatter = p => { const d = p.data.value || p.data; return ttRows(cats[d[1]] + ' · ' + YEARS[d[0]], [{ k: mode === 'abs' ? 'Mill. kr' : mode === 'share' ? 'Andel av året' : 'Indeks (2016 = 100)', v: fmt(d[2]) + (mode === 'share' ? ' %' : ''), c: 'transparent' }]); };
  chart('chHeat').setOption(o, true);
  $('#heatCap').textContent = (mode === 'abs' ? 'Mill. kr (løpende)' : mode === 'share' ? 'Andel av årets total (%)' : 'Indeks, 2016 = 100') + ' · topp 18 kategorier etter ' + S.cat.to;
}
function renderWaterfall(list) {
  const rows = list.filter(r => r.drAbs != null && Math.abs(r.drAbs) > 1).sort((a, b) => Math.abs(b.drAbs) - Math.abs(a.drAbs)).slice(0, 14).sort((a, b) => a.drAbs - b.drAbs);
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: Object.assign(axisCommon(), { type: 'value', axisLabel: { color: C.muted, fontSize: 11, formatter: v => nf0.format(v) } }),
    yAxis: { type: 'category', data: rows.map(r => r.n), axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.text2, fontSize: 11, width: lw('chWaterfall', 0.36, 170), overflow: 'truncate' } },
    tooltip: Object.assign(o.tooltip, { trigger: 'item', formatter: p => ttRows(rows[p.dataIndex].n, [{ k: 'Realendring', v: (p.value > 0 ? '+' : '') + nf1.format(p.value) + ' mill. 2025-kr', c: p.color }, { k: 'Endring realt %', v: pct(rows[p.dataIndex].dr), c: 'transparent' }]) }),
    series: [{ type: 'bar', barMaxWidth: 16, data: rows.map(r => ({ value: r.drAbs / 1e6, itemStyle: { color: r.drAbs > 0 ? C.s[7] : C.s[0], borderRadius: 3 } })),
      label: { show: true, position: 'right', color: C.text2, fontSize: 11, formatter: p => (p.value > 0 ? '+' : '') + nf1.format(p.value) } }]
  });
  chart('chWaterfall').setOption(o, true);
  $('#wfCap').textContent = 'Realendring ' + S.cat.from + '→' + S.cat.to + ', mill. 2025-kr · rød = økning, blå = reduksjon';
}

/* =====================================================================
   LEVERANDØRER
   ===================================================================== */
function levAgg() {
  const m = S.measure; const map = new Map();
  for (let i = 0; i < N; i++) {
    if (!pass(i, { lev: 1 })) continue;
    const l = TX.l[i]; let e = map.get(l); if (!e) { e = { l, v: 0, n: 0, y: YEARS.map(() => 0) }; map.set(l, e); }
    e.v += val(i, m); e.n++; e.y[Y[i] - 2016] += TX.a[i];
  }
  return Array.from(map.values());
}
function renderSuppliers() {
  const m = S.measure, div = unitDiv(m);
  const all = levAgg().sort((a, b) => b.v - a.v);
  const top = all.slice(0, 15).reverse();
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 16, right: 64, top: 8, bottom: 8, containLabel: true },
    xAxis: Object.assign(axisCommon(), { type: 'value', axisLabel: { color: C.muted, fontSize: 11, formatter: axisFmt(m) } }),
    yAxis: { type: 'category', data: top.map(e => D.lev[e.l].n), axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.text2, fontSize: 11.5, width: lw('chTopLev', 0.34, 220), overflow: 'truncate' } },
    tooltip: Object.assign(o.tooltip, { trigger: 'item', formatter: p => { const e = top[p.dataIndex]; return ttRows(D.lev[e.l].n, [{ k: 'Beløp', v: money(e.v, m), c: C.s[0] }, { k: 'Fakturalinjer', v: nf0.format(e.n), c: 'transparent' }, { k: 'Bransje', v: D.bransje[D.lev[e.l].b], c: 'transparent' }], 'Klikk for å filtrere'); } }),
    series: [{ type: 'bar', barMaxWidth: 16, data: top.map(e => ({ value: e.v / div, itemStyle: { color: e.l === ANON ? C.muted : C.s[0], opacity: S.lev !== null && S.lev !== e.l ? 0.3 : 1, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', color: C.text, fontSize: 11, formatter: p => isCap(m) ? nf0.format(p.value) : nf1.format(p.value) } }]
  });
  const c = chart('chTopLev'); c.setOption(o, true);
  c.off('click'); c.on('click', p => { const l = top[p.dataIndex].l; S.lev = S.lev === l ? null : l; syncControls(); renderPage(); });
  $('#srcTopLev').innerHTML = 'Kilde: <b>Ready2.xlsm</b>, ' + esc(S.year || '2016–2025') + '. Enhet: ' + unitName(m) + '. Grå stolpe = privatpersoner slått sammen og anonymisert (' + D.meta.persons + ' navn).';

  // Pareto
  const posv = all.filter(e => e.v > 0).map(e => e.v); const tot = posv.reduce((s, v) => s + v, 0);
  let cum = 0; const pts = posv.map((v, j) => { cum += v; return [j + 1, cum / tot * 100]; });
  const n80 = pts.findIndex(p => p[1] >= 80) + 1;
  const o2 = baseOpt();
  Object.assign(o2, {
    grid: { left: 8, right: 20, top: 24, bottom: 30, containLabel: true },
    xAxis: Object.assign(axisCommon(), { type: 'value', min: 1, max: Math.max(2, pts.length), name: 'Antall leverandører (rangert)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.muted, fontSize: 11 }, splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value', max: 100, axisLabel: { color: C.muted, fontSize: 11, formatter: v => v + ' %' } }),
    tooltip: Object.assign(o2.tooltip, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.accent2, type: 'dashed' } }, formatter: ps => ttRows('Topp ' + nf0.format(ps[0].data[0]) + ' leverandører', [{ k: 'Kumulativ andel', v: nf1.format(ps[0].data[1]) + ' %', c: C.s[0] }]) }),
    series: [{ type: 'line', data: pts, showSymbol: false, lineStyle: { width: 2, color: C.s[0] },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(C.s[0], 0.3) }, { offset: 1, color: hexA(C.s[0], 0) }]) },
      markLine: n80 > 0 ? { symbol: 'none', silent: true, lineStyle: { color: C.s[1], type: 'dashed' }, label: { color: C.text, fontSize: 11, formatter: p => p.name }, data: [{ yAxis: 80, name: '80 %' }, { xAxis: n80, name: nf0.format(n80) + ' lev.' }] } : undefined }]
  });
  chart('chPareto').setOption(o2, true);
  $('#paretoCap').textContent = pts.length ? (nf0.format(n80) + ' av ' + nf0.format(pts.length) + ' leverandører (' + nf1.format(n80 / pts.length * 100) + ' %) står for 80 % av beløpet') : 'Ingen data i utvalget';

  // Bransje-treemap
  const bm = new Map();
  all.forEach(e => { const b = D.lev[e.l].b; bm.set(b, (bm.get(b) || 0) + e.v); });
  const tsorted = Array.from(bm.entries()).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const tmax = tsorted.length ? tsorted[0][1] : 1;
  const tdata = tsorted.map(([b, v]) => { const col = lerpHex(C.seq[1], C.seq[3], Math.sqrt(v / tmax)); return { name: D.bransje[b], value: v, itemStyle: { color: col }, label: { color: textOn(col) } }; });
  const o3 = baseOpt();
  Object.assign(o3, {
    tooltip: Object.assign(o3.tooltip, { formatter: p => ttRows(p.name, [{ k: 'Beløp', v: money(p.value, m), c: C.s[0] }]) }),
    series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%', top: 0, left: 0,
      itemStyle: { borderColor: C.panel, borderWidth: 2, gapWidth: 2, borderRadius: 3 },
      label: { fontSize: 11, formatter: p => p.name + '\n' + (isCap(m) ? nf0.format(p.value) + ' kr' : nf1.format(p.value / 1e6) + ' mill.'), overflow: 'truncate' },
      upperLabel: { show: false }, data: tdata }]
  });
  chart('chBransje').setOption(o3, true);

  renderLevTable(all);
}
function renderLevTable(all) {
  const m = S.measure; const q = S.levQ.trim().toLowerCase();
  let rows = all;
  if (q) rows = rows.filter(e => D.lev[e.l].n.toLowerCase().includes(q) || D.bransje[D.lev[e.l].b].toLowerCase().includes(q));
  const tot = all.reduce((s, e) => s + e.v, 0);
  const sk = { n: e => D.lev[e.l].n, b: e => D.bransje[D.lev[e.l].b], c: e => e.n, sum: e => e.v };
  const k = S.levSort, dir = S.levDir;
  rows = rows.slice().sort((a, b) => { const x = sk[k](a), y = sk[k](b); return typeof x === 'string' ? dir * x.localeCompare(y, 'nb') : dir * (x - y); });
  const shown = rows.slice(0, 400);
  const th = (key, label, cls) => '<th class="' + (cls || '') + (key === k ? ' sorted' : '') + '" data-k="' + key + '">' + label + '<span class="ar">' + (key === k ? (dir > 0 ? '▲' : '▼') : '↕') + '</span></th>';
  let h = '<table class="dt"><thead><tr>' + th('n', 'Leverandør') + th('b', 'Bransje') + th('c', 'Linjer', 'num') + th('sum', isCap(m) ? 'kr/innb.' : 'Mill. kr', 'num') + '<th class="num">Andel</th><th>2016–2025</th></tr></thead><tbody>';
  shown.forEach(e => {
    h += '<tr class="click' + (S.lev === e.l ? ' sel' : '') + '" data-l="' + e.l + '"><td class="wrap">' + esc(D.lev[e.l].n) + '</td><td>' + esc(D.bransje[D.lev[e.l].b]) + '</td><td class="num">' + nf0.format(e.n) + '</td><td class="num">' + (isCap(m) ? nf0.format(e.v) : nf2.format(e.v / 1e6)) + '</td><td class="num">' + (tot ? nf1.format(e.v / tot * 100) : '–') + ' %</td><td>' + spark(e.y, 80, 20) + '</td></tr>';
  });
  h += '</tbody></table>';
  $('#levTable').innerHTML = h;
  $('#levCap').textContent = nf0.format(rows.length) + ' leverandører i utvalget' + (rows.length > 400 ? ' (viser 400 største)' : '') + ' · klikk en rad for å filtrere';
  $$('#levTable th[data-k]').forEach(t => t.addEventListener('click', () => { const kk = t.dataset.k; if (S.levSort === kk) S.levDir *= -1; else { S.levSort = kk; S.levDir = (kk === 'n' || kk === 'b') ? 1 : -1; } renderLevTable(all); }));
  $$('#levTable tr[data-l]').forEach(tr => tr.addEventListener('click', () => { const l = Number(tr.dataset.l); S.lev = S.lev === l ? null : l; syncControls(); renderPage(); }));
}

/* =====================================================================
   KOSTRA
   ===================================================================== */
function renderKostra() {
  const T = D.kostra_tot;
  const st = T['1848'].KOSbelop0000, sc = T['1848'].KOSbelopinnbygge0000, g6 = T.EKG06.KOSbelopinnbygge0000;
  const j0 = 0, j1 = 9;
  const b0 = st.AGD10[j0] * 1000, b1 = st.AGD10[j1] * 1000;
  const realG = b1 / (b0 * KF[2016]) - 1, cagrR = Math.pow(1 + realG, 1 / 9) - 1;
  const capS = sc.AGD10[j1], capG = g6.AGD10[j1];
  const net = st.AGD2[j1] * 1000;
  const kp = [
    { v: b1, f: 'mill', l: 'Brutto driftsutgifter 2025', s: '2016: ' + nf1.format(b0 / 1e6) + ' mill. kr · ' + pct(b1 / b0 - 1) + ' nominelt' },
    { v: realG * 100, f: 'pct', l: 'Realvekst 2016–2025 (2025-kr)', s: 'Real CAGR ' + pct(cagrR) + ' per år · KPI-deflatert' },
    { v: capS, f: 'kr', l: 'Brutto driftsutgifter per innbygger 2025', s: 'KOSTRA-gruppe 6: ' + nf0.format(capG) + ' kr (' + pct(capS / capG - 1) + ')' },
    { v: net, f: 'mill', l: 'Netto driftsutgifter 2025', s: 'Per innbygger: ' + nf0.format(sc.AGD2[j1]) + ' kr' }
  ];
  const host = $('#kostraKpis');
  host.innerHTML = kp.map(() => '<div class="kpi"><div class="v"></div><div class="l"></div><div class="s"></div></div>').join('');
  $$('.kpi', host).forEach((el, k) => {
    $('.l', el).textContent = kp[k].l; $('.s', el).innerHTML = esc(kp[k].s);
    if (kp[k].f === 'pct') { el.querySelector('.v').innerHTML = '+' + nf1.format(kp[k].v) + '<span class="u">%</span>'; }
    else countUp($('.v', el), kp[k].v, kp[k].f, 700);
  });

  // Total nominelt + realt
  const nom = st.AGD10.map(v => v * 1000 / 1e6), real = st.AGD10.map((v, j) => v * 1000 * KF[YEARS[j]] / 1e6);
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, data: [{ name: 'Løpende kroner' }, { name: 'Faste 2025-kroner', icon: 'rect', itemStyle: { color: C.s[1] } }] }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: YEARS.map(String), splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value' }),
    tooltip: Object.assign(o.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } },
      formatter: ps => { const j = ps[0].dataIndex; return ttRows(YEARS[j], [{ k: 'Løpende kroner', v: nf1.format(nom[j]) + ' mill. kr', c: C.s[0] }, { k: 'Faste 2025-kroner', v: nf1.format(real[j]) + ' mill. kr', c: C.s[1] }, { k: 'KPI-faktor', v: nf2.format(KF[YEARS[j]]), c: 'transparent' }]); } }),
    series: [
      { name: 'Løpende kroner', type: 'bar', data: nom, barMaxWidth: 30, itemStyle: { color: C.s[0], borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'insideBottom', distance: 8, color: '#ffffff', fontSize: 10.5, fontWeight: 600, formatter: p => nf0.format(p.value) } },
      { name: 'Faste 2025-kroner', type: 'line', data: real, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2, color: C.s[1] }, itemStyle: { color: C.s[1], borderColor: C.panel, borderWidth: 2 } }
    ]
  });
  chart('chKTot').setOption(o, true);

  // Art (stablet)
  const realMode = S.kArt === 'real';
  const o2 = baseOpt();
  Object.assign(o2, {
    grid: { left: 8, right: 16, top: 54, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, width: '100%' }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: YEARS.map(String), splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value' }),
    tooltip: Object.assign(o2.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } },
      formatter: ps => ttRows(ps[0].axisValue, ps.slice().reverse().map(p => ({ k: p.seriesName, v: nf1.format(p.value) + ' mill.', c: p.color })), 'Kommunekasse, SSB 12367') }),
    series: KART.map(([a, n], k) => ({ name: n, type: 'bar', stack: 'a', barMaxWidth: 30,
      itemStyle: { color: C.s[k], borderColor: C.panel, borderWidth: 1 },
      data: D.kostra_art[a].v.map((v, j) => v == null ? null : v * 1000 * (realMode ? KF[YEARS[j]] : 1) / 1e6) }))
  });
  chart('chKArt').setOption(o2, true);

  // Sammenligning per innbygger (FGK)
  const art = S.kCmpArt, jy = S.kCmpYear - 2016;
  const regs = ['1848', 'EKG06', 'EKA18', 'EAKUO'];
  const fgk = Object.keys(D.kostra_fgk).filter(f => f !== 'FGK1c');
  const vals = f => regs.map(r => { const x = D.kostra_fgk[f].r[r]; return x && x.KOSbelopinnbygge0000 && x.KOSbelopinnbygge0000[art] ? x.KOSbelopinnbygge0000[art][jy] : null; });
  fgk.sort((a, b) => (vals(a)[0] || 0) - (vals(b)[0] || 0));
  const lbl = f => D.kostra_fgk[f].n.replace(', kommune', '');
  const o3 = baseOpt();
  Object.assign(o3, {
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, data: regs.map(r => D.regions[r]) }),
    xAxis: Object.assign(axisCommon(), { type: 'value', axisLabel: { color: C.muted, fontSize: 11, formatter: v => nf0.format(v / 1000) + ' k' } }),
    yAxis: { type: 'category', data: fgk.map(lbl), axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.text2, fontSize: 11, width: lw('chKCmp', 0.32, 180), overflow: 'truncate' } },
    tooltip: Object.assign(o3.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } },
      formatter: ps => { const f = fgk[ps[0].dataIndex]; const v = vals(f); return ttRows(lbl(f) + ' · ' + S.kCmpYear, regs.map((r, k) => ({ k: D.regions[r], v: v[k] == null ? '–' : nf0.format(v[k]) + ' kr', c: C.s[k] })), 'Kr per innbygger, ' + (art === 'AGD10' ? 'brutto' : 'netto') + ' driftsutgifter'); } }),
    series: regs.map((r, k) => ({ name: D.regions[r], type: 'bar', barMaxWidth: 7, barGap: '15%', barCategoryGap: '30%', itemStyle: { color: C.s[k], borderRadius: [0, 2, 2, 0] }, data: fgk.map(f => vals(f)[k]) }))
  });
  chart('chKCmp').setOption(o3, true);
  $('#kCmpCap').textContent = (art === 'AGD10' ? 'Brutto' : 'Netto') + ' driftsutgifter, kr per innbygger, ' + S.kCmpYear + ' · Steigen mot KOSTRA-gruppe 6, Nordland og landet uten Oslo';

  // Per innbygger over tid
  const o4 = baseOpt();
  Object.assign(o4, {
    grid: { left: 8, right: 16, top: 54, bottom: 8, containLabel: true },
    legend: legendLine({ top: 0, left: 0, data: regs.map(r => D.regions[r]) }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: YEARS.map(String), boundaryGap: false, splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value', scale: true, axisLabel: { color: C.muted, fontSize: 11, formatter: v => nf0.format(v / 1000) + ' k' } }),
    tooltip: Object.assign(o4.tooltip, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.accent2, type: 'dashed' } },
      formatter: ps => ttRows(ps[0].axisValue, ps.map(p => ({ k: p.seriesName, v: nf0.format(p.value) + ' kr', c: p.color })), 'Brutto driftsutgifter per innbygger (sum funksjoner)') }),
    series: regs.map((r, k) => ({ name: D.regions[r], type: 'line', data: T[r].KOSbelopinnbygge0000.AGD10, symbol: 'circle', symbolSize: 7, lineStyle: { width: r === '1848' ? 3 : 2, color: C.s[k] }, itemStyle: { color: C.s[k], borderColor: C.panel, borderWidth: 2 },
      endLabel: { show: true, color: C.text2, fontSize: 10, formatter: p => nf0.format(p.value / 1000) + ' k' } }))
  });
  o4.grid.right = 44;
  chart('chKCap').setOption(o4, true);

  // Investeringer
  const inv = st.AGI5.map(v => v * 1000 / 1e6);
  const o5 = baseOpt();
  Object.assign(o5, {
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: Object.assign(axisCommon(), { type: 'category', data: YEARS.map(String), splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value' }),
    tooltip: Object.assign(o5.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } }, formatter: ps => ttRows(ps[0].axisValue, [{ k: 'Brutto investeringsutgifter', v: nf1.format(ps[0].value) + ' mill. kr', c: C.s[0] }, { k: 'Faste 2025-kr', v: nf1.format(ps[0].value * KF[Number(ps[0].axisValue)]) + ' mill.', c: 'transparent' }]) }),
    series: [{ type: 'bar', data: inv, barMaxWidth: 26, itemStyle: { color: C.s[0], borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: C.text2, fontSize: 10, formatter: p => nf1.format(p.value) } }]
  });
  chart('chKInv').setOption(o5, true);

  // Avvikstabell mot KOSTRA-gruppe 6
  const pop = POP[S.kCmpYear];
  const dev = Object.keys(D.kostra_fgk).map(f => {
    const x = D.kostra_fgk[f].r; const s = x['1848'].KOSbelopinnbygge0000[art][jy], g = x.EKG06.KOSbelopinnbygge0000[art][jy];
    return { n: lbl(f), s, g, d: (s != null && g != null) ? s - g : null, p: (s != null && g) ? s / g - 1 : null, mk: (s != null && g != null) ? (s - g) * pop : null };
  }).sort((a, b) => Math.abs(b.mk || 0) - Math.abs(a.mk || 0));
  let h = '<table class="dt"><thead><tr><th>Tjenesteområde (KOSTRA)</th><th class="num">Steigen kr/innb.</th><th class="num">Gruppe 6 kr/innb.</th><th class="num">Avvik %</th><th class="num">Forskjell mill. kr</th></tr></thead><tbody>';
  dev.forEach(r => { const cl = r.mk == null ? 'na' : r.mk > 0 ? 'pos' : 'neg'; h += '<tr><td class="wrap">' + esc(r.n) + '</td><td class="num">' + (r.s == null ? '–' : nf0.format(r.s)) + '</td><td class="num">' + (r.g == null ? '–' : nf0.format(r.g)) + '</td><td class="num ' + cl + '">' + pct(r.p) + '</td><td class="num ' + cl + '">' + (r.mk == null ? '–' : (r.mk > 0 ? '+' : '') + nf1.format(r.mk / 1e6)) + '</td></tr>'; });
  h += '</tbody></table>';
  $('#kDevTable').innerHTML = h;
  $('#kDevCap').textContent = (art === 'AGD10' ? 'Brutto' : 'Netto') + ' driftsutgifter per innbygger, ' + S.kCmpYear + ' · innbyggere 31.12.: ' + nf0.format(pop);
}

/* =====================================================================
   TRANSAKSJONER
   ===================================================================== */
let txRows = [];
function renderTx() {
  const q = S.tx.q.trim().toLowerCase();
  const rows = [];
  for (let i = 0; i < N; i++) {
    if (!pass(i)) continue;
    if (q) {
      const k = D.konto[TX.k[i]], f = D.func[TX.f[i]];
      const hay = (D.lev[TX.l[i]].n + ' ' + k.k + ' ' + k.n + ' ' + f.f + ' ' + f.n + ' ' + TX.b[i] + ' ' + TX.p[i] + ' ' + D.to[TOi[i]].n).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push(i);
  }
  const sk = { p: i => TX.p[i], b: i => TX.b[i], l: i => D.lev[TX.l[i]].n, k: i => D.konto[TX.k[i]].k, f: i => D.func[TX.f[i]].f, t: i => D.to[TOi[i]].n, r: i => INV[i], a: i => TX.a[i] };
  const key = S.tx.sort, dir = S.tx.dir, g = sk[key];
  rows.sort((x, y) => { const a = g(x), b = g(y); return typeof a === 'string' ? dir * a.localeCompare(b, 'nb') : dir * (a - b) || (TX.p[y] - TX.p[x]); });
  txRows = rows;
  const per = 100, pages = Math.max(1, Math.ceil(rows.length / per));
  if (S.tx.page >= pages) S.tx.page = pages - 1;
  const slice = rows.slice(S.tx.page * per, S.tx.page * per + per);
  const th = (k, l, cls) => '<th class="' + (cls || '') + (k === key ? ' sorted' : '') + '" data-k="' + k + '">' + l + '<span class="ar">' + (k === key ? (dir > 0 ? '▲' : '▼') : '↕') + '</span></th>';
  let h = '<table class="dt"><thead><tr>' + th('p', 'Periode') + th('b', 'Bilag') + th('l', 'Leverandør') + th('k', 'Konto') + th('f', 'Funksjon') + th('t', 'Tjenesteområde') + th('r', 'Regnskap') + th('a', 'Beløp (kr)', 'num') + '</tr></thead><tbody>';
  slice.forEach(i => {
    const k = D.konto[TX.k[i]], f = D.func[TX.f[i]], p = TX.p[i];
    h += '<tr><td>' + Math.floor(p / 100) + '-' + String(p % 100).padStart(2, '0') + '</td><td>' + TX.b[i] + '</td><td class="wrap">' + esc(D.lev[TX.l[i]].n) + '</td><td class="wrap">' + k.k + ' ' + esc(k.n) + '</td><td class="wrap">' + f.f + ' ' + esc(f.n) + '</td><td>' + esc(D.to[TOi[i]].n) + '</td><td>' + (INV[i] ? 'Investering' : 'Drift') + '</td><td class="num' + (TX.a[i] < 0 ? ' neg' : '') + '">' + nf2.format(TX.a[i]) + '</td></tr>';
  });
  let sum = 0; rows.forEach(i => { sum += TX.a[i]; });
  h += '</tbody><tfoot><tr><td colspan="7">Sum ' + nf0.format(rows.length) + ' linjer</td><td class="num">' + nf2.format(sum) + '</td></tr></tfoot></table>';
  $('#txTable').innerHTML = h;
  $$('#txTable th[data-k]').forEach(t => t.addEventListener('click', () => { const k = t.dataset.k; if (S.tx.sort === k) S.tx.dir *= -1; else { S.tx.sort = k; S.tx.dir = (k === 'l' || k === 't') ? 1 : -1; } S.tx.page = 0; renderTx(); }));
  $('#txPager').innerHTML = '<button class="btn" data-p="prev" ' + (S.tx.page === 0 ? 'disabled' : '') + '>‹ Forrige</button><span>Side ' + (S.tx.page + 1) + ' av ' + pages + '</span><button class="btn" data-p="next" ' + (S.tx.page >= pages - 1 ? 'disabled' : '') + '>Neste ›</button>';
  $$('#txPager button').forEach(b => b.addEventListener('click', () => { S.tx.page += b.dataset.p === 'next' ? 1 : -1; renderTx(); $('#txTable').scrollTop = 0; }));
  $('#txInfo').textContent = nf0.format(rows.length) + ' linjer · sum ' + money(sum, 'nom');
  $('#txCap').textContent = 'Alle utgiftslinjer fra Ready2.xlsm etter gjeldende filtre · beløp i løpende kroner · privatpersoner anonymisert';
}
function exportCsv() {
  const lines = ['Periode;Bilag;Leverandør;Bransje;Konto;Kontonavn;Art;Funksjon;Funksjonsnavn;Tjenesteområde;Sektor;Regnskap;Beløp'];
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  txRows.forEach(i => {
    const k = D.konto[TX.k[i]], f = D.func[TX.f[i]], t = D.to[TOi[i]];
    lines.push([TX.p[i], TX.b[i], q(D.lev[TX.l[i]].n), q(D.bransje[BR[i]]), k.k, q(k.n), k.art, f.f, q(f.n), q(t.n), q(D.sektor[t.s].n), INV[i] ? 'Investering' : 'Drift', String(TX.a[i]).replace('.', ',')].join(';'));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'steigen_fakturalinjer_utvalg.csv';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* =====================================================================
   DATAKVALITET OG METODE
   ===================================================================== */
function renderQuality() {
  const o = baseOpt();
  Object.assign(o, {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, data: ['KOSTRA: kjøp og overføringer', 'Fakturagrunnlag (Ready2)'] }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: YEARS.map(String), splitLine: { show: false } }),
    yAxis: Object.assign(axisCommon(), { type: 'value' }),
    tooltip: Object.assign(o.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } },
      formatter: ps => { const j = ps[0].dataIndex; return ttRows(YEARS[j], [{ k: 'KOSTRA (12367)', v: nf1.format(covKos[j] / 1e6) + ' mill. kr', c: C.s[0] }, { k: 'Fakturagrunnlag', v: nf1.format(covFak[j] / 1e6) + ' mill. kr', c: C.s[1] }, { k: 'Dekningsgrad', v: nf0.format(covPct[j] * 100) + ' %', c: 'transparent' }]); } }),
    series: [
      { name: 'KOSTRA: kjøp og overføringer', type: 'bar', data: covKos.map(v => v / 1e6), barMaxWidth: 22, barGap: '12%', itemStyle: { color: C.s[0], borderRadius: [4, 4, 0, 0] } },
      { name: 'Fakturagrunnlag (Ready2)', type: 'bar', data: covFak.map(v => v / 1e6), barMaxWidth: 22, itemStyle: { color: C.s[1], borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: C.text, fontSize: 10.5, fontWeight: 600, formatter: p => nf0.format(covPct[p.dataIndex] * 100) + ' %' } }
    ]
  });
  chart('chCov').setOption(o, true);

  // linjer per måned per serie
  const keys = []; YEARS.forEach(y => { for (let mm = 1; mm <= 12; mm++) keys.push(y * 100 + mm); });
  const pos = new Map(keys.map((k, j) => [k, j]));
  const ser = [0, 1, 2].map(() => keys.map(() => 0));
  for (let i = 0; i < N; i++) ser[TX.s[i]][pos.get(Y[i] * 100 + M[i])]++;
  const names = ['Serie 9xxxxxxx (2016 – jan. 2025)', 'Serie 82xxxxx (fra feb. 2025)', 'Andre bilagsserier'];
  const o2 = baseOpt();
  Object.assign(o2, {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: legendOpt({ top: 0, left: 0, data: names }),
    xAxis: Object.assign(axisCommon(), { type: 'category', data: keys.map(k => Math.floor(k / 100) + '-' + String(k % 100).padStart(2, '0')), splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, interval: 11, formatter: v => v.slice(0, 4) } }),
    yAxis: Object.assign(axisCommon(), { type: 'value' }),
    tooltip: Object.assign(o2.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(92,200,255,.06)' } }, formatter: ps => ttRows(ps[0].axisValue, ps.map(p => ({ k: p.seriesName, v: nf0.format(p.value), c: p.color })), 'Antall fakturalinjer') }),
    series: names.map((n, k) => ({ name: n, type: 'bar', stack: 's', data: ser[k], barCategoryGap: '20%', itemStyle: { color: C.s[k] } }))
  });
  chart('chLines').setOption(o2, true);

  renderEvents();
  renderMethod();
}
function linesYear(y) { let n = 0; for (let i = 0; i < N; i++) if (Y[i] === y) n++; return n; }
function renderEvents() {
  const ka = D.kostra_art, kf = D.kostra_func;
  const inc670 = (D.income_by_art.find(x => x.art === 670) || { sum: {} }).sum;
  const n82 = TX.s.reduce((s, v) => s + (v === 1 ? 1 : 0), 0);
  const inv222 = y => { let s = 0; for (let i = 0; i < N; i++) if (Y[i] === y && INV[i] && D.func[TX.f[i]].f === 222 && AG[i] !== 4) s += TX.a[i]; return s; };
  const E = [
    { y: '2016–2024', t: 'Fallende antall fakturalinjer i uttrekket', tags: ['brudd', 'fakta', 'hyp'],
      f: 'Utgiftslinjer per år faller fra ' + nf0.format(linesYear(2016)) + ' (2016) til ' + nf0.format(linesYear(2024)) + ' (2024). Dekning mot KOSTRA-kjøp faller fra ' + nf0.format(covPct[0] * 100) + ' % til ' + nf0.format(covPct[8] * 100) + ' %, mens KOSTRA-kjøpene øker.',
      h: 'Deler av fakturastrømmen (f.eks. e-faktura/EHF eller andre bilagsarter) er trolig bokført i serier som ikke er med i uttrekket. Kontroller uttrekkskriteriene i økonomisystemet.' },
    { y: 'Feb. 2025', t: 'Ny bilagsserie 82xxxxx', tags: ['brudd', 'fakta', 'hyp'],
      f: nf0.format(n82) + ' utgiftslinjer i ny serie fra februar 2025; antall linjer per måned øker fra om lag 140 til om lag 950. Dekning 2025: ' + nf0.format(covPct[9] * 100) + ' %.',
      h: 'Mulig systembytte eller ny fakturaflyt. 2025 er derfor ikke sammenlignbart med 2017–2024 i fakturagrunnlaget.' },
    { y: '2020', t: 'Ny kommunelov og nye økonomiforskrifter', tags: ['brudd', 'fakta'],
      f: 'Kommuneloven (2018) med ny forskrift om økonomiplan, årsbudsjett, årsregnskap og årsberetning gjelder fra budsjett- og regnskapsåret 2020. SSB opplyser om brudd i KOSTRA-gruppene mellom 2019 og 2020.' },
    { y: 'Des. 2020', t: 'Premieavvik −5,5 mill. kr (KLP)', tags: ['fakta'],
      f: 'Én linje på art 090 / funksjon 170 «Årets premieavvik» på −5 500 124 kr. Regnskapsmessig pensjonspost – ikke en reell reduksjon i kjøp.' },
    { y: '2021–2025', t: 'Store svingninger i pensjonspostene (pensjonskostnader)', tags: ['fakta'],
      f: 'KOSTRA funksjon 170 Årets premieavvik: ' + nf1.format(kf['170'].AGD10[7] / 1000) + ' mill. kr (2023); funksjon 173 Premiefond: ' + nf1.format(kf['173'].AGD10[5] / 1000) + ' mill. kr (2021). Gjør «Fellesutgifter og pensjon» negativ flere år.' },
    { y: '2024', t: 'KOSTRA: funksjon 254 delt i 257 og 258', tags: ['brudd', 'fakta'],
      f: 'Hjemmetjenester rapporteres fra 2024 på 257 (personellbase bofellesskap) og 258 (ambulerende). Funksjon 254 har ikke tall for 2024–2025. Tjenesteområdet «Pleie og omsorg» er sammenlignbart, enkeltfunksjonene ikke.' },
    { y: '2016 / 2025', t: 'Investeringer i skolelokaler (funksjon 222)', tags: ['fakta'],
      f: 'Investeringskjøp ekskl. mva: ' + nf1.format(inv222(2016) / 1e6) + ' mill. kr (2016) og ' + nf1.format(inv222(2025) / 1e6) + ' mill. kr (2025, hovedsakelig Fauskebygg A/S). Prosjektutgifter – ikke løpende nivå.' },
    { y: '2023–2024', t: 'Salg av næringsarealer (inntekter, holdt utenfor)', tags: ['fakta'],
      f: 'Art 670 salg av fast eiendom: ' + nf1.format((inc670['2023'] || 0) / 1e6) + ' mill. kr (2023) og ' + nf1.format((inc670['2024'] || 0) / 1e6) + ' mill. kr (2024). Inntektsarter (600–999) inngår ikke i utgiftsanalysen.' },
    { y: '2016–2023', t: 'Kjøp som erstatter egenproduksjon øker kraftig', tags: ['fakta', 'hyp'],
      f: 'KOSTRA AGD51: ' + nf1.format(ka.AGD51.v[0] / 1000) + ' mill. kr (2016) → ' + nf1.format(ka.AGD51.v[7] / 1000) + ' mill. kr (2023) → ' + nf1.format(ka.AGD51.v[9] / 1000) + ' mill. kr (2025). Kjøp fra andre (private), art 370: ' + nf1.format(ka.A370.v[0] / 1000) + ' → ' + nf1.format(ka.A370.v[7] / 1000) + ' mill. kr (2023).',
      h: 'Kan skyldes kjøp av private helse-, omsorgs- og vikartjenester og interkommunale løsninger (f.eks. barnevern via Bodø kommune). Bør avstemmes mot årsberetningene.' },
    { y: '2020–2023', t: 'Introduksjonsordningen (funksjon 275)', tags: ['fakta', 'hyp'],
      f: 'Brutto driftsutgifter ' + nf1.format(kf['275'].AGD10[4] / 1000) + ' mill. kr (2020) → ' + nf1.format(kf['275'].AGD10[7] / 1000) + ' mill. kr (2023).',
      h: 'Sannsynlig sammenheng med økt bosetting av flyktninger (bl.a. fra Ukraina fra 2022).' },
    { y: '2016–2025', t: 'Lønnsutgiftene driver totalveksten', tags: ['fakta', 'hyp'],
      f: 'Lønn ekskl. sykelønnsrefusjon (AG16): ' + nf1.format(ka.AG16.v[0] / 1000) + ' → ' + nf1.format(ka.AG16.v[9] / 1000) + ' mill. kr, ' + pct(ka.AG16.v[9] / ka.AG16.v[0] - 1) + ' nominelt / ' + pct(ka.AG16.v[9] / (ka.AG16.v[0] * KF[2016]) - 1) + ' realt.',
      h: 'Lønnsoppgjør over KPI og/eller flere årsverk – fordelingen må kontrolleres mot årsverkstall og årsberetninger.' }
  ];
  const tag = t => t === 'fakta' ? '<span class="badge fakta">Fakta</span>' : t === 'hyp' ? '<span class="badge hyp">Hypotese</span>' : '<span class="badge brudd">Brudd i serie</span>';
  $('#events').innerHTML = E.map(e => '<div class="event"><div class="yr">' + esc(e.y) + '</div><div><h4>' + esc(e.t) + ' ' + e.tags.map(tag).join(' ') + '</h4><p><b>Fakta:</b> ' + esc(e.f) + '</p>' + (e.h ? '<p><b>Hypotese:</b> ' + esc(e.h) + '</p>' : '') + '</div></div>').join('');
}
function renderMethod() {
  const m = D.meta;
  const kpiRows = YEARS.map(y => '<tr><td>' + y + '</td><td>' + nf1.format(KPI[y]) + '</td><td>' + nf2.format(KF[y]) + '</td><td>' + nf0.format(D.pop.jan1[y]) + '</td><td>' + nf0.format(POP[y]) + '</td></tr>').join('');
  const toRows = D.to.map(t => '<tr><td>' + esc(t.n) + '</td><td>' + esc(D.sektor[t.s].n) + '</td><td>' + esc(Array.isArray(t.f) ? t.f.join(', ') : t.f) + '</td></tr>').join('');
  $('#method').innerHTML =
    '<h3>Metode og definisjoner</h3>' +
    '<h4>Datagrunnlag</h4><ul>' +
    '<li><b>Ready2.xlsm</b>, ark «Grunn_data»: ' + nf0.format(m.rows_raw) + ' rader (fakturalinjer 2016–2025).</li>' +
    '<li>Utelatt: ' + m.rows_stray + ' rad uten periode/konto (sumrad ' + nf2.format(m.stray_sum) + ' kr) og ' + nf0.format(m.rows_income) + ' linjer med inntektsarter 600–999 (sum ' + nf1.format(m.income_sum / 1e6) + ' mill. kr).</li>' +
    '<li>Analysert: ' + nf0.format(m.rows_exp) + ' utgiftslinjer, ' + nf0.format(m.suppliers) + ' leverandørnavn.</li>' +
    '<li>Drift = 5-sifret konto (1xxxx), investering = 4-sifret konto. KOSTRA-art = sifre 2–4 (drift) eller 1–3 (investering).</li>' +
    '<li>Mva (art 429, kompensasjonsberettiget) holdes som standard utenfor, slik KOSTRA trekker ut art 729 i brutto driftsutgifter. Kan slås på i filteret.</li></ul>' +
    '<h4>Realverdi og per innbygger</h4><p>Faste 2025-kroner = beløp × KPI<sub>2025</sub> / KPI<sub>år</sub> (konsumprisindeks, årsgjennomsnitt, SSB 03014). Per innbygger = beløp / folkemengde 31.12. (= 1.1. året etter, SSB 07459), samme prinsipp som KOSTRA.</p>' +
    '<table class="kv"><thead><tr><th>År</th><th>KPI (2015=100)</th><th>Faktor til 2025-kr</th><th>Folkemengde 1.1.</th><th>Folkemengde 31.12.</th></tr></thead><tbody>' + kpiRows + '</tbody></table>' +
    '<h4>Tjenesteområder (egen KOSTRA-basert inndeling)</h4><p>Hver KOSTRA-funksjon tilhører nøyaktig ett område, slik at summene ikke dobbeltelles. Samme inndeling brukes for fakturagrunnlaget og KOSTRA-tallene. Kolonnen «Mottakergruppe» i Ready2 er beholdt som egen dimensjon.</p>' +
    '<div class="dtable-wrap" style="max-height:260px"><table class="dt"><thead><tr><th>Tjenesteområde</th><th>Sektor</th><th>Funksjoner</th></tr></thead><tbody>' + toRows + '</tbody></table></div>' +
    '<h4>Personvern</h4><p>' + m.persons + ' leverandørnavn som ser ut som privatpersoner (bl.a. mottakere av stønader, tilskudd og refusjoner) er slått sammen til «Privatpersoner (anonymisert)». Klassifiseringen er automatisk (navneregel) og kan inneholde enkelte feil; beløpene påvirkes ikke.</p>' +
    '<h4>Hva mangler</h4><ul>' +
    '<li><b>Budsjett 2026 / økonomiplan 2026–2029</b> finnes ikke i datagrunnlaget – se kommunens vedtatte budsjettdokument.</li>' +
    '<li><b>Renter og avdrag</b> (funksjon 870) inngår ikke i KOSTRA-tjenesteområdene – se SSB tabell 13543 (Økonomisk oversikt drift, fra 2020).</li>' +
    '<li><b>Årsregnskap og årsberetning</b> 2016–2025 er ikke brukt til avstemming. Anbefales særlig for 2017–2024, der fakturauttrekket er ufullstendig.</li>' +
    '<li>KOSTRA-gruppe 6 er gruppering gjeldende fra 2020 (SSB Klass 112); sammensetningen kan variere mellom år.</li></ul>' +
    '<h4>Kilder</h4><ul class="sources">' +
    '<li>Ready2.xlsm (fakturagrunnlag, Steigen kommune), 2016–2025.</li>' +
    '<li><a href="https://www.ssb.no/statbank/table/12362" target="_blank" rel="noopener">SSB tabell 12362</a> – Utgifter til tjenesteområdene, kommunekonsern, 2016–2025 (oppdatert ' + esc((D.kostra_meta.updated || '').slice(0, 10)) + ').</li>' +
    '<li><a href="https://www.ssb.no/statbank/table/12367" target="_blank" rel="noopener">SSB tabell 12367</a> – Detaljerte regnskapstall driftsregnskapet, kommunekasse, 2016–2025.</li>' +
    '<li><a href="https://www.ssb.no/statbank/table/03014" target="_blank" rel="noopener">SSB tabell 03014</a> – Konsumprisindeks, årsgjennomsnitt 2015–2025.</li>' +
    '<li><a href="https://www.ssb.no/statbank/table/07459" target="_blank" rel="noopener">SSB tabell 07459</a> – Folkemengde 1. januar, Steigen (1848), 2016–2026.</li>' +
    '<li><a href="https://www.ssb.no/klass/klassifikasjoner/112" target="_blank" rel="noopener">SSB Klass 112</a> – KOSTRA-kommunegruppering (Steigen = gruppe 6).</li></ul>';
}

/* =====================================================================
   KONTROLLER, NAVIGASJON, CHIPS
   ===================================================================== */
const PAGE_HEAD = {
  kategorier: ['Kategorianalyse', 'Første og siste år, nominell og reell endring, CAGR og andel – for KOSTRA-tall og fakturagrunnlaget.'],
  leverandorer: ['Leverandører', 'Hvem kommunen kjøper fra, konsentrasjon og bransjer. Klikk for å filtrere hele dashboardet.'],
  kostra: ['KOSTRA – offisielle regnskapstall', 'Brutto driftsutgifter for Steigen 2016–2025, etter art og tjenesteområde, sammenlignet med KOSTRA-gruppe 6, Nordland og landet uten Oslo. Filtrene gjelder ikke her.'],
  transaksjoner: ['Transaksjoner', 'Søk, sorter og eksporter fakturalinjene bak tallene.'],
  datakvalitet: ['Datakvalitet og metode', 'Dekningsgrad, brudd i seriene, hendelser, definisjoner og kilder.']
};
function setupControls() {
  const fy = $('#fYear');
  fy.innerHTML = '<option value="">Alle (2016–2025)</option>' + YEARS.slice().reverse().map(y => '<option value="' + y + '">' + y + '</option>').join('');
  const ft = $('#fTO');
  const order = D.sektor.map((s, si) => '<optgroup label="' + esc(s.n) + '">' + D.to.map((t, k) => t.s === si ? '<option value="' + k + '">' + esc(t.n) + '</option>' : '').join('') + '</optgroup>').join('');
  ft.innerHTML = '<option value="">Alle</option>' + order;
  fy.addEventListener('change', () => { S.year = fy.value ? Number(fy.value) : null; changed(); });
  $('#fQ').addEventListener('change', e => { S.q = e.target.value ? Number(e.target.value) : null; changed(); });
  ft.addEventListener('change', () => { S.to = ft.value !== '' ? Number(ft.value) : null; changed(); });
  $('#fReg').addEventListener('change', e => { S.reg = e.target.value; changed(); });
  $$('#fMeasure button').forEach(b => b.addEventListener('click', () => { S.measure = b.dataset.m; changed(); }));
  $('#fMva').addEventListener('change', e => { S.mva = e.target.checked; changed(); });
  $('#fReset').addEventListener('click', () => { Object.assign(S, { year: null, q: null, to: null, reg: '', measure: 'nom', mva: false, ag: null, vtg: null, lev: null }); S.tx.q = ''; $('#txSearch').value = ''; S.levQ = ''; $('#levSearch').value = ''; changed(); });
  $$('#trendGran button').forEach(b => b.addEventListener('click', () => { S.gran = b.dataset.g; $$('#trendGran button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderTrend(); }));
  $$('#catSrc button').forEach(b => b.addEventListener('click', () => { S.cat.src = b.dataset.s; updateFilterVisibility(); renderCategories(); renderChips(); }));
  $('#catDim').addEventListener('change', e => { S.cat.dim = e.target.value; renderCategories(); });
  $('#catFrom').addEventListener('change', e => { S.cat.from = Number(e.target.value); if (S.cat.to <= S.cat.from) S.cat.to = Math.min(2025, S.cat.from + 1); renderCategories(); });
  $('#catTo').addEventListener('change', e => { S.cat.to = Number(e.target.value); if (S.cat.from >= S.cat.to) S.cat.from = Math.max(2016, S.cat.to - 1); renderCategories(); });
  $$('#heatMode button').forEach(b => b.addEventListener('click', () => { S.heat = b.dataset.h; $$('#heatMode button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderCategories(); }));
  $$('#kArtMode button').forEach(b => b.addEventListener('click', () => { S.kArt = b.dataset.a; $$('#kArtMode button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderKostra(); }));
  $$('#kCmpArt button').forEach(b => b.addEventListener('click', () => { S.kCmpArt = b.dataset.k; $$('#kCmpArt button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderKostra(); }));
  const ky = $('#kCmpYear'); ky.innerHTML = YEARS.slice().reverse().map(y => '<option' + (y === S.kCmpYear ? ' selected' : '') + '>' + y + '</option>').join('');
  ky.addEventListener('change', () => { S.kCmpYear = Number(ky.value); renderKostra(); });
  let t1; $('#txSearch').addEventListener('input', e => { clearTimeout(t1); t1 = setTimeout(() => { S.tx.q = e.target.value; S.tx.page = 0; renderTx(); }, 220); });
  $('#txCsv').addEventListener('click', exportCsv);
  let t2; $('#levSearch').addEventListener('input', e => { clearTimeout(t2); t2 = setTimeout(() => { S.levQ = e.target.value; renderLevTable(levAgg()); }, 200); });
  $$('.pagenav button').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  document.addEventListener('click', e => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); go(a.dataset.goto); } });
  $('#tree').addEventListener('click', e => {
    const tg = e.target.closest('.tg');
    if (tg) { const v = Number(tg.dataset.t); if (S.open.has(v)) S.open.delete(v); else S.open.add(v); renderTree(); return; }
    const tr = e.target.closest('tr.grp'); if (tr) { const v = Number(tr.dataset.v); S.vtg = S.vtg === v ? null : v; S.open.add(v); changed(); }
  });
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  let rt, lastW = window.innerWidth; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 120) { lastW = window.innerWidth; renderPage(); } else resizeAll(); }, 180); });
}
function syncControls() {
  $('#fYear').value = S.year === null ? '' : String(S.year);
  $('#fQ').value = S.q === null ? '' : String(S.q);
  $('#fTO').value = S.to === null ? '' : String(S.to);
  $('#fReg').value = S.reg;
  $('#fMva').checked = S.mva;
  $$('#fMeasure button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === S.measure)));
  [['#fYear', S.year !== null], ['#fQ', S.q !== null], ['#fTO', S.to !== null], ['#fReg', !!S.reg]].forEach(([s, on]) => $(s).parentElement.classList.toggle('active', on));
  renderChips();
}
function renderChips() {
  const c = [];
  if (S.year !== null) c.push(['year', 'År', S.year]);
  if (S.q !== null) c.push(['q', 'Kvartal', 'K' + S.q]);
  if (S.to !== null) c.push(['to', 'Tjenesteområde', D.to[S.to].n]);
  if (S.reg) c.push(['reg', 'Regnskap', S.reg === 'drift' ? 'Drift' : 'Investering']);
  if (S.ag !== null) c.push(['ag', 'Art', D.ag[S.ag].n]);
  if (S.vtg !== null) c.push(['vtg', 'Vare-/tjenestegruppe', D.vtg[S.vtg]]);
  if (S.lev !== null) c.push(['lev', 'Leverandør', D.lev[S.lev].n]);
  const host = $('#chips');
  const pageUses = ['oversikt', 'leverandorer', 'transaksjoner'].includes(S.page) || (S.page === 'kategorier' && S.cat.src === 'faktura');
  host.innerHTML = pageUses ? c.map(([k, l, v]) => '<span class="chip"><b>' + esc(l) + ':</b> ' + esc(v) + '<button type="button" data-k="' + k + '" aria-label="Fjern filter">✕</button></span>').join('') : '';
  $$('button', host).forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; S[k] = k === 'reg' ? '' : null; changed(); }));
}
function changed() { syncControls(); renderPage(); }
function go(p) {
  S.page = p;
  $$('.pagenav button').forEach(b => { if (b.dataset.page === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('.page').forEach(s => s.classList.toggle('active', s.id === 'p-' + p));
  const host = $('#toolbarLeft');
  if (p === 'oversikt') { host.innerHTML = ''; }
  else { const h = PAGE_HEAD[p]; host.innerHTML = '<div class="page-head"><h2>' + esc(h[0]) + '</h2><p>' + esc(h[1]) + '</p></div>'; }
  updateFilterVisibility();
  try { history.replaceState(null, '', '#' + p); } catch (e) { /* file:// */ }
  renderChips();
  renderPage(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function updateFilterVisibility() {
  const p = S.page;
  $('#filters').classList.toggle('hidden', p === 'kostra' || p === 'datakvalitet' || (p === 'kategorier' && S.cat.src === 'kostra'));
}
function renderPage(animate) {
  const p = S.page;
  if (p === 'oversikt') { renderKpis(animate); renderOvWarn(); renderBars(); renderDonut(); renderTree(); renderTrend(); }
  else if (p === 'kategorier') renderCategories();
  else if (p === 'leverandorer') renderSuppliers();
  else if (p === 'kostra') renderKostra();
  else if (p === 'transaksjoner') renderTx();
  else if (p === 'datakvalitet') renderQuality();
  renderChips();
  requestAnimationFrame(resizeAll);
}
function resizeAll() { Object.keys(charts).forEach(id => { const el = document.getElementById(id); if (el && el.offsetParent !== null) charts[id].resize(); }); }

/* =====================================================================
   INTRO
   ===================================================================== */
function intro(skipIntro) {
  const box = $('#intro'), v = $('#introVideo'), bar = $('#introProgress');
  let done = false;
  const end = () => {
    if (done) return; done = true;
    box.classList.add('outro');
    document.body.classList.remove('intro-active');
    setTimeout(() => { document.body.classList.add('revealed'); renderPage(true); }, 250);
    setTimeout(() => { box.remove(); resizeAll(); }, 1100);
  };
  if (skipIntro || !v) { box.style.display = 'none'; done = true; document.body.classList.remove('intro-active'); document.body.classList.add('revealed'); renderPage(true); return; }
  v.addEventListener('timeupdate', () => { if (v.duration) bar.style.width = (v.currentTime / v.duration * 100) + '%'; });
  v.addEventListener('ended', end);
  v.addEventListener('error', end);
  const srcs = v.querySelectorAll('source'); if (srcs.length) srcs[srcs.length - 1].addEventListener('error', end);
  $('#introSkip').addEventListener('click', end);
  document.addEventListener('keydown', e => { if (!done && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); end(); } });
  $('#introPlay').addEventListener('click', () => { box.classList.remove('needs-click'); v.play().catch(end); });
  const p = v.play();
  if (p && p.catch) p.catch(() => box.classList.add('needs-click'));
  setTimeout(() => { if (!done && !box.classList.contains('needs-click')) end(); }, 15000);
}

/* =====================================================================
   OPPSTART
   ===================================================================== */
function init() {
  let t = null; try { t = localStorage.getItem('gpsi-theme'); } catch (e) { /* ignore */ }
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  readColors(); themeIcon();
  $('#genDate').textContent = 'generert ' + D.meta.generated;
  setupControls(); syncControls();
  const skip = /nointro|intro=0/.test(location.hash + location.search);
  const h = (location.hash || '').replace('#', '').split(/[&?]/)[0];
  if (PAGE_HEAD[h]) go(h); else renderPage(false);
  intro(skip);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
