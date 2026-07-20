// Test headless du bloc D1+D3 : extrait le VRAI code pur de index.html
// (entre les marqueurs //<<DATA_CORE_START>> … //<<DATA_CORE_END>>) et le vérifie
// contre les fixtures. Critère BLOQUANT : restauration à l'identique du prod.
//   Exécuter :  node test/verify-migration.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// ── Extraire le bloc pur ──
const m = html.match(/\/\/<<DATA_CORE_START>>([\s\S]*?)\/\/<<DATA_CORE_END>>/);
assert.ok(m, 'Bloc DATA_CORE introuvable dans index.html');
const core = eval('(function(){' + m[1] + '\n return {SCHEMA_VERSION,migrate,normalizeReservation,validateImportStructure,prepareImport};})()');

const readFixture = f => JSON.parse(readFileSync(join(root, 'test/fixtures', f), 'utf8'));
let pass = 0, fail = 0;
const ok  = (name) => { pass++; console.log('  ✅ ' + name); };
const ko  = (name, e) => { fail++; console.log('  ❌ ' + name + '\n     ' + (e && e.message || e)); };
const test = (name, fn) => { try { fn(); ok(name); } catch (e) { ko(name, e); } };

console.log('\n=== CRITÈRE BLOQUANT : restauration à l’identique ===');

test('prod-sample (backup v1.0) : 13 réservations, valeurs identiques', () => {
  const raw = readFixture('prod-sample.json');
  const out = core.prepareImport(raw);
  assert.equal(out.reservations.length, 13);
  // Comparaison champ à champ avec l'original (mêmes valeurs, paid>total préservé)
  raw.reservations.forEach((orig, i) => {
    assert.deepEqual(out.reservations[i], {
      id: orig.id, prenom: orig.prenom, nom: orig.nom, tel: orig.tel, apt: orig.apt,
      from: orig.from, to: orig.to, persons: orig.persons, status: orig.status,
      total: orig.total, paid: orig.paid, discount: orig.discount, notes: orig.notes,
    }, 'réservation #' + (i + 1) + ' modifiée');
  });
});

test('prod-sample : paid > total CONSERVÉ (Bechir 420>200, Yahya 720>350)', () => {
  const out = core.prepareImport(readFixture('prod-sample.json'));
  assert.equal(out.reservations[0].paid, 420);
  assert.equal(out.reservations[0].total, 200);
  assert.equal(out.reservations[2].paid, 720);
});

test('prod-sample : tel préservé tel quel (chaîne, formats variés dont vide/espaces/+)', () => {
  const raw = readFixture('prod-sample.json');
  const out = core.prepareImport(raw);
  raw.reservations.forEach((orig, i) => {
    assert.equal(out.reservations[i].tel, orig.tel);        // valeur identique
    assert.equal(typeof out.reservations[i].tel, 'string'); // jamais coercé en nombre
  });
  // les cas limites doivent exister dans la fixture (garde-fou anti-régression)
  const tels = raw.reservations.map(r => r.tel);
  assert.ok(tels.some(t => t === ''), 'un tel vide attendu');
  assert.ok(tels.some(t => /\s/.test(t)), 'un tel avec espaces attendu');
  assert.ok(tels.some(t => t.startsWith('+')), 'un tel international attendu');
});

test('prod-sample : aptConfig identique, capacity "" préservée', () => {
  const raw = readFixture('prod-sample.json');
  const out = core.prepareImport(raw);
  assert.deepEqual(out.aptConfig, raw.aptConfig);
  assert.equal(out.aptConfig.APT1.capacity, '');
});

test('export-legacy (sans version) : 2 réservations identiques', () => {
  const raw = readFixture('export-legacy-sample.json');
  const out = core.prepareImport(raw);
  assert.equal(out.reservations.length, 2);
  raw.reservations.forEach((orig, i) => {
    Object.keys(orig).forEach(k => assert.deepEqual(out.reservations[i][k], orig[k], k));
  });
});

console.log('\n=== MIGRATION / IDEMPOTENCE ===');

test('migrate détecte legacy backup (version 1.0) comme v0 → schemaVersion courant', () => {
  const out = core.migrate(readFixture('prod-sample.json'));
  assert.equal(out.schemaVersion, core.SCHEMA_VERSION);
});

test('migrate est idempotent (rejouer ne change rien)', () => {
  const once = core.migrate(readFixture('prod-sample.json'));
  const twice = core.migrate(once);
  assert.deepEqual(twice, once);
});

console.log('\n=== CAS D’ÉCHEC : doivent être rejetés proprement (structure) ===');

test('other-app rejeté (pas de reservations)', () => {
  assert.equal(core.validateImportStructure(readFixture('invalid-other-app.json')).ok, false);
});
test('no-reservations rejeté', () => {
  assert.equal(core.validateImportStructure(readFixture('invalid-no-reservations.json')).ok, false);
});
test('objet null / tableau / primitive rejetés', () => {
  assert.equal(core.validateImportStructure(null).ok, false);
  assert.equal(core.validateImportStructure([1, 2]).ok, false);
  assert.equal(core.validateImportStructure('x').ok, false);
});
test('reservations:[] (vide mais valide) accepté', () => {
  assert.equal(core.validateImportStructure({ reservations: [] }).ok, true);
});

console.log('\n=== TOLÉRANCE : champs manquants complétés, pas de rejet ===');

test('réservation partielle : défauts appliqués sans planter', () => {
  const out = core.normalizeReservation({ from: '2026-01-01', to: '2026-01-03' });
  assert.equal(out.persons, 1);
  assert.equal(out.status, 'unpaid');
  assert.equal(out.total, 0);
  assert.equal(out.paid, 0);
  assert.equal(out.notes, '');
  assert.equal(typeof out.id, 'string');
});
test('status inconnu → "unpaid"', () => {
  assert.equal(core.normalizeReservation({ status: 'wtf' }).status, 'unpaid');
});

console.log(`\n──────────────\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
