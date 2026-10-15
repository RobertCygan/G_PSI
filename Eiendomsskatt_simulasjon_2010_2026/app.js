/* =========================================================================
   DATA – aggregates prepared in Python from Basisdata.xlsm (table "Data").
   cells: [år, krets_nr|"UK", fritakklasse, sumSkatt, antall, sumTakst,
           sumGrunnlag, sumAreal(rader med areal), antallMedAreal, sumSkatt(rader med areal)]
   fritakklasse: 0 = "Ingen" (skattepliktig), 1 = §-fritak, 2 = ikke oppgitt i kilden
   Only aggregates are embedded – no property-level rows.
   ========================================================================= */
const MIN_COUNT = DATA.minCount;
const YEARS = DATA.years;
const KRETSER = DATA.kretser;                 // [{nr, navn, lab:[lon,lat]}]
const KNAME = Object.fromEntries(KRETSER.map(k => [k.nr, k.navn]));
KNAME.UK = 'Uten krets';

/* Index: year -> krets -> fritakklasse -> measures */
const IDX = {};
for (const [y, k, f, s, n, t, g, a, na, sa] of DATA.cells) {
  ((IDX[y] ??= {})[k] ??= {})[f] = { s, n, t, g, a, na, sa };
}
const EMPTY = () => ({ s: 0, n: 0, t: 0, g: 0, a: 0, na: 0, sa: 0, nEx: 0, nAll: 0 });

/* Aggregate one krets (or all) for a year under the current fritak filter. */
function agg(year, krets) {
  const out = EMPTY();
  const ks = krets ? [krets] : Object.keys(IDX[year] || {});
  const classes = { all: [0, 1, 2], tax: [0], ex: [1] }[STATE.fritak];
  for (const k of ks) {
    const cell = IDX[year]?.[k]; if (!cell) continue;
    for (const f of [0, 1, 2]) {
      const c = cell[f]; if (!c) continue;
      out.nAll += c.n; if (f === 1) out.nEx += c.n;
      if (!classes.includes(+f)) continue;
      out.s += c.s; out.n += c.n; out.t += c.t; out.g += c.g; out.a += c.a; out.na += c.na; out.sa += c.sa;
    }
  }
  return out;
}

/* =========================================================================
   STATE – single source of truth; every visual derives from it.
   ========================================================================= */
const STATE = {
  year: YEARS[YEARS.length - 1],
  selected: null,            // krets nr or null
  colorMetric: 'skatt',
  heightMetric: 'm2',        // Initial pair shown in the requested reference.
  colorCategory: 'all',
  heightCategory: 'all',
  fritak: 'all',
  fixedScale: true,
  quantile: false,
  exag: 1,
  is3d: true,
  playing: false,
  chartView: 'line',
  sort: { k: 'skatt', dir: -1 },
};

/* =========================================================================
   METRICS registry – add a new metric by adding an entry here.
   value(cur, prev) returns a number or null ("Ingen data").
   ========================================================================= */
const METRICS = {
  skatt:    { label: 'Total eiendomsskatt', unit: 'kr', value: c => c.n ? c.s : null },
  antall:   { label: 'Antall eiendommer', unit: 'n', value: c => c.n || null },
  snitt:    { label: 'Gjennomsnittlig skatt per eiendom', unit: 'kr', value: c => c.n ? c.s / c.n : null },
  grunnlag: { label: 'Takstgrunnlag (skattegrunnlag)', unit: 'kr', value: c => c.n ? c.g : null },
  takst:    { label: 'Takst (før reduksjonsfaktor)', unit: 'kr', value: c => c.n ? c.t : null },
  m2:       { label: 'Skatt per m²', unit: 'kr/m2', caveat: 'Areal er ufullstendig og gjelder 2026-data',
              value: c => c.a > 0 ? c.sa / c.a : null },
  areal:    { label: 'Bruksareal totalt', unit: 'm2', caveat: 'Areal er ufullstendig og gjelder 2026-data',
              value: c => c.a > 0 ? c.a : null },
  fritak:   { label: 'Andel fritatte eiendommer', unit: 'pct', value: c => c.nAll ? 100 * c.nEx / c.nAll : null },
  dKr:      { label: 'Endring fra året før (kr)', unit: 'kr', diverging: true,
              value: (c, p) => (c.n && p && p.n) ? c.s - p.s : null },
  dPct:     { label: 'Endring fra året før (%)', unit: 'pct', diverging: true,
              value: (c, p) => (c.n && p && p.s) ? 100 * (c.s - p.s) / p.s : null },
  bygningstype: { label: 'Bygningstype', unit: 'n', building: true },
  bygningsstatus: { label: 'Bygningsstatus', unit: 'n', building: true },
};
const HEIGHT_NONE = 'none';

function isBuildingMetric(id) { return !!METRICS[id]?.building; }
function categoryFor(id) { return id === STATE.colorMetric ? STATE.colorCategory : STATE.heightCategory; }
function buildingCategory(id, category) {
  return BUILDINGS.groups[id]?.categories.find(c => c.id === category);
}
function metricLabel(id, category = categoryFor(id)) {
  if (!isBuildingMetric(id)) return METRICS[id].label;
  return METRICS[id].label + ': ' + (buildingCategory(id, category)?.label || 'Alle kategorier');
}

/* Metric value for a krets (or whole municipality) in a year. */
function metricValue(id, year, krets, category = categoryFor(id)) {
  const m = METRICS[id];
  if (m.building) {
    const group = BUILDINGS.groups[id];
    const counts = category === 'all' ? group.totals : buildingCategory(id, category)?.counts;
    if (!counts) return null;
    return krets ? (counts[krets] ?? null) : Object.values(counts).reduce((a, b) => a + b, 0);
  }
  const cur = agg(year, krets);
  const prev = YEARS.includes(year - 1) ? agg(year - 1, krets) : null;
  return m.value(cur, prev);
}

