# Coordination — cartographie de cohérence contrats ↔ code (chantier 2.50.0)

**Rédigé par l'agent de coordination, à partir de la lecture du code livré aux commits
`9ed22fc`→`5af0ba4` (branche courante), comparé point par point à
`01-contrats-techniques.md`.**

Légende : ✅ conforme · ⚠️ écart (mineur, sans risque fonctionnel identifié) · ❌ écart
bloquant. Aucun écart ❌ n'a été trouvé lors de cette relecture.

---

## §1 — Schéma (lot backend)

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `cav.is_decheterie` BOOLEAN NOT NULL DEFAULT false | ✅ | `backend/src/scripts/init-db.js:8223` |
| `cav.decheterie_code` VARCHAR(40) | ✅ | `backend/src/scripts/init-db.js:8224` |
| `cav.decheterie_pavid` VARCHAR(20) | ✅ | `backend/src/scripts/init-db.js:8225` |
| `tour_decheterie_bordereaux` — colonnes, FK, CHECK, index | ✅ | `backend/src/scripts/init-db.js:8239-8273`, DDL identique au contrat colonne par colonne (types, `ON DELETE CASCADE`/`SET NULL`, CHECK poids 0-60000, CHECK statut, `UNIQUE(numero)`, `UNIQUE(client_id)`) |
| Doctrine BYTEA (jamais `/uploads`) | ✅ | Commentée en tête d'`init-db.js:8228-8233`, de `bordereau-decheterie.js:19-21` et de `bordereaux.js:1-10, 20`. Aucune écriture de signature/PDF dans `backend/uploads` détectée dans le diff |
| Seed à verrou, garde sur la commune | ✅ | `backend/src/scripts/init-db.js:8637-8716` — verrou `collecte.decheteries_metropole_seed` posé uniquement si `marques > 0` (l.8705-8712) ; correspondance par identifiant **avec** vérification de commune (`normaliserCommune`, l.8676-8679) ; repli par nom « chetterie »/« cheterie » + commune, ambiguïté (`candidats.length > 1`) explicitement non tranchée (l.8683-8689) |
| Registre RGPD art. 30, idempotent (`WHERE NOT EXISTS`) | ✅ | `init-db.js:8277-8296` |

**Écart mineur** ⚠️ : le contrat ne précise pas d'ordre entre le seed des déchèteries et
celui du plan de chaîne V7 (`try { ... seed-chaine-v7 ... } catch`) qui le précède
immédiatement dans le fichier ; l'implémentation place le seed déchèterie **après** (l.8637),
ce qui est sans conséquence (les deux seeds sont indépendants) mais n'est cité nulle part —
signalé seulement pour mémoire, aucune action requise.

## §2.1 — Route chauffeur

| Point du contrat | Statut | Implémentation |
|---|---|---|
| Chemin `POST /api/tours/:id/cav/:cavId/bordereau-decheterie-public` | ✅ | `backend/src/routes/tours/bordereaux.js:91` |
| Ordre des règles (garde véhicule → démo → idempotence client_id → point déchèterie de la tournée → validations poids/signatures → transaction → 201 → post-réponse) | ✅ | Suivi à la lettre : garde véhicule via middleware `MOBILE_DRIVER_PATH` en amont (non ré-écrite dans la route, conforme à la doctrine affichée l.8-11) ; démo l.118-121 ; idempotence l.126-140 ; point déchèterie l.142-149 ; poids l.152-155 ; signature chauffeur l.157-163 ; signature agent/motif l.165-183 ; transaction `creerBordereau` l.186-193 ; 201 l.196-204 ; notifications/journal après la réponse l.206-227 |
| Codes 4xx exacts (`POINT_NON_DECHETERIE`, `POIDS_INVALIDE`, `SIGNATURE_INVALIDE`, `MOTIF_REQUIS`, `CLIENT_ID_INVALIDE`) | ✅ | Tous présents littéralement, cf. `bordereaux.js:145,153,159,175,179,131` |
| Démo → `200 { demo: true }`, aucune écriture, aucune notification | ✅ | `bordereaux.js:119-121`, retour immédiat avant toute écriture |
| `client_id` déjà connu → `200 { deja_enregistre, bordereau }` | ✅ | `bordereaux.js:136-139` (avant validation) **et** filet dans `creerBordereau` sur 23505 (l.263-268) pour la course entre deux dépôts concurrents du même `client_id` |
| Numérotation `BD-AAAA-NNNN`, retry unique sur 23505 hors client_id | ✅ | `numeroSuivant` (`bordereau-decheterie.js:158-173`) + boucle `for (tentative < 2)` dans `creerBordereau` (`bordereaux.js:236-275`) |
| Notification post-réponse : messagerie + push + journal d'activité, jamais bloquants | ✅ | `bordereaux.js:206-227`, `.catch(() => {})` sur le push, `notifierGestionnaires` fire-and-forget (non awaité) |
| Poids jamais versé dans `tour_weights`/`total_weight_kg`/`tonnage_history`/apprentissage | ✅ | Aucune écriture de ces tables dans `bordereaux.js` ni `bordereau-decheterie.js` ; doctrine rappelée en commentaire de tête (`bordereaux.js:22-25`) |

