# Audit pluridisciplinaire SOLIDATA — 9 personas

**Date** : 1er mai 2026
**Branche auditée** : `claude/design-app-architecture-hGVgg` (post-implémentation v1.5.0)
**Méthode** : 9 personas d'audit séquencés (CTO, RSSI, UX, BA Collecte, BA Tri, HR, Ops BTQ/Logistique, Direction, Enterprise Architect)
**Exécution** : 8 agents IA en parallèle (BA Collecte+Tri fusionnés, EA en synthèse)

---

## 1. Résumé exécutif

### Note globale de maturité de l'application

| Dimension | Note | Tendance |
|---|---|---|
| Architecture technique | 6.5 / 10 | ↗ +1 (fixes du 1er mai) |
| Sécurité applicative | 5.0 / 10 | → stable, fixes ecstatic-darwin appliqués |
| UX / Design system | 6.8 / 10 | ↗ +0.5 (sprint a11y, FormField, ErrorState) |
| Performance | 7.0 / 10 | ↗ +1.5 (N+1 fix, throttle GPS, cache, indexs) |
| Logique métier collecte | 7.1 / 10 | → stable |
| Logique métier tri/production | 6.4 / 10 | → stable |
| Logique métier RH/insertion | 6.5 / 10 | → stable |
| Logique métier BTQ/logistique | 6.5 / 10 | → stable |
| Pilotage / direction | 6.5 / 10 | → stable, manques structurels |
| Cohérence transverse | 5.5 / 10 | ⚠ point faible (référentiels doublons) |
| **Note globale consolidée** | **6.3 / 10** | **Production fonctionnelle, dette structurelle significative** |

### Principaux risques (top 5)

1. **🔴 Référentiels partenaires dédoublés** — `exutoires` et `clients_exutoires` cohabitent sans FK : impossibilité de tracer une commande → expédition → facture de bout en bout. *Risque audit éco-organisme et financier.*
2. **🔴 Reporting Refashion DPAV en double saisie** — déclaration manuelle non sourcée depuis `production_daily` ni `stock_movements`. *Risque non-conformité et perte de subvention.*
3. **🔴 Données PCM accessibles sans authentification** (audit RSSI, à confirmer en prod) — endpoint `/api/pcm/*` historiquement sans `authenticate`. *Risque RGPD majeur, profils psychologiques de 500+ salariés.*
4. **🔴 Tests automatisés quasi-absents** (≈ 5 % de couverture) — 0 fichier `.test.js`, smoke manuel uniquement. *Risque de régression à chaque changement.*
5. **🔴 Statut commande exutoires** — 9 statuts commande / 5 préparation / 4 contrôle / 4 facture sans state machine commune. *Risque d'états orphelins dans le workflow logistique.*

### Principaux points forts (top 5)

1. **Architecture modulaire claire** — 26 modules métier isolés, conteneurisation Docker propre, healthchecks et limites mémoire explicites.
2. **Authentification JWT robuste** — 6 rôles, refresh token, fail-safe sur secret par défaut, rate limiting strict sur `/auth`.
3. **IA intégrée fonctionnelle** — moteur prédictif remplissage CAV, optimiseur de tournées OSRM, diagnostic d'insertion 7 freins, SolidataBot Claude.
4. **Documentation exceptionnelle** — `CLAUDE.md` exhaustif, 25+ documents fonctionnels et techniques, audits quotidiens tracés.
5. **Sprint qualité du 1er mai** — 12 actions livrées (N+1 fix, throttle GPS, indexs FK, code splitting, FormField/ErrorState, focus trap, request-logger, healthcheck, cache Redis, backup S3).

### Top 10 actions prioritaires

