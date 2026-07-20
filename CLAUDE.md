# GestAppart – Gestion Réservations

Application web mobile (**PWA**) permettant à un propriétaire de gérer les
réservations de ses appartements de location : calendrier d'occupation,
suivi des paiements, statistiques et sauvegardes. Fonctionne **hors-ligne**,
UI **en français**.

Déployée sur **GitHub Pages** : https://azaiezi.github.io/location-app/

## Stack technique & contraintes

- **HTML + CSS + JavaScript vanilla** — aucun framework, **aucune étape de build**.
- **Application mono-fichier** : tout le HTML, le CSS (`<style>`) et le JS
  (`<script>`) vivent dans `index.html`. Il n'y a pas de fichiers `.css`/`.js`
  séparés (hors service workers).
- **Persistance** : `localStorage` uniquement (pas de backend, pas de base).
- **Dépendances PDF (locales, same-origin)** : `jsPDF 2.5.1` + `jspdf-autotable 3.5.28`,
  rapatriées dans `vendor/` et précachées par le service worker → **l'export PDF
  fonctionne hors-ligne**. Plus aucune dépendance CDN. Pour mettre à jour ces
  librairies : remplacer les fichiers de `vendor/`, ajuster la version notée ici
  et dans `sw.js`, puis incrémenter `PDF_CACHE`.
- Cible : mobile, mode `standalone`, orientation portrait.

## Structure des fichiers

```
location-app-main/
├── CLAUDE.md            ← ce fichier
├── index.html           ← TOUTE l'application (HTML + CSS inline + JS inline, ~2090 lignes)
├── manifest.json        ← manifeste PWA (nom, icônes, scope /location-app/, thème)
├── sw.js                ← service worker unique (cache-first + skipWaiting + purge, cache PDF séparé)
├── vendor/              ← librairies JS locales (offline)
│   ├── jspdf.umd.min.js               ← jsPDF 2.5.1
│   └── jspdf.plugin.autotable.min.js  ← jspdf-autotable 3.5.28
└── icons/
    ├── icon-192.png     ← icône PWA 192×192 (any maskable)
    └── icon-512.png     ← icône PWA 512×512 (any maskable)
```

### Organisation interne de `index.html`

- **Lignes ~12–299** : `<style>` — thème clair/sombre via variables CSS (`--bg`,
  `--primary`…), styles du calendrier, des modales, badges de statut.
- **Lignes ~307–660** : balisage `<body>` — top bar, onglets, conteneurs de vues
  et modales (formulaire, statut, paramètres, recherche, confirmation).
- **Lignes ~661–2081** : `<script>` — toute la logique applicative.

### Modèle de données (localStorage)

- `gestappart_reservations` : tableau de réservations. Champs :
  `id, prenom, nom, tel, apt, from, to, persons, status, total, paid, discount, notes`.
  `status ∈ { paid, advance, unpaid, cancelled }`, dates `from`/`to` au format `YYYY-MM-DD`.
  ⚠️ `paid > total` existe en prod (données réelles) — **valeur légitime à préserver**,
  jamais à « corriger » hors du formulaire.
- `gestappart_apts` : config par appartement `{ APT1: { price, capacity }, ... }`
  (`capacity` peut valoir `""`).
- `theme` : `light` / `dark`.
- Les appartements sont une **liste fixe** (`APT_IDS`, 15 entrées) définie en dur.

### Versioning du schéma & import/export (bloc `//<<DATA_CORE_START>>` dans `index.html`)

- **`SCHEMA_VERSION`** (actuellement `2`) est ajouté aux fichiers **exportés** et aux
  snapshots de backup. Deux formats de fichier legacy coexistent en prod et doivent
  rester importables :
  - **export manuel** (`exportJSON`) : `{ reservations, aptConfig, exportDate }`, sans version ;
  - **backup auto/manuel** (`performAutoBackup`) : `{ date, reservations, aptConfig, version:"1.0" }`.
- **Migration** : `migrate(data)` est un **pipeline idempotent et extensible** (`MIGRATIONS`).
  L'absence de `schemaVersion` (export sans version **ou** backup `version:"1.0"`) = **legacy = v0**,
  jamais rejeté. Pour une future v3 : bump `SCHEMA_VERSION` + ajouter `MIGRATIONS[2]`.
