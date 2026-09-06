# Bordereau déchèterie (2.50.0) — preuves de l'agent de debug

Rédigé le 6 septembre 2026. Objectif : prouver que le chantier « bordereau de
collecte déchèterie » (backend / mobile / web) fonctionne pour de vrai, sur
PostgreSQL 16.13 réel, à travers les vrais handlers Express — pas seulement
sur des mocks — et corriger tout défaut réel trouvé.

## 1. Environnement de preuve

- PostgreSQL 16.13 local (cluster `16/main`), PostGIS 3.4.2 + pgcrypto.
- Base `solidata_decheterie` créée pour ce chantier, rôle `solidata_user`.
- Séquence rejouée conforme à la doctrine du projet (échec attendu à la
  passe 1 sur une base neuve, documenté dans `CLAUDE.md` §12) :
  `init-db.js` (échoue passe 1, `clients_exutoires` absente) →
  `migrate-exutoires.js` → `migrate-finance.js` → `init-db.js` (passe 2, OK)
  → import du référentiel réel `import-cav-209.sql` (209 CAV) →
  `init-db.js` (passe 3, seed déchèteries) → `init-db.js` (passe 4,
  idempotence + persistance d'un démarquage manuel).
- Redis absent de l'environnement : vérifié non bloquant (`config/redis.js`
  dégrade, `middleware/cache.js` s'auto-neutralise, `init-db.js` ne le
  requiert jamais).
- Script de preuve HTTP : `scratchpad/proof.js` — monte les VRAIS routeurs
  (`routes/tours`, `routes/cav`) dans une app Express + `supertest`, jetons
  JWT signés avec `JWT_SECRET`, deux vraies signatures PNG 600×220
  (`sig_agent.png`, `sig_chauffeur.png`).

## 2. Tableau des vérifications

### 2.1 Schéma et seed (init-db.js)