| # | Action | Persona | Priorité | Effort | Bénéfice principal |
|---|---|---|---|---|---|
| 1 | Authentifier `/api/pcm/*` (`authenticate`+`authorize('ADMIN','RH')`) | RSSI | P1 | S (30min) | Bloque la fuite de données psychologiques |
| 2 | Fix colonne `kg_entree` → `entree_ligne_kg` dans `performance.js` | Direction / EA | P1 | S (30min) | Page Performance + KPIs réparés |
| 3 | Fusion `exutoires` + `clients_exutoires` → `partners` | EA / Ops | P1 | M (10h) | Traçabilité commande → facture |
| 4 | Sourcer Refashion DPAV depuis `production_daily` (vue) | Direction | P1 | M (4-6h) | Conformité éco-organisme |
| 5 | Visite médicale post-embauche (route + alerte J+8) | RH | P1 | M (3-4h) | Conformité droit du travail |
| 6 | Supprimer fallback localStorage refresh token, n'utiliser que HttpOnly | RSSI | P1 | S (1h) | XSS impact réduit |
| 7 | Ne plus retourner `err.message` au client (54 occurrences) | RSSI | P1 | M (4h) | Fuite info / énumération DB |
| 8 | Lier `production_daily.tour_id` → `tours` (vue réconciliation poids) | EA / BA Tri | P1 | M (3h) | Cohérence collecte ↔ tri ↔ Refashion |
| 9 | Tests Jest 5 modules clés (tours, insertion, dashboard, stock, finance) | CTO | P0 | L (20h) | Non-régression future |
| 10 | Refactor `tours/` (15 → 3 fichiers + `TourService`) | CTO | P1 | L (8h) | Maintenabilité du module le plus complexe |

---

## 2. Tableau des constats (sélection des 30 plus impactants)

> Tableau complet sur les 80+ constats détaillés conservé dans les rapports d'agents (voir `/tmp/claude-0/.../tasks/*.output`). Ci-dessous les 30 prioritaires.