**Écart mineur** ⚠️ : le corps du message de notification (`bordereaux.js:220-225`) recompose
le texte par `corps.slice(corps.indexOf('bordereau'))`, une manipulation de chaîne un peu
fragile (dépend que le mot « bordereau » n'apparaisse pas ailleurs avant le numéro) plutôt
que de reconstruire le texte de `notifierGestionnaires` indépendamment de celui du push. Sans
risque fonctionnel observé sur les cas testés (le mot « bordereau » n'apparaît qu'une fois
dans `corps`), mais fragile si le gabarit du message change un jour. Signalé pour vigilance,
pas un défaut au sens du contrat.

## §2.2 — Payloads mobiles enrichis

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `cavs[]` gagne `is_decheterie`, `decheterie_libelle`, `bordereau_deja_depose` | ✅ | `decorerDecheterie` (`backend/src/routes/tours/index.js:241-289`), appliqué sur `GET /:id/public` (l.460-461) et `GET /vehicle/:id/today` (l.396-397) |
| Points association : `is_decheterie: false` | ✅ | `decorerDecheterie` retourne `points.map(neutre)` si `isAssociation` (l.257-258) |
| Une seule requête | ✅ | Un seul `pool.query` par appel (l.246-254), `Map` en mémoire pour joindre aux points |
| Dégradation sur base non migrée | ✅ | `try/catch` avec repli `neutre` (l.264-266), commenté explicitement |

**Écart mineur** ⚠️ (non signalé par le contrat comme interdit, mais à noter pour la
cohérence de nommage demandée) : le payload ajoute aussi `decheterie_code` (`index.js:280`),
un champ que le contrat §2.2 ne liste pas dans son exemple JSON (qui ne montre que
`is_decheterie`, `decheterie_libelle`, `bordereau_deja_depose`). Il est cohérent avec le
reste du système (même nom que la colonne, même nom que `BordereauResume.decheterie_code`)
et n'est lu nulle part côté mobile (`services/decheterie.js#bordereauRequis` ne teste que
`is_decheterie`/`bordereau_deja_depose`) — champ inoffensif mais **en dehors de la forme
figée par le contrat**, à faire valider par le coordinateur si le contrat doit être
strictement gelé.