/* =========================================================================
   FORMAT – Norwegian Bokmål
   ========================================================================= */
const nf0 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NBSP = ' ';
function fmt(v, unit, signed = false) {
  if (v == null || !isFinite(v)) return 'Ingen data';
  const sign = v < 0 ? '−' : (signed && v > 0 ? '+' : '');
  const av = Math.abs(v);
  switch (unit) {
    case 'kr': return sign + nf0.format(av) + NBSP + 'kr';
    case 'kr/m2': return sign + nf0.format(av) + NBSP + 'kr/m²';
    case 'm2': return sign + nf0.format(av) + NBSP + 'm²';
    case 'pct': return sign + nf1.format(av) + NBSP + '%';
    default: return sign + nf0.format(av);
  }
}
function fmtShort(v, unit) {  // compact for legend ticks / axis
  if (v == null) return '–';
  const sign = v < 0 ? '−' : '';
  const av = Math.abs(v);
  let s;
  if (unit === 'pct') s = nf1.format(av) + ' %';
  else if (av >= 1e6) s = nf1.format(av / 1e6) + ' mill.';
  else if (av >= 1e3) s = nf0.format(av / 1e3) + ' k';
  else s = nf0.format(av);
  return sign + s;
}

/* =========================================================================
   COLOUR – sequential (viridis-type, colour-blind safe) and diverging (blue–orange).
   ========================================================================= */
