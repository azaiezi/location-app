// ⚠️ Incrémenter cette version à CHAQUE modification d'un fichier mis en cache
// (index.html, manifest.json, assets…) pour forcer la mise à jour sur mobile.
const CACHE = 'gestappart-v14';

// Cache séparé pour les librairies PDF (jsPDF 2.5.1, jspdf-autotable 3.5.28).
// Volumineuses (~400 Ko) et à version figée → on les isole pour qu'elles
// survivent aux bumps de CACHE et évitent un re-téléchargement à chaque déploiement.
// N'incrémenter PDF_CACHE que si on change la version des librairies dans vendor/.
const PDF_CACHE = 'gestappart-pdf-v2';

// Caches à préserver lors de la purge à l'activation (liste blanche).
const KEEP = [CACHE, PDF_CACHE];

const ASSETS = ['./index.html', './manifest.json'];

const PDF_ASSETS = [
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(ASSETS)),
    caches.open(PDF_CACHE).then(c => c.addAll(PDF_ASSETS))
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