- **Import non destructif** (`importJSON` → `validateImportStructure` + `prepareImport`) :
  parse → validation de structure → migration + normalisation **tolérante** dans une
  structure temporaire → **backup auto de l'état courant** (réversible via « Restaurer
  une sauvegarde ») → seulement ensuite `saveData()`. Tout échec laisse les données
  **intactes**. Rejet uniquement si structure fondamentalement incompatible (pas un objet,
  pas de tableau `reservations`).
- **Normalisation** (`normalizeReservation`) : complète les champs **manquants** avec des
  défauts (`persons→1, status→'unpaid', total/paid/discount→0, chaînes→''`) **sans jamais
  altérer** une valeur présente et bien typée.

> ⚠️ **Critère d'acceptation BLOQUANT (prod)** : l'app est en production. Toute évolution
> du format ou de l'import **doit** restaurer à l'identique le JSON de prod réel (mêmes
> réservations, mêmes champs, mêmes valeurs). Fixtures + test headless : voir ci-dessous.

### Calendrier — vue ANNÉE scrollable horizontalement

- **Plage rendue = année civile en cours** (`calYear`, 365/366 colonnes), pas une fenêtre
  de 30 jours. Grille construite en JS (`renderCalendar`) avec **largeurs fixes en px** :
  `CELL_W = 64`, `APT_LABEL_W = 72`, `ROW_H = 48`. Largeur totale = `72 + dayCount×64`
  (≈ 23 400 px) → défilement horizontal dans `.cal-wrap` (`overflow:auto`). Le reste de la
  page ne scrolle pas (`html/body`, `#app`, `.screen` en `overflow:hidden`).
- **Boutons = raccourcis de SCROLL** (plus de re-render) : `Auj.` → `scrollToToday()` ;
  `‹`/`›` → `cal-wrap.scrollBy(±30×CELL_W)` (≈ un mois). Le bouton `30j` et le code mort
  `setDays`/`btn-<n>` ont été retirés.
- **Ouverture positionnée sur aujourd'hui** (1er rendu → `scrollToToday(false)`). Les
  re-renders suivants (refreshAll après création/modif) **préservent la position de scroll**
  (flag `cal-wrap.dataset.calReady`) — éditer une résa de décembre ne ramène pas la vue à juillet.
