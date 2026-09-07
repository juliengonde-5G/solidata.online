# Contrats techniques figés — chantier « bordereau déchèterie » (2.50.0)

Ces contrats sont la référence commune des trois lots (backend / mobile / web), écrits à
fichiers disjoints. **Un lot ne modifie jamais un fichier d'un autre lot** ; s'il a besoin d'un
changement de contrat, il le note dans son rapport et l'agent de coordination tranche.

## 0. Vocabulaire
- **Point déchèterie** : un CAV (`cav.is_decheterie = true`). Ce n'est PAS un lieu technique
  (`lieux_techniques.categorie = 'dechetterie'`, arrêts) : ceux-ci ne produisent aucun bordereau.
- **Bordereau** : une ligne `tour_decheterie_bordereaux` + son PDF ; un par passage
  (tournée × point). Statuts : `a_valider` → `valide`.
- **Code de déchèterie** : l'une des 7 cases du formulaire Métropole
  (`DECHETERIES_METROPOLE` dans `backend/src/utils/bordereau-decheterie-pdf.js`) ; `null` = hors
  liste (commune écrite en clair dans Remarque(s)).

## 1. Schéma (lot backend — `backend/src/scripts/init-db.js`, section migrations, idempotent)

```sql
ALTER TABLE cav ADD COLUMN IF NOT EXISTS is_decheterie BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cav ADD COLUMN IF NOT EXISTS decheterie_code VARCHAR(40);   -- l'une des 7 cases, ou NULL (hors liste)
ALTER TABLE cav ADD COLUMN IF NOT EXISTS decheterie_pavid VARCHAR(20);  -- référence Métropole « Dech F12 » (information)

CREATE TABLE IF NOT EXISTS tour_decheterie_bordereaux (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20) UNIQUE NOT NULL,                       -- BD-AAAA-NNNN, séquentiel par année
  tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  tour_cav_id INTEGER REFERENCES tour_cav(id) ON DELETE SET NULL,
  cav_id INTEGER REFERENCES cav(id) ON DELETE SET NULL,     -- le document survit à la suppression du point
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  client_id VARCHAR(64) UNIQUE,                             -- idempotence du rejeu mobile
  date_enlevement DATE NOT NULL,                            -- jour civil Europe/Paris de la collecte
  decheterie_code VARCHAR(40),                              -- SNAPSHOT du code au moment de la collecte
  decheterie_libelle VARCHAR(255) NOT NULL,                 -- SNAPSHOT : libellé de la case, sinon nom du point
  cav_nom VARCHAR(255),
  poids_indicatif_kg NUMERIC(8,1) NOT NULL CHECK (poids_indicatif_kg >= 0 AND poids_indicatif_kg <= 60000),
  signature_agent BYTEA,                                    -- PNG, NULL si non recueillie
  signature_agent_absente_motif VARCHAR(40),                -- 'agent_indisponible' | NULL (liste fermée)
  signature_chauffeur BYTEA,                                -- PNG (obligatoire à la création ; NULL après anonymisation)
  signature_chauffeur_absente_motif VARCHAR(40),            -- 'anonymisation' | NULL
  remarques TEXT,
  statut VARCHAR(20) NOT NULL DEFAULT 'a_valider' CHECK (statut IN ('a_valider', 'valide')),
  pdf BYTEA NOT NULL,                                       -- le document courant (régénéré à la validation)
  pdf_genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
  valide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  valide_le TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tdb_tour ON tour_decheterie_bordereaux(tour_id);
CREATE INDEX IF NOT EXISTS idx_tdb_cav ON tour_decheterie_bordereaux(cav_id);
CREATE INDEX IF NOT EXISTS idx_tdb_a_valider ON tour_decheterie_bordereaux(created_at) WHERE statut = 'a_valider';
```

**Doctrine de stockage** : signatures et PDF en base (BYTEA), **jamais** sous `/uploads`
(servi statiquement par `index.js` : une signature y serait accessible par URL). Le PDF pèse
~15 Ko, une signature ≤ 200 Ko décodés (borne serveur).