| # | Vérification | Résultat |
|---|---|---|
| 1 | `cav.is_decheterie/decheterie_code/decheterie_pavid` créées, idempotentes (2 passages) | ✅ |
| 2 | `tour_decheterie_bordereaux` : CHECK `poids_indicatif_kg` [0,60000], CHECK `statut`, UNIQUE `numero`, UNIQUE `client_id`, index `idx_tdb_tour/cav/a_valider`, FK `ON DELETE SET NULL` (cav/vehicle/driver/tour_cav) et `ON DELETE CASCADE` (tour_id) | ✅ (vérifié par `\d` sur la table réelle) |
| 3 | Entrée `rgpd_registre` « Collecte en déchèterie — bordereaux Métropole (signatures manuscrites) » | ✅ |
| 4 | Base neuve sans référentiel CAV : 0 marqué, **verrou NON posé** (nouvelle tentative au démarrage suivant) | ✅ |
| 5 | Après import des 209 CAV réels : **15 points marqués**, dont **7 avec `decheterie_code`** (Cléon, Boos, Caudebec-lès-Elbeuf, Déville-lès-Rouen, Petit-Quevilly, Le Trait, **et Saint-Étienne-du-Rouvray**) — voir écart documenté en §3.1 | ✅ (comportement correct, chiffres différents de l'hypothèse de départ) |
| 6 | Verrou `collecte.decheteries_metropole_seed` posé après le marquage | ✅ |
| 7 | Démarquage manuel d'un CAV (`UPDATE cav SET is_decheterie=false`) **survit** à un 3ᵉ passage d'`init-db.js` | ✅ |
| 8 | La garde « id_solidata ne marque que si la commune correspond » a été **naturellement exercée** : sur la base fraîchement importée, les id 203/207 du référentiel Métropole tombent sur des CAV « ROUEN - … » sans rapport avec Bois-Guillaume/Cléon — non marqués par id, correctement rapprochés par repli nom+commune | ✅ |

### 2.2 Parcours réel via les vrais handlers Express (`proof.js`, 66/66 vérifications vertes)

| # | Vérification | Résultat |
|---|---|---|
| 1 | `GET /tours/:id/public` (jeton chauffeur) : point déchèterie → `is_decheterie:true`, `decheterie_libelle:"Petit-Quevilly"`, `bordereau_deja_depose:false` ; point ordinaire → `false`/`null` | ✅ |
| 2 | Dépôt nominal → `201`, numéro `BD-2026-0001`, statut `a_valider`, poids 185, `date_enlevement` = jour civil Paris | ✅ |
| 3 | Rejeu même `client_id` → `200 { deja_enregistre:true }`, même id, **une seule ligne** en base | ✅ |
| 4 | `bordereau_deja_depose:true` au rechargement de `/public` | ✅ |
| 5 | Véhicule B sur la tournée du véhicule A → `403` (garde de périmètre héritée) | ✅ |
| 6 | CAV ordinaire de la même tournée → `409 POINT_NON_DECHETERIE` | ✅ |
| 7 | Poids −1 et 70000 → `400 POIDS_INVALIDE` ; signature bidon → `400 SIGNATURE_INVALIDE` ; agent absent sans motif → `400 MOTIF_REQUIS` | ✅ (4/4) |
| 8 | Motif `agent_indisponible` accepté sur un point hors-liste → `201` ; snapshot `decheterie_code=NULL`, `decheterie_libelle`=nom du point, motif stocké | ✅ |
| 9 | Tournée `is_demo` → `200 { demo:true }`, **0 écriture** en base | ✅ |
| 10 | Poids indicatif : `tour_weights` vide, `tours.total_weight_kg` inchangé | ✅ |
| 11 | `GET /tours/bordereaux/:id/pdf` : ADMIN → `200 application/pdf`, `nosniff`, `no-store`, `rgpd_audit_log` `BORDEREAU_DECHETERIE_CONSULTE` écrit ; COLLABORATEUR web → `403` ; jeton chauffeur → `403` | ✅ |
| 12 | `POST /valider` (MANAGER) → `200`, statut `valide`, `valide_par_nom`, `rgpd_audit_log` `BORDEREAU_DECHETERIE_VALIDE`, **PDF régénéré** (taille différente) ; seconde validation → `409 BORDEREAU_DEJA_VALIDE` | ✅ |
| 13 | `GET /tours/:id/bordereaux`, `GET /cav/:id/bordereaux`, `GET /cav/:id/historique` (`nb_bordereaux`, bloc `bordereaux`), `GET /tours/bordereaux/referentiel-decheteries` (7 cases) | ✅ (5/5) |
| 14 | `PUT /cav/:id` : code bidon → `400 DECHETERIE_CODE_INVALIDE` ; marquage valide → `200` ; démarquage → code remis à `NULL` | ✅ |
| 15 | Notification messagerie : MANAGER actif reçoit un message `type=notification`, `source=bordereau_decheterie`, `lien=/tours?tour=<id>` ; **aucune** notification pour la tournée démo | ✅ |
| 16 | Anonymisation (`services/anonymization.anonymizeEmployee`) : `signature_chauffeur→NULL`, motif `anonymisation`, `driver_employee_id→NULL`, PDF régénéré et servi | ✅ |
| 17 | Purge RGPD (`purgeBordereauxDecheterie`) : lignes > 1095 j supprimées, ligne récente **conservée** (purge sélective, pas un TRUNCATE), `rgpd_audit_log PURGE_BORDEREAUX_DECHETERIE` écrit | ✅ |
| 18 | `PURGES_RGPD` contient l'entrée `bordereaux_decheterie` | ✅ |

### 2.3 Bout-en-bout HTTP additionnel (hors script principal)

| # | Vérification | Résultat |
|---|---|---|
| 1 | `GET /api/tours/vehicle/:id/today` (jeton chauffeur) décore aussi `is_decheterie`/`decheterie_libelle`/`bordereau_deja_depose` | ✅ |
| 2 | `GET /api/rgpd/purges` (ADMIN + MFA) liste l'entrée `bordereaux_decheterie` avec seuil, provenance, dernier passage | ✅ |
| 3 | `POST /api/rgpd/purges/bordereaux_decheterie/executer` (ADMIN + MFA) exécute la purge à la demande et journalise **même à 0 ligne** | ✅ |

### 2.4 Rendu du PDF réel (pymupdf)

Les 3 PDF produits par le script de preuve (à-valider, validé, anonymisé) ont
été rendus en PNG et en texte extrait, puis inspectés visuellement.

- **`proof-bordereau-a-valider.pdf` / `-valide.pdf`** : case « Petit-Quevilly »
  cochée, case « Solidarité Textile » cochée, TLC = 185, les deux signatures
  manuscrites visibles, et sur le document validé la mention
  « Validé par Solidarité textiles sur Solidata le 06/09/2026 » dans
  Remarque(s) — texte extrait ET rendu visuel conformes.
- **`proof-bordereau-anonymise.pdf`** : signature de l'agent (tiers) **conservée**,
  signature du chauffeur remplacée par « Signature retirée (anonymisation du
  salarié) », mention de validation toujours présente. Conforme à la doctrine
  RGPD du cahier des charges §3.7.
- Les rendus `bordereau-valide.png` / `bordereau-sans-sig.png` produits par
  l'agent de coordination (déjà présents dans le scratchpad) confirment par
  ailleurs le cas « hors liste » : case aucune cochée pour la déchèterie,
  mention « Déchèterie : Rouen — Quai du Pré aux Loups » en clair dans
  Remarque(s), et « Signature non recueillie » en l'absence de motif reconnu.

Fichiers produits par cette session (scratchpad) :
`proof-bordereau-a-valider.{pdf,png,txt}`, `proof-bordereau-valide.{pdf,png,txt}`,
`proof-bordereau-anonymise.{pdf,png,txt}`.

### 2.5 Contre-épreuves par mutation (3, chacune restaurée)

| # | Mutation | Effet |
|---|---|---|
| 1 | Retrait de la garde `row.is_decheterie !== true` dans `routes/tours/bordereaux.js` (POST public) | Le test de contrat « 409 POINT_NON_DECHETERIE » **tombe** (500 au lieu de 409, la ligne mutée casse aussi la suite de la logique). Restauré, 36/36 tests contrat verts, fichier identique à l'original (`diff` vide). |
| 2 | Remplacement de `genererPdfDepuisLigne(...)` par `ligne.pdf` (pas de régénération) dans `POST /valider` | Le test de contrat « PDF RÉGÉNÉRÉ » **tombe** (`Buffer.isBuffer` false, le mock renvoie l'ancien buffer). Restauré, 36/36 verts, fichier identique. |
| 3 | Retrait de l'appel `decorerDecheterie(...)` dans `GET /:id/public` (`routes/tours/index.js`) | **Aucun test existant ne tombait** — trou de couverture réel débusqué (voir §3.2). Un test manquant a été écrit et vérifié rouge sur la mutation puis vert après restauration. Fichier `routes/tours/index.js` restauré à l'identique (`diff` vide contre la copie de sauvegarde). |

## 3. Défauts trouvés

### 3.1 Écart entre l'hypothèse de la mission et le comportement réel du seed (pas un défaut de code)

L'énoncé attendait « 14 marquées, dont 6 avec un `decheterie_code`… Saint-
Étienne-du-Rouvray n'a pas de CAV ». La preuve sur PostgreSQL réel montre
**15 marquées, 7 avec code**. Cause : `backend/src/scripts/import-cav-209.sql`
contient bien une entrée « SAINT-ÉTIENNE-DU-ROUVRAY - 47 Rue de Seine
(Déchetterie - 9h / 12h - 14h / 17h) », que le repli « nom contient
"chetterie" + commune correspondante, candidat unique » rapproche
correctement (l'entrée du référentiel Métropole pour cette commune a
`id_solidata: null`, donc passe nécessairement par le repli). **Ce n'est pas
un défaut** : la garde anti-erreur d'identifiant et le repli par nom
fonctionnent exactement comme prévu par les contrats techniques §1 — le seed
a simplement trouvé un vrai point correspondant là où l'hypothèse de départ
pensait qu'il n'y en avait pas dans ce jeu de données précis. Documenté ici
pour que la note du cahier des charges (« Saint-Étienne-du-Rouvray n'a pas de
CAV ») soit lue comme relative à la production, pas à ce jeu d'import.

### 3.2 Trou de couverture réel — `decorerDecheterie` sur `GET /:id/public` (CORRIGÉ)

**Fichier** : `backend/tests/contract/bordereau-decheterie-contract.test.js`
(nouveau code de test uniquement — aucun code applicatif modifié).

**Cause** : le fichier de contrat du lot backend couvre exhaustivement le
dépôt du bordereau, la validation, les listes et le marquage CAV, mais ne
contient **aucun test** de `GET /api/tours/:id/public` (ni de
`GET /api/tours/vehicle/:id/today`) — c'est-à-dire la moitié « le chauffeur
SAIT qu'il doit déposer un bordereau » du contrat §2.2. La contre-épreuve
(retrait de `decorerDecheterie(...)` dans `routes/tours/index.js`) ne faisait
tomber **aucun** test sur 208 suites / 4074 tests. Un régression sur ce point
précis serait passée en production sans qu'aucun test ne s'en aperçoive : un
chauffeur sur un serveur régressé aurait vu un point déchèterie strictement
identique à une borne ordinaire, sans être orienté vers l'écran de signature.

**Correctif** : 3 tests de contrat ajoutés (describe
« GET /api/tours/:id/public — décoration déchèterie du payload mobile
(§2.2) ») avec un mock routé par motif SQL, vérifiant : (1) point marqué
déchèterie code connu → `is_decheterie`, `decheterie_libelle`,
`bordereau_deja_depose:false` ; (2) bordereau déjà déposé →
`bordereau_deja_depose:true` ; (3) point ordinaire → `is_decheterie:false`,
`decheterie_libelle:null`. Vérifiés **rouges** sur le code muté, **verts**
après restauration. Le code applicatif de `routes/tours/index.js` était et
reste correct — c'est la couverture qui manquait.

## 4. Chaîne inter-lots (backend ↔ mobile ↔ web)

Confrontation champ par champ, tous vérifiés cohérents :

- **mobile → backend** : `mobile/src/services/decheterie.js
  construirePayloadBordereau()` envoie exactement
  `{client_id, poids_indicatif_kg, signature_chauffeur, signature_agent,
  agent_absent_motif}` ; `routes/tours/bordereaux.js` lit exactement ces 5
  clés, dans le même ordre de validation que documenté en tête de fichier.
- **backend → web** : `BordereauResume` (`services/bordereau-decheterie.js
  projeterResume`) correspond champ à champ à ce que consomme
  `frontend/src/components/tours/BordereauxDecheterie.jsx` (numero,
  decheterie_libelle, cav_nom, date_enlevement, poids_indicatif_kg,
  statut, signature_*_presente, signature_*_absente_motif, valide_par_nom,
  valide_le) — vérifié à la fois par lecture croisée du code et par les
  réponses HTTP réelles du §2.2.
- **routes exactes** : `GET /tours/bordereaux/referentiel-decheteries`,
  `GET /tours/:id/bordereaux`, `GET /cav/:id/bordereaux`,
  `GET /tours/bordereaux/:id/pdf`, `POST /tours/bordereaux/:id/valider` —
  tous appelés par le front avec le chemin exact monté côté backend
  (vérifié par exécution réelle, pas seulement par lecture).
- **mobile — aiguillage** : `FillLevel.jsx` enchaîne sur
  `/decheterie-bordereau` **après** `addPendingCollect` (la collecte est
  déjà en file/envoyée) et uniquement quand `bordereauRequis(point)` est
  vrai (`is_decheterie===true && bordereau_deja_depose!==true`) — lu dans le
  code, cohérent avec le contrat §3.
- **mobile — file hors-ligne** : `syncPendingBordereaux` est bien appelée
  dans `syncAll()`, après `syncPendingCollects()` (ordre voulu par le
  contrat : le point doit être connu de la tournée avant que le bordereau
  ne soit accepté) ; `getPendingCount()` compte le store `pendingBordereaux`
  dans son total.

## 5. Tests et builds

- `cd backend && npx jest` → **208 suites passées / 210 (2 e2e Postgres
  optionnelles gated par variable d'env, comme d'habitude), 4077 tests
  passés / 4121 (44 skipped), 0 échec**. (4074 avant ce lot + 3 tests ajoutés
  au §3.2.)
- `cd mobile && npm test -- --run` → **23 fichiers, 292 tests, 0 échec**.
- `cd mobile && npm run build` → vert (avertissement de taille de chunk
  préexistant, sans rapport avec ce chantier).
- `cd frontend && npm run build` → vert.

## 6. Ce qui n'a pas pu être prouvé, et pourquoi

- **Le pad de signature côté navigateur réel** (`SignaturePad.jsx`, pointer
  events, `touch-action: none`) n'a été vérifié que par les tests Vitest
  (rendu statique + logique pure `services/signature.js`) — aucun test
  Playwright/Chromium n'a été exécuté dans cette session (hors périmètre du
  script de preuve backend ; le cahier des charges ne le demandait pas
  explicitement pour ce lot, contrairement à d'autres chantiers du
  changelog qui font un rendu Chromium réel). Recommandation : un aller-
  retour Chromium serait la preuve manquante la plus utile avant mise en
  production, en particulier pour la coupure tactile (`setPointerCapture`).
- **Le comportement OFFLINE réel du mobile** (mise en file IndexedDB puis
  rejeu à la reconnexion) a été vérifié par les tests Vitest de
  `mobile/tests/bordereauSync.test.js` (politique 2xx/4xx/5xx sur mock
  fetch) mais pas par un scénario end-to-end navigateur avec coupure réseau
  simulée.
- **Le rendu du logo Métropole officiel** n'a pas pu être vérifié :
  `backend/assets/logo-metropole-rouen.png` n'existe pas dans ce dépôt (le
  cahier des charges le prévoit explicitement — « texte de repli tant que
  le PNG officiel n'est pas déposé ») ; le repli textuel « MÉTROPOLE / ROUEN
  / NORMANDIE » a été vérifié à l'écran (§2.4) et fonctionne comme prévu.
- **L'échelle de charge** (des dizaines de bordereaux sur une même tournée,
  génération PDF en rafale) n'a pas été testée en volume — seul le chemin
  nominal et les cas d'erreur unitaires ont été exercés.

## 7. Conclusion

**66/66 vérifications HTTP réelles vertes** (script principal) + **8/8
vérifications additionnelles** (init-db ×4, HTTP additionnel ×3, garde
d'identifiant) + **3/3 contre-épreuves concluantes** + **3 tests de contrat
ajoutés pour combler un trou de couverture réel** (aucun défaut de code
applicatif trouvé à cet endroit — seulement un défaut de test). Le chantier
fonctionne de bout en bout sur PostgreSQL réel, à travers les vrais
handlers Express, avec des PDF rendus et inspectés visuellement dans les
trois états (à valider / validé / anonymisé).

Aucune modification de code applicatif n'a été nécessaire — le seul
changement livré par cet agent est l'ajout de 3 tests de contrat manquants
(73 lignes, `backend/tests/contract/bordereau-decheterie-contract.test.js`).
