// Proxy de perf pour la vue calendrier ANNÉE (approche 1, sans virtualisation).
// Reproduit la construction de la chaîne HTML de la grille (365 j × 15 apparts) et
// la boucle de placement des barres, comme renderCalendar, et chronomètre :
//   - le rendu INITIAL, et
//   - un RE-RENDER (après création/modif de réservation).
// ⚠️ Mesure le coût CPU JS (assemblage de chaîne + boucles). Le layout/paint réel
//    du navigateur (surtout mobile) N'EST PAS mesurable ici → à tester sur appareil.
//   node test/perf-calendar.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const APT_IDS = ['APT1','APT2','APT3','APT4','APT5','APT6','APT7','APT8','APTA','APTB','APTC','APTD','APTE','APTF','APTG'];
const CELL_W = 64, ROW_H = 48, APT_LABEL_W = 72, YEAR = 2026;
const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
const parseDate = s => { const [y,m,d]=s.split('-'); return new Date(+y,+m-1,+d); };
const diffDays = (a,b) => Math.round((parseDate(b)-parseDate(a))/86400000);

// Construit la grille + place les barres, comme renderCalendar (partie CPU).
function buildYear(reservations) {
  const yearStart = new Date(YEAR, 0, 1);
  const dayCount = Math.round((new Date(YEAR+1,0,1) - yearStart) / 86400000);
  const days = [];
  for (let i = 0; i < dayCount; i++) days.push(toISO(addDays(yearStart, i)));
  const start = days[0], end = days[days.length-1];
  const totalW = APT_LABEL_W + dayCount * CELL_W;

  let html = `<div style="min-width:${totalW}px;position:relative">`;
  html += `<div style="display:flex;position:sticky;top:0;z-index:20">`;
  html += `<div style="width:${APT_LABEL_W}px">${YEAR}</div>`;
  days.forEach(d => { html += `<div style="width:${CELL_W}px;flex-shrink:0">${parseDate(d).getDate()}</div>`; });
  html += `</div>`;
  APT_IDS.forEach(aptId => {
    html += `<div style="display:flex;height:${ROW_H}px">`;
    html += `<div style="width:${APT_LABEL_W}px;position:sticky;left:0">${aptId}</div>`;
    days.forEach(d => { html += `<div class="cal-cell" style="width:${CELL_W}px" onclick="handleCellClick('${aptId}','${d}')"></div>`; });
    html += `</div>`;
  });
  html += `</div>`;

  // Placement des barres (overlay)
  let blocks = 0;
  APT_IDS.forEach((aptId, rowIdx) => {
    const aptResas = reservations.filter(r => r.apt === aptId && r.status !== 'cancelled' && r.from <= end && r.to > start);
    aptResas.forEach(resa => {
      const visFrom = resa.from < start ? start : resa.from;
      const colStart = days.indexOf(visFrom);
      if (colStart < 0) return;
      const spanDays = Math.min(diffDays(visFrom, resa.to), days.length - colStart);
      if (spanDays <= 0) return;
      const left = APT_LABEL_W + colStart*CELL_W + 2;
      const width = spanDays*CELL_W - 4;
      void `${left}${width}`; // simule la construction du style de la barre
      blocks++;
    });
  });

  const cellNodes = 1 + dayCount + APT_IDS.length*(1+dayCount);
  return { htmlLen: html.length, cellNodes, blocks, dayCount };
}

function bench(label, reservations) {
  // warmup
  buildYear(reservations);
  const N = 20, t = [];
  for (let i = 0; i < N; i++) { const a = performance.now(); buildYear(reservations); t.push(performance.now()-a); }
  t.sort((x,y)=>x-y);
  const med = t[Math.floor(N/2)], max = t[N-1];
  const info = buildYear(reservations);
  console.log(`  ${label}`);
  console.log(`    médiane ${med.toFixed(1)} ms | max ${max.toFixed(1)} ms  (build chaîne + placement barres, ${N} itérations)`);
  console.log(`    nœuds cellules: ${info.cellNodes} | barres: ${info.blocks} | HTML: ${(info.htmlLen/1024).toFixed(0)} Ko | jours: ${info.dayCount}`);
}

// 1) Données réelles (fixture locale si dispo, sinon anonymisée)
let real;
try { real = JSON.parse(readFileSync(join(root,'test/fixtures/prod-sample.local.json'),'utf8')).reservations; }
catch { real = JSON.parse(readFileSync(join(root,'test/fixtures/prod-sample.json'),'utf8')).reservations; }

// 2) ~150 réservations synthétiques réparties sur l'année et les apparts (déterministe)
const many = [];
for (let i = 0; i < 150; i++) {
  const apt = APT_IDS[i % APT_IDS.length];
  const startDay = (i * 17) % 360;            // étalé sur l'année
  const nights = 2 + (i % 6);
  const from = toISO(addDays(new Date(YEAR,0,1), startDay));
  const to   = toISO(addDays(new Date(YEAR,0,1), startDay + nights));
  many.push({ apt, from, to, status: ['paid','unpaid','advance'][i%3], total: 100, paid: 0, discount: 0 });
}

console.log('\n=== Rendu vue ANNÉE (proxy CPU — pas le paint navigateur) ===\n');
console.log(`Données réelles (${real.length} réservations) :`);
bench('rendu', real);
console.log(`\nCharge synthétique (${many.length} réservations, proche de ta prod) :`);
bench('rendu initial', many);
console.log('    → un re-render (refreshAll après création/modif) refait exactement ce même travail :');
bench('re-render', many);

console.log('\nNote : le coût dominant est le layout/paint d\'une grille ~23 400 px avec ~5 856 nœuds,');
console.log('       NON mesurable ici. Test appareil requis (mobile ~380 px) pour valider la fluidité.\n');