**Seed à verrou** (init-db, clé `settings` `collecte.decheteries_metropole_seed`) : lit
`backend/src/data/decheteries-metropole.json` ; pour chaque entrée avec `id_solidata`, marque
`is_decheterie = true`, `decheterie_code`, `decheterie_pavid` sur le CAV **d'identifiant
`id_solidata` SI sa commune correspond** (normalisation casse/accents/tirets), sinon repli sur
un CAV dont le nom contient « chetterie » ET dont la commune correspond ; sinon ne marque rien
et le dit dans le journal. Le verrou n'est posé que si au moins un CAV a été marqué. Un
démarquage manuel ultérieur ne revient jamais (doctrine 2.26.4).

**Registre RGPD** (seed idempotent, même pattern que les entrées existantes) : traitement
« Collecte en déchèterie — bordereaux Métropole (signatures manuscrites) », base légale
obligation contractuelle/convention, durée = `rgpd.bordereaux_decheterie_retention_jours`
(défaut **1095** en code).

## 2. API backend (lot backend)

### 2.1 Côté chauffeur (jeton chauffeur, chemin `-public` ⇒ garde de périmètre véhicule existante)

`POST /api/tours/:id/cav/:cavId/bordereau-decheterie-public` — JSON
```json
{
  "client_id": "uuid-v4 généré par le mobile (obligatoire, ≤ 64 car.)",
  "poids_indicatif_kg": 185,
  "signature_chauffeur": "data:image/png;base64,....",
  "signature_agent": "data:image/png;base64,....  | null",
  "agent_absent_motif": "agent_indisponible | null   (obligatoire si signature_agent est null)"
}
```
Règles, dans cet ordre :
1. garde véhicule (existante) ; tournée de **démonstration** → `200 { demo: true }`, aucune
   écriture, aucune notification ;
2. `client_id` déjà connu → `200 { deja_enregistre: true, bordereau: { id, numero, statut } }` ;
3. le point doit être dans `tour_cav` de cette tournée ET `cav.is_decheterie` → sinon
   `409 { error, code: 'POINT_NON_DECHETERIE' }` (4xx : la file mobile purge, c'est voulu —
   refus définitif) ;
4. poids illisible / négatif / > 60 000 → `400 { code: 'POIDS_INVALIDE' }` ; signature chauffeur
   absente ou non PNG (`estPngValide`) ou > 200 Ko → `400 { code: 'SIGNATURE_INVALIDE' }` ;
   signature agent absente sans motif de la liste fermée → `400 { code: 'MOTIF_REQUIS' }` ;
5. **transaction** : numéro `BD-AAAA-NNNN` (MAX+1 de l'année, retry unique sur violation
   d'unicité), snapshots (code, libellé de la case ou nom du point, cav_nom, vehicle_id,
   driver_employee_id de la tournée), `date_enlevement` = jour civil Paris de NOW(),
   PDF généré par `genererBordereauPdf` (statut `a_valider`), INSERT ;
6. réponse `201 { bordereau: { id, numero, statut: 'a_valider', poids_indicatif_kg, date_enlevement } }` ;
7. **après la réponse** (jamais bloquant, erreurs journalisées) :
   - messagerie interne : `notifierGestionnaires({ texte: 'Collecte en déchèterie <libellé> — tournée #<id> : bordereau <numero> à valider (<poids> kg indicatifs)', source: 'bordereau_decheterie', lien: '/tours?tour=<tourId>' })` (`routes/tours/notifier.js`) ;
   - push : `sendPushToRoles(['ADMIN','MANAGER'], { title: 'Collecte en déchèterie', body, tag: 'bordereau-<id>', data: { url: '/tours?tour=<tourId>', tourId } })` ;
   - journal d'activité (entité `bordereau_decheterie`, action création).

Le poids indicatif **n'entre jamais** dans `tour_weights`, `tours.total_weight_kg`,
`tonnage_history` ni l'apprentissage.

