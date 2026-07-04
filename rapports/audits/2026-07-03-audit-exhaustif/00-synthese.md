# Audit exhaustif SOLIDATA — Synthèse générale

> **Date** : 3-4 juillet 2026
> **Périmètre** : les 27 modules, backend (63 routeurs), frontend web (85 routes), PWA mobile, base de données (80+ tables), services IA/capteurs, benchmark marché.
> **Méthode** : 9 audits de domaine menés en parallèle par agents spécialisés, chaque affirmation référencée `fichier:ligne` et contre-vérifiée sur le schéma `init-db.js`. Lecture de code exhaustive, aucune exécution en production.
> **Livrables** : ce document + 9 rapports détaillés (voir §9) + 15 correctifs bloquants déjà appliqués, testés et poussés.

---

## 1. Verdict global

SOLIDATA est un ERP d'une **ampleur fonctionnelle remarquable** pour une structure de cette taille : 27 modules couvrant toute la chaîne de valeur d'une SIAE textile (recrutement → insertion → collecte IoT → tri → stock → logistique → facturation → boutiques → vente au kilo → reporting éco-organisme). Le benchmark marché (§8) confirme qu'**aucun outil du commerce ne couvre ce périmètre vertical** : il faudrait assembler 4 à 5 logiciels distincts.

Cette richesse a un revers : la vélocité de construction a laissé une **dette de fiabilité** concentrée sur un schéma récurrent — le **désalignement entre le code et le schéma de données réel** (colonnes renommées côté base mais pas côté requête, noms de champs divergents entre le front et le back). Ces bugs sont d'autant plus dangereux qu'ils sont **masqués** : cache Redis, `catch → console.error` silencieux, et un smoke-test qui considère `401` comme « OK ». Une fonctionnalité peut être morte en production sans que personne ne le voie.

**Note de fiabilité globale : 5,3 / 10** (moyenne pondérée des 9 domaines). Le socle d'architecture (auth centralisée, state machines, repositories, services partagés, pipeline IoT) est **sain et bien pensé** ; ce sont les **branchements** qui cassent, pas la structure. La bonne nouvelle : la majorité des bloquants sont des correctifs d'un à quelques mots, sans refonte.

### Décompte consolidé des anomalies

| Domaine | Bloquant/Critique | Majeur/Élevé | Mineur | Rapport |
|---------|:---:|:---:|:---:|---------|
| 01 · Sécurité & routeurs | 3 | 6 | 8 | `01-transverse-securite-routeurs.md` |
| 02 · Recrutement / RH / Insertion | 4 | 10 | 12 | `02-recrutement-rh-insertion.md` |
| 03 · Collecte / Véhicules / Capteurs | 4 | 7 | 12 | `03-collecte-vehicules-capteurs.md` |
| 04 · Tri / Stock / **Traçabilité** | 3 | 11 | 14 | `04-tri-stock-tracabilite.md` |
| 05 · Logistique / Facturation | 4 | 6 | 10 | `05-logistique-exutoires-facturation.md` |
| 06 · Finance / Pennylane / Reporting | 3 | 3 | 12 | `06-finance-pennylane-reporting.md` |
| 07 · Boutiques / VAK | 0 | 3 | 15 | `07-boutiques-vak.md` |
| 08 · UX web & mobile | 3 | 5 | 7 | `08-ux-frontend-mobile.md` |
| **Total** | **24** | **51** | **90** | **165 findings** |

