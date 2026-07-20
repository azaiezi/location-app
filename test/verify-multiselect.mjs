// Test headless de la sémantique de multi-sélection d'appartements (feature Stats).
// Extrait les fonctions pures statAptsEffective / statIsAll / statAptsLabel de index.html.
//   node test/verify-multiselect.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function extractFn(name) {
  const start = html.indexOf('function ' + name);
  let depth = 0, began = false;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') { depth++; began = true; }
    else if (html[j] === '}') { depth--; if (began && depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error('introuvable: ' + name);
}

const APT_IDS = ['APT1','APT2','APT3','APT4','APT5','APT6','APT7','APT8','APTA','APTB','APTC','APTD','APTE','APTF','APTG'];
const factory = new Function('APT_IDS', 'getSel',
  `${extractFn('statAptsEffective').replace(/statSelectedApts/g,'getSel()')}
   ${extractFn('statIsAll').replace(/statSelectedApts/g,'getSel()')}
   ${extractFn('statAptsLabel')}
   return { statAptsEffective, statIsAll, statAptsLabel };`);

let sel = new Set();
const api = factory(APT_IDS, () => sel);

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + '\n     ' + (e.message || e)); } };

console.log('\n=== Sémantique « vide = tous » ===');
test('ensemble vide → statIsAll true, effective = tous, label "Tous les appartements"', () => {
  sel = new Set();
  assert.equal(api.statIsAll(), true);
  assert.deepEqual(api.statAptsEffective(), APT_IDS);
  assert.equal(api.statAptsLabel(), 'Tous les appartements');
});
test('tous cochés → équivaut à "tous"', () => {
  sel = new Set(APT_IDS);
  assert.equal(api.statIsAll(), true);
  assert.equal(api.statAptsLabel(), 'Tous les appartements');
});

console.log('\n=== Sous-ensembles ===');
test('APT1 + APT3 → effective = [APT1,APT3] (ordre APT_IDS), label "APT1, APT3"', () => {
  sel = new Set(['APT3', 'APT1']);
  assert.deepEqual(api.statAptsEffective(), ['APT1', 'APT3']);
  assert.equal(api.statIsAll(), false);
  assert.equal(api.statAptsLabel(), 'APT1, APT3');
});
test('mono-sélection → effective = [APTx] (comportement équivalent à avant)', () => {
  sel = new Set(['APT5']);
  assert.deepEqual(api.statAptsEffective(), ['APT5']);
  assert.equal(api.statAptsLabel(), 'APT5');
});
test('4+ sélectionnés → label compact "N appartements"', () => {
  sel = new Set(['APT1', 'APT2', 'APT3', 'APT4']);
  assert.equal(api.statAptsLabel(), '4 appartements');
});
test('valeur inconnue ignorée par effective (borné à APT_IDS)', () => {
  sel = new Set(['APTZ', 'APT2']);
  assert.deepEqual(api.statAptsEffective(), ['APT2']);
});

console.log(`\n──────────────\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