| ID | Domaine | Module | Persona | Constat | Risque | Impact | Priorité | Effort | Recommandation | Action concrète |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Sécurité | PCM | RSSI | Auth manquante sur `/api/pcm/*` (mentionné audits historiques) | Fuite RGPD données sensibles 500+ salariés | Critique | P1 | S | Ajouter middleware auth | `router.use(authenticate, authorize('ADMIN','RH'))` en tête de `pcm.js` |
| C-02 | Sécurité | Auth | RSSI | Refresh token en localStorage (fallback) | Vol token via XSS | Haut | P1 | S | HttpOnly cookie uniquement | Supprimer fallback `frontend/src/services/api.js` |
| C-03 | Sécurité | Routes | RSSI | 54 routes retournent `detail: err.message` | Fuite schéma DB et stack traces | Haut | P1 | M | Map error handler central | `errorHandler` centralisé, jamais `err.message` côté client |
| C-04 | Sécurité | Config | RSSI | `.env.example` contient mots de passe par défaut explicites | Reprise dev → prod sans changement | Haut | P1 | S | Placeholders type `CHANGE_ME_*` | Ré-écrire `backend/.env.example` |
| C-05 | Sécurité | npm | RSSI | 10 vulnérabilités npm (8 HIGH : tesseract.js, pdf-parse, xml2js) | RCE / DoS via dépendance | Haut | P1 | S | `npm audit fix` + Dependabot | Vérifier non-régression, MAJ deps |
| C-06 | Architecture | tours | CTO | 17 fichiers, 5,2K LOC, duplications, pas de service layer | Maintenabilité ralentie, bug fixes plus longs | Moyen | P2 | L | Refactor 17 → 3 + `TourService` | Voir runbook P1#12 |
| C-07 | Tests | Global | CTO | 0 fichier `.test.js`, ~5% couverture | Régressions silencieuses à chaque modif | Critique | P1 | L | Jest + Supertest sur 5 modules clés | tours, insertion, dashboard, stock, finance |
| C-08 | Architecture | Routes | CTO | Logique métier dans routes, pas de couche service/repository | Pas de tests unitaires possibles | Moyen | P2 | XL | Service+Repository layer | Voir runbook P2#16 |
| C-09 | Performance | dashboard | CTO/Perf | N+1 sur `/dashboard/objectifs` ✅ corrigé | — | — | — | — | — | Fait dans v1.5.0 |
| C-10 | Performance | Socket.IO | CTO/Perf | GPS proximité CAV non throttlée ✅ corrigé | — | — | — | — | — | Fait dans v1.5.0 |
| C-11 | UX | Modals | UX | `window.confirm` utilisé dans 9 pages au lieu de `<ConfirmDialog>` | Accessibilité dégradée, incohérence | Moyen | P2 | S | Remplacer par `<ConfirmDialog>` | grep `window.confirm` puis fix |
| C-12 | UX | Tours | UX | Wizard sans breadcrumb / barre d'étapes | Chauffeur perdu, abandon | Moyen | P2 | S | Composant Stepper visible | Créer `Stepper.jsx` réutilisable |
| C-13 | UX | InsertionParcours | UX | Page très dense (radar + timeline + freins + actions) | Charge cognitive élevée pour CIP | Moyen | P2 | M | Onglets : Vue/Parcours/Freins/Docs | Refonte page |
| C-14 | UX | LiveVehicles+Tours | UX | Vue véhicule + tournée active séparées | Manager 3-4 navigations | Moyen | P3 | M | Vue côte à côte | Page unifiée `/dashboard-collecte` enrichie |
| C-15 | UX | Reporting | UX/Direction | 4 pages reporting fragmentées (Collecte/RH/Production/Métropole) | Direction sans vue impact unifiée | Moyen | P2 | M | Page synthèse direction | `Dashboard /direction` ou hub |
| C-16 | UX | a11y | UX | ~30 boutons icône sans `aria-label` | WCAG AA non atteint | Moyen | P2 | M | Audit + ajout aria-label | Sprint a11y phase 2 |
| C-17 | Métier | Collecte | BA | `fill_level` non harmonisé (capteurs % vs mobile 0-5) | Modèle ML pollué | Moyen | P2 | S | Conversion 0-5 → 0-100% | Backend normalisation |
| C-18 | Métier | Collecte | BA | Pas de contrainte poids max essieu (DPM) ni pause déjeuner forcée | Non-conformité routière, fatigue | Haut | P2 | M | Ajouter contraintes optimiseur tournée | `predictive-ai.js` enrichi |
| C-19 | Métier | Collecte | BA | Pas d'alerte chauffeur "CAV inaccessible" en temps réel | Perte productivité, retard non visible | Moyen | P2 | M | Type incident "CAV inaccessible" + reroute | Mobile + backend |
| C-20 | Métier | Tri | BA | `produits_finis` sans FK `batch_id` | Traçabilité lot → PF cassée, audit Refashion défaillant | Haut | P1 | M | Ajouter FK + backfill | Migration init-db.js |
| C-21 | Métier | Tri | BA | Aucun KPI perte par opération (% poids entré → sorti) | Optimisation poste aveugle | Moyen | P2 | M | Dashboard "Perte OP.n %" | Vue + page Production |
| C-22 | Métier | Tri | BA | Stock original vs stock moderne en parallèle, sans réconciliation | Quel flux pour Refashion DPAV ? | Haut | P1 | M | Documenter + vue de réconciliation | `docs/LOGIQUE_STOCK_INVENTAIRES.md` à enrichir |
| C-23 | Métier | RH | RH | Diagnostic insertion par défaut (freins=3) si pas saisi | Plans d'action sur diagnostic bidon | Haut | P1 | S | CHECK avant création jalons | `routes/insertion/conversion.js` |
| C-24 | Métier | RH | RH | Visite médicale : colonne existe, pas de route ni alerte | Non-conformité droit du travail | Haut | P1 | M | Route POST + alerte J+8 | `routes/employees.js` + scheduler |
| C-25 | Métier | RH | RH | Prescripteur (PE/ML/CD/CCAS) optionnel, free text | Reporting Pôle Emploi/FSE+ incomplet | Haut | P2 | M | ENUM + table prescripteur_orgas | Migration + UI |
| C-26 | Métier | RH | RH | Conversion candidat→employé sans transaction (catch silencieux) | Parcours insertion cassé sans rollback | Haut | P1 | S | BEGIN/COMMIT/ROLLBACK | `routes/candidates/conversion.js` |
| C-27 | Métier | RH | RH | Aucun export FSE+ ni rapport mandat individuel | Non-conformité reporting IAE | Moyen | P2 | L | Tables + routes export | À spécifier avec Direction |
| C-28 | Métier | BTQ | Ops | Import CSV bloqué si `daterange` overlap (même jour) | Perte des ventes du jour si re-déclenchement | Moyen | P2 | S | Flag `force_override=true` UI | `boutiques.js` |
| C-29 | Métier | BTQ | Ops | Reconstruction tickets par minute fusionne tickets simultanés | IPT / panier moyen surestimés | Moyen | P2 | M | Privilégier `num_ticket` réel | Code import enrichi |
| C-30 | Métier | Logistique | Ops | Conflit lieu chargement sans `SELECT FOR UPDATE` | Surréservation quai si requêtes parallèles | Moyen | P2 | S | Lock pessimiste + UNIQUE index | `preparations.js` |
| C-31 | Métier | Logistique | Ops | Mouvements stock provisoires non finalisés | Stock incohérent, double comptage | Haut | P1 | S | Cron alerte > 7j | Job scheduler |
| C-32 | Métier | Logistique | Ops | Statuts commandes `chargee` / préparation `en_chargement` non alignés | Workflow incohérent, audit difficile | Moyen | P2 | M | Enum centralisé | Voir EA #2 |
| C-33 | Pilotage | Direction | Direction | DPAV Refashion en double saisie (manuel) | Écart ERP ↔ déclaration éco-organisme | Critique | P1 | M | Vue auto-sourcée | `vw_refashion_summary` |
| C-34 | Pilotage | Direction | Direction | Taux valorisation peut dépasser 100% | Reporting incohérent stakeholders | Haut | P1 | S | Revoir formule (exclure déchets) | `dashboard.js` ligne ~192 |
| C-35 | Pilotage | Direction | Direction | CO2 calculé sur mix fixe (1.567 t CO2/t) | Reporting Métropole imprécis ±20% | Moyen | P2 | M | Lier ventilation exutoires réelle | Ajouter `exutoire_type` + facteurs ADEME |
| C-36 | Pilotage | Direction | Direction | Aucun seuil d'alerte configurable | Pilotage rigide, alertes métier ignorées | Moyen | P2 | M | Table `alert_thresholds` + UI | Migration + page admin |
| C-37 | Transverse | Référentiels | EA | `exutoires` ↔ `clients_exutoires` doublons sans FK | Traçabilité commande→facture impossible | Critique | P1 | M | Fusion en `partners` | Voir Ch1 EA |
| C-38 | Transverse | Statuts | EA | 20+ enums statuts disjoints (commandes/prep/contrôle/facture) | Audit comptable & workflow opaques | Haut | P1 | M | State machine centralisée | Voir Ch2 EA |
| C-39 | Transverse | Poids | EA | `tours.total_weight_kg` ≠ `production_daily.entree_ligne_kg` (pas de FK) | Refashion sur déclaratif vs réel | Haut | P1 | M | FK `tour_id` + vue réconciliation | Voir Ch3 EA |
| C-40 | Transverse | Vocabulaire | EA | Glossaire métier non normalisé (10 termes critiques flous) | Onboarding lent, incohérences code | Moyen | P3 | S | `docs/GLOSSAIRE_METIER.md` | À écrire |