- Libellé de plage = « Année {calYear} » ; case coin haut-gauche = l'année.
- ⚠️ **Limite connue** : la vue ne rend qu'**une seule année civile** (l'année en cours, pas
  de navigation d'année). Une **réservation à cheval sur le nouvel an** (ex. 28/12 → 03/01)
  n'est donc que **partiellement visible** : seule la portion dans l'année affichée apparaît
  (barre écrêtée à la fin/au début d'année), l'autre portion appartient à une année non rendue.
- **Barres de réservation** = overlays en position absolue, calculés depuis **le même `CELL_W`**
  (`left = 72 + colStart×CELL_W + 2`, `width = spanDays×CELL_W − 4`). Changer `CELL_W` réaligne
  automatiquement les barres (colStart/spanDays dépendent des dates, pas de la largeur).
- **Sticky** : en-tête des dates (`top:0`), colonne des noms d'appart (`left:0`), et **case coin
  haut-gauche** (`top:0; left:0; z-index:25`) épinglée pendant les deux défilements.
- **Perf (approche 1, sans virtualisation)** : grille année ≈ **5 856 nœuds de cellules**,
  HTML ~**521 Ko**, ~23 400 px. Coût JS (build + placement barres) **négligeable** (<1 ms,
  mesuré `test/perf-calendar.mjs`, même à 150 résas et en re-render). Le coût réel = **layout/paint**
  du navigateur, non mesurable hors appareil → **à surveiller sur mobile** ; si saccadé, envisager
  la virtualisation (approche 2) plutôt qu'un hack.

### Notifications toast — durées par type

- `toast(msg, type, durée?)`. **Défaut 2500 ms** si `durée` non fournie → succès standards
  **et** toutes les erreurs/avertissements (quota D2, import échoué D1, saisie V1…) restent
  lisibles. **Les toasts d'erreur ne passent jamais de durée** (donc 2500 ms, inchangés).
- **Court (1800 ms)** — passé explicitement aux confirmations anodines : sauvegarde
  (`performAutoBackup`), export JSON, `📥 Fichier téléchargé`, `✅ Rapport PDF ouvert !`.
- **Succès important (2800 ms)** : `✅ Import réussi : N réservation(s)` (le temps de lire le nombre).

### Filtre Statistiques — multi-sélection d'appartements

- L'onglet **Statistiques → « par période & appartement »** utilise un **composant à
  cases à cocher sur mesure** (pas de `<select multiple>` natif) : déclencheur `#stat-apt-trigger`
  + menu `#stat-apt-menu` (role `listbox`, `aria-checked`, cases de 44px, scrollable,
  fermeture au clic extérieur / Échap). Mobile-first, identique desktop/mobile.
- État central : `statSelectedApts` (Set des apparts **explicitement cochés**), source =
  `APT_IDS`. Helpers purs : `statAptsEffective()`, `statIsAll()`, `statAptsLabel()`.
- **Sémantique « vide = tous »** : set vide (ou tous cochés) ⇒ tous les appartements.
  La case « Tous » coche/décoche tout et reflète l'état (indéterminée si partiel).
- Vues câblées sur cet état (aucune logique de calcul dupliquée) : cartes de synthèse
  (CA/encaissé agrégés), détail par hébergement (n'affiche que les sélectionnés), et
  **export PDF** (titre + nom de fichier reflètent la sélection). Le filtre par date
  reste combinable. Fermer le menu recalcule si des dates valides sont saisies.
- ⚠️ Le calcul comptable reste centralisé dans `renderPeriodStats` ; si le correctif
  « encaissé » (`montantEncaisse(r)`) est fait plus tard, la multi-sélection en hérite
  sans changement.

### Validation de saisie (`saveReservation`)

- **Règles DURES (bloquent l'enregistrement, message rouge sous le champ via
  `setFieldError`)** : `persons` entier ≥ 1 ; `discount`/`paid`/`total` numériques et ≥ 0.
  Parsing robuste (`readNumField` : vide/espaces/virgule décimale, jamais de `NaN` en base).
- **Avertissements SOUPLES (confirmables, n'empêchent pas d'enregistrer)** :
  `persons > capacity` (seulement si la `capacity` de l'appart est renseignée et numérique ;
  `capacity:""` → aucun avertissement) ; `paid > total` en statut `advance` (trop-perçu légitime).
- **PAS de règle dure `paid ≤ total`** : un trop-perçu / acompte est valide (cf. fixture
  `paid 420 > total 200`). L'ancien clamp silencieux `paid≤final` a été retiré au profit
  d'un avertissement souple.
- **Principe** : la validation dure ne porte que sur les valeurs **saisies** dans le
  formulaire ; elle ne doit jamais bloquer l'édition d'une résa existante à cause d'une
  valeur pré-existante non modifiée.
- ⚠️ **Comportement pré-existant NON modifié (moteur de prix)** : `calcTotal`/`syncPaymentStatus`
  recalculent `total` et forcent `paid` selon le statut dès l'ouverture/à l'enregistrement
  (ex. statut `paid` → `paid = total final`). Éditer une résa legacy peut donc recalculer
  `paid` indépendamment de V1. À traiter séparément si on veut préserver un `paid` legacy.

### Dates calendaires — TOUJOURS en local, jamais UTC

- Les dates de réservation (`from`/`to`) sont des **chaînes `"AAAA-MM-JJ"`** issues
  directement de `<input type="date">`, stockées telles quelles, comparées par
  **comparaison de chaînes** (`hasConflict`) — TZ-agnostique.
- **Règle** : pour convertir une `Date` en chaîne calendaire, utiliser **`toISO`**
  (formatage local `getFullYear/getMonth+1/getDate`), **jamais `toISOString()`** qui
  passe en UTC et peut **reculer d'un jour** sur une date à minuit local dans un fuseau
  à l'est de UTC. Idem : parser une chaîne avec `parseDate` (`new Date(y, m-1, d)` local),
  jamais `new Date("AAAA-MM-JJ")` (interprété UTC). `addDays` construit aussi en local
  (`new Date(y, m, d+n)`) → robuste aux changements d'heure (DST). Writer et reader
  doivent rester alignés (tous locaux).
- Exceptions légitimes en UTC : les **horodatages** complets (`exportDate`, `date` des
  backups) via `new Date().toISOString()` — ce sont des instants, pas des dates calendaires.
- **Diagnostic Q1 retenu = Cas A** : aucune date en base n'était décalée (writer stockait
  déjà des chaînes correctes) ; le bug était uniquement en génération de grille/affichage
  via `toISOString()`. Correctif **d'affichage seulement, zéro mutation du stockage**.

### Robustesse du stockage & quota (`saveData`, `storeBackupSnapshot`)

- **Quota** : `isQuotaError(e)` détecte le dépassement (`QuotaExceededError`, code 22/1014…).
  `saveData()` renvoie un booléen et, en cas d'échec, effectue un **rollback des deux clés**
  (`gestappart_reservations` / `gestappart_apts`) → **jamais d'écriture partielle** ; le
  `localStorage` reste cohérent avec la dernière sauvegarde réussie. Message quota explicite.
- **Rétention des backups** : `storeBackupSnapshot()` garde les **N derniers** (réglage
  `keep`, min 1), le plus récent en tête. Résilient au quota : purge les plus anciens et
  réessaie ; renvoie `false` si même le plus récent ne tient pas — **sans jamais** toucher
  aux données courantes.
- **Backup pré-import fiable (lien avec D1)** : si le backup de l'état courant échoue
  (quota), l'import **ne se fait pas en silence** → seconde confirmation avertissant que
  l'opération serait **sans point de retour** (l'utilisateur peut nettoyer d'abord, ou
  confirmer explicitement). `commitImport()` vérifie aussi le retour de `saveData` : si
  l'écriture finale échoue, l'utilisateur est prévenu (« affiché mais non enregistré »),
  les anciennes données restant persistées.
