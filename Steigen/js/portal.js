(function(){'use strict';
const nf=new Intl.NumberFormat('nb-NO');
const stats=[['Fakturalinjer',window.STEIGEN_DATA.tx.a.length],['Grunnkretser',DATA.kretser.length],['År med eiendomsskatt',DATA.years.length],['Bygningsregistreringer',BUILDINGS.rowCount]];
for(const [label,value] of stats){const a=document.createElement('article'),b=document.createElement('b'),s=document.createElement('span');b.textContent=nf.format(value);s.textContent=label;a.append(b,s);document.getElementById('databaseStats').append(a);}
const privacy=document.getElementById('privacyDialog');
document.querySelector('[data-dialog="personvern"]').addEventListener('click',()=>privacy.showModal());
document.getElementById('closePrivacy').addEventListener('click',()=>privacy.close());
privacy.addEventListener('click',e=>{if(e.target===privacy){const r=privacy.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)privacy.close();}});
document.getElementById('backTop').addEventListener('click',()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);const b=document.querySelector('.pagenav button[data-page="'+CSS.escape(page)+'"]');b?.click();});
new MutationObserver(()=>window.SteigenProperty?.refresh()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
})();