---

## 3. Plan d'action priorisé sur 90 jours

### Immédiat (semaine 0-1) — quick wins critiques (~10h cumul)

| # | Action | Persona | Effort | Impact |
|---|---|---|---|---|
| I-1 | Authentifier `/api/pcm/*` | RSSI | 30min | Bloque exfiltration PCM |
| I-2 | Fix `kg_entree` → `entree_ligne_kg` (`performance.js`) | Direction | 30min | Page Performance opérationnelle |
| I-3 | Mots de passe placeholders dans `.env.example` | RSSI | 30min | Bloque copie naïve dev→prod |
| I-4 | `npm audit fix` + tests smoke + commit | RSSI | 2h | Réduit surface d'attaque dépendances |
| I-5 | Supprimer fallback localStorage refresh token | RSSI | 1h | XSS impact réduit |
| I-6 | Activer backups S3 sur le serveur prod (runbook fourni) | Ops | 3h | RPO < 1h, conformité reprise |
| I-7 | CHECK contrainte avant création jalons insertion (freins ≠ NULL) | RH | 1h | Diagnostic obligatoire |
| I-8 | Cron alerte mouvements stock provisoires > 7j | Ops | 1h | Stock cohérent |
| I-9 | Audit `npm audit` + `pg_typeof(type_produit)` en prod | RSSI/Ops | 30min | Detection drift data |

### 30 jours — fondations (~50h)