### 2.2 Payloads mobiles enrichis (`GET /tours/:id/public`, `GET /tours/vehicle/:id/today`)
Chaque élément de `cavs[]` gagne :
```json
{ "is_decheterie": true, "decheterie_libelle": "Petit-Quevilly" | null, "bordereau_deja_depose": false }
```
(`decheterie_libelle` = libellé de la case du formulaire si code connu, sinon `null` ;
`bordereau_deja_depose` = EXISTS d'un bordereau tournée × point.) Points association et
tournées de bornes ordinaires : `is_decheterie: false`.

### 2.3 Côté back-office (`authenticate` + `authorize('ADMIN','MANAGER')`)
- `GET /api/tours/bordereaux/referentiel-decheteries` → `{ decheteries: [{ code, libelle }] }`
  (les 7 cases, ordre du formulaire).
- `GET /api/tours/:id/bordereaux` → `{ bordereaux: [BordereauResume] }` (ordre `created_at`).
- `GET /api/cav/:id/bordereaux` → `{ bordereaux: [BordereauResume & { tour_id, tour_date, vehicule }] }`
  (dans `routes/cav.js`, ADMIN/MANAGER).
- `GET /api/tours/bordereaux/:bid/pdf` → `application/pdf`, `Content-Disposition: inline;
  filename="bordereau-<numero>.pdf"`, `X-Content-Type-Options: nosniff`, `Cache-Control:
  no-store` ; **journalisé** `rgpd_audit_log` action `BORDEREAU_DECHETERIE_CONSULTE`
  (entity_type `tour_decheterie_bordereaux`, entity_id) + journal d'activité.
- `POST /api/tours/bordereaux/:bid/valider` → `200 { bordereau: BordereauResume }` ;
  `409 { code: 'BORDEREAU_DEJA_VALIDE' }` ; `404` inconnu. Effets en transaction : statut
  `valide`, `valide_par`, `valide_le = NOW()`, PDF **régénéré** avec `validation: { date }`
  (mention « Validé par Solidarité textiles sur Solidata le JJ/MM/AAAA » dans Remarque(s)) ;
  `rgpd_audit_log` `BORDEREAU_DECHETERIE_VALIDE` ; journal d'activité.

**Montage** (`routes/tours/index.js`) : `routes/tours/bordereaux.js` exporte
`{ routerChauffeur, routerBackOffice }`. `routerChauffeur` (la route `-public` du §2.1) est monté
AVANT `router.use(authenticate)` (l. ~1830) — le middleware `MOBILE_DRIVER_PATH` (l. 203)
authentifie et applique la garde de périmètre véhicule à tout chemin `-public`, sous-routeurs
compris. `routerBackOffice` est monté juste APRÈS `router.use(authenticate)` et AVANT
`./live-edit` (premier sous-routeur), donc avant toute route `/:id` ; dans ce routeur,
`/bordereaux/referentiel-decheteries` est déclaré avant `/bordereaux/:bid/pdf`.
Payloads mobiles : `GET /:id/public` et `GET /vehicle/:id/today` font `SELECT tc.*` +
`CAV_PHOTO_COLUMNS` puis `decoratePhotoState()` — ajouter `c.is_decheterie, c.decheterie_code`
au SELECT (alias explicites) et décorer `is_decheterie` / `decheterie_libelle` /
`bordereau_deja_depose` au même endroit. `rapport.js` nomme ses colonnes (riche + repli) :
ne PAS y toucher dans ce lot (le rapport de tournée n'affiche pas le bordereau en 2.50.0).

`BordereauResume` (jamais de BYTEA dans une liste) :
```json
{ "id": 12, "numero": "BD-2026-0007", "tour_id": 681, "cav_id": 338, "cav_nom": "…",
  "decheterie_code": "petit_quevilly" | null, "decheterie_libelle": "Petit-Quevilly",
  "date_enlevement": "2026-09-04", "poids_indicatif_kg": 185,
  "signature_agent_presente": true, "signature_agent_absente_motif": null,
  "signature_chauffeur_presente": true, "signature_chauffeur_absente_motif": null,
  "statut": "a_valider" | "valide", "valide_par_nom": "Prénom N." | null, "valide_le": null,
  "pdf_genere_le": "…", "created_at": "…" }
```

### 2.4 CAV (`routes/cav.js`)
- `GET /cav`, `GET /cav/:id` exposent `is_decheterie`, `decheterie_code`, `decheterie_pavid`.
- `PUT /cav/:id` et `POST /cav` acceptent `is_decheterie` (booléen) et `decheterie_code`
  (`null` ou l'un des 7 codes → sinon `400 { code: 'DECHETERIE_CODE_INVALIDE' }`) ;
  `decheterie_code` est ignoré (remis à `null`) si `is_decheterie` est faux.

### 2.5 RGPD
- Purge `purgeBordereauxDecheterie` dans `services/rgpd-purges.js`, entrée `PURGES_RGPD` :
  `cle: 'bordereaux_decheterie'`, `actionAuto: 'AUTO_PURGE_BORDEREAUX_DECHETERIE'`,
  `actionManuelle: 'PURGE_BORDEREAUX_DECHETERIE'`, `jobName: 'purgeBordereauxDecheterie'`,
  `entiteAudit: 'tour_decheterie_bordereaux'`, `retentionSetting:
  'rgpd.bordereaux_decheterie_retention_jours'`, `retentionDefaut: 1095`, `retentionUnite:
  'jours'` ; DELETE des lignes dont `created_at` dépasse le délai. Branchement au scheduler
  comme les 8 autres (même mécanisme, `JOB_SCHEDULE` si le registre l'exige).
- Anonymisation (`services/anonymization.js`) : pour l'employé anonymisé,
  `signature_chauffeur = NULL`, `signature_chauffeur_absente_motif = 'anonymisation'`,
  `driver_employee_id = NULL`, PDF régénéré (fonction partagée du service bordereau).
- Libellés français des nouveaux codes dans `frontend/src/utils/rgpd-libelles.js`
  (**fichier possédé par le lot backend** pour ce chantier — la garde
  `tests/unit/rgpd-audit-libelles.test.js` l'exige) : `BORDEREAU_DECHETERIE_CONSULTE`,
  `BORDEREAU_DECHETERIE_VALIDE`, `AUTO_PURGE_BORDEREAUX_DECHETERIE`,
  `PURGE_BORDEREAUX_DECHETERIE`. Idem pour l'entité `bordereau_decheterie` du journal
  d'activité (garde `activity-log-libelles.test.js`, dictionnaire côté front indiqué par le test).

## 3. Mobile (lot mobile — `mobile/src/**`, `mobile/tests/**`)
- Aiguillage : dans `FillLevel.jsx`, quand le point courant porte `is_decheterie` et pas
  `bordereau_deja_depose`, la confirmation de collecte enchaîne sur la route
  `/decheterie-bordereau` (nouvel écran `pages/DecheterieBordereau.jsx`) au lieu du retour
  carte. La collecte elle-même (file `pendingCollects`, `collect-public`) est **inchangée**.
- Écran (FALC, `MobileShell` + `PrimaryActionBar` + `StepConfirmScreen`) en 3 temps :
  (1) poids indicatif en kg — compteur à gros boutons (±10 / ±50, raccourcis 50/100/200,
  saisie clavier possible), obligatoire, ≥ 0 ; (2) signature de l'agent — pad + bouton
  « Effacer » + choix explicite « L'agent n'est pas disponible » (motif `agent_indisponible`) ;
  (3) signature du chauffeur — pad, obligatoire.
- `components/SignaturePad.jsx` : `<canvas>` maison, pointer events + `setPointerCapture`,
  `touch-action: none`, trait 3 px, fond transparent, dimension logique ≤ 600 × 220 (poids
  borné), export `toDataURL('image/png')`. Logique pure dans `services/signature.js`
  (`SIGNATURE_MIN_POINTS`, `signatureExploitable(traits)`, `estDataUrlPng(s)`).
- Règles pures dans `services/decheterie.js` : `bordereauRequis(point)`,
  `validerBordereau({ poidsKg, signatureAgent, agentAbsent, signatureChauffeur })` →
  `{ ok, erreurs: [] }`, `poidsIndicatifValide(n)`.
- File hors-ligne : nouveau store IndexedDB `pendingBordereaux` (`db.js`, version +1),
  élément `{ clientId, tourId, cavId, poidsKg, signatureAgent, agentAbsentMotif,
  signatureChauffeur, createdAt }` ; `sync.js` : `sendBordereau(item)` (JSON vers 2.1) et
  `syncPendingBordereaux()` dans `syncAll()`, politique existante 2xx purge / 4xx purge (sauf
  401) / 5xx conserve. Exception assumée à « aucun blob en file » : ce sont des signatures
  bornées, non re-recueillables.
- Hors ligne : le bordereau est **mis en file et dit tel quel** (« sera envoyé dès le réseau »),
  jamais bloquant ; `StepConfirmScreen` statut `pending`.
- Tests Vitest : services purs (signature, decheterie), file (2xx/4xx/5xx), composant en
  `renderToStaticMarkup`, et `importsResolus.test.js` toujours vert.

## 4. Web (lot web — `frontend/src/**` sauf `utils/rgpd-libelles.js` et le dictionnaire du journal d'activité)
- `pages/Tours.jsx` : section « Bordereaux déchèterie » dans `TourDetailPanel` (chargement
  paresseux `GET /tours/:id/bordereaux`, pattern Questionnaires), lignes : numéro, point,
  date, poids indicatif, badge statut, mention agent absent, boutons « Voir » (Modal `xl` +
  `<iframe>` sur objectURL du blob `GET /tours/bordereaux/:id/pdf`), « Télécharger »,
  « Valider » (ADMIN/MANAGER, `useConfirm`, puis rechargement). Lien profond `/tours?tour=<id>`
  ouvre directement la fiche (lu via `useSearchParams`).
- `pages/AdminCAV.jsx` : formulaire — case « Déchèterie de la Métropole » + sélecteur
  « Case du formulaire » (7 codes depuis `GET /tours/bordereaux/referentiel-decheteries` +
  « Hors liste ») ; liste — badge « Déchèterie » ; fiche — section « Bordereaux de collecte »
  (`GET /cav/:id/bordereaux`, mêmes boutons Voir/Télécharger, pas de validation ici).
- `utils/bordereaux.js` : `BORDEREAU_STATUT_META` (`a_valider` : « À valider », ambre ;
  `valide` : « Validé », vert) + `libelleStatutBordereau` / `classeStatutBordereau` —
  repli sur la valeur brute, jamais « — ».
- Composant partagé `components/tours/BordereauxDecheterie.jsx` (liste + visionneuse) utilisé
  par les deux pages.

## 5. Propriété des fichiers
| Lot | Fichiers |
|---|---|
| backend | `backend/src/scripts/init-db.js`, `backend/src/services/bordereau-decheterie.js` (nouveau), `backend/src/routes/tours/bordereaux.js` (nouveau), `backend/src/routes/tours/index.js` (montage + payloads mobiles), `backend/src/routes/cav.js`, `backend/src/services/rgpd-purges.js`, `backend/src/services/anonymization.js`, `backend/src/services/scheduler.js` / `monitoring.js` (si nécessaire), `backend/src/utils/bordereau-decheterie-pdf.js` (déjà écrit — n'ajouter que si nécessaire), `frontend/src/utils/rgpd-libelles.js`, dictionnaire du journal d'activité côté front, `backend/tests/**` |
| mobile | `mobile/src/**`, `mobile/tests/**` |
| web | `frontend/src/**` hors les deux dictionnaires ci-dessus |
| coordination | `rapports/decheterie-2026-09-06/**`, `CLAUDE.md`, `docs/**` |
