// Test headless du bloc Q1 (fuseau horaire / dates). Extrait les VRAIS helpers
// toISO / parseDate / addDays / diffDays / mondayOf de index.html et les vérifie.
// Piloté par TZ — à lancer sous un fuseau à offset positif ET sous un fuseau DST :
//   TZ='Africa/Tunis' node test/verify-dates.mjs
//   TZ='Europe/Paris' node test/verify-dates.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const TZ = process.env.TZ || '(défaut)';

// Extraction : lignes `const X = ...;` (one-liners) + fonction mondayOf par accolades.
const line = (name) => {
  const m = html.match(new RegExp('const ' + name + ' = [^\\n]*'));
  if (!m) throw new Error('helper introuvable: ' + name);
  return m[0];
};
function extractFn(name) {
  const start = html.indexOf('function ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') { depth++; began = true; }
    else if (html[j] === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('accolade non fermée: ' + name);
}
const factory = new Function(
  [line('toISO'), line('parseDate'), line('addDays'), line('diffDays'), extractFn('mondayOf'),
   'return { toISO, parseDate, addDays, diffDays, mondayOf };'].join('\n')
);
const { toISO, parseDate, addDays, diffDays } = factory();

const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/prod-sample.json'), 'utf8'));

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + '\n     ' + (e && e.message || e)); } };

console.log(`\n════ TZ=${TZ} ════`);

console.log('\n=== toISO local : plus de décalage d’un jour ===');
test('minuit local 31/12/2026 → "2026-12-31" (frontière fin d’année)', () => {
  assert.equal(toISO(new Date(2026, 11, 31)), '2026-12-31');
});
test('minuit local 01/01/2027 → "2027-01-01"', () => {
  assert.equal(toISO(new Date(2027, 0, 1)), '2027-01-01');
});
test('00:30 local (tôt le matin) ne recule pas d’un jour', () => {
  assert.equal(toISO(new Date(2026, 6, 19, 0, 30)), '2026-07-19');
});
test('fin de mois : 28/02 et 31/08', () => {
  assert.equal(toISO(new Date(2026, 1, 28)), '2026-02-28');
  assert.equal(toISO(new Date(2026, 7, 31)), '2026-08-31');
});

console.log('\n=== BLOQUANT : les 13 dates de prod stables (parseDate → toISO = identité) ===');
test('round-trip identité sur toutes les dates from/to de la fixture', () => {
  fixture.reservations.forEach((r, i) => {
    assert.equal(toISO(parseDate(r.from)), r.from, `from #${i + 1}`);
    assert.equal(toISO(parseDate(r.to)),   r.to,   `to #${i + 1}`);
  });
});

console.log('\n=== Grille calendrier : chaque réservation retrouve sa colonne ===');
test('days.indexOf(resa.from) trouve la bonne colonne (30 jours depuis un from)', () => {
  fixture.reservations.forEach((r, i) => {
    const start = parseDate(r.from);
    const days = [];
    for (let k = 0; k < 30; k++) days.push(toISO(addDays(start, k)));
    assert.equal(days[0], r.from, `col 0 = from #${i + 1}`);
    assert.equal(days.indexOf(r.from), 0, `indexOf from #${i + 1}`);
  });
});
test('clamp fin de bloc : toISO(addDays(parseDate(end),1)) = lendemain local', () => {
  assert.equal(toISO(addDays(parseDate('2026-12-31'), 1)), '2027-01-01');
  assert.equal(toISO(addDays(parseDate('2026-08-31'), 1)), '2026-09-01');
});

console.log('\n=== addDays / diffDays robustes à travers un changement d’heure (DST) ===');
// Europe/Paris : bascule PRINTEMPS le dim 29/03/2026, AUTOMNE le dim 25/10/2026.
test('addDays traverse la bascule de printemps sans sauter/répéter un jour', () => {
  assert.equal(toISO(addDays(parseDate('2026-03-28'), 1)), '2026-03-29');
  assert.equal(toISO(addDays(parseDate('2026-03-28'), 2)), '2026-03-30');
  assert.equal(toISO(addDays(parseDate('2026-03-29'), 1)), '2026-03-30');
});
test('addDays traverse la bascule d’automne correctement', () => {
  assert.equal(toISO(addDays(parseDate('2026-10-24'), 1)), '2026-10-25');
  assert.equal(toISO(addDays(parseDate('2026-10-24'), 2)), '2026-10-26');
});
test('diffDays correct à travers les deux bascules (Math.round absorbe ±1h)', () => {
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);  // printemps (23h dans l’intervalle)
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2);  // automne  (25h dans l’intervalle)
  assert.equal(diffDays('2026-03-29', '2026-03-29'), 0);
});
test('séjour à cheval sur la bascule : nb de nuits exact', () => {
  // réservation 27/03 → 31/03 = 4 nuits, malgré le printemps le 29
  assert.equal(diffDays('2026-03-27', '2026-03-31'), 4);
  // 23/10 → 27/10 = 4 nuits, malgré l’automne le 25
  assert.equal(diffDays('2026-10-23', '2026-10-27'), 4);
});

console.log(`\n────────────── TZ=${TZ}\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