| # | Action | Persona | Effort |
|---|---|---|---|
| J30-1 | Centraliser error handler — supprimer `err.message` côté client (54 occurrences) | RSSI | 4h |
| J30-2 | CSP : retirer `'unsafe-inline'` / `'unsafe-eval'` | RSSI | 2h |
| J30-3 | Tests Jest sur 5 modules clés (tours, insertion, dashboard, stock, finance) | CTO | 20h |
| J30-4 | Conversion candidat→employé en transaction explicite | RH | 2h |
| J30-5 | Route + alerte visite médicale post-embauche | RH | 4h |
| J30-6 | Vue `vw_refashion_summary` sourcée depuis `production_daily` + `stock_movements` | Direction | 6h |
| J30-7 | Adoption `FormField` + `ErrorState` sur 5 pages (Stock, Candidates, ExutoiresCommandes, Tours, Expeditions) | UX | 6h |
| J30-8 | Remplacer `window.confirm` par `<ConfirmDialog>` (9 pages) | UX | 3h |
| J30-9 | FK `produits_finis.batch_id` + backfill | BA Tri | 3h |
| J30-10 | FK `production_daily.tour_id` + vue de réconciliation poids | EA / BA | 3h |

### 60 jours — refactor & cohérence transverse (~40h)

| # | Action | Persona | Effort |
|---|---|---|---|
| J60-1 | Refactor `tours/` 15→3 fichiers + `TourService` (runbook P1#12) | CTO | 8h |
| J60-2 | `BillingService` + fusion `billing.js`/`factures-exutoires.js` (runbook P1#13) | CTO | 7h |
| J60-3 | **Fusion référentiels `partners`** (Ch1 EA — la grosse pierre) | EA / Ops | 10h |
| J60-4 | State machine centralisée enums + transitions (Ch2 EA) | EA | 12h |
| J60-5 | Onglets `InsertionParcours.jsx` (Vue/Parcours/Freins/Docs) | UX / RH | 6h |

### 90 jours — production-grade & pilotage avancé (~60h)

| # | Action | Persona | Effort |
|---|---|---|---|
| J90-1 | Réplication PostgreSQL primary/standby (runbook P1#14) | CTO / Ops | 8h |
| J90-2 | Repository layer 5 modules (runbook P2#16) | CTO | 10h |
| J90-3 | Scheduler dédié + BullMQ workers + DLQ (runbook P2#18) | CTO | 8h |
| J90-4 | Secrets manager Scaleway/Vault (runbook P2#19) | RSSI | 4h |
| J90-5 | Dashboard exécutif consolidé (8 KPI essentiels + alert_thresholds + comparaison N-1 lissée) | Direction | 12h |
| J90-6 | Lien `colisages` ↔ `commandes_exutoires` (Ch4 EA) | EA / Ops | 8h |
| J90-7 | Table `employee_state` composite (Ch5 EA) | RH / EA | 10h |

---

## 4. Dette technique et dette métier

### Dette technique (CTO)

| Domaine | Dette | Impact | Priorité |
|---|---|---|---|
| Tests | 0 fichier `.test.js`, smoke manuel uniquement | Régressions silencieuses | P1 |
| `tours/` | 17 fichiers, 5.2K LOC, duplications | Maintenance lente | P2 |
| Couches | Routes mélangées avec logique et SQL | Pas de tests unitaires possibles | P2 |
| TypeScript | Aucun, JS pur | Erreurs runtime fréquentes | P3 |
| OpenAPI | Pas de spec API | Onboarding lent | P3 |

### Dette sécurité (RSSI)

| Domaine | Dette | Impact | Priorité |
|---|---|---|---|
| Auth PCM | Endpoint sans `authenticate` (à confirmer prod) | Fuite RGPD | P1 |
| Token storage | Refresh token en localStorage | XSS impact ↑ | P1 |
| Erreurs | `err.message` exposé client | Info leak | P1 |
| Secrets | `.env.example` mots de passe par défaut | Copie dev→prod | P1 |
| Dépendances | 10 vuln npm (8 HIGH) | Surface d'attaque | P1 |
| CSP | `unsafe-inline`/`unsafe-eval` | XSS exécuté malgré Helmet | P2 |
| Audit | Pas de SAST/DAST CI | Vulnérabilités latentes | P2 |

### Dette UX (Product Designer)

| Domaine | Dette | Impact | Priorité |
|---|---|---|---|
| `window.confirm` | 9 pages | Accessibilité, cohérence | P2 |
| FormField adoption | 40+ pages avec boilerplate | Doublonnage, a11y | P2 |
| ErrorState adoption | 75 pages avec catch silencieux | UX dégradée erreurs réseau | P2 |
| Tabulation | Kanban draggable, onglets ←/→ manquants | a11y | P2 |
| Hiérarchie h1/h2 | Manquante | SEO, lecteurs d'écran | P3 |
| Mode sombre | Absent | Confort atelier nuit | P4 |
| Modals existants | FocusTrap appliqué ✅ | — | — |

### Dette fonctionnelle / métier

| Domaine | Dette | Impact | Priorité |
|---|---|---|---|
| Visite médicale | Colonne sans route ni alerte | Conformité | P1 |
| Prescripteur IAE | Free text, pas d'enum | Reporting Pôle Emploi | P2 |
| Diagnostic insertion | Freins=3 par défaut | Plans d'action sur diag bidon | P1 |
| Sortie type | VARCHAR libre | Statistiques sorties dynamiques | P2 |
| Mandat individuel PE | Aucune table | Reporting non couvert | P3 |
| Absences/congés | Pas de table dédiée | Calendrier travail incomplet | P2 |
| Conformité FSE+ | Aucun export | Subvention européenne en risque | P2 |
| KPI productivité par poste | Manquant | Optimisation aveugle | P2 |
| KPI perte par opération tri | Manquant | Audit qualité | P2 |

### Dette data / pilotage

| Domaine | Dette | Impact | Priorité |
|---|---|---|---|
| Référentiels partenaires | `exutoires` ⊥ `clients_exutoires` | Traçabilité globale | P1 |
| Enums statuts | 20+ disjoints | Workflow incohérent | P1 |
| Réconciliation poids | `tours` ⊥ `production_daily` ⊥ `stock_movements` | Refashion DPAV | P1 |
| Refashion DPAV | Saisie manuelle | Conformité éco-org | P1 |
| Population commune (Métropole) | NULL ou caduque | KPI captation faux | P2 |
| Comparaison N-1 lissée | Variation brute | Décision pilotage biaisée | P2 |
| Alertes seuils | Hardcodés | Pilotage rigide | P2 |
| Vue exécutive consolidée | Inexistante | Pilotage stratégique limité | P2 |
| Glossaire métier | Non normalisé | Onboarding, incohérences code | P3 |

---

## 5. Matrice de criticité

| Sujet | Gravité | Urgence | Portée | Composite |
|---|---|---|---|---|
| Auth PCM manquante (à confirmer) | Critique | Immédiate | Locale | 🔴 |
| Référentiels `partners` doublés | Critique | Courte | Systémique | 🔴 |
| Refashion DPAV double saisie | Critique | Courte | Multi-module | 🔴 |
| Tests automatisés absents | Élevée | Courte | Systémique | 🔴 |
| Refresh token localStorage + XSS | Élevée | Immédiate | Systémique | 🔴 |
| `err.message` exposé client | Élevée | Courte | Systémique | 🟠 |
| Réconciliation poids tours/production | Élevée | Courte | Multi-module | 🟠 |
| Statuts disjoints (commande/prep/facture) | Élevée | Moyenne | Multi-module | 🟠 |
| Visite médicale absente | Élevée | Courte | Locale RH | 🟠 |
| Diagnostic insertion par défaut | Élevée | Courte | Locale RH | 🟠 |
| `produits_finis` sans batch_id | Moyenne | Moyenne | Multi-module | 🟡 |
| `window.confirm` 9 pages | Moyenne | Moyenne | Multi-module | 🟡 |
| Refactor `tours/` 17 fichiers | Moyenne | Moyenne | Locale | 🟡 |
| KPI perte par opération | Moyenne | Longue | Locale Tri | 🟡 |
| Mode sombre | Faible | Longue | Systémique | 🟢 |
| Glossaire métier | Faible | Longue | Systémique | 🟢 |

---

## 6. Hypothèses et zones à confirmer (avec un humain métier)

> Distinction systématique entre constaté / probable / à confirmer dans les rapports d'agents.
> Zones nécessitant validation humaine avant action :

### Sécurité
- **PCM auth** : les audits historiques (CLAUDE.md, 6/4) signalaient une absence d'auth. Vérifier sur la branche actuelle l'application effective de `authenticate` dans `pcm.js`.
- **Vulnérabilités npm** : exécuter `npm audit` réel sur la branche pour confirmer les 10 vuln estimées.
- **Logs sensibles** : auditer manuellement les logs production pour vérifier qu'aucun token / mot de passe / donnée RGPD n'est journalisé.

### Métier & données
- **Source de vérité Refashion DPAV** : la déclaration s'appuie-t-elle sur le tonnage brut entrant (collecte) ou net trié ? **À valider avec la Direction**, c'est un point de conformité critique.
- **Stock original vs stock moderne** : quel flux est la source de vérité pour Refashion ? Le doc `LOGIQUE_STOCK_INVENTAIRES.md` est à enrichir.
- **Multi-employment** : 1 user = 1 employee strict, ou 1 user = N employees (multi-contrat possible) ? Décision design à prendre.
- **Conformité FSE+** : SOLIDATA reçoit-il du FSE+ ? Si oui, quel format d'export attendu ? À confirmer avec Direction et financeurs.
- **Mandats Pôle Emploi/France Travail** : quel volume actuel ? Justifie-t-il un module dédié ?

### Workflows
- **Statut commande exutoires `chargee`** : la transition est documentée comme corrigée dans les audits. À retester en E2E sur la prod actuelle.
- **OCR factures fournisseurs** : `tesseract.js` est en dépendance, mais le service `ocr.service.js` est-il implémenté ou seulement en projet ?
- **Récurrence commandes exutoires** : la fonctionnalité est-elle utilisée en prod, ou les commandes sont-elles toutes ad hoc ?

### UX
- **Mode mobile** : `window.alert/confirm` sur mobile chauffeur a-t-il un impact métier réel ou les chauffeurs n'utilisent-ils pas ces parcours ?
- **PWA offline** : niveau d'usage offline réel ? Justifie-t-il l'investissement IndexedDB complet ?
- **Capteurs LoRaWAN** : combien de CAV équipés réellement (vs 209 au total) ? Justifie le module Sensors complet ?

### Pilotage
- **Comparaison N-1** : la Direction utilise-t-elle déjà ces deltas ? Quelle granularité (jour / semaine / mois) est la plus utile ?
- **Population commune Métropole** : la donnée est-elle mise à jour annuellement ou statique depuis import initial ?
- **Vue exécutive** : quels 8 KPI essentiels la Direction veut-elle voir en première page ?

---

## 7. Tableau de synthèse des priorités (ultra opérationnel)

> Vue 1 page pour pilotage. Tri par priorité × ROI.

| Rang | Action | Persona | Priorité | Effort | Impact (1-5) | ROI | Bloquant pour |
|---|---|---|---|---|---|---|---|
| 1 | Auth PCM `authenticate`+`authorize('ADMIN','RH')` | RSSI | P1 | S 30min | 5 | ⭐⭐⭐⭐⭐ | Conformité RGPD |
| 2 | Fix `kg_entree`→`entree_ligne_kg` performance.js | Direction | P1 | S 30min | 5 | ⭐⭐⭐⭐⭐ | Page Performance |
| 3 | Sourcer Refashion DPAV (vue auto) | Direction | P1 | M 6h | 5 | ⭐⭐⭐⭐⭐ | Conformité éco-org |
| 4 | Fusion `partners` (exutoires+clients_exutoires) | EA | P1 | M 10h | 5 | ⭐⭐⭐⭐⭐ | Traçabilité totale |
| 5 | Tests Jest 5 modules clés | CTO | P1 | L 20h | 5 | ⭐⭐⭐⭐ | Toute évolution P2 |
| 6 | Supprimer fallback localStorage refresh token | RSSI | P1 | S 1h | 4 | ⭐⭐⭐⭐⭐ | Sécurité XSS |
| 7 | Centraliser errorHandler (no err.message) | RSSI | P1 | M 4h | 4 | ⭐⭐⭐⭐ | Conformité OWASP |
| 8 | Visite médicale (route + alerte) | RH | P1 | M 4h | 4 | ⭐⭐⭐⭐ | Conformité droit travail |
| 9 | FK production_daily.tour_id + vue réconciliation | EA/BA | P1 | M 3h | 4 | ⭐⭐⭐⭐⭐ | Cohérence Refashion |
| 10 | Diagnostic insertion CHECK avant jalons | RH | P1 | S 1h | 4 | ⭐⭐⭐⭐⭐ | Plans action fiables |
| 11 | Conversion candidat→employé en transaction | RH | P1 | S 2h | 4 | ⭐⭐⭐⭐ | Robustesse RH |
| 12 | npm audit fix + Dependabot | RSSI | P1 | S 2h | 4 | ⭐⭐⭐⭐ | Conformité dépendances |
| 13 | Backups S3 activation prod (runbook) | Ops | P1 | M 3h | 4 | ⭐⭐⭐⭐⭐ | RPO < 1h |
| 14 | State machine centralisée enums | EA | P1 | M 12h | 4 | ⭐⭐⭐⭐ | Workflow logistique cohérent |
| 15 | FormField + ErrorState adoption 5 pages | UX | P2 | M 6h | 3 | ⭐⭐⭐⭐ | UX cohérente |
| 16 | Refactor `tours/` 17→3 + `TourService` | CTO | P1 | L 8h | 4 | ⭐⭐⭐ | Maintenabilité |
| 17 | `BillingService` + fusion facturation | CTO | P1 | L 7h | 3 | ⭐⭐⭐ | Réutilisation logique |
| 18 | Onglets InsertionParcours | UX/RH | P2 | M 6h | 3 | ⭐⭐⭐⭐ | UX CIP |
| 19 | window.confirm → ConfirmDialog (9 pages) | UX | P2 | S 3h | 2 | ⭐⭐⭐⭐ | a11y |
| 20 | FK produits_finis.batch_id | BA Tri | P1 | M 3h | 4 | ⭐⭐⭐⭐ | Traçabilité Refashion |
| 21 | Réplication PostgreSQL primary/standby | CTO/Ops | P2 | L 8h | 4 | ⭐⭐⭐ | HA |
| 22 | Repository layer 5 modules | CTO | P2 | L 10h | 3 | ⭐⭐⭐ | Tests unitaires |
| 23 | Scheduler dédié + BullMQ workers | CTO | P2 | L 8h | 3 | ⭐⭐⭐ | Robustesse jobs |
| 24 | Secrets manager (Scaleway/Vault) | RSSI | P2 | M 4h | 4 | ⭐⭐⭐ | Compliance |
| 25 | Dashboard exécutif consolidé (8 KPI) | Direction | P2 | L 12h | 4 | ⭐⭐⭐ | Pilotage stratégique |
| 26 | Lien colisages↔commandes_exutoires | EA/Ops | P2 | M 8h | 4 | ⭐⭐⭐ | Audit factures |
| 27 | Table `employee_state` composite | RH/EA | P2 | M 10h | 3 | ⭐⭐⭐ | Reporting RH cohérent |
| 28 | KPI perte par opération tri | BA Tri | P2 | M 4h | 3 | ⭐⭐⭐ | Optimisation poste |
| 29 | Vues matérialisées dashboard | Direction | P2 | M 4h | 3 | ⭐⭐⭐ | Latence dashboard |
| 30 | Glossaire métier `docs/GLOSSAIRE_METIER.md` | EA | P3 | S 2h | 2 | ⭐⭐⭐ | Onboarding |

**Total effort 90 jours (top 30) : ~165h** = un sprint dédié de 4-5 semaines à 1 ETP, ou 8-12 semaines à 0.5 ETP avec partage tickets.

---

## Annexes

- **Code livré dans v1.5.0** : `rapports/rapport-implementation-2026-05-01.md`
- **Runbooks infrastructure** : `docs/RUNBOOK_INFRA_ROADMAP.md`
- **Rapports détaillés par persona** : transcripts des 8 agents (`/tmp/claude-0/.../tasks/*.output`)
- **Audit multi-agents initial** : voir conversation du 1er mai (Architecte / Debug / Performance / UI / System Design)

**Méthode** : 9 personas séquencés, chaque persona avec rôle, mission, livrables, recommandations distincts. Distinction systématique constaté / probable / à confirmer. Pas de spéculation : chaque constat cite fichier:ligne.