## §2.3 — Routes back-office

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `GET /api/tours/bordereaux/referentiel-decheteries` | ✅ | `bordereaux.js:294-296`, `authorize('ADMIN','MANAGER')` posé route par route (`gestionnaire`, l.281-291, jamais en `.use()` — justifié en commentaire l.279-291) |
| `GET /api/tours/:id/bordereaux` | ✅ | `bordereaux.js:451-469` (ordre `created_at, id`) |
| `GET /api/cav/:id/bordereaux` | ✅ | `backend/src/routes/cav.js:1211-1250`, ADMIN/MANAGER, aucun BYTEA renvoyé (`COLONNES_RESUME`) |
| `GET /api/tours/bordereaux/:bid/pdf` — headers, journalisation | ✅ | `bordereaux.js:304-333` — `Content-Type`, `Content-Disposition: inline; filename=...`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` tous présents ; `journaliserBordereau('BORDEREAU_DECHETERIE_CONSULTE', ...)` + `logActivity` avant l'envoi du fichier |
| `POST /api/tours/bordereaux/:bid/valider` — effets, 409, régénération PDF | ✅ | `bordereaux.js:344-389` — `FOR UPDATE OF b` (verrou pessimiste), 409 `BORDEREAU_DEJA_VALIDE` avec `valide_le`, PDF régénéré via `genererPdfDepuisLigne(ligne, { validation: { date } })`, `journaliserBordereau('BORDEREAU_DECHETERIE_VALIDE', ...)`, `autoLogActivity('bordereau_decheterie')` sur la route |
| Montage : `routerChauffeur` avant `authenticate`, `routerBackOffice` juste après et avant `./live-edit` | ✅ | `tours/index.js:1892` (`router.use('/', bordereauxChauffeur)` avant `router.use(authenticate)` l.1898) puis `tours/index.js:1902-1903` (`router.use('/', bordereauxBackOffice)`), et `./live-edit` monté seulement en l.1967 — vérifié par lecture directe de l'ordre des `router.use` |
| `/referentiel-decheteries` déclarée avant `/:bid/pdf` | ✅ | Ordre respecté dans `bordereaux.js` (l.294 avant l.304) |
| `rapport.js` non modifié | ✅ | `git diff ce4070f..HEAD -- backend/src/routes/tours/rapport.js` ne retourne aucune ligne |
| `BordereauResume` — forme exacte | ✅ | `projeterResume` (`bordereau-decheterie.js:270-290`) produit exactement les clés listées au contrat, y compris les booléens `signature_*_presente` calculés en SQL (`COLONNES_RESUME`) |

## §2.4 — CAV

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `GET /cav`, `GET /cav/:id` exposent les 3 colonnes | ✅ | `SELECT *` sur `cav` dans les deux routes (colonnes ajoutées par `ALTER TABLE`, donc automatiquement présentes) — vérifié qu'aucune projection explicite ne les exclut |
| `PUT /cav/:id`, `POST /cav` acceptent `is_decheterie`/`decheterie_code`, 400 sur code invalide, code remis à `null` si `is_decheterie` faux | ✅ | `lireMarquageDecheterie` (`cav.js:1040-1053`), utilisée dans `POST /` (l.1094-1100) et `PUT /:id` (l.1155-1168) ; `400 DECHETERIE_CODE_INVALIDE` sur les deux routes |

## §2.5 — RGPD

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `purgeBordereauxDecheterie` dans `services/rgpd-purges.js`, entrée `PURGES_RGPD` avec tous les champs prescrits | ✅ | `rgpd-purges.js:609-673` (fonction) et `:857-869` (entrée registre) — `cle`, `actionAuto`, `actionManuelle`, `jobName`, `entiteAudit`, `retentionSetting`, `retentionDefaut: 1095`, `retentionUnite: 'jours'` tous conformes au contrat |
| Branchement au scheduler comme les 8 autres | ✅ | `scheduler.js` — import (l.1427), appel dans `runAllJobs` juste après `purgeArretsGps` (l.2049-2052), export (l.2117) ; `monitoring.js` — entrée `JOB_SCHEDULE.purgeBordereauxDecheterie` (l.147-150) |
| Anonymisation : `signature_chauffeur = NULL`, motif `'anonymisation'`, `driver_employee_id = NULL`, PDF régénéré | ✅ | `retirerSignatureChauffeur` (`bordereau-decheterie.js:322-373`), appelée depuis `anonymization.js:408-427` dans un `try/catch` résilient (table absente → warning, pas d'échec de l'anonymisation) |
| Libellés français (`frontend/src/utils/rgpd-libelles.js`, entité du journal d'activité) — **propriété du lot backend pour ce chantier** | ✅ | Les 4 codes RGPD présents (`rgpd-libelles.js:43,54,116-117`) + entité `tour_decheterie_bordereaux` (l.144) ; entité `bordereau_decheterie` + libellé « Consultation » ajoutés dans `frontend/src/pages/ActivityLog.jsx` (`ACTION_LABELS.view`, `ENTITY_LABELS.bordereau_decheterie`) — ces deux fichiers front sont bien modifiés par le **lot backend** (git blame du diff : commits backend), conformément à l'exception de propriété du §5 du contrat |

## §3 — Mobile

| Point du contrat | Statut | Implémentation |
|---|---|---|
| Aiguillage dans `FillLevel.jsx` (`bordereauRequis(point)` → `/decheterie-bordereau`, collecte elle-même inchangée) | ✅ | `mobile/src/pages/FillLevel.jsx:261-283` — le `bordereauRequis(point)` teste le point AVANT le retour de confirmation standard ; l'appel à `sendCollect`/`addPendingCollect` en amont n'est pas modifié dans son corps (diff ne touche que l'aval) |
| Écran 3 temps, FALC, `MobileShell` + `PrimaryActionBar` + `StepConfirmScreen` | ✅ | `mobile/src/pages/DecheterieBordereau.jsx` — import des trois composants (l.6-9), 3 étapes numérotées dans le composant (poids, agent, chauffeur) |
| `components/SignaturePad.jsx` — canvas maison, pointer events + `setPointerCapture`, `touch-action: none`, trait 3 px, ≤ 600×220, `toDataURL('image/png')` | ✅ | Constantes `LARGEUR=600`, `HAUTEUR=220` (l.38-39), `setPointerCapture` (l.104), `toDataURL('image/png')` (l.139) ; épaisseur de trait `EPAISSEUR_TRAIT` référencée l.60 |
| `services/signature.js` — `SIGNATURE_MIN_POINTS`, `signatureExploitable`, `estDataUrlPng` | ✅ | Toutes présentes, `SIGNATURE_MIN_POINTS = 12` documenté et justifié |
| `services/decheterie.js` — `bordereauRequis`, `validerBordereau`, `poidsIndicatifValide` | ✅ | Toutes présentes avec la signature attendue |
| Store IndexedDB `pendingBordereaux`, DB v7, item `{clientId, tourId, cavId, poidsKg, signatureAgent, agentAbsentMotif, signatureChauffeur, createdAt}` | ✅ | `mobile/src/services/db.js` — `DB_VERSION = 7` (l.66), store créé de façon additive (l.150-155), `addPendingBordereau` produit exactement ces clés (l.428-450) |
| `sync.js` — `sendBordereau`, `syncPendingBordereaux`, politique 2xx purge / 4xx purge sauf 401 / 5xx conserve | ✅ | `mobile/src/services/sync.js:701-727` — `isClientError` (l.112-121) exclut explicitement le 401 (`if (err?.retryable) return false`, commentaire l.113-118) ; sur un 4xx métier (409/400) la file est purgée (l.716-720, avec le commentaire qui cite nommément `POINT_NON_DECHETERIE`/`POIDS_INVALIDE`/`SIGNATURE_INVALIDE`/`MOTIF_REQUIS`) ; sur autre chose (401, 5xx, réseau) `recordFailure` + `break` (l.722-723), l'item reste en file |
| Hors ligne dit tel quel, jamais bloquant | ✅ | `DecheterieBordereau.jsx` — commentaire de tête et logique de mise en file sans blocage réseau |
| Tests Vitest (signature, decheterie, file, composant, `importsResolus.test.js`) | ✅ | `mobile/tests/signature.test.js`, `decheterie.test.js`, `bordereauSync.test.js`, `SignaturePad.test.js`, `DecheterieBordereau.test.js` tous présents dans le diff ; `importsResolus.test.js` non modifié (pas dans le diffstat) donc toujours actif tel quel |

## §4 — Web

| Point du contrat | Statut | Implémentation |
|---|---|---|
| `pages/Tours.jsx` — section « Bordereaux déchèterie » dans `TourDetailPanel`, chargement paresseux, colonnes, boutons Voir/Télécharger/Valider, lien profond `/tours?tour=<id>` | ✅ | `frontend/src/pages/Tours.jsx:449-472` (deep link `useSearchParams`), `:1651-1683` (section repliable + `BordereauxDecheterie` monté avec `endpoint`, `peutValider`, `onValide`, `titre`) |
| `pages/AdminCAV.jsx` — case + sélecteur (7 codes + Hors liste), badge liste, section fiche | ✅ | Cf. diff détaillé lu plus haut : `EMPTY_FORM` (l.86-87), fetch référentiel (l.324-330), badge (l.694-703), bloc formulaire (l.1169-1206 et suite), section fiche `BordereauxDecheterie` en lecture seule (l.1078-1092) |
| `utils/bordereaux.js` — `BORDEREAU_STATUT_META`, `libelleStatutBordereau`, `classeStatutBordereau` | ✅ | Toutes présentes, forme conforme |
| `components/tours/BordereauxDecheterie.jsx` — composant partagé, liste + visionneuse | ✅ | Utilisé identiquement par `Tours.jsx` et `AdminCAV.jsx`, aperçu PDF en blob/objectURL, téléchargement en blob, validation avec `useConfirm` |

**Écart mineur** ⚠️ : `utils/bordereaux.js` ajoute `MOTIF_SIGNATURE_ABSENTE_LABELS` et
`libelleMotifSignatureAbsente`, non listés nommément au contrat §4 (qui ne cite que
`BORDEREAU_STATUT_META`/`libelleStatutBordereau`/`classeStatutBordereau`) mais nécessaires
pour afficher `signature_agent_absente_motif`/`signature_chauffeur_absente_motif` — une
fonctionnalité explicitement demandée par le cahier des charges (§3.6, mention de l'agent
absent) sans que le contrat n'en précise le nommage. Addition cohérente, aucune action
requise.

**Écart mineur** ⚠️ (nuance de rédaction) : le contrat dit de `libelleStatutBordereau` /
`classeStatutBordereau` « repli sur la valeur brute, jamais « — » ». La fonction réelle
(`bordereaux.js` front, l.27) est `BORDEREAU_STATUT_META[statut]?.label || statut || '—'` —
elle retombe bien sur `statut` (valeur brute) pour un statut inconnu mais NON vide, et ne
tombe sur `'—'` que si `statut` est lui-même vide/`null`/`undefined` — cas qui ne devrait
jamais se produire (colonne `NOT NULL`). Comportement défensif raisonnable, en tension
littérale mais pas en pratique avec l'énoncé du contrat.

## Cohérence de nommage bout en bout (vérification demandée explicitement)

Comparaison `construirePayloadBordereau` (mobile) → lecture `routerChauffeur.post` (backend)
→ `projeterResume` (backend) → consommation `BordereauxDecheterie.jsx` (web) :

| Champ | Mobile envoie | Backend lit | Backend renvoie (résumé) | Web consomme |
|---|---|---|---|---|
| Idempotence | `client_id` | `req.body.client_id` | — (non renvoyé en résumé, ni nécessaire) | — |
| Poids | `poids_indicatif_kg` | `req.body.poids_indicatif_kg` | `poids_indicatif_kg` | `b.poids_indicatif_kg` |
| Signature chauffeur | `signature_chauffeur` | `req.body.signature_chauffeur` | `signature_chauffeur_presente` + `signature_chauffeur_absente_motif` | `b.signature_chauffeur_absente_motif` |
| Signature agent | `signature_agent` | `req.body.signature_agent` | `signature_agent_presente` + `signature_agent_absente_motif` | `b.signature_agent_absente_motif` |
| Motif agent absent | `agent_absent_motif` | `req.body.agent_absent_motif` | `signature_agent_absente_motif` | `b.signature_agent_absente_motif` |

**Aucun écart de nommage trouvé** sur cette chaîne complète. Les seules divergences de nom
sont volontaires et documentées : le corps envoyé par le mobile porte `agent_absent_motif`
(entrée), le résumé renvoyé par le backend porte `signature_agent_absente_motif` (état
stocké) — deux noms différents pour deux moments différents (l'intention déclarée à l'entrée
vs. la donnée persistée), jamais confondus dans le code lu.

---

## Synthèse

- **Aucun écart bloquant (❌)** trouvé entre les contrats figés (`01-contrats-techniques.md`)
  et le code livré par les 3 lots au moment de cette relecture (commit `5af0ba4`).
- **5 écarts mineurs (⚠️)**, tous sans risque fonctionnel identifié à la lecture :
  1. ordre du seed déchèterie vs. seed chaîne V7 (non spécifié par le contrat) ;
  2. reconstruction de chaîne fragile dans le corps de la notification push ;
  3. `decheterie_code` ajouté au payload mobile enrichi, hors de la forme JSON figée au
     contrat §2.2 (sans effet observé, non lu côté mobile) ;
  4. `libelleMotifSignatureAbsente`/`MOTIF_SIGNATURE_ABSENTE_LABELS` ajoutés à
     `utils/bordereaux.js` sans être nommés au contrat (addition cohérente et nécessaire) ;
  5. tension littérale (pas pratique) entre « jamais « — » » et le repli `'—'` sur un
     `statut` vide dans `libelleStatutBordereau`.
- La **cohérence de nommage bout en bout** demandée (mobile → backend → web) a été vérifiée
  explicitement sur les 5 champs du contrat §2.1 : **aucun écart**.
- Cette cartographie a été établie par **lecture de code seule** (pas d'exécution de tests,
  pas d'accès à une base PostgreSQL réelle) : les preuves d'exécution (Jest, Vitest,
  vérifications PostgreSQL, contre-épreuves par mutation) relèvent de l'agent de debug et
  n'ont pas été dupliquées ici.