- **`loadData` ne réécrit pas** : la normalisation au chargement est **en mémoire seulement** ;
  elle n'est persistée qu'à la prochaine mutation (`saveData`).

### Tests (non déployés)

- **⚠️ Confidentialité** : le dépôt est public. `test/fixtures/prod-sample.json` est une
  version **ANONYMISÉE** (noms/téléphones factices, PII retirée des notes ; structure,
  valeurs numériques et cas limites identiques). Le **vrai** backup reste en local sous
  `test/fixtures/prod-sample.local.json`, **exclu par `.gitignore`** (`*.local.json`).
  Ne jamais committer de données réelles de locataires.
- `test/fixtures/` : `prod-sample.json` (anonymisée, 13 résas), `export-legacy-sample.json`,
  + fichiers `invalid-*.json` (cas d'échec).
- `test/verify-migration.mjs` : extrait le bloc pur `//<<DATA_CORE_START>>…END` de
  `index.html` et le vérifie contre les fixtures (dont la restauration à l'identique).
- `test/verify-quota.mjs` : extrait `isQuotaError`/`saveData`/`storeBackupSnapshot` et les
  teste contre un `localStorage` simulé plein (rollback, rétention, résilience).
- `test/verify-dates.mjs` : extrait `toISO`/`parseDate`/`addDays`/`diffDays`/`mondayOf` et
  vérifie l'absence de décalage d'un jour + la robustesse DST. **Piloté par `TZ`** — à
  lancer sous un fuseau à offset positif ET sous un fuseau DST (sous UTC le bug est invisible).
- `test/verify-multiselect.mjs` : extrait `statAptsEffective`/`statIsAll`/`statAptsLabel`
  et vérifie la sémantique « vide = tous », sous-ensembles et libellés.
- Lancer :
  ```
  node test/verify-migration.mjs && node test/verify-quota.mjs
  TZ='Africa/Tunis' node test/verify-dates.mjs && TZ='Europe/Paris' node test/verify-dates.mjs
  ```
  Le dossier `test/` n'est ni référencé par `index.html` ni précaché par `sw.js`.

### Fonctionnalités clés (repères dans le JS)

- Vues : **calendrier** (`renderCalendar`), **liste** (`renderList`),
  **stats** (`renderStats`, `renderPeriodStats`) — navigation via `switchTab`.
- Réservations : `openForm` / `saveReservation`, contrôle des chevauchements
  `hasConflict`, changement de statut `setStatus`, calcul remise `calcTotal`.
- Sauvegardes : export/import JSON (`exportJSON`/`importJSON`), snapshots et
  **sauvegarde automatique du soir** (`scheduleAutoBackup`, `checkMissedBackup`,
  `performAutoBackup`) stockés dans localStorage.
- Export **PDF** (`exportPDF`) via jsPDF/autotable.
- Autres : autocomplétion client (`suggestClients`), recherche de disponibilité
  (`searchAvailability`), thème (`toggleTheme`).

## Commandes utiles

```bash
# Lancer en local (serveur statique — ouvrir ensuite http://localhost:8000)
python3 -m http.server 8000
# ou
npx serve .

# Déploiement : push sur la branche servie par GitHub Pages (aucun build).
git add -A && git commit -m "…" && git push
```

> ⚠️ Le `scope`/`start_url` du manifeste est `/location-app/` (chemin du dépôt
> GitHub Pages). En local à la racine (`http://localhost:8000/`), l'installation
> PWA / le scope du service worker peuvent différer de la prod.

## Conventions de code

- Rester en **vanilla JS**, sans build ni dépendance supplémentaire non-CDN.
- Tout le code reste **dans `index.html`** (style et logique inline) — conserver
  cette organisation mono-fichier tant qu'aucune décision contraire n'est prise.
- **UI, libellés et commentaires en français.**
- Handlers déclenchés par `onclick="fn()"` dans le HTML → les fonctions sont
  **globales** dans le `<script>`.
- Toute mutation d'état doit appeler `saveData()` puis `refreshAll()` pour
  persister et rafraîchir les vues.
- Thématisation par **variables CSS** (`var(--…)`), pas de couleurs en dur dans
  le nouveau code lorsqu'une variable existe.

## Particularités PWA — À NE PAS OUBLIER

Un **seul** service worker : `sw.js`, enregistré à [index.html](index.html)
(~ligne 1808). Il gère `skipWaiting`, `clients.claim` et la purge des anciens
caches à l'activation.

⚠️ **Versioning du cache.**
**Ne pas confondre 3 « versions »** : (1) la **version affichée** dans « À propos »
(`index.html`, actuellement **`GestAppart v2.0`**) ; (2) le **nom de cache SW** ci-dessous
(logique d'incrément à chaque déploiement) ; (3) `SCHEMA_VERSION`/`version:"1.0"` = versions
du **format de données** (migration/import) — **ne jamais toucher** pour un changement d'affichage.

Le nom de cache est défini par la constante `CACHE`
en haut de `sw.js` (actuellement `gestappart-v14`). Il n'est pas incrémenté
automatiquement. **À chaque modification de `index.html` (ou d'un autre asset mis
en cache), incrémenter cette constante** (`-v15`, `-v16`, …), sinon l'ancienne
version reste servie depuis le cache sur mobile.

**Deux caches, une liste blanche** : les librairies PDF vivent dans un cache
séparé `PDF_CACHE` (`gestappart-pdf-v2`) pour survivre aux bumps de `CACHE` et
éviter un re-téléchargement de ~400 Ko à chaque déploiement. La purge à
l'`activate` utilise une liste blanche `KEEP = [CACHE, PDF_CACHE]` (`!KEEP.includes(k)`)
au lieu d'un simple `k !== CACHE`, pour ne pas supprimer `PDF_CACHE`.

⚠️ **Conséquence : bumper `CACHE` ne rafraîchit PAS les fichiers de `vendor/`.**
Comme `PDF_CACHE` survit aux bumps de `CACHE`, **toute modification du contenu de
`vendor/` (mise à jour de jsPDF/autotable, ou simple retouche d'un de ces fichiers)
exige d'incrémenter spécifiquement `PDF_CACHE`** (`gestappart-pdf-v3`, …), sinon
l'ancienne copie continue d'être servie. Pour mettre à jour une lib : remplacer le
fichier dans `vendor/`, ajuster la version notée dans `sw.js` et ci-dessus, puis
bumper `PDF_CACHE`.

⚠️ Balises HTML mal placées : des `<link rel="manifest">` / `<meta>` sont
dupliqués **après `</head>`** (lignes ~303–306) avec un `theme-color` différent
(`#2563eb`) de celui du `<head>` (`#1e293b`). À nettoyer.

## Améliorations envisagées

_(à compléter — laissé vide pour l'instant)_
