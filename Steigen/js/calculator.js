(function(){'use strict';const root=document.getElementById('eskatt-kalkulator');

/* ==========================================================================
   PARAMETERE – alt som kan endre seg ligger her.
   Kilde: Rammer og retningslinjer for taksering 2019 (rev. 17.02.2020),
   pkt. 4.5–5.1, og kommunestyrets årlige vedtak (skattesats, bunnfradrag).
   ========================================================================== */
const CONFIG = window.STEIGEN_CALCULATOR_CONFIG;

/* ============================== Hjelpefunksjoner ============================== */
const $ = s => root.querySelector(s);
const nf0 = new Intl.NumberFormat('nb-NO',{maximumFractionDigits:0});
const nf2 = new Intl.NumberFormat('nb-NO',{minimumFractionDigits:2,maximumFractionDigits:2});
const nfArea = new Intl.NumberFormat('nb-NO',{maximumFractionDigits:2});
const kr  = v => nf0.format(Math.round(v)) + ' kr';
const kr2 = v => nf2.format(v) + ' kr';
const m2  = v => nfArea.format(v) + ' m²';
const fx  = v => nf2.format(v);
const parseArea = s => {
  const text = String(s ?? '').replace(/\s/g,'').replace(',','.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text); return Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : null;
};
const num = s => parseArea(s) ?? 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lavMid = r => (r[0] + r[1]) / 2;
const alderNavn = a => a.navn + (a.tekst ? ' ' + a.tekst : '');
const byggFritak = (type, areal, gard) => {
  if (type?.landbruk && gard) return 'Fritatt: driftsbygning på gårdsbruk i drift';
  return areal > 0 && areal <= CONFIG.fritakMaksAreal ? 'Ikke skattepliktig (15 m² eller mindre)' : '';
};

/* ================================= Tilstand ================================= */
const S = {
  step: 1,
  type: null,
  floors: {hoved:'', under:'', sokkel:'', loft:'', kjeller:''},
  alder: null,
  standard: 'normal',
  bygg: [],              // {id, type, areal}
  tomt: '',
  noMaal: false,
  gard: false,
  sone: '',
  ytre: 'normal'
};
let byggSeq = 0;

/* ================================ Beregning ================================ */
function indreFaktor(alderId, std){
  const a = CONFIG.alder.find(x => x.id === alderId);
  if (!a) return null;
  if (std === 'hoy' && a.hoy != null) return Math.min(1, a.hoy);
  if (std === 'lav' && a.lav) return lavMid(a.lav);
  return a.normal;
}

const hasBolig = state => ['hoved','under','loft','kjeller'].some(k => num(state.floors[k]) > 0);
const hasTomt = state => state.noMaal || num(state.tomt) > 0;

function inputIssues(state){
  const issues = [];
  const add = (key, steg, tekst) => issues.push({key, steg, tekst});
  const bolig = hasBolig(state);
  if (bolig && !CONFIG.boligtyper.some(t => t.id === state.type)) add('Type',1,'Velg Bolig eller Fritid.');
  for (const e of CONFIG.etasjer){
    const value = String(state.floors[e.id] ?? '').trim();
    if (value && parseArea(value) == null) add('Area',1,`${e.navn}: oppgi et gyldig areal på 0 m² eller mer.`);
  }
  const fl = state.floors;
  if (num(fl.sokkel) > num(fl.under)) add('Area',1,'Sokkelleilighet/hybel kan ikke være større enn hele underetasjen.');
  if (bolig && !CONFIG.alder.some(a => a.id === state.alder)) add('Year',1,'Velg når boligen ble tatt i bruk.');
  state.bygg.forEach((b,i) => {
    if (!CONFIG.andreBygg.some(t => t.id === b.type) || parseArea(b.areal) == null || num(b.areal) <= 0)
      add('Bygg',2,`Bygning ${i+1}: velg type og oppgi et gyldig areal større enn 0 m², eller fjern bygningen.`);
  });
  if (!state.noMaal && String(state.tomt).trim() !== '' && parseArea(state.tomt) == null) add('Tomt',3,'Oppgi et gyldig tomteareal (0 m² eller mer), eller kryss av for at målebrev ikke finnes.');
  if (!bolig && state.bygg.length === 0 && !hasTomt(state)) add('Tomt',3,'Oppgi tomteareal eller legg til en bygning i steg 2. Du kan også beregne en bolig i steg 1.');
  if (state.sone === '' || !Number.isInteger(Number(state.sone)) || !CONFIG.soner[Number(state.sone)]) add('Sone',3,'Velg sone.');
  return issues;
}

function beregn(state){
  const partial = !hasBolig(state);
  const t = CONFIG.boligtyper.find(x => x.id === state.type);
  const sats = t ? t.sats : 10000;
  const rows = [];
  // Bolig – etasjer
  const fl = {}; for (const k in state.floors) fl[k] = num(state.floors[k]);
  const sokkel = Math.min(fl.sokkel, fl.under);
  const underRest = fl.under - sokkel;
  const etasjeAreal = {hoved:fl.hoved, under:underRest, sokkel:sokkel, loft:fl.loft, kjeller:fl.kjeller};
  let vektet = 0, byggVerdi = 0;
  for (const e of CONFIG.etasjer){
    const a = etasjeAreal[e.id]; if (!a) continue;
    const v = a * e.faktor * sats;
    vektet += a * e.faktor; byggVerdi += v;
    rows.push({obj:(t && t.kategori==='fritid' ? 'Fritidsbolig' : 'Bolig') + ' – ' + e.navn.toLowerCase().replace('herav ',''), areal:a, faktor:e.faktor, sats, verdi:v});
  }
  // Andre bygg
  for (const b of state.bygg){
    const bt = CONFIG.andreBygg.find(x => x.id === b.type); const a = num(b.areal);
    if (!bt || !a) continue;
    const friTekst = byggFritak(bt, a, state.gard);
    const fri = Boolean(friTekst);
    const v = fri ? 0 : a * bt.sats;
    byggVerdi += v;
    rows.push({obj:bt.navn, areal:a, faktor:1, sats:bt.sats, verdi:v, fri, friTekst});
  }
  // Tomt
  const T = CONFIG.tomt;
  const maks = state.gard ? T.maksArealGardsbruk : T.maksAreal;
  const oppgitt = num(state.tomt);
  const tomtAreal = state.noMaal ? Math.min(T.arealUtenMaalebrev, maks) : Math.min(oppgitt, maks);
  const tomtVerdi = tomtAreal * T.pris;
  const sjablong = byggVerdi + tomtVerdi;

  const sone = state.sone === '' ? null : CONFIG.soner[+state.sone];
  const ytre = CONFIG.ytre.find(x => x.id === state.ytre) || CONFIG.ytre[0];
  // Uten boligopplysninger brukes 1,00 som synlig, foreløpig antakelse.
  const indre = indreFaktor(state.alder, state.standard) ?? (partial ? 1 : null);
  const gardF = state.gard ? CONFIG.gardsbrukFaktor : 1;

  let takst = null, grunnlag = null, skatt = null, skattBeregnet = null, skattAvrundet = null, underGrense = false, bunn = 0;
  const kat = t ? t.kategori : 'bolig';
  if (sone && indre != null && inputIssues(state).length === 0){
    const indreBygg = indre, indreTomt = CONFIG.indreFaktorGjelderTomt ? indre : 1;
    takst = (byggVerdi * indreBygg + tomtVerdi * indreTomt) * sone.faktor * ytre.faktor * gardF;
    bunn = partial ? 0 : (kat === 'bolig' || CONFIG.bunnfradragForFritid) ? CONFIG.bunnfradrag : 0;
    grunnlag = Math.max(0, takst * CONFIG.reduksjonsfaktor - bunn);
    skattBeregnet = grunnlag * CONFIG.skattesatsPromille / 1000;
    skattAvrundet = Math.floor(skattBeregnet + 1e-9);
    underGrense = skattAvrundet < CONFIG.utskrivningsgrense;
    // Avrunding og 300-kronersgrensen gjelder hele eiendommen, ikke delbeløp.
    skatt = partial ? skattBeregnet : underGrense ? 0 : skattAvrundet;
  }
  return {rows, vektet, byggVerdi, tomtAreal, oppgitt, tomtVerdi, sjablong, sone, ytre, indre, gardF, takst, bunn, grunnlag, skatt, skattBeregnet, skattAvrundet, underGrense, kat, sats, partial};
}

function mangler(){
  return inputIssues(S);
}

/* ============================ Bygging av skjema ============================ */
function radioCards(container, name, items, getLabel){
  container.innerHTML = items.map(it => {
    const l = getLabel(it);
    return `<label class="opt"><input type="radio" name="${name}" value="${esc(it.id)}"><span class="mark" aria-hidden="true"></span><span class="opt-copy"><b>${esc(l.navn)}</b>${l.tekst?`<small>${esc(l.tekst)}</small>`:''}</span>${l.f?`<span class="f">${l.f}</span>`:''}</label>`;
  }).join('');
}

function buildForm(){
  root.querySelectorAll('[data-year]').forEach(e => e.textContent = CONFIG.skatteaar);
  root.querySelectorAll('[data-tomtpris]').forEach(e => e.textContent = kr(CONFIG.tomt.pris));
  root.querySelectorAll('[data-tomtmaks]').forEach(e => e.textContent = m2(CONFIG.tomt.maksAreal));
  root.querySelectorAll('[data-tomtgard]').forEach(e => e.textContent = m2(CONFIG.tomt.maksArealGardsbruk));
  root.querySelectorAll('[data-red]').forEach(e => e.textContent = fx(CONFIG.reduksjonsfaktor));

  radioCards($('#typeList'), 'type', CONFIG.boligtyper, t => ({navn:t.navn, tekst:t.tekst + '. ' + nf0.format(t.sats)+' kr per m²'}));
  radioCards($('#yearList'), 'alder', CONFIG.alder, a => ({navn:a.navn, tekst:a.tekst}));
  radioCards($('#stdList'), 'std', CONFIG.standarder, s => ({navn:s.navn, tekst:s.tekst}));
  radioCards($('#ytreList'), 'ytre', CONFIG.ytre, y => ({navn:y.navn, tekst:y.tekst, f:'faktor '+fx(y.faktor)}));

  $('#floorFields').innerHTML = CONFIG.etasjer.map(e => `
    <div class="field floor-field" id="f_${e.id}">
      <label for="fl_${e.id}">${esc(e.navn)}</label>
      <div class="inbox"><input id="fl_${e.id}" data-floor="${e.id}" inputmode="decimal" autocomplete="off" aria-describedby="fx_${e.id} errArea"><span>m²</span></div>
      <div class="floor-meta"><p class="fx" id="fx_${e.id}">Etasjefaktor ${fx(e.faktor)}</p>
        <button type="button" class="floor-help" aria-label="Forklaring: ${esc(e.navn)}" aria-controls="tip_${e.id}" aria-describedby="tip_${e.id}" aria-expanded="false">?</button>
      </div>
      <div class="floor-tip" id="tip_${e.id}" role="tooltip" hidden>
        <strong>${esc(e.navn)}</strong>${e.hjelp.map(p => `<p>${esc(p)}</p>`).join('')}
        <p class="tip-source">Kilder: Steigens takseringsretningslinjer, pkt. 3.1 og etasjefaktorer; Kartverkets føringsinstruks, pkt. 6.1.8–6.1.9${e.id==='kjeller'?'; Steigen kommunes informasjon om eiendomsskatt':''}.</p>
      </div>
    </div>`).join('');

  $('#sone').innerHTML = '<option value="">Velg sone …</option>' + CONFIG.soner.map((s,i) => `<option value="${i}">${esc(s.navn)} (${fx(s.faktor)})</option>`).join('');

  // Steg
  const navn = ['Bolig','Andre bygg','Tomt og sone','Resultat'];
  $('#steps').innerHTML = navn.map((n,i) => `<li data-s="${i+1}"><button type="button" data-go="${i+1}"><span class="dot">${i+1}</span><span class="lab">${n}</span></button></li>`).join('');

  // Standardvalg
  root.querySelector('input[name=std][value=normal]').checked = true;
  root.querySelector('input[name=ytre][value=normal]').checked = true;
}

function renderBygg(){
  const list = $('#blist');
  list.innerHTML = S.bygg.map(b => {
    const a = num(b.areal); const friTekst = byggFritak(CONFIG.andreBygg.find(t => t.id === b.type), a, S.gard);
    return `<div class="brow" data-id="${b.id}">
      <div class="field"><label for="bt_${b.id}">Type bygning</label>
        <select id="bt_${b.id}" data-bt="${b.id}">${CONFIG.andreBygg.map(t => `<option value="${t.id}" ${t.id===b.type?'selected':''}>${esc(t.navn)} – ${nf0.format(t.sats)} kr/m²</option>`).join('')}</select></div>
      <div class="field"><label for="ba_${b.id}">Bruksareal</label><div class="inbox"><input id="ba_${b.id}" data-ba="${b.id}" inputmode="decimal" autocomplete="off" value="${esc(b.areal)}"><span>m²</span></div></div>
      <button type="button" class="btn link rm" data-rm="${b.id}">Fjern<span class="sr-only"> bygning</span></button>
      ${friTekst?`<span class="tag">${esc(friTekst)}</span>`:''}
    </div>`;
  }).join('');
  $('#bempty').hidden = S.bygg.length > 0;
}

function updateByggTag(row){
  const b = S.bygg.find(b => String(b.id) === row.dataset.id);
  if(!b) return;
  const text = byggFritak(CONFIG.andreBygg.find(t => t.id===b.type),num(b.areal),S.gard);
  let tag = row.querySelector('.tag');
  if(text){
    if(!tag){tag=document.createElement('span');tag.className='tag';row.appendChild(tag);}
    tag.textContent=text;
  } else if(tag) tag.remove();
}

/* ================================ Visning ================================ */
let activeHelp = null, pinnedHelp = false, helpTimer = null;
function closeHelp(){
  clearTimeout(helpTimer);
  if (!activeHelp) return;
  document.getElementById(activeHelp.getAttribute('aria-controls')).hidden = true;
  activeHelp.setAttribute('aria-expanded','false');
  activeHelp = null; pinnedHelp = false;
}
function positionHelp(){
  if (!activeHelp) return;
  const tip = document.getElementById(activeHelp.getAttribute('aria-controls'));
  tip.style.maxHeight = Math.max(100, window.innerHeight - 24) + 'px';
  const button = activeHelp.getBoundingClientRect(), popup = tip.getBoundingClientRect();
  const left = Math.max(12, Math.min(button.right - popup.width, window.innerWidth - popup.width - 12));
  const above = button.top - popup.height - 10;
  const top = above >= 12 ? above : Math.max(12, Math.min(button.bottom + 10, window.innerHeight - popup.height - 12));
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function openHelp(button, pinned=false){
  clearTimeout(helpTimer);
  if (activeHelp !== button) closeHelp();
  activeHelp = button; pinnedHelp = pinnedHelp || pinned;
  document.getElementById(button.getAttribute('aria-controls')).hidden = false;
  button.setAttribute('aria-expanded','true');
  positionHelp();
}
function scheduleHelpClose(){
  clearTimeout(helpTimer);
  helpTimer = setTimeout(() => {
    if (!activeHelp || pinnedHelp || document.activeElement === activeHelp) return;
    const tip = document.getElementById(activeHelp.getAttribute('aria-controls'));
    if (!activeHelp.matches(':hover') && !tip.matches(':hover')) closeHelp();
  },150);
}
function bindHelp(){
  root.querySelectorAll('.floor-help').forEach(button => {
    const tip = document.getElementById(button.getAttribute('aria-controls'));
    button.addEventListener('pointerenter', e => { if(e.pointerType==='mouse') openHelp(button); });
    button.addEventListener('pointerleave',scheduleHelpClose);
    button.addEventListener('focus', () => openHelp(button));
    button.addEventListener('blur', () => { pinnedHelp=false; scheduleHelpClose(); });
    button.addEventListener('click', () => {
      if (activeHelp === button && pinnedHelp) closeHelp(); else openHelp(button,true);
    });
    tip.addEventListener('pointerenter', () => clearTimeout(helpTimer));
    tip.addEventListener('pointerleave',scheduleHelpClose);
  });
  root.addEventListener('keydown',e => { if(e.key==='Escape') closeHelp(); });
  root.addEventListener('pointerdown', e => { if(!e.target.closest('.floor-help,.floor-tip')) closeHelp(); });
  window.addEventListener('resize',positionHelp);
  window.addEventListener('scroll',positionHelp,{passive:true});
}

function showStep(n, focus=true){
  closeHelp();
  S.step = n;
  root.querySelectorAll('.panel').forEach(p => p.hidden = +p.dataset.step !== n);
  root.querySelectorAll('#steps li').forEach(li => {
    const s = +li.dataset.s;
    li.classList.toggle('current', s === n);
    const filled = s === 1 ? hasBolig(S) : s === 2 ? S.bygg.length > 0 : s === 3 ? hasTomt(S) : false;
    li.classList.toggle('done', s < n && filled);
    const b = li.querySelector('button');
    if (s === n) b.setAttribute('aria-current','step'); else b.removeAttribute('aria-current');
    b.setAttribute('aria-label', `Steg ${s} av 4: ${li.querySelector('.lab').textContent}${s<n && filled?' (utfylt)':''}`);
  });
  if (n === 4) renderResult();
  if (focus){ const h = root.querySelector(`.panel[data-step="${n}"] h2`); h && h.focus(); window.scrollTo({top: root.getBoundingClientRect().top + window.scrollY - 165, behavior:'smooth'}); }
}

function validateStep(n){
  const issues = inputIssues(S).filter(x => x.steg === n);
  const keys = n===1 ? ['Type','Area','Year'] : n===2 ? ['Bygg'] : ['Tomt','Sone'];
  keys.forEach(key => {
    const el = $('#err'+key);
    if(el){el.textContent = issues.filter(x => x.key === key).map(x => x.tekst).join(' ');el.setAttribute('role','alert');}
  });
  if(n===1) root.querySelectorAll('[data-floor]').forEach(input => {
    const bad = String(input.value).trim() !== '' && parseArea(input.value) == null || input.dataset.floor==='sokkel' && num(S.floors.sokkel)>num(S.floors.under);
    input.setAttribute('aria-invalid',String(bad));input.closest('.field').classList.toggle('err',bad);
  });
  if(n===3){
    $('#tomt').setAttribute('aria-invalid',String(issues.some(x => x.key==='Tomt')));
    $('#sone').setAttribute('aria-invalid',String(issues.some(x => x.key==='Sone')));
  }
  return issues.length === 0;
}

function updateStdAvailability(){
  const a = CONFIG.alder.find(x => x.id === S.alder);
  root.querySelectorAll('input[name=std]').forEach(inp => {
    const v = inp.value;
    let dis = false;
    if (a && v === 'hoy' && a.hoy == null) dis = true;
    if (a && v === 'lav' && !a.lav) dis = true;
    inp.disabled = dis;
    const small = inp.closest('.opt').querySelector('small');
    const base = CONFIG.standarder.find(s => s.id === v).tekst;
    if (!a) small.textContent = base;
    else if (dis) small.textContent = 'Ikke aktuelt for bygg tatt i bruk 2010 eller senere';
    else {
      const f = v === 'hoy' ? a.hoy : v === 'lav' ? a.lav : a.normal;
      small.textContent = base + ' · indre faktor ' + (Array.isArray(f) ? fx(f[0]) + '–' + fx(f[1]) : fx(f));
    }
  });
  if (root.querySelector('input[name=std]:checked')?.disabled){
    root.querySelector('input[name=std][value=normal]').checked = true; S.standard = 'normal';
  }
}

function renderSide(){
  const r = beregn(S);
  $('#boxTitle').textContent = r.partial ? 'Anslag for valgte deler' : 'Foreløpig overslag';
  $('#weighted').textContent = m2(r.vektet);
  const rows = [];
  rows.push(['Vektet bruksareal', m2(r.vektet)]);
  rows.push(['Sonefaktor', r.sone ? fx(r.sone.faktor) : '–']);
  rows.push(['Indre faktor', r.indre != null ? fx(r.indre) : '–']);
  if (r.takst != null) rows.push(['Takst', kr(r.takst)]);
  $('#boxRows').innerHTML = rows.map(([k,v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');

  if (r.skatt != null){
    $('#bigVal').textContent = r.partial ? kr2(r.skatt) : kr(r.skatt);
    $('#bigUnit').textContent = r.partial ? 'Beregnet bidrag per år for valgte deler av en bebygd bolig-/fritidseiendom. Endelig skatt gjelder hele eiendommen.' : r.underGrense ? `Ingen utskriving: beregnet årsskatt er under ${kr(CONFIG.utskrivningsgrense)}.` : `per år · ${CONFIG.terminer} terminer à ca. ${kr(r.skatt/CONFIG.terminer)}`;
    $('#mVal').textContent = (r.partial ? kr2(r.skatt) : kr(r.skatt)) + ' / år';
    // Hva om: standard
    const a = CONFIG.alder.find(x => x.id === S.alder);
    const alts = a ? CONFIG.standarder.filter(s => !(s.id==='hoy' && a.hoy==null) && !(s.id==='lav' && !a.lav)) : [];
    if (!r.partial && alts.length > 1){
      $('#whatIf').innerHTML = '<hr><h3>Hva om standarden er …</h3>' + alts.map(s => {
        const rr = beregn({...S, standard:s.id});
        const kort = s.id==='normal'?'Normal':s.id==='hoy'?'Oppgradert':'Dårligere';
        return `<div class="kv${s.id===S.standard?' cur':''}"><span>${kort}${s.id===S.standard?' (valgt)':''}</span><b>${kr(rr.skatt)}</b></div>`;
      }).join('') + '<p class="note">Standard vurderes av kommunen ved besiktigelse.</p>';
    } else $('#whatIf').innerHTML = '';
  } else {
    $('#bigVal').textContent = '–';
    const m = mangler();
    $('#bigUnit').textContent = m.length ? 'Fyll inn eller rett opp opplysningene for å se overslaget.' : '';
    $('#mVal').textContent = '–';
    $('#whatIf').innerHTML = '';
  }
}

function renderResult(){
  const r = beregn(S);
  const m = mangler();
  $('#resMissing').innerHTML = m.length ? `<div class="missing" role="alert"><b>Noen opplysninger mangler:</b><ul>${m.map(x => `<li>${esc(x.tekst)} – <button type="button" class="btn link" data-go="${x.steg}">gå til steg ${x.steg}</button></li>`).join('')}</ul></div>` : r.partial ? '<div class="missing"><b>Dette er bare et anslag for valgte deler av eiendommen.</b> Det forutsetter en bebygd bolig-/fritidseiendom og indre faktor 1,00 hvis byggeår ikke er valgt. Skatt fastsettes for hele eiendommen; avrunding og grensen på 300 kr brukes derfor ikke på dette delbeløpet. En tomt uten bygg tatt i bruk beskattes ikke.</div>' : '';
  $('.panel[data-step="4"] h2').textContent = r.partial ? 'Beregnet bidrag fra valgte deler' : 'Slik er eiendomsskatten beregnet';
  const t = CONFIG.boligtyper.find(x => x.id === S.type);
  $('#resSub').textContent = [r.partial ? [S.bygg.length?'Andre bygg':null,hasTomt(S)?'tomt':null].filter(Boolean).join(' og ') : t.navn, r.sone ? 'Sone: ' + r.sone.navn : null, 'Skatteår ' + CONFIG.skatteaar].filter(Boolean).join(' · ');

  let h = '<div class="tablewrap"><table><caption>Sjablongverdi</caption><thead><tr><th scope="col">Objekt</th><th class="n" scope="col">Areal</th><th class="n" scope="col">Faktor</th><th class="n" scope="col">Sats per m²</th><th class="n" scope="col">Verdi</th></tr></thead><tbody>';
  for (const x of r.rows){
    h += `<tr><td>${esc(x.obj)}${x.fri?`<small>${esc(x.friTekst)}</small>`:''}</td><td class="n">${m2(x.areal)}</td><td class="n">${fx(x.faktor)}</td><td class="n">${nf0.format(x.sats)} kr</td><td class="n${x.fri?' free':''}">${nf0.format(Math.round(x.verdi))}</td></tr>`;
  }
  const tomtNote = S.noMaal ? 'Målebrev finnes ikke' : (r.oppgitt > r.tomtAreal ? `Oppgitt ${m2(r.oppgitt)}, maks ${m2(r.tomtAreal)} regnes med` : '');
  if (hasTomt(S)) h += `<tr><td>Tomt${tomtNote?`<small>${esc(tomtNote)}</small>`:''}</td><td class="n">${m2(r.tomtAreal)}</td><td class="n">–</td><td class="n">${nf0.format(CONFIG.tomt.pris)} kr</td><td class="n">${nf0.format(r.tomtVerdi)}</td></tr>`;
  h += `<tr class="tot"><td colspan="4">Sum sjablongverdi</td><td class="n">${nf0.format(Math.round(r.sjablong))}</td></tr></tbody></table></div>`;

  if (r.takst != null){
    const alder = CONFIG.alder.find(a=>a.id===S.alder);
    const indreT = alder ? esc(alderNavn(alder)) + ', ' + CONFIG.standarder.find(s=>s.id===S.standard).navn.toLowerCase() + (S.standard==='lav' ? ' (overslaget bruker midtverdien)' : '') : 'Forutsatt indre faktor 1,00 uten boligopplysninger';
    let run = r.sjablong;
    h += '<div class="tablewrap"><table><caption>Fra sjablongverdi til eiendomsskatt</caption><thead><tr><th scope="col">Trinn</th><th class="n" scope="col">Faktor</th><th class="n" scope="col">Beløp</th></tr></thead><tbody>';
    run *= r.sone.faktor;
    h += `<tr class="op"><td>Sonefaktor<small>${esc(r.sone.navn)}</small></td><td class="n">× ${fx(r.sone.faktor)}</td><td class="n">${nf0.format(Math.round(run))}</td></tr>`;
    run *= r.ytre.faktor;
    h += `<tr class="op"><td>Ytre faktor<small>${esc(r.ytre.navn)}</small></td><td class="n">× ${fx(r.ytre.faktor)}</td><td class="n">${nf0.format(Math.round(run))}</td></tr>`;
    run = (r.byggVerdi*r.indre + r.tomtVerdi*(CONFIG.indreFaktorGjelderTomt?r.indre:1))*r.sone.faktor*r.ytre.faktor;
    h += `<tr class="op"><td>Indre faktor (aldersfaktor)<small>${indreT}${CONFIG.indreFaktorGjelderTomt?'':' · gjelder bare bygninger'}</small></td><td class="n">× ${fx(r.indre)}</td><td class="n">${nf0.format(Math.round(run))}</td></tr>`;
    if (S.gard){ run *= r.gardF; h += `<tr class="op"><td>Gårdbrukers bolig på gårdsbruk i drift</td><td class="n">× ${fx(r.gardF)}</td><td class="n">${nf0.format(Math.round(run))}</td></tr>`; }
    h += `<tr class="tot"><td colspan="2">Takst</td><td class="n">${kr(r.takst)}</td></tr>`;
    h += `<tr class="op"><td>Reduksjon for bolig og fritidsbolig<small>Eiendomsskatteloven § 8 A-2</small></td><td class="n">× ${fx(CONFIG.reduksjonsfaktor)}</td><td class="n">${nf0.format(Math.round(r.takst*CONFIG.reduksjonsfaktor))}</td></tr>`;
    if (r.bunn > 0) h += `<tr class="op"><td>Bunnfradrag</td><td class="n"></td><td class="n">− ${nf0.format(r.bunn)}</td></tr>`;
    h += `<tr class="tot"><td colspan="2">Skattegrunnlag</td><td class="n">${kr(r.grunnlag)}</td></tr>`;
    h += `<tr class="op"><td>${r.partial?'Beregnet bidrag per år':'Beregnet årsskatt'}${r.partial?'':'<small>Avrundet ned til hele kroner, jf. eiendomsskatteloven § 14</small>'}</td><td class="n">× ${nf2.format(CONFIG.skattesatsPromille).replace(/,00$/,'')} ‰</td><td class="n">${r.partial?kr2(r.skattBeregnet):kr(r.skattAvrundet)}</td></tr>`;
    if (!r.partial){
      h += `<tr class="tot"><td colspan="2">Eiendomsskatt per år${r.underGrense?`<small>Under utskrivningsgrensen på ${kr(CONFIG.utskrivningsgrense)} per eiendom</small>`:''}</td><td class="n">${kr(r.skatt)}</td></tr>`;
      h += `<tr class="op"><td>Per termin (${CONFIG.terminer} terminer)</td><td class="n"></td><td class="n">ca. ${kr(r.skatt/CONFIG.terminer)}</td></tr>`;
    }
    h += '</tbody></table></div>';
  }
  $('#resBody').innerHTML = h;
}

/* Feilmeldinger som allerede vises, oppdateres når brukeren retter opp */
function refreshErrors(){
  const shown = root.querySelector(`.panel[data-step="${S.step}"] .error:not(:empty)`);
  if (shown) validateStep(S.step);
}

/* ================================ Hendelser ================================ */
function bind(){
  root.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) showStep(+go.dataset.go);
    const rm = e.target.closest('[data-rm]');
    if (rm){ S.bygg = S.bygg.filter(b => String(b.id) !== rm.dataset.rm); renderBygg(); renderSide(); $('#addB').focus(); }
  });
  $('#addB').addEventListener('click', () => {
    const id = ++byggSeq; S.bygg.push({id, type:'garasje', areal:''}); renderBygg(); renderSide();
    document.getElementById('bt_'+id).focus();
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'type') S.type = t.value;
    if (t.name === 'alder'){ S.alder = t.value; updateStdAvailability(); }
    if (t.name === 'std') S.standard = t.value;
    if (t.name === 'ytre') S.ytre = t.value;
    if (t.dataset.bt){ S.bygg.find(b => b.id === +t.dataset.bt).type = t.value; updateByggTag(t.closest('.brow')); }
    if (t.id === 'sone') S.sone = t.value;
    if (t.id === 'noMaal'){ S.noMaal = t.checked; $('#tomt').disabled = t.checked; }
    if (t.id === 'gard'){ S.gard = t.checked; renderBygg(); }
    refreshErrors();
    renderSide();
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.floor) S.floors[t.dataset.floor] = t.value;
    if (t.dataset.ba){
      S.bygg.find(b => b.id === +t.dataset.ba).areal = t.value;
      updateByggTag(t.closest('.brow'));
    }
    if (t.id === 'tomt') S.tomt = t.value;
    refreshErrors();
    renderSide();
  });
  $('#print').addEventListener('click', () => window.print());
  $('#reset').addEventListener('click', () => { closeHelp(); Object.assign(S, structuredClone(initialState));
    root.querySelectorAll('input').forEach(input=>{input.disabled=false;input.removeAttribute('aria-invalid');if(input.type==='radio')input.checked=(input.name==='std'&&input.value===S.standard)||(input.name==='ytre'&&input.value===S.ytre);else if(input.type==='checkbox')input.checked=false;else input.value='';});
    $('#sone').value='';root.querySelectorAll('.error').forEach(el=>el.textContent='');renderBygg();updateStdAvailability();showStep(1);renderSide(); });
}

const initialState = structuredClone(S);
buildForm();
bind();
bindHelp();
renderBygg();
updateStdAvailability();
showStep(1, false);
renderSide();

/* Testgrensesnitt (brukes til kontroll av beregningene) */
window.SteigenCalculator = Object.freeze({calculate: beregn, validate: inputIssues, config: CONFIG});

})();