const SEQ = ['#2a1f5e', '#3b3f8a', '#2f6594', '#2a8a8c', '#44ab78', '#92c75a', '#e4d84a'];
const DIV = ['#2b6fcf', '#6ea3e0', '#c7d4e2', '#e2a97a', '#e0632b'];
function hex2rgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function lerpColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - i;
  const a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
  return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * f)).join(',')})`;
}
const NODATA = '#2a3242';

/* Build the colour scale for the current state: returns {color(v), ticks, type}. */
function buildScale(id) {
  const m = METRICS[id];
  const years = m.building ? [STATE.year] : STATE.fixedScale ? YEARS : [STATE.year];
  const vals = [];
  for (const y of years) for (const k of KRETSER) { const v = metricValue(id, y, k.nr); if (v != null) vals.push(v); }
  if (!vals.length) return { color: () => NODATA, ticks: [], type: 'none' };
  vals.sort((a, b) => a - b);
  // Clamp the domain to the 2nd–98th percentile so a few tiny kretser do not wash out the map
  const pct = p => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  if (m.diverging) {
    const abs = vals.map(Math.abs).sort((a, b) => a - b);
    const mx = abs[Math.round(0.98 * (abs.length - 1))] || 1;
    return { type: 'div', min: -mx, max: mx, color: v => v == null ? NODATA : lerpColor(DIV, (v + mx) / (2 * mx)),
             clamped: true, ticks: [-mx, 0, mx] };
  }
  const min = pct(0.02), max = pct(0.98);
  if (STATE.quantile && vals.length >= 7) {
    const q = p => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const breaks = [1, 2, 3, 4, 5, 6].map(i => q(i / 7));
    return { type: 'quant', min, max, breaks,
      color: v => { if (v == null) return NODATA; let c = 0; while (c < 6 && v >= breaks[c]) c++; return SEQ[c]; },
      ticks: [min, breaks[2], max] };
  }
  const span = (max - min) || 1;
  return { type: 'lin', min, max, clamped: true, color: v => v == null ? NODATA : lerpColor(SEQ, (v - min) / span), ticks: [min, (min + max) / 2, max] };
}

/* =========================================================================
   MAP – MapLibre GL, fill-extrusion for height, fill for colour.
   ========================================================================= */
let map = null, mapReady = false, markers = [];
const labelHeights = new Map();
let labelMatrix = null;
const BOUNDS = [[13.55, 67.55], [15.95, 68.15]];
const HEIGHT_MAX = 5500; // metres at exaggeration 1

function initMap() {
  if (!window.maplibregl) {
    document.getElementById('nomap').style.display = 'grid'; return;
  }
  try {
    map = new maplibregl.Map({
      container: 'map', attributionControl: false, antialias: true,
      style: {
        version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } }],
      },
      bounds: BOUNDS, fitBoundsOptions: { padding: { top: 120, bottom: 90, left: 70, right: 60 } },
      pitch: 40, bearing: -12, maxPitch: 70, minZoom: 6, maxZoom: 12,
    });
  } catch (e) { document.getElementById('nomap').style.display = 'grid'; return; }

  map.on('error', e => {
    console.warn('Kartfeil', e?.error?.message || e);
    if (e.sourceId === 'basemap') document.getElementById('basemapStatus').textContent = 'Bakgrunnskart utilgjengelig · ';
  });
  map.on('load', () => {
    map.addSource('kretser', { type: 'geojson', data: GEO, promoteId: 'nr' });
    map.addLayer({ id: 'fill', type: 'fill', source: 'kretser',
      paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], NODATA], 'fill-opacity': 0.85, 'fill-antialias': false } });
    map.addLayer({ id: 'ext', type: 'fill-extrusion', source: 'kretser',
      paint: { 'fill-extrusion-color': ['coalesce', ['feature-state', 'color'], NODATA],
               'fill-extrusion-height': ['coalesce', ['feature-state', 'h'], 0],
               'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
    // No boundary layer. Names are projected onto each extrusion's roof.
    for (const k of KRETSER) {
      const el = document.createElement('div'); el.className = 'lbl-marker'; el.textContent = k.navn;
      el.dataset.nr = k.nr;
      map.getContainer().appendChild(el);
      markers.push({ el, nr: k.nr, lab: k.lab });
    }
    // MapLibre 4.7.1 supplies the Mercator-to-clip matrix on every rendered frame.
    // Using it also follows zoom, pitch, rotation, resize and animated camera moves.
    map.addLayer({ id: 'roof-labels', type: 'custom', renderingMode: '3d',
      render(_gl, matrix) { labelMatrix = matrix; updateLabels(); } });
    mapReady = true;
    renderMap(); updateLabels();
    addBasemap();
  });

  // Hover tooltip + click (works for both the flat fill and the 3D extrusion layer)
  let hovered = null;
  const tip = document.getElementById('tip');
  const featAt = p => map.queryRenderedFeatures(p, { layers: ['fill', 'ext'] })[0];
  const clearHover = () => {
    if (hovered) map.setFeatureState({ source: 'kretser', id: hovered }, { hover: false });
    hovered = null; map.getCanvas().style.cursor = ''; tip.style.display = 'none';
  };
  map.on('mousemove', e => {
    const f = featAt(e.point);
    if (!f) return clearHover();
    const id = f.properties.nr;
    if (hovered !== id) {
      if (hovered) map.setFeatureState({ source: 'kretser', id: hovered }, { hover: false });
      hovered = id; map.setFeatureState({ source: 'kretser', id }, { hover: true });
    }
    map.getCanvas().style.cursor = 'pointer';
    tip.innerHTML = tooltipHTML(id);
    tip.style.display = 'block';
    const wrap = document.getElementById('mapwrap').getBoundingClientRect();
    let x = e.point.x + 16, y = e.point.y + 16;
    if (x + tip.offsetWidth > wrap.width - 8) x = e.point.x - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > wrap.height - 8) y = e.point.y - tip.offsetHeight - 12;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  map.on('mouseout', clearHover);
  map.on('click', e => { const f = featAt(e.point); if (!f) return; const id = f.properties.nr; select(STATE.selected === id ? null : id); });
  map.on('zoom', updateLabels); map.on('resize', updateLabels);
}

// Independent context layer, drawn below the existing Steigen layers.
// It never participates in selection, measures, extrusion heights or labels.
function addBasemap() {
  try {
    map.setPaintProperty('bg', 'background-color', '#0b1621');
    map.addSource('basemap', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    map.addLayer({ id: 'base-landcover', type: 'fill', source: 'basemap', 'source-layer': 'landcover',
      paint: { 'fill-color': '#172831', 'fill-opacity': 0.6 } }, 'fill');
    map.addLayer({ id: 'base-water', type: 'fill', source: 'basemap', 'source-layer': 'water',
      paint: { 'fill-color': '#07151f' } }, 'fill');
    map.addLayer({ id: 'base-roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 7,
      paint: { 'line-color': '#3b4a53', 'line-width': 0.7, 'line-opacity': 0.65 } }, 'fill');
  } catch (error) {
    console.warn('Bakgrunnskart', error);
    document.getElementById('basemapStatus').textContent = 'Bakgrunnskart utilgjengelig · ';
  }
}

function tooltipHTML(id) {
  const y = STATE.year, cur = agg(y, id), prev = YEARS.includes(y - 1) ? agg(y - 1, id) : null;
  const row = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
  const dKr = METRICS.dKr.value(cur, prev), dPct = METRICS.dPct.value(cur, prev);
  const chg = dKr == null ? 'Ingen data' : `<span class="${dKr < 0 ? 'neg' : 'pos'}">${fmt(dKr, 'kr', true)} (${fmt(dPct, 'pct', true)})</span>`;
  let h = `<div class="n">${KNAME[id]}<span>${y}</span></div><dl>`;
  h += row('Total eiendomsskatt', fmt(METRICS.skatt.value(cur), 'kr'));
  h += row('Antall eiendommer', fmt(METRICS.antall.value(cur), 'n'));
  h += row('Gjennomsnitt per eiendom', fmt(METRICS.snitt.value(cur), 'kr'));
  h += row('Endring fra året før', chg);
  // Colour/height metrics, only when they are not already among the four standard rows
  const std = ['skatt', 'antall', 'snitt', 'dKr', 'dPct'];
  const extra = [];
  if (!std.includes(STATE.colorMetric)) extra.push(['Farge', STATE.colorMetric]);
  if (STATE.heightMetric !== HEIGHT_NONE && !std.includes(STATE.heightMetric) && STATE.heightMetric !== STATE.colorMetric) extra.push(['Høyde', STATE.heightMetric]);
  if (extra.length) h += '<div class="sep"></div>';
  if (STATE.heightMetric === STATE.colorMetric && isBuildingMetric(STATE.heightMetric) && STATE.heightCategory !== STATE.colorCategory) extra.push(['Høyde', STATE.heightMetric]);
  for (const [role, mid] of extra) {
    const category = role === 'Farge' ? STATE.colorCategory : STATE.heightCategory;
    h += row(role + ': ' + metricLabel(mid, category), fmt(metricValue(mid, y, id, category), METRICS[mid].unit, METRICS[mid].diverging));
  }
  if (isBuildingMetric(STATE.colorMetric) || isBuildingMetric(STATE.heightMetric)) h += '<div class="warn">Bygg: antall registreringer · tilstand i kildefilen</div>';
  if (cur.n > 0 && cur.n < MIN_COUNT) h += `<div class="warn">⚠ få eiendommer (${cur.n})</div>`;
  if (cur.n === 0) h += `<div class="warn">Ingen eiendommer i utvalget</div>`;
  return h + '</dl>';
}

function renderMap() {
  if (!mapReady) return;
  const cs = buildScale(STATE.colorMetric);
  let hs = null;
  if (STATE.heightMetric !== HEIGHT_NONE) {
    const years = isBuildingMetric(STATE.heightMetric) ? [STATE.year] : STATE.fixedScale ? YEARS : [STATE.year];
    let mx = 0;
    for (const y of years) for (const k of KRETSER) { const v = metricValue(STATE.heightMetric, y, k.nr, STATE.heightCategory); if (v != null) mx = Math.max(mx, Math.abs(v)); }
    hs = { mx: mx || 1, div: !!METRICS[STATE.heightMetric].diverging };
  }
  for (const k of KRETSER) {
    const cv = metricValue(STATE.colorMetric, STATE.year, k.nr);
    let h = 0;
    if (hs) { const hv = metricValue(STATE.heightMetric, STATE.year, k.nr, STATE.heightCategory); if (hv != null) h = Math.abs(hv) / hs.mx * HEIGHT_MAX * STATE.exag; }
    map.setFeatureState({ source: 'kretser', id: k.nr }, { color: cs.color(cv), h, sel: STATE.selected === k.nr });
    labelHeights.set(k.nr, STATE.is3d && hs ? h : 0);
  }
  map.setLayoutProperty('ext', 'visibility', STATE.is3d && STATE.heightMetric !== HEIGHT_NONE ? 'visible' : 'none');
  map.setLayoutProperty('fill', 'visibility', STATE.is3d && STATE.heightMetric !== HEIGHT_NONE ? 'none' : 'visible');
  updateLabels();
  renderLegend(cs);
}

function renderLegend(cs) {
  const m = METRICS[STATE.colorMetric];
  const el = document.getElementById('legend');
  let bar;
  if (cs.type === 'div') bar = `linear-gradient(90deg,${DIV.join(',')})`;
  else if (cs.type === 'quant') bar = `linear-gradient(90deg,${SEQ.map((c, i) => `${c} ${i / 7 * 100}% ${(i + 1) / 7 * 100}%`).join(',')})`;
  else bar = `linear-gradient(90deg,${SEQ.join(',')})`;
  const ticks = cs.ticks.map((t, i) => `<span>${cs.clamped && i === 0 ? '≤ ' : cs.clamped && i === cs.ticks.length - 1 ? '≥ ' : ''}${fmtShort(t, m.unit)}</span>`).join('');
  let h = `<div class="t">Farge: ${metricLabel(STATE.colorMetric, STATE.colorCategory)}</div><div class="bar" style="background:${bar}"></div><div class="ticks">${ticks}</div>`;
  h += `<div class="h">Høyde = ${STATE.heightMetric === HEIGHT_NONE ? 'ingen (flatt kart)' : metricLabel(STATE.heightMetric, STATE.heightCategory)}</div>`;
  h += `<div class="h" style="border:0;padding-top:2px">${m.building ? 'Antall registreringer · tilstand i kildefilen' : STATE.fixedScale ? 'Fast skala ' + YEARS[0] + '–' + YEARS[YEARS.length - 1] : 'Skala for ' + STATE.year}${cs.type === 'quant' ? ' · kvantiler' : ''}</div>`;
  if (m.building || isBuildingMetric(STATE.heightMetric)) h += '<div class="caveat">Byggdata har ingen årsserie. År og fritak endrer bare skattetallene.</div>';
  const cav = m.caveat || (STATE.heightMetric !== HEIGHT_NONE && METRICS[STATE.heightMetric].caveat);
  if (cav) h += `<div class="caveat">⚠ ${cav}</div>`;
  el.innerHTML = h;
}

function updateLabels() {
  if (!map || !labelMatrix) return;
  const container = map.getContainer(), w = container.clientWidth, h = container.clientHeight;
  const m = labelMatrix;
  // In MapLibre 4.x fill-extrusion heights use metres at the camera centre's
  // latitude. Use that same conversion so roof and label coincide exactly.
  const metre = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 1).z;
  for (const { el, nr, lab } of markers) {
    const altitude = labelHeights.get(nr) || 0;
    const p = maplibregl.MercatorCoordinate.fromLngLat(lab, 0);
    p.z = altitude * metre;
    const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    const px = (x / cw + 1) * w / 2, py = (1 - y / cw) * h / 2;
    const hidden = cw <= 0 || z / cw < -1 || z / cw > 1 || px < -80 || px > w + 80 || py < -40 || py > h + 40;
    el.classList.toggle('hidden', hidden);
    el.classList.toggle('selected', nr === STATE.selected);
    el.dataset.altitude = String(altitude);
    if (!hidden) el.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px)`;
  }
}

