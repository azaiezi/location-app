// Test headless du bloc D2 (quota localStorage). Extrait les VRAIES fonctions
// isQuotaError / saveData / storeBackupSnapshot de index.html et les exécute
// contre un localStorage simulé avec plafond de capacité.
//   Exécuter :  node test/verify-quota.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Extrait `function NAME(...) { ... }` par comptage d'accolades (sûr ici : pas
// d'accolade dans les littéraux de ces fonctions).
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('fonction introuvable: ' + name);
  let depth = 0, began = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') { depth++; began = true; }
    else if (src[j] === '}') { depth--; if (began && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('accolade non fermée: ' + name);
}

const srcQuota = extractFn(html, 'isQuotaError');
const srcSave  = extractFn(html, 'saveData');
const srcStore = extractFn(html, 'storeBackupSnapshot');

// localStorage simulé avec plafond d'octets (approximé par longueur des chaînes).
function makeLS(limit) {
  const map = new Map();
  const projected = (k, v) => {
    let s = 0;
    for (const [kk, vv] of map) if (kk !== k) s += kk.length + vv.length;
    return s + k.length + v.length;
  };
  return {
    _map: map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      v = String(v);
      if (projected(k, v) > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      map.set(k, v);
    },
    removeItem: k => map.delete(k),
  };
}

// Fabrique les 3 fonctions en leur injectant l'environnement (closure).
function build({ localStorage, reservations, aptConfig, keep = 7 }) {
  const toast = () => {};
  const loadBackupSettings = () => ({ enabled: false, time: '22:00', keep });
  const factory = new Function(
    'localStorage', 'reservations', 'aptConfig', 'toast', 'loadBackupSettings', 'BACKUP_STORE_KEY', 'BACKUP_LAST_KEY',
    `${srcQuota}\n${srcSave}\n${srcStore}\nreturn { isQuotaError, saveData, storeBackupSnapshot };`
  );
  return factory(localStorage, reservations, aptConfig, toast, loadBackupSettings, 'BK', 'BK_LAST');
}

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + '\n     ' + (e && e.message || e)); } };

console.log('\n=== isQuotaError ===');
test('reconnaît name/code de quota, ignore erreur générique', () => {
  const { isQuotaError } = build({ localStorage: makeLS(1e6), reservations: [], aptConfig: {} });
  assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);
  assert.equal(isQuotaError({ code: 22 }), true);
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(isQuotaError(new Error('autre')), false);
  assert.equal(isQuotaError(null), false);
});

console.log('\n=== saveData : rollback anti-écriture-partielle ===');
test('échec quota sur la 2e clé → rollback, données précédentes intactes, retour false', () => {
  const ls = makeLS(60);                       // plafond serré
  ls.setItem('gestappart_reservations', '[]'); // état précédent (petit)
  ls.setItem('gestappart_apts', '{}');
  const before = { r: ls.getItem('gestappart_reservations'), a: ls.getItem('gestappart_apts') };
  // Nouvel état : reservations tient, mais aptConfig énorme fait dépasser
  const huge = {}; for (let i = 0; i < 50; i++) huge['APT' + i] = { price: 100, capacity: '' };
  const { saveData } = build({ localStorage: ls, reservations: [{ id: '1' }], aptConfig: huge });
  const ok = saveData();
  assert.equal(ok, false, 'doit signaler l’échec');
  assert.equal(ls.getItem('gestappart_reservations'), before.r, 'reservations rollback à l’état précédent');
  assert.equal(ls.getItem('gestappart_apts'), before.a, 'apts inchangé');
});
test('succès normal → retour true, données écrites', () => {
  const ls = makeLS(1e6);
  const { saveData } = build({ localStorage: ls, reservations: [{ id: 'x' }], aptConfig: { APT1: { price: 60, capacity: '' } } });
  assert.equal(saveData(), true);
  assert.deepEqual(JSON.parse(ls.getItem('gestappart_reservations')), [{ id: 'x' }]);
});

console.log('\n=== storeBackupSnapshot : rétention + résilience quota ===');
test('rétention : plafonne à keep derniers', () => {
  const ls = makeLS(1e6);
  const { storeBackupSnapshot } = build({ localStorage: ls, reservations: [], aptConfig: {}, keep: 3 });
  for (let i = 0; i < 5; i++) assert.equal(storeBackupSnapshot({ date: 'd' + i, reservations: [] }), true);
  const stored = JSON.parse(ls.getItem('BK'));
  assert.equal(stored.length, 3);
  assert.equal(stored[0].date, 'd4', 'le plus récent en tête');
});
test('quota : purge les anciens pour caser le plus récent → true, newest conservé', () => {
  const ls = makeLS(1e6);
  const { storeBackupSnapshot } = build({ localStorage: ls, reservations: [], aptConfig: {}, keep: 10 });
  // pré-remplir avec de gros anciens snapshots
  const big = 'x'.repeat(200);
  storeBackupSnapshot({ date: 'old1', reservations: [], blob: big });
  storeBackupSnapshot({ date: 'old2', reservations: [], blob: big });
  // rétrécir le plafond : seul ~1 snapshot tient désormais
  const tight = makeLS(400);
  const { storeBackupSnapshot: store2 } = build({ localStorage: tight, reservations: [], aptConfig: {}, keep: 10 });
  // recharger les anciens dans tight n'est pas nécessaire : on teste qu'un nouveau passe seul
  tight.setItem('BK', JSON.stringify([{ date: 'old', reservations: [], blob: big }]));
  const ok = store2({ date: 'newest', reservations: [], blob: big });
  assert.equal(ok, true, 'doit réussir en purgeant l’ancien');
  const stored = JSON.parse(tight.getItem('BK'));
  assert.ok(stored.some(b => b.date === 'newest'), 'le plus récent est conservé');
});
test('quota : même seul le snapshot ne tient pas → false, pas de casse', () => {
  const ls = makeLS(50);   // trop petit pour tout snapshot
  const { storeBackupSnapshot } = build({ localStorage: ls, reservations: [], aptConfig: {}, keep: 5 });
  const ok = storeBackupSnapshot({ date: 'd', reservations: [], blob: 'y'.repeat(500) });
  assert.equal(ok, false);
});

console.log(`\n──────────────\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