*(Le rapport 09 est un benchmark, sans décompte d'anomalies.)*

---

## 2. Ce qui a déjà été corrigé pendant l'audit

27 bloquants/majeurs confirmés (vérifiés contre le schéma, testés — Jest 180/180 vert à chaque étape) ont été corrigés et poussés sur la branche `claude/solidata-erp-audit-265e2e`. **Première passe** :

| # | Correctif | Impact utilisateur avant | Commit |
|---|-----------|--------------------------|--------|
| 1 | **Rôle RESP_BTQ créable** | Impossible de créer un responsable boutique (rôle refusé par `POST /users` alors que le module Boutiques le promet) | `8bcb7fc` |
| 2 | **Rôle AUTORITE utilisable** | Le rôle « autorité/financeur » n'avait **aucune page accessible** (back l'autorise, front non) | `8bcb7fc` |
| 3 | **Suivi GPS temps réel** | Socket lisait la mauvaise clé de token → auth vide → carte live muette | `8bcb7fc` |
| 4 | **Bornes de mois SQL** (9 requêtes) | Tous les rapports mensuels (production, RH heures/ETP, exports, expéditions) plantaient en 500 **~7 mois sur 12** (fév/avr/juin/sept/nov…) | `65cce89` |
| 5 | **Page « Collecte en direct »** | 500 systématique (4 colonnes SQL inexistantes) → feature phare morte | `65cce89` |
| 6 | **Synthèse Produits Finis** | Cartes toujours à 0 (noms de champs front/back divergents) | `65cce89` |
| 7 | **Jauges objectifs (dashboard)** | 500 dès qu'un objectif existe (`SUM(kg_entree)`, colonne inexistante) | `f5b017b` |
| 8 | **Dashboard performance / Reporting RH** | 500 (`insertion_diagnostics.status` inexistant) | `f5b017b` |
| 9 | **Pointage mensuel** | 500 les mois courts (bornes de mois non propagées) | `cb0df54` |
| 10 | **Contrôle facturation Pennylane** (module 23bis) | Inopérant : rapprochement manuel → 500, auto-match → facture perdue (colonnes `motif`/`modifie_par` inexistantes) | `cb0df54` |
| 11 | **Workflow commandes exutoires** | Bloqué dès la création : bouton « Confirmer » mort (state machine sur `brouillon` au lieu de `en_attente`) | `cb0df54` |
| 12 | **Unité CO₂ reporting collecte** | Affichait « kg » pour des tonnes | `65cce89` |
| 13-15 | UX : recherche factice retirée, accents rétablis sur 20 statuts, `/candidates` ouvert aux MANAGER | Faux espoirs / illisibilité / retours silencieux au dashboard | `65cce89` |

**Seconde passe** (13 correctifs supplémentaires) :

| # | Correctif | Impact utilisateur avant | Commit |
|---|-----------|--------------------------|--------|
| 16 | **Insertion IA** (3 endpoints /profil, /entretien, /cohorte) | 500 (colonnes `position_id`/`hire_date`/`mobilite` inexistantes) → tout le volet IA insertion mort | `1ebbdb5` |
| 17 | **Planning employés** | Toute sauvegarde échouait (`ON CONFLICT` sur contrainte supprimée) | `1ebbdb5` |
| 18 | **RGPD candidats** (anonymisation/export/purge) | ROLLBACK silencieux (table `pcm_profiles` inexistante) → non-conformité Art. 15/17 | `1ebbdb5` |
| 19 | **Radar « 7 freins »** | Axe Numérique toujours à 1 (colonne omise) | `1ebbdb5` |
| 20 | **CO₂ & tarifs exutoires** | Gammes P1 (essuyage/tricot/mérinos) → CO₂ = 0 et tarification impossible | `1ebbdb5` |
| 21 | **Import CSV temps réel boutiques** | Webhook 401 systématique (monté derrière le JWT) | `e1e81e3` |
| 22 | **Fuite PII chauffeurs** | `GET /vehicles/available` public exposait les noms | `e1e81e3` |
| 23 | **Rapports PCM côté insertion** | Illisibles dès que `PCM_ENCRYPTION_KEY` câblée (clés désalignées) | `e1e81e3` |
| 24 | **KPIs industriels / Reporting RH** | 403 avalé pour le rôle RH → bloc vide | `e1e81e3` |
| 25 | **Objectifs vs réalisé (scorecard)** | 500 + double schéma `periodic_objectives` → réalisé toujours 0 | `d19d3f0` |
| 26 | **Ré-import CSV VAK** | Duplication des lignes (segments/annuel double-comptés) | `04e0d1c` |
| 27 | **Perf dashboard boutiques** | Index composites (boutique + date) manquants | `04e0d1c` |

**Ces correctifs ne touchent que du câblage** (noms de colonnes, clés, bornes, alignement de schéma) — aucun changement de logique métier, chacun aligné sur une source de vérité existante (le schéma DB ou un usage correct ailleurs dans le code). Suite Jest 180/180 verte à chaque étape.