/* =========================================================================
   CHARTS – Chart.js line (development) and stacked bars (top 8 + Andre)
   ========================================================================= */
let chart = null;
const yearLinePlugin = {   // vertical line at selected year + "Stort hopp 2019"
  id: 'yearLine',
  afterDatasetsDraw(c) {
    if (c.config.type !== 'line') return;
    const x = c.scales.x, y = c.scales.y, ctx = c.ctx;
    const i = YEARS.indexOf(STATE.year);
    if (i >= 0) {
      const px = x.getPixelForValue(i);
      ctx.save(); ctx.strokeStyle = 'rgba(240,182,74,.85)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke(); ctx.restore();
    }
    const j = YEARS.indexOf(2019);
    if (j >= 0 && ['skatt', 'grunnlag', 'takst', 'snitt'].includes(STATE.colorMetric)) {
      const px = x.getPixelForValue(j);
      ctx.save(); ctx.fillStyle = 'rgba(147,161,186,.9)'; ctx.font = '11px IBM Plex Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Stort hopp 2019', px, y.top + 10); ctx.restore();
    }
  },
};
Chart.register(yearLinePlugin);
Chart.defaults.color = '#93a1ba'; Chart.defaults.font.family = 'IBM Plex Sans, sans-serif'; Chart.defaults.font.size = 11;

