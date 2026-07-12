# Vague 1 — Rapport de réalisation : réparer les chaînes de bout en bout

**Date** : 12 juillet 2026 · Fait suite au [plan d'action](01-plan-action.md) (section Vague 1) et à la [vague 0](02-vague0-realisation.md).
**Méthode** : 9 agents d'implémentation en parallèle sur lots à fichiers quasi disjoints, commit de sécurisation, puis agent debug final (revue intégrale, cohérences inter-lots, validation des migrations sur Postgres réel).
**Résultat** : **38/38 items « fait »** (26 chantiers du plan + 8 résidus de vague 0 + sous-items). Verdict debug : **prêt à committer**.
**Vérifications** : Jest backend **322/322** (33 suites, ~106 tests ajoutés par la vague) · build Vite OK · mobile Vitest **40/40** · `init-db.js` exécuté **deux fois sur un Postgres 16 réel** (création + idempotence, vues DPAV interrogées avec les résultats attendus).

## Arbitrage appliqué

**A1 (traçabilité conditionnement)** — décision par défaut de l'orchestrateur, documentée et **réversible** : pas d'UI colisage en vague 1 ; les preuves d'audit Refashion (`vw_dpav_sortants`, `vw_coherence_tri_filiere`) sont **repointées sur `produits_finis`**, la table réellement alimentée par l'atelier (étiquetage + balance). Limite assumée (commentée en SQL et à l'écran) : les flux vrac CSR/effilochage/refus n'apparaissent pas dans la vue sortants — l'adoption du colisage reste possible en vague 2 pour la traçabilité fine carton/balle.

## Ce qui a été livré

### Chaîne matière → Refashion (lots dpav-refashion, stock-produits-finis, metropole-communes)
- **Vues d'audit Refashion vivantes** : repointées sur `produits_finis` avec mapping vers les 5 familles Refashion + `non_classe` (DROP+CREATE prouvé sur PG16, chemin d'upgrade validé) ; garde du filtre trimestre sur les exports (les vues mensuelles 500-aient).
- **DPAV outillée** : bandeau « Activité ERP » (collecte/tri + sévérité d'écart), bouton « Pré-remplir depuis l'activité », **badges d'écart déclaré/calculé par champ** ; formulaires de saisie DPAV / communes / **subventions** enfin présents (le KPI subvention du dashboard se remplit désormais par la saisie) ; journal d'audit affiché.
- **Inventaire qui corrige le stock** : la validation pose des écritures de régularisation par catégorie comptée (transactionnel, idempotent, distinction « non compté » vs « compté zéro », prouvé sur PG16).
- **Annulation comptable des mouvements** : contre-écriture liée + motif obligatoire, l'original n'est jamais altéré (solde prouvé 100 → 0).
- **Sortie carton → stock** : le scan décrémente le stock pour le flux **libre** (voir « correction debug » ci-dessous pour btq/vak) ; annulation de scan transactionnelle.
- **Triple pesée réconciliée** : écarts calculés et badgés sur les contrôles de pesée (seuils existants réutilisés).
- **3 voies produits finis harmonisées** : générateur unique (compteur poste, code base24, catalogue, `created_by`, `source`) ; le formulaire manuel n'a plus de code-barres libre ; la **balance kiosque exige désormais un token de poste** (`/balance/<token>`, seed logué, liste ADMIN).
- **Captation par commune juste** : répartition du tonnage **au prorata des CAV collectés** (prouvé : 300 kg → 200/100 au lieu de l'inflation cartésienne) ; **rattachement CAV↔commune** enfin possible (sélecteur INSEE dans AdminCAV, taux de rattachement, part « non rattaché » affichée honnêtement) ; erreurs de ReportingMetropole visibles par section.

### Chaîne financière (lots finance-pennylane, exutoires-tarifs)
- **Matching de factures sûr** : référence complète `CMD-AAAA-NNNN`, match exact, refus si ambigu — plus aucune clôture de commande arbitraire.
- **Rentabilité matière réelle** : cascade de sources (facture Pennylane rapprochée > pesée client × prix > tonnage × prix), méthode documentée dans la note de l'écran, état « données indisponibles » explicite.
- **Rapprochement CA opérationnel vs comptable** : nouvel endpoint et vue par activité (exutoires, boutiques HT, VAK HT, subventions vs comptes 70/74 du GL), par mois, avec écarts — **sans injection dans le P&L** (pas de double compte).
- **Sync Pennylane quotidienne** planifiée (scheduler, verrou, log) — la route manuelle délègue à la même fonction.
- **Tarifs exutoires réalignés** de bout en bout (CHECK SQL migré, validateur, UI — essuyage/tricot/mérinos tarifables, `INSERT 'essuyage'` prouvé) ; **transition `→ expédiée` gardée** : refus 409 sans préparation liée (le seul chemin qui décrémente le stock), raccourci retiré du front.

### Chaîne personne (lot personne-rh-insertion)
- **Prescripteurs utilisables** : page référentiel (ADMIN/RH), affectation sur la fiche salarié, **export FSE+ accessible** depuis le panneau cohorte — la colonne prescripteur n'est plus structurellement vide.
- **Compétences opérationnelles** : permis B / CACES éditables sur la fiche employé (source réelle du planning vérifiée), Skills.jsx refondu à partir des employés (jointure fautive corrigée), backfill idempotent depuis les candidats liés.
- **Plafond CDDI 24 mois** : durée cumulée calculée (fusion d'intervalles), badge ambre ≥ 20 mois / rouge ≥ 23, encart « contrats finissant sous 60 j » ; le CHECK qui coerçait CDDI→CDD est levé ; **jalons recalés au renouvellement** (jalons réalisés intouchés, parcours terminés non réactivés).
- **Anonymisation RGPD unifiée** : `services/anonymization.js` (employé + candidat) transactionnel et résilient, consommé par la route manuelle ET la purge planifiée — santé/RQTH/naissance/titres de séjour, textes libres d'insertion, PCM/entretiens couverts.
- **Visites médicales fiables** : date d'embauche distincte de la dernière visite, échéance recalculée à la création, réimport non destructif.

### Terrain & incidents (lot terrain-incidents)
- **Cycle de vie des incidents** : nouveau routeur `/api/incidents` (liste transverse filtrable, stats, transitions avec résolveur/commentaire obligatoire), **page web Incidents** (ADMIN/MANAGER) au menu Collecte.
- **Checklists visibles** : les notes du chauffeur ne sont plus perdues (colonne + déstructuration) et les checklists s'affichent sur la fiche véhicule.
- **Mobile chauffeur** : action FALC « Impossible de collecter ce point » (5 raisons, offline-first via la file de sync) ; **photo d'incident** (multipart en ligne, dégradation propre hors ligne) ; clôture mobile **idempotente** (répliquée du correctif web de vague 0).
- **Véhicules** : anti-double-affectation sur les 4 modes de création de tournée (409 explicite) ; le filtre `available=true` est réellement honoré.

### Moteur prédictif honnête (lot ia-predictif)
- **Normalisation par capacité** : fin de la formule kg-comme-% qui saturait ; cadence réelle de collecte apprise de l'historique ; **source unique des facteurs** (`utils/fill-factors.js` : appris > manuel > défaut, avec cache) remplaçant les 3 jeux divergents de `cav.js` ; **config persistée** en base (plus de perte au déploiement) avec affichage de la source effective de chaque facteur dans AdminPredictive.
- **Boucle capteur réparée** : le décalage était à la lecture (`observed_fill_level` 0-5 vs `observed_fill_rate` %) — coalesce correct, catch muets remplacés par des logs.
- **Contexte LLM honnête** : `estimated_fill_rate` (toujours 0) remplacé par la vraie donnée capteur/prédiction ; modèles Claude dépréciés alignés (predictive-ai, chat, vehicles).
- **Job quotidien de prédictions** J..J+7 (heuristique locale, sans LLM) — la boucle d'apprentissage capteur a enfin de la matière ; script de **backtest** livré (`scripts/backtest-predictions.js`).

### Finitions (lot finitions)
- BoutiquesObjectifs et BoutiquesVentes passés en base HT (libellés exacts, % d'atteinte corrects), endpoint rayons enrichi de `ca_ht` (table du jour alignée sur le KPI), carte résumé des heures complétée (Maladie/Congés/Formation).

## Corrections de la passe debug

1. **Régression inter-lots — double décompte du stock** (la trouvaille majeure de la passe) : la sortie carton écrivait un mouvement pour TOUT scan, alors que les flux boutique et VAK sont déjà décrémentés en aval (expédition de commande boutique ; préparation exutoire rendue obligatoire par la garde 38b). Corrigé : mouvement au scan **réservé au flux libre**.
2. **Chemin « base neuve » d'`init-db.js` réparé** (bugs pré-existants découverts par la validation obligatoire) : deux DO blocks s'exécutaient avant le CREATE TABLE qu'ils modifient, et un index avant sa colonne — une reconstruction from scratch échouait. Ordre toléré + colonnes intégrées à la définition canonique ; **double exécution complète validée sur PG16** (création puis idempotence, zéro erreur).
3. `vehicles.js` : dernier défaut `CLAUDE_MODEL` déprécié aligné sur `claude-sonnet-5`.

## Points résiduels documentés (backlog vagues 2/3)

1. Menu « Véhicules » encore réservé ADMIN — un MANAGER n'a pas d'entrée vers la consultation des checklists (routes déjà ouvertes).
2. Recopie temps réel permis/CACES au moment du link candidat↔collaborateur (le backfill d'init-db rattrape à chaque déploiement).
3. Exutoires : raccourcis `confirmée→en_préparation` et `en_préparation→chargée` encore ouverts ; modal détail d'ExutoiresCommandes lit des champs désalignés.
4. `CLAUDE_MODEL` déprécié restant dans `ai-agent/` (module par ailleurs candidat au décommissionnement — arbitrage A3).
5. CHECK `employee_contracts.weekly_hours IN (26,35)` coerce toujours les temps réels 24/28/30 à l'import ; libellés Malibou de la visite d'embauche à confirmer sur un export réel ; ordre des colonnes FSE+ modifié (à valider avec le financeur).
6. IA : `proposals.js`/`stats.js` lisent la couche manuelle/défaut des facteurs (affichage) ; `predictive_seasonal_factors` créée au premier recalcul mensuel (absence gérée).
7. Reconstruction from scratch : exécuter `migrate-exutoires.js` et `migrate-finance.js` avant le premier `init-db` (comme validé ici) — sans impact sur les déploiements courants.

## Changements de comportement à communiquer au déploiement

- **Kiosque balance** : chaque tablette doit être reconfigurée UNE fois sur `/balance/<token>` (jeton par poste, seed logué au premier démarrage, liste via `GET /api/stock-original/balance-postes`).
- `GET /vehicles?available=true` renvoie désormais uniquement les véhicules réellement libres.
- Panier moyen de BoutiquesVentes en base HT ; valeurs FillRateMap légèrement recalibrées (facteurs unifiés).
- Premier login des comptes encore en `admin123` : changement de mot de passe exigé (vague 0).
- `API_USER`/`API_PASSWORD` à renseigner dans le `.env` serveur pour le smoke test authentifié (rappel vague 0).