**Total : 27 bloquants/majeurs corrigés, testés et poussés.**

---

## 3. Les 6 anomalies transverses (la racine commune)

Au-delà des bugs individuels, **six motifs récurrents** traversent tous les domaines. Les traiter en systémique vaut mieux que corriger cas par cas.

1. **Désalignement code ↔ schéma DB.** Cause n°1 des bloquants. Colonnes renommées par une migration mais laissées dans d'anciennes requêtes (`kg_entree`, `insertion_diagnostics.status`, `net_weight_kg`, `motif`, `p.name`, `e.position_id`…). **Remède** : un test d'intégration qui exécute chaque requête sur une base éphémère (le smoke-test actuel ne le détecte pas car il tolère les 401/erreurs).

2. **Erreurs invisibles pour l'utilisateur.** 51 % des pages qui appellent l'API n'ont **aucun retour d'erreur** (`catch → console.error`), 190 occurrences sur 65 fichiers. Un 500 s'affiche comme « 0 » ou « Aucune donnée » — indiscernable d'une absence réelle. **Remède** : intercepteur global + `ErrorState` (déjà écrit, utilisé par 5 pages sur 83 seulement).

3. **Contrats front/back instables.** Fallbacks en cascade (`registration || vehicle_registration || vehicle_name`, `cav_name || name || nom`, `nb_collected` vs `collected_count`) qui trahissent l'absence de contrat d'API partagé. **Remède** : figer les schémas de réponse (au minimum un fichier de types partagé, à terme OpenAPI).