function renderChart() {
  const ctx = document.getElementById('chart');
  const m = METRICS[STATE.colorMetric];
  document.getElementById('chartHeading').textContent = m.building ? 'Fordeling' : 'Utvikling';
  document.getElementById('chartViews').hidden = !!m.building;
  document.getElementById('chartMetricName').textContent = '· ' + metricLabel(STATE.colorMetric);
  ctx.setAttribute('aria-label', m.building ? 'Antall bygningsregistreringer per grunnkrets' : 'Utvikling over tid');
  const grid = { color: 'rgba(38,51,73,.8)' };
  let cfg;
  if (m.building) {
    // A register snapshot must not be presented as a fabricated historical series.
    const rows = [...KRETSER, { nr: 'UK', navn: 'Uten krets' }].map(k => ({ ...k, value: metricValue(STATE.colorMetric, STATE.year, k.nr) }));
    rows.sort((a, b) => b.value - a.value);
    cfg = { type: 'bar', data: { labels: rows.map(r => r.navn), datasets: [{ label: 'Antall registreringer', data: rows.map(r => r.value), backgroundColor: rows.map(r => r.nr === STATE.selected ? '#f0b64a' : '#44ab78') }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y, 'n') + ' registreringer' } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 65, minRotation: 45, font: { size: 9 } } }, y: { beginAtZero: true, grid, ticks: { precision: 0 } } } } };
  } else if (STATE.chartView === 'line') {
    const vals = YEARS.map(y => metricValue(STATE.colorMetric, y, STATE.selected));
    cfg = { type: 'line',
      data: { labels: YEARS.map(String), datasets: [{ label: STATE.selected ? KNAME[STATE.selected] : 'Hele kommunen', data: vals,
        borderColor: '#f0b64a', backgroundColor: 'rgba(240,182,74,.14)', fill: true, tension: .25, spanGaps: false,
        pointRadius: YEARS.map(y => y === STATE.year ? 5 : 2.5), pointBackgroundColor: '#f0b64a' }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y, m.unit, m.diverging) } } },
        scales: { x: { grid: { display: false } }, y: { grid, ticks: { callback: v => fmtShort(v, m.unit) }, beginAtZero: !m.diverging } } } };
  } else {
    // Top 8 kretser by colour metric in selected year, rest as "Andre"; stacked over years (sum-type metrics only make sense)
    const sumType = ['skatt', 'antall', 'grunnlag', 'takst', 'areal', 'dKr'].includes(STATE.colorMetric) ? STATE.colorMetric : 'skatt';
    const mm = METRICS[sumType];
    const ranked = KRETSER.map(k => ({ nr: k.nr, v: metricValue(sumType, STATE.year, k.nr) ?? -Infinity })).sort((a, b) => b.v - a.v);
    const top = ranked.slice(0, 8).map(r => r.nr), rest = ranked.slice(8).map(r => r.nr);
    const pal = ['#e4d84a', '#b9d35a', '#92c75a', '#5fb979', '#44ab78', '#2a8a8c', '#2f6594', '#3b3f8a'];
    const ds = top.map((nr, i) => ({ label: KNAME[nr], data: YEARS.map(y => metricValue(sumType, y, nr) ?? 0), backgroundColor: pal[i], stack: 's' }));
    ds.push({ label: 'Andre', data: YEARS.map(y => rest.reduce((acc, nr) => acc + (metricValue(sumType, y, nr) ?? 0), 0)), backgroundColor: '#4a5670', stack: 's' });
    ds.push({ label: 'Uten krets', data: YEARS.map(y => metricValue(sumType, y, 'UK') ?? 0), backgroundColor: '#6b7792', stack: 's' });
    document.getElementById('chartMetricName').textContent = '· ' + mm.label + ' (topp 8 + andre)';
    cfg = { type: 'bar', data: { labels: YEARS.map(String), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, font: { size: 10 } } },
                   tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y, mm.unit) } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid, ticks: { callback: v => fmtShort(v, mm.unit) } } } } };
  }
  if (chart) chart.destroy();
  chart = new Chart(ctx, cfg);
}

/* =========================================================================
   KPI + TABLE
   ========================================================================= */
function renderKPIs() {
  const y = STATE.year, cur = agg(y, STATE.selected), prev = YEARS.includes(y - 1) ? agg(y - 1, STATE.selected) : null;
  const dKr = METRICS.dKr.value(cur, prev), dPct = METRICS.dPct.value(cur, prev);
  const few = cur.n > 0 && cur.n < MIN_COUNT ? ` <span class="few">⚠ få eiendommer</span>` : '';
  const cards = [
    { k: 'Total eiendomsskatt', v: fmt(METRICS.skatt.value(cur), 'kr'), d: `År ${y}` + few },
    { k: 'Antall eiendommer', v: fmt(METRICS.antall.value(cur), 'n'), d: 'skatteobjekter (rader i skattelisten)' },
    { k: 'Gjennomsnittlig skatt per eiendom', v: fmt(METRICS.snitt.value(cur), 'kr'), d: 'total / antall' },
    { k: 'Endring fra året før', v: fmt(dKr, 'kr', true), d: dPct == null ? (prev ? 'Ingen data' : `${YEARS[0]} er første år`) : fmt(dPct, 'pct', true) + ` mot ${y - 1}`, cls: dKr == null ? '' : dKr < 0 ? 'neg' : 'pos' },
  ];
  document.getElementById('kpis').innerHTML = cards.map(c => `<div class="kpi"><div class="k">${c.k}</div><div class="v num ${c.cls || ''}">${c.v}</div><div class="d">${c.d}</div></div>`).join('');
  document.getElementById('scopeTitle').textContent = STATE.selected ? KNAME[STATE.selected] : 'Hele kommunen';
  const fl = { all: 'alle eiendommer', tax: 'kun skattepliktige', ex: 'kun fritatte' }[STATE.fritak];
  document.getElementById('scopeSub').textContent = `${y} · ${fl}` + (STATE.selected ? ` · grunnkrets ${STATE.selected}` : '');
}