4. **Masquage par le cache et les catch.** Le cache Redis (TTL 120 s) et les `.catch(()=>[])` ont laissé des bugs SQL invisibles en production pendant des semaines (incident du 11/05 cité dans CLAUDE.md). **Remède** : invalidation de cache sur écriture (`invalidate()` existe mais n'est jamais appelé) + logguer/alerter les 5xx même mis en cache.

5. **State machines contournées.** Le moteur centralisé (bien conçu) n'est appelé que par 1 route sur 5 concernées ; les autres font des `UPDATE statut` directs → la garantie d'intégrité est illusoire. **Remède** : router toutes les transitions par le moteur (chantier V6 déjà amorcé).

6. **Incohérences d'unités et de définitions.** kg vs tonnes vs pièces/paires non modélisés ; panier moyen, IPT, % écart pesée, absentéisme calculés avec **deux définitions différentes** selon l'écran ; **objectif boutique en HT comparé à un réalisé TTC** (surestime l'atteinte de ~20 %). Ces points **n'ont pas été corrigés** car ils demandent une **décision métier** (un objectif de CA est-il exprimé HT ou TTC ?) plutôt qu'un simple câblage. **Remède** : un module de KPI unique (une seule définition par indicateur) — à cadrer avec la direction.

---

## 4. Traçabilité industrielle des flux (mission centrale)

C'est le point sur lequel tu as le plus insisté, et le rapport 04 en fait la cartographie complète. **Constat : la colonne vertébrale de traçabilité existe dans la base mais n'est pas branchée.**

### 4.1 L'état réel

Le flux **collecte → réception → tri → colisage → expédition → Refashion** présente **12 ruptures de chaîne** (détail §1.3 du rapport 04). Les plus structurantes :

- **Le workflow de lots — cœur de la traçabilité — n'a aucune interface.** Les tables `batch_tracking → operation_executions → operation_outputs → colisages` (16 endpoints backend) sont **vides en production** : aucune page ne les alimente. Le carton étiqueté ne « sait » pas de quel lot ni de quelle tournée il vient (`produits_finis.batch_id` existe mais n'est jamais écrit).
- **Trois registres de stock parallèles jamais réconciliés** (brut / trié théorique / conditionné) : aucun total n'est comparable à un autre.
- **Deux des cinq exports Refashion officiels sont structurellement vides ou faux** (`vw_dpav_sortants` s'appuie sur les colisages inutilisés ; `vw_dpav_communes` fait un produit cartésien qui gonfle le tonnage par commune ~×10).
- **Le poids par CAV est une moyenne**, pas une mesure (répartition uniforme du total de tournée) — toute analyse « par commune » en hérite.

### 4.2 Ta décision → le chantier « carton/balle chaîné bout-en-bout »

Tu as choisi une traçabilité **au carton/balle chaînée sans rupture** (pas encore le passeport à la pièce). C'est le bon niveau d'ambition : réaliste à 12 mois, et suffisant pour Refashion/Métropole. Le chantier concret :

1. **Activer le workflow de lots avec une UI minimale** (2 écrans) : un bouton « Démarrer un lot » sur la sortie balance vers l'atelier de tri (le champ `stock_movement_id` est déjà prévu), et un écran de colisage. Cela remplit les 6 tables aujourd'hui vides.
2. **Écrire les 2 liens morts** : `produits_finis.batch_id` (carton → lot) et `colisages.expedition_id` (colisage → expédition). Le chaînage carton → lot → tournée → expédition devient alors continu.
3. **Faire d'`operation_outputs` l'alimenteur automatique du stock trié** (aujourd'hui rien n'alimente le stock par catégorie) + un tableau de réconciliation brut/trié/conditionné.
4. **Corriger les 2 vues Refashion fausses** une fois les colisages alimentés.

Les modules `etiquettes.js`, `BalancePage` et le grand livre stock-original sont déjà **exemplaires** (transactions, `FOR UPDATE`, idempotence de scan, UX tactile) — la réparation est un problème de **câblage, pas de refonte**.

---

## 5. Extensibilité : nouveau véhicule + nouvelles sondes (échéance proche)

Tu vas étendre le parc avec un **nouveau véhicule** et de **nouvelles sondes de remplissage**, et faire évoluer la chaîne de tri avec une **sonde matière/couleur**. Verdict d'extensibilité (rapport 03 §4 et rapport 04 §2) :

### 5.1 Nouveau véhicule — **BON** (≈ 15 min, sans code)
`POST /vehicles` ne requiert que l'immatriculation ; le `qr_token` chauffeur est généré automatiquement et l'URL de pairing est fournie. **Frictions mineures** : la tare saisie en base n'est jamais pré-remplie côté mobile (pesée), et un bug laisse le statut `in_use` collé après tournée (rapport 03, A10).

### 5.2 Nouvelles sondes de remplissage — **BON pour un EM400-MUD de plus, CODE REQUIS pour un autre modèle**
Le provisioning LoRaWAN est complet (API Orange Live Objects, AppKey chiffrée, déduplication `fcnt`, diagnostic 4 couches). **Mais** : le décodeur Milesight est **câblé en dur** (`liveobjects-processor.js:3,62`), la colonne `sensor_type` n'est jamais consultée, et les seuils d'alerte (80/95/20 %) sont codés en dur, non configurables par CAV. **Recommandation avant l'arrivée des nouvelles sondes** : un **registre de décodeurs multi-modèles** (choisi selon `sensor_type`) + des seuils par CAV. Chantier P1, à faire **avant** la commande du nouveau matériel.

### 5.3 Sonde matière/couleur au tri — ta décision : **convoyeur optique industriel**
Tu vises un scénario **convoyeur optique industriel** (débit élevé, type TOMRA/Picvisa/Valvan) plutôt qu'un poste assisté. Conséquences sur le schéma de données (rapport 04 §2.3, DDL esquissé) :

- La table de lectures `tri_lectures_sonde` doit être **dimensionnée haut débit dès l'origine** (`BIGSERIAL`, partitionnement mensuel, index sur `batch_id`/`operation_execution_id`) — un convoyeur lit plusieurs pièces/seconde.
- **Cohérence avec ta décision traçabilité** : les lectures à la pièce ne sont **pas stockées comme un passeport par vêtement**, mais **agrégées au niveau balle/carton** (composition dominante, % matières, famille couleur). C'est cohérent avec le choix « carton/balle » et évite un volume ingérable.
- **Prérequis absolu** : ce chantier **dépend de l'activation du workflow de lots** (§4.2). Tant que `batch_id` ne vit pas, une lecture de sonde n'a rien à quoi se rattacher. **La sonde matière/couleur ne peut pas précéder la réparation de la traçabilité.**
- Point d'ancrage déjà en place : `categories_sortantes.famille_refashion` — le mapping sortie sonde → filière réglementaire a une cible.

---

## 6. Simplicité d'usage (public à faible littératie numérique)

Exigence n°1 du commanditaire. Le **mobile chauffeur est le point fort** de l'application (gros boutons, feedback haptique, parcours linéaire) — sauf un piège grave : en cas de rejet réseau 4xx, les données saisies (pesées, collectes) sont **supprimées** de la file de synchronisation avec un badge « À renvoyer » **mensonger** — le chauffeur croit ses données sauvées alors qu'elles sont perdues (rapport 08, A8 ; rapport 03, A7).

Côté web, les 5 frictions majeures pour un public peu à l'aise :
1. **Erreurs invisibles** (§3.2) : des zéros affichés comme des données vraies, des actions « enregistrées » qui ont échoué en silence.
2. **Le COLLABORATEUR** atterrit sur un tableau de bord de direction affichant « 0 module disponible ».
3. **Le RESP_BTQ** voit un dashboard sans rapport avec sa boutique.
4. **Clic menu → retour silencieux au dashboard** quand le rôle n'a pas accès (pas de page « accès refusé »).
5. **Incohérences visuelles** : `alert()`/`confirm()` natifs (78 occurrences) vs modales maison, accents manquants (corrigés en partie), design system quasi inutilisé (`FormField` sur 2 pages / 83).

**Ces points sont peu coûteux à corriger** et à fort impact sur la perception de fiabilité.

---

## 7. Plan d'action priorisé

Intégrant tes 4 décisions : traçabilité **carton/balle**, sonde **convoyeur industriel**, réglementaire **différé**, essaimage **préparé mais interne d'abord**.

### P0 — Fiabilité immédiate (fait, ou < 1 jour)
- ✅ **28 bloquants/majeurs confirmés** (§2, deux passes) — corrigés, testés et poussés. Couvre insertion IA, planning, RGPD candidats, radar freins, types produit/CO₂, webhook boutiques, PII véhicules, clé PCM, KPIs RH, scorecard/objectifs, ré-import VAK.
- ✅ **Sécurisation des 13 endpoints tournée mobile** (`commit bf08932`) : les routes chauffeur (détail tournée, démarrer/collecter/peser/incident/statut/scan/ré-optim + `/vehicle/:id/today`) étaient ouvertes sans authentification, sur un `:id` énumérable → lecture des tournées et falsification anonyme de tonnage/pesées possibles. Elles exigent désormais le JWT chauffeur, avec **ré-auth transparente** côté mobile (helper `authedFetch` + `driverAuth`, `vehicle_token` persisté) pour zéro perte de données offline. Corrige au passage la purge des données de collecte sur 401. Validé : backend 180/180, mobile 40/40, builds OK.
- ✅ **Reliquat scan/GPS traité** (`commit ad52ea8`, rapport 03 A7) : la file de sync visait deux endpoints inexistants (`/tours/:id/scan`, `/tours/gps-batch`). Scans rebranchés sur `/scan-public` ; **bufferisation GPS hors-ligne complétée** (nouvel endpoint batch `POST /tours/gps-batch-public` + capture locale dans TourMap quand le réseau tombe, sans double-insertion avec le socket temps réel) → les traces GPS en zone blanche ne sont plus perdues.
- ☐ **Filet de sécurité** : test d'intégration exécutant chaque requête SQL (détecte les désalignements colonne — cause n°1 des bloquants) + rendre le smoke-test strict sur les 5xx.

### P1 — Robustesse & préparation matérielle (semaines)
- ☐ **Registre de décodeurs multi-sondes + seuils par CAV** — **avant** la commande des nouvelles sondes (§5.2).
- ☐ **Gestion d'erreur UI systématique** (intercepteur + `ErrorState`) et fin de la perte de données mobile 4xx.
- ☐ **Cloisonnement des boutiques** (RESP_BTQ limité à sa boutique — aujourd'hui aucun cloisonnement) et durcissement RGPD/PII (santé/finances ouvertes aux MANAGER).
- ☐ **Router toutes les transitions de statut par la state machine** (5 modules).

### P2 — Traçabilité carton/balle bout-en-bout (mois) — **chantier structurant EN COURS**
> Détail et suivi : `10-chantier-tracabilite-carton-balle.md`.
- ✅ **I1** — lien carton → lot : `produits_finis.batch_id` écrit à l'étiquetage (backend + tests).
- ✅ **I2** — UI Lots de tri (onglet ChaineTri : créer/démarrer/suivre) + sélecteur de lot au poste d'étiquetage.
- ✅ **I3** — fiche traçabilité lot → cartons → sortie (chaîne rendue interrogeable et visible).
- ✅ **I5** — `vw_dpav_communes` corrigée (produit cartésien → tonnage territorial gonflé ~×nb_cav).
- ☐ **I4** — reverser `operation_outputs` en stock trié : **différé** (bloqué par le seed `matieres`, bug A1).
- ☐ Vues Refashion « sortants » (colisages inutilisés) : repointer sur `produits_finis` — décision métier.
- ☐ **Puis** : schéma haut débit de la sonde matière/couleur convoyeur (§5.3), fondations posées par I1-I3.

### Différé (par ta décision)
- Réglementaire (RNDTS, e-facturation Factur-X 09/2026, DPP textile) : **veille active**, pas de chantier maintenant. ⚠️ Rappel : la **réception** d'e-factures devient obligatoire au 09/2026 — à re-arbitrer d'ici la rentrée.
- Essaimage inter-SIAE : garder les **garde-fous d'architecture** (pas de nouveau couplage mono-site, `boutique_id`/`site` explicites) sans construire le multi-tenant.

---

## 8. Positionnement marché (benchmark, rapport 09)

SOLIDATA occupe une **position atypique et défendable** : l'intégration verticale SIAE-textile (collecte IoT + tri + Refashion + exutoires + boutiques + VAK + insertion) n'existe nulle part dans le commerce. Le **reporting Refashion natif** est un savoir-faire potentiellement monétisable auprès des ~60 autres opérateurs de tri conventionnés — ce qui justifie ta décision « essaimage préparé ».

**Gaps identifiés** (pour mémoire, non prioritaires selon tes choix) : registre déchets RNDTS, e-facturation, DPP-readiness (identifiants GS1). **Acteurs à surveiller** : Matoha/Picvisa/Valvan (sondes tri), Heyliot (2ᵉ source capteurs français, pour dé-risquer la dépendance Milesight/Orange), Trackdéchets (API registre).

---

## 9. Index des rapports détaillés

| Fichier | Domaine |
|---------|---------|
| `00-synthese.md` | **Ce document** |
| `01-transverse-securite-routeurs.md` | Sécurité, logique des 63 routeurs, RGPD, socle backend |
| `02-recrutement-rh-insertion.md` | Recrutement, PCM, RH, Insertion, Pointage, Prescripteurs |
| `03-collecte-vehicules-capteurs.md` | Collecte, tournées, véhicules, GPS, capteurs LoRaWAN, IA prédictive, mobile |
| `03a-annexe-frontend-collecte.md` | Annexe : pages web opérationnelles de collecte |
| `03b-annexe-frontend-admin-collecte.md` | Annexe : pages admin CAV/véhicules/sondes/prédictif |
| `04-tri-stock-tracabilite.md` | **Tri, stock, produits finis, étiquettes, traçabilité bout-en-bout, sonde NIR** |
| `05-logistique-exutoires-facturation.md` | Logistique exutoires, expéditions, facturation, contrôle Pennylane, Refashion |
| `06-finance-pennylane-reporting.md` | Finance, Pennylane, reporting, historique, dashboards |
| `07-boutiques-vak.md` | Boutiques retail 2ⁿᵈᵉ main, Vente au Kilo, intégration SumUp |
| `08-ux-frontend-mobile.md` | UX/UI web & mobile, accessibilité, cohérence, faible littératie |
| `09-benchmark-marche.md` | Comparaison outils leaders traçabilité déchets & textile |

---

*Synthèse établie le 4 juillet 2026. Les 15 correctifs P0 sont sur la branche `claude/solidata-erp-audit-265e2e` (Jest 180/180). Les décisions d'ambition du 4 juillet (traçabilité carton/balle, sonde convoyeur industriel, réglementaire différé, essaimage préparé) sont intégrées au plan d'action §7.*