function tableRows() {
  const y = STATE.year, total = agg(y, null);
  const rows = [...KRETSER.map(k => k.nr), 'UK'].map(nr => {
    const cur = agg(y, nr);
    return { nr, navn: KNAME[nr], skatt: METRICS.skatt.value(cur), n: cur.n,
      colorValue: metricValue(STATE.colorMetric, y, nr, STATE.colorCategory),
      heightValue: STATE.heightMetric === HEIGHT_NONE ? null : metricValue(STATE.heightMetric, y, nr, STATE.heightCategory),
      andel: total.s ? 100 * cur.s / total.s : null };
  });
  return { rows, total };
}

function renderTable() {
  const { rows, total } = tableRows();
  const hasHeight = STATE.heightMetric !== HEIGHT_NONE;
  if (!hasHeight && STATE.sort.k === 'heightValue') STATE.sort = { k: 'colorValue', dir: -1 };
  const { k, dir } = STATE.sort;
  rows.sort((a, b) => {
    if (k === 'navn') return dir * a.navn.localeCompare(b.navn, 'nb');
    if (a[k] == null) return b[k] == null ? 0 : 1;
    if (b[k] == null) return -1;
    return dir * (a[k] - b[k]);
  });
  const metricCell = (id, value) => {
    const m = METRICS[id], formatted = fmt(value, m.unit, m.diverging);
    return value != null && m.diverging ? `<span class="${value < 0 ? 'neg' : 'pos'}">${formatted}</span>` : formatted;
  };
  document.getElementById('colorTableLabel').textContent = metricLabel(STATE.colorMetric, STATE.colorCategory);
  document.getElementById('heightTableLabel').textContent = hasHeight ? metricLabel(STATE.heightMetric, STATE.heightCategory) : '';
  document.getElementById('heightTableHeader').hidden = !hasHeight;
  document.getElementById('tableYear').textContent = '· ' + STATE.year;
  const building = isBuildingMetric(STATE.colorMetric) || isBuildingMetric(STATE.heightMetric);
  const caveats = [...new Set([METRICS[STATE.colorMetric]?.caveat, METRICS[STATE.heightMetric]?.caveat].filter(Boolean))];
  document.getElementById('tableMetricNote').textContent = 'Farge og høyde følger kartvalgene. Andel = andel av kommunens eiendomsskatt.'
    + (building ? ' Byggdata: antall registreringer i kildefilen, uavhengig av år og fritak.' : '')
    + (caveats.length ? ' ' + caveats.join('. ') + '.' : '');
  const maxShare = Math.max(1, ...rows.map(r => r.andel ?? 0));
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = rows.map(r => {
    const few = r.n > 0 && r.n < MIN_COUNT ? `<span class="few" title="Færre enn ${MIN_COUNT} eiendommer">⚠</span>` : '';
    const share = r.andel == null ? 'Ingen data' : `<span class="share"><i><b style="width:${(r.andel / maxShare * 100).toFixed(0)}%"></b></i>${fmt(r.andel, 'pct')}</span>`;
    return `<tr data-nr="${r.nr}" class="${r.nr === STATE.selected ? 'sel' : ''} ${r.nr === 'UK' ? 'uk' : ''}">
      <td>${r.navn}${few}</td><td>${fmt(r.skatt, 'kr')}</td><td>${fmt(r.n || null, 'n')}</td><td>${metricCell(STATE.colorMetric, r.colorValue)}</td>${hasHeight ? `<td>${metricCell(STATE.heightMetric, r.heightValue)}</td>` : ''}<td>${share}</td></tr>`;
  }).join('');
  // Ratios and percentages are recalculated for the whole municipality,
  // never summed or averaged over the displayed district values.
  const colorTotal = metricValue(STATE.colorMetric, STATE.year, null, STATE.colorCategory);
  const heightTotal = hasHeight ? metricValue(STATE.heightMetric, STATE.year, null, STATE.heightCategory) : null;
  document.querySelector('#tbl tfoot').innerHTML = `<tr><td>Hele kommunen</td><td>${fmt(total.s || null, 'kr')}</td><td>${fmt(total.n || null, 'n')}</td>
    <td>${metricCell(STATE.colorMetric, colorTotal)}</td>${hasHeight ? `<td>${metricCell(STATE.heightMetric, heightTotal)}</td>` : ''}<td>${total.s ? '100,0' + NBSP + '%' : 'Ingen data'}</td></tr>`;
  document.querySelectorAll('#tbl thead th').forEach(th => {
    th.setAttribute('aria-sort', th.dataset.k === k ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    th.querySelector('.arr').textContent = th.dataset.k === k ? (dir > 0 ? '▲' : '▼') : '';
  });
}

function renderNote() {
  const unknown = DATA.fritakUnknownYears, none = DATA.fritakNoneCodedYears;
  let flags = '';
  if (unknown.includes(STATE.year)) flags = `<span class="flag">Fritak er ikke oppgitt i kilden for ${STATE.year} – fritaksfilteret gir ingen treff</span>`;
  else if (none.includes(STATE.year)) flags = `<span class="flag">Skattelisten for ${STATE.year} inneholder ingen fritakskoder (alle rader står som «Ingen»)</span>`;
  document.getElementById('noteBody').innerHTML = `
    <p style="margin:0 0 6px">Tallene er aggregert fra den opplastede eiendomsskattelisten (Basisdata, ${nf0.format(DATA.rows)} rader, ${YEARS[0]}–${YEARS[YEARS.length - 1]}).
    Bare summer og antall per år og grunnkrets vises – ingen eiendoms- eller personopplysninger. År og fritak gjelder skattedata. Tabellkolonnene «Farge» og «Høyde» følger de valgte måltallene og kategoriene; nøkkeltallene viser fortsatt eiendomsskatt.</p>
    <ul>
      <li><b>Antall eiendommer</b> = antall skatteobjekter (rader) i skattelisten det året. Delte bygg kan gi flere rader per matrikkelenhet; radene er ikke slått sammen.</li>
      <li><b>Uten krets</b>: noen få objekter (bl.a. gnr 5000) mangler grunnkrets. De vises i tabellen og inngår i totalen, men ikke på kartet.</li>
      <li><b>Areal</b> (bruksareal) finnes for ca. 67 % av radene, og 2026-arealet er lagt på alle år. Skatt per m² beregnes bare over rader med areal.</li>
      <li><b>Takst</b> og <b>takstgrunnlag</b>: fra 2020 er grunnlaget lavere enn taksten (reduksjonsfaktor). Promillesats varierer med år og eiendomstype.</li>
      <li><b>Fritak</b>: §-koder finnes for ${YEARS[0]}–2013 og 2015–2024. 2014 er «ikke oppgitt i kilden»; 2025–2026 har ingen koder i kilden.</li>
      <li>Kretser med færre enn ${MIN_COUNT} eiendommer merkes ⚠. Vurder om slike tall bør deles.</li>
      <li><b>Bygningstype / Bygningsstatus</b>: fra Byggestatus.xlsm, arkene «Byggningstype» og «Byggningsstatus». ${nf0.format(BUILDINGS.rowCount)} registreringer (${nf0.format(BUILDINGS.uniqueBuildingNumbers)} ulike bygningsnumre). Tallene teller registreringer, ikke unike bygg; også revne/utgåtte bygg kan inngå. Tomme felt i oppsummeringene teller som 0.</li>
      <li><b>Byggdata er et øyeblikksbilde</b>, uten årsserie eller fritaksfordeling. Års- og fritaksvalget filtrerer derfor ikke byggdata. Velg kategori separat for farge og høyde. Grafen viser fordeling per grunnkrets når fargen viser byggdata.</li>
      <li><b>Bygg uten krets</b>: «Andre» og «INGEN» er samlet som «Uten krets» (${nf0.format(BUILDINGS.groups.bygningstype.totals.UK)} registreringer). De er med i grafen, men kan ikke plasseres på kartet.</li>
    </ul>
    ${flags ? '<p style="margin:8px 0 0">' + flags + '</p>' : ''}`;
}

/* =========================================================================
   RENDER + EVENTS
   ========================================================================= */
function renderAll() {
  renderTimeline();
  document.getElementById('prevYear').disabled = STATE.year === YEARS[0];
  document.getElementById('nextYear').disabled = STATE.year === YEARS[YEARS.length - 1];
  const chip = document.getElementById('selChip');
  chip.hidden = !STATE.selected;
  if (STATE.selected) { document.getElementById('selName').textContent = KNAME[STATE.selected]; document.getElementById('selSub').textContent = 'Grunnkrets ' + STATE.selected + ' · ' + STATE.year; }
  renderMap(); renderKPIs(); renderChart(); renderTable(); renderNote();
}
function select(nr) {
  STATE.selected = nr;
  renderAll();
  document.querySelector('#tbl tbody tr.sel')?.scrollIntoView({ block: 'nearest' });
}
function setYear(y) { STATE.year = Math.max(YEARS[0], Math.min(YEARS[YEARS.length - 1], y)); renderAll(); }

function renderTimeline() {
  const index = YEARS.indexOf(STATE.year);
  document.getElementById('yearSelect').value = String(STATE.year);
  const slider = document.getElementById('yearSlider');
  slider.value = index;
  slider.setAttribute('aria-valuetext', String(STATE.year));
  slider.style.setProperty('--progress', (100 * index / Math.max(1, YEARS.length - 1)) + '%');
  for (const button of document.getElementById('yearTicks').children) {
    const active = Number(button.dataset.year) === STATE.year;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function fillMetricSelects() {
  const c = document.getElementById('colorSel'), h = document.getElementById('heightSel');
  for (const [id, m] of Object.entries(METRICS)) { c.add(new Option(m.label, id)); h.add(new Option(m.label, id)); }
  h.add(new Option('Ingen (flatt kart)', HEIGHT_NONE));
  c.value = STATE.colorMetric; h.value = STATE.heightMetric;
  syncCategorySelects();
}

function syncCategorySelects() {
  for (const role of ['color', 'height']) {
    const id = STATE[role + 'Metric'];
    const group = BUILDINGS.groups[id];
    const field = document.getElementById(role + 'CategoryField');
    field.hidden = !group;
    if (!group) continue;
    const select = document.getElementById(role + 'Category');
    const category = STATE[role + 'Category'];
    select.replaceChildren(new Option('Alle kategorier', 'all'));
    for (const item of group.categories) select.add(new Option(item.label, item.id));
    select.value = category === 'all' || group.categories.some(c => c.id === category) ? category : 'all';
    STATE[role + 'Category'] = select.value;
    document.getElementById(role + 'CategoryLabel').textContent = METRICS[id].label + (role === 'color' ? ' – farge' : ' – høyde');
  }
}

function bind() {
  const sl = document.getElementById('yearSlider');
  sl.min = 0; sl.max = YEARS.length - 1; sl.step = 1; sl.value = YEARS.indexOf(STATE.year);
  const yearSelect = document.getElementById('yearSelect'), ticks = document.getElementById('yearTicks');
  for (const [i, y] of YEARS.entries()) {
    yearSelect.add(new Option(String(y), String(y)));
    const tick = document.createElement('button');
    tick.type = 'button'; tick.className = 'year-tick'; tick.dataset.year = y;
    tick.textContent = String(y).slice(-2); tick.title = String(y);
    tick.setAttribute('aria-label', 'Velg ' + y);
    tick.style.left = (100 * i / Math.max(1, YEARS.length - 1)) + '%';
    tick.addEventListener('click', () => { stop(); setYear(y); }); ticks.appendChild(tick);
  }
  sl.addEventListener('input', () => { stop(); setYear(YEARS[+sl.value]); });
  yearSelect.addEventListener('change', () => { stop(); setYear(+yearSelect.value); });
  document.getElementById('prevYear').addEventListener('click', () => { stop(); setYear(STATE.year - 1); });
  document.getElementById('nextYear').addEventListener('click', () => { stop(); setYear(STATE.year + 1); });
  let timer = null;
  const playBtn = document.getElementById('playBtn');
  function stop() { STATE.playing = false; clearInterval(timer); timer = null; playBtn.textContent = '▶ Spill av'; playBtn.setAttribute('aria-pressed', 'false'); }
  playBtn.addEventListener('click', () => {
    if (STATE.playing) return stop();
    STATE.playing = true; playBtn.textContent = '❚❚ Pause'; playBtn.setAttribute('aria-pressed', 'true');
    if (STATE.year === YEARS[YEARS.length - 1]) setYear(YEARS[0]);
    timer = setInterval(() => {
      if (STATE.year >= YEARS[YEARS.length - 1]) return stop();
      setYear(STATE.year + 1);
      if (STATE.year === YEARS[YEARS.length - 1]) stop();
    }, 1200);
  });
  for (const role of ['color', 'height']) {
    document.getElementById(role + 'Sel').addEventListener('change', e => {
      STATE[role + 'Metric'] = e.target.value; STATE[role + 'Category'] = 'all'; syncCategorySelects(); renderAll();
    });
    document.getElementById(role + 'Category').addEventListener('change', e => { STATE[role + 'Category'] = e.target.value; renderAll(); });
  }
  document.getElementById('fritakSel').addEventListener('change', e => { STATE.fritak = e.target.value; renderAll(); });
  document.getElementById('fixedScale').addEventListener('change', e => { STATE.fixedScale = e.target.checked; renderMap(); });
  document.getElementById('quantScale').addEventListener('change', e => { STATE.quantile = e.target.checked; renderMap(); });
  document.getElementById('exag').addEventListener('input', e => { STATE.exag = +e.target.value; renderMap(); });
  document.getElementById('btn3d').addEventListener('click', e => {
    STATE.is3d = !STATE.is3d; e.currentTarget.setAttribute('aria-pressed', String(STATE.is3d));
    if (map) map.easeTo({ pitch: STATE.is3d ? 40 : 0, duration: 500 }); renderMap();
  });
  document.getElementById('btnView').addEventListener('click', () => { if (map) map.fitBounds(BOUNDS, { padding: { top: 120, bottom: 90, left: 70, right: 60 }, pitch: STATE.is3d ? 40 : 0, bearing: -12, duration: 600 }); });
  document.getElementById('zoomIn').addEventListener('click', () => map?.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => map?.zoomOut());
  const reset = () => { stop(); STATE.selected = null; STATE.fritak = 'all'; document.getElementById('fritakSel').value = 'all'; setYear(YEARS[YEARS.length - 1]); };
  document.getElementById('resetBtn').addEventListener('click', reset);
  document.getElementById('selClear').addEventListener('click', () => select(null));
  document.getElementById('viewLine').addEventListener('click', () => { STATE.chartView = 'line'; setSeg(); renderChart(); });
  document.getElementById('viewBars').addEventListener('click', () => { STATE.chartView = 'bars'; setSeg(); renderChart(); });
  function setSeg() { document.getElementById('viewLine').setAttribute('aria-pressed', String(STATE.chartView === 'line')); document.getElementById('viewBars').setAttribute('aria-pressed', String(STATE.chartView === 'bars')); }
  document.querySelectorAll('#tbl thead th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    STATE.sort = STATE.sort.k === k ? { k, dir: -STATE.sort.dir } : { k, dir: k === 'navn' ? 1 : -1 };
    renderTable();
  }));
  document.querySelector('#tbl tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const nr = tr.dataset.nr; select(STATE.selected === nr ? null : nr);
    // The selected area's label is highlighted; no boundary lines are drawn.
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.key === 'ArrowLeft') { stop(); setYear(STATE.year - 1); }
    if (e.key === 'ArrowRight') { stop(); setYear(STATE.year + 1); }
    if (e.key === 'Escape') select(null);
  });
  window.addEventListener('resize', updateLabels);
  const ct = document.getElementById('ctlToggle'), mc = document.getElementById('mapctl');
  ct.addEventListener('click', () => { const open = mc.classList.toggle('collapsed'); ct.setAttribute('aria-expanded', String(!open)); });
  if (window.innerWidth <= 600) { mc.classList.add('collapsed'); ct.setAttribute('aria-expanded', 'false'); }
}

fillMetricSelects();
bind();
initMap();
renderAll();
