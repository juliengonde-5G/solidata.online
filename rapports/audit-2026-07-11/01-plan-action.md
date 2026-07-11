# AUDIT COMPLET SOLIDATA — Plan d'action priorisé

**Date** : 11 juillet 2026 · Compagnon de la [synthèse exécutive](00-synthese-executive.md).
**Convention d'effort** : **S** < 1 jour · **M** = 1 à 3 jours · **L** = chantier (> 3 jours ou nécessitant un cadrage).
**Priorités** : **P0** = fausse ou bloque le métier / risque externe · **P1** = important · **P2** = confort.

Principes directeurs issus de l'audit :
1. **Réparer avant d'ajouter** — la valeur la plus rentable est dans le recâblage de l'existant (backend déjà écrit), pas dans de nouvelles fonctionnalités.
2. **Chaque vague se termine par une preuve** — un test (contrat, smoke, requête de réconciliation) qui empêche la régression silencieuse de revenir.
3. **Aucun chiffre affiché ne doit être structurellement faux** — un KPI non fiable se masque avec un bandeau explicite plutôt que de rester affiché.

---

## 0. Cinq arbitrages métier à trancher AVANT de coder

Ces décisions conditionnent plusieurs chantiers ; elles relèvent de la direction, pas du développement.

| # | Arbitrage | Options | Impacte |
|---|---|---|---|
| A1 | **Conditionnement / colisage** : la traçabilité carton→balle→exutoire passe-t-elle par l'adoption du workflow `colisages` en atelier (UI à construire, discipline de scan) **ou** par le repointage des vues DPAV/cohérence sur `produits_finis` (plus simple, traçabilité moins fine) ? | Adopter UI colisage (L) / Repointer les vues (M) | T1, audit Refashion, vague 1-A et 2 |
| A2 | **Facturation interne (`billing.js`/`invoices`)** : la brique est propre mais déconnectée du flux réel (le contrôle passe par Pennylane). La relier ou la retirer ? | Relier (L) / Retirer (S) | Vague 3, lisibilité du module Finance |
| A3 | **Chatbot** : `ai-agent/` (Flask) est mort en production, doublonné par `chat.js` intégré. Décommissionner le conteneur Python ? | Décommissionner (S) / Maintenir (coût récurrent) | Vague 3, surface d'attaque, coûts |
| A4 | **Périmètre QHSE** : accidents du travail/presqu'accidents, EPI, habilitations à échéance, DUERP — module SOLIDATA à construire ou outil externe ? | Module dédié (L) / Externe + interfaces (M) | Vague 2, persona QHSE (4,5/10) |
| A5 | **Accès auditeurs externes** : ouvrir un espace AUTORITE en lecture seule (Refashion + Métropole) ou continuer à servir les audits par exports préparés en interne ? | Portail lecture seule (M-L) / Exports formalisés (M) | T7, personas auditeurs (2/10 et 5,5/10) |

---

## Vague 0 — Stopper les chiffres faux et fermer les trous de sécurité
*Horizon : 1 à 2 semaines. Essentiellement des correctifs S, sans dépendance entre eux, déployables au fil de l'eau.*

### 0.A Sécurité immédiate
| # | Action | Réf. code | Effort |
|---|---|---|:---:|
| 1 | Randomiser le mot de passe admin initial + forcer le changement au premier login (`must_change_password`) | `init-db.js`, `auth.js` | S |
| 2 | Garde-fou anti-auto-lockout : interdire la désactivation/rétrogradation du **dernier ADMIN actif** sur `PUT /users/:id` (déjà présent sur DELETE) | `routes/users.js` | S |
| 3 | Ajouter `authorize` sur les GET de `teams.js` + **projeter** les colonnes (exclure salaire, RQTH, titre de séjour) | `routes/teams.js` | S |
| 4 | Re-vérifier `is_active` au refresh token et purger les `refresh_tokens` à la désactivation d'un compte | `routes/auth.js` | S |
| 5 | Corriger le `require('./tours/predictions')` inexistant (500 systématique sur `/predictive/ia/ajustements`) | `services/predictive-ai.js:258` | S |

### 0.B Données faussées — corriger à la source
| # | Action | Réf. code | Effort |
|---|---|---|:---:|
| 6 | Aligner l'enum des **types d'heures** (congé/maladie/heures sup/formation) entre front et back, **rejeter** les valeurs inconnues au lieu de rabattre sur `normal` | `WorkHours.jsx`, `routes/employees.js` (POST /:id/hours) | S |
| 7 | Réintroduire la saisie réelle des entrées **R3/R4** (aujourd'hui envoyées en dur à 0) | `Production.jsx` (saveFeuille) | S |
| 8 | **HT/TTC boutiques** : comparer l'objectif et le réalisé sur la même base, corriger les libellés « CA HT » erronés | `boutiques.js:182`, `boutique-objectifs.js`, `BoutiquesDashboard.jsx` | S |
| 9 | Rendre la **clôture de tournée idempotente** (garde sur le statut courant + bouton désactivé pendant l'appel) — le double-clic duplique stock/tonnage/feedback | `routes/tours/execution.js`, `Tours.jsx` | S |
| 10 | Corriger le mix **moyens de paiement VAK** (le libellé normalisé `CB` tombe en « Autre ») | `VakPerformance.jsx:68`, `VakJournee.jsx` | S |
| 11 | Ne plus injecter/exposer `estimated_fill_rate` (toujours 0) dans le feedback capteur et l'**API publique partenaires** | `liveobjects-processor.js`, `public-api.js` | S |
| 12 | Masquer le KPI « Subvention Refashion » du dashboard d'accueil tant que la table n'est pas alimentée (bandeau explicite) | `routes/dashboard.js`, `Dashboard.jsx` | S |
| 13 | Réparer `/metropole/sortie-dynamique` (colonnes `im.type/statut/date_realisation` inexistantes, 500 avalé) et unifier la définition de « sortie dynamique » avec le module insertion | `routes/metropole.js` | S |
| 14 | Clôturer réellement le **parcours d'insertion à la sortie** (`insertion_status='termine'` + `insertion_end_date` au bilan de sortie) — supprime le double comptage des cohortes | `routes/insertion/routes.js` | S |

### 0.C Écrans cassés en silence — réparer ou débrancher
| # | Action | Réf. code | Effort |
|---|---|---|:---:|
| 15 | **FinanceOperations** : aligner le contrat (réponse `/auto` à plat vs `.auto/.overrides` attendus ; payload `{overrides}` vs `{data}`) — l'écran est vide et la sauvegarde échoue toujours | `finance.js:944-996`, `FinanceOperations.jsx:65-99` | M |
| 16 | **FinanceTresorerie** : renseigner `type/class` dans `cash_flow` (sections Revenus/Dépenses toujours vides) | `finance.js:804-816` | S |
| 17 | Boutons morts : Actualiser/Exporter de **FinanceControles** (routes inexistantes) et « Synchroniser factures » de **Pennylane.jsx** (route supprimée le 03/05) — réparer ou retirer, et afficher les erreurs | `FinanceControles.jsx`, `Pennylane.jsx:79` | S |
| 18 | KPI kanban **commandes exutoires** : aligner `total_tonnage_prevu/total_ca_prevu` ↔ `tonnage_prevu/ca_previsionnel` | `commandes-exutoires.js` (stats), `ExutoiresCommandes.jsx` | S |
| 19 | Export CSV Refashion : utiliser l'instance axios authentifiée (`accessToken`) au lieu de `localStorage.getItem('token')` — aujourd'hui un fichier d'erreur est téléchargé sans alerte | `AdminRefashionExports.jsx` | S |
| 20 | Corriger l'export PDF de `Billing.jsx` (ou retirer la page en attendant l'arbitrage A2) | `Billing.jsx` | S |
| 21 | `confirm()` non attendu avant suppression de batch d'import (la suppression part toujours) | `BoutiquesImport.jsx:97` | S |
| 22 | **Smoke test de déploiement** : corriger les 4 routes inexistantes testées (`grand-livre`→`ledger`, chemins reporting/production/metropole) et vérifier `API_USER`/`API_PASSWORD` en prod — c'est la porte de déploiement | `scripts/tests/api-smoke.js` | S |

### 0.D Accès élémentaires
| # | Action | Réf. code | Effort |
|---|---|---|:---:|
| 23 | Ouvrir l'**import de paie Malibou au rôle RH** (front + les 3 routes `authorize('ADMIN')`) — geste mensuel fondateur du processus RH | `App.jsx:228`, `Layout.jsx:276`, `employees.js:776-848` | S |
| 24 | Référencer **/dashboard-executif** et **/admin-alert-thresholds** dans la navigation (pages orphelines fonctionnelles) + `authorize()` sur `dashboard.js` (notamment `/executive`) | `Layout.jsx`, `routes/dashboard.js` | S |
| 25 | Ouvrir la gestion CAV/capteurs au rôle MANAGER (aujourd'hui ADMIN seul pour un geste quotidien logistique) | `routes/cav.js`, `Layout.jsx` | S |

**Preuve de fin de vague 0** : smoke test vert en production avec credentials ; captures avant/après des 8 écrans réparés ; grille de tests de contrat amorcée sur les routes corrigées.

---

## Vague 1 — Réparer les chaînes de bout en bout
*Horizon : 3 à 6 semaines. Dépend des arbitrages A1 (colisage) et A2 (billing).*

### 1.A Chaîne matière → Refashion (T1) — le chantier prioritaire
| # | Action | Effort |
|---|---|:---:|
| 26 | Exécuter l'arbitrage **A1** : soit UI colisage en atelier (création, ajout cartons, scellement — backend `tri.js` déjà transactionnel), soit repointage des vues `vw_dpav_sortants` / `vw_coherence_tri_filiere` sur `produits_finis` | L / M |
| 27 | Brancher **`/refashion/dpav-source`** dans `Refashion.jsx` : pré-remplissage automatique de la DPAV + affichage de l'écart déclaré/calculé | M |
| 28 | Construire la **saisie/validation DPAV, communes et subventions** (les POST existent, aucune UI) — avec workflow de soumission tracé | M |
| 29 | Poser une **écriture de régularisation automatique à la validation d'inventaire** (sinon le stock théorique diverge indéfiniment) | M |
| 30 | Permettre la **correction auditée des mouvements** du stock moderne (symétrie avec stock-original) | M |
| 31 | Faire décrémenter le stock par la **sortie carton** ; réconcilier la **triple pesée** d'expédition (préparation/chargement/client) avec alerte d'écart | M |
| 32 | Harmoniser les **3 voies de création de `produits_finis`** (étiquette, formulaire manuel, balance publique) : mêmes champs, auteur systématique, authentification de la balance (token de poste) | M |
| 33 | **Captation par commune** : corriger la jointure `tour_weights × tour_cav` (répartition du tonnage au prorata plutôt que produit cartésien) et exposer le rattachement CAV↔commune dans AdminCAV (`PATCH /communes/cav/:id` existe) | M |

### 1.B Chaîne financière (T3/T4)
| # | Action | Effort |
|---|---|:---:|
| 34 | Fiabiliser **autoMatchCommande** : matcher sur la référence complète (`CMD-YYYY-NNNN`), refus si ambigu, plus de `LIKE '%CMD-2026%' LIMIT 1` sans ORDER BY | S |
| 35 | Réparer la **rentabilité matière** sur une vraie source de CA (ou état « données indisponibles » explicite) — les colonnes lues n'existent pas dans `expeditions` | M |
| 36 | Intégrer **CA boutiques + VAK + subventions Refashion** dans la consolidation finance (aujourd'hui hors P&L) | M |
| 37 | Planifier automatiquement la **sync des factures clients** Pennylane (aujourd'hui manuelle) | S |
| 38 | Tarifs exutoires : migrer CHECK SQL + validateur + UI vers la **nomenclature actuelle des gammes** (essuyage/tricot/mérinos impossibles à tarifer) ; bloquer le raccourci `chargee→expediee` qui saute la préparation et le mouvement de stock | M |

### 1.C Chaîne personne : RH ↔ insertion (T4/T5)
| # | Action | Effort |
|---|---|:---:|
| 39 | **Prescripteurs** : construire l'UI (référentiel + affectation sur le salarié) et brancher l'**export FSE+** dans l'interface CIP — la colonne est structurellement vide aujourd'hui | M |
| 40 | Rendre **permis B / CACES éditables** sur la fiche employé (recopie depuis le candidat lié) — condition du planning chauffeur ; refondre `Skills.jsx` sur les employés (aujourd'hui mauvais identifiant candidat) | M |
| 41 | Suivi de la **durée cumulée CDDI** (plafond légal 24 mois) + alertes de fin de contrat côté RH ; recalcul des jalons d'insertion au renouvellement de contrat | M |
| 42 | **Anonymisation RGPD complète** : données santé/RQTH, diagnostics et jalons d'insertion, et aligner la purge automatique candidats (scheduler) sur la route manuelle (entretiens, mises en situation, PCM) | M |
| 43 | Dissocier « dernière visite médicale » et « visite post-embauche » à l'import ; recalculer `visite_medicale_due_date` à la création | S |

### 1.D Incidents & terrain (personas logistique/QHSE/chauffeur)
| # | Action | Effort |
|---|---|:---:|
| 44 | **Cycle de vie des incidents** : routes de mise à jour (statut open→in_progress→resolved→closed, `resolved_by/at` — le schéma existe déjà), vue transverse filtrable, clôture depuis le web | M |
| 45 | **Checklist véhicule** : persister le champ `notes` (perdu à la réception) et créer la consultation web des checklists | S |
| 46 | Mobile : bouton « **CAV inaccessible / sauter** » distinct de la saisie de niveau ; **photo d'incident** (le backend l'accepte déjà, le mobile n'envoie que du JSON) | M |
| 47 | Empêcher la **double affectation d'un véhicule** à la création de tournée + faire respecter le filtre de disponibilité côté API | S |

### 1.E Moteurs IA : rendre le prédictif honnête (T6)
| # | Action | Effort |
|---|---|:---:|
| 48 | **Normaliser `predictFillRate` par la capacité** (kg vs %) et backtester sur l'historique de feedback | M |
| 49 | **Persister la configuration prédictive en base** (aujourd'hui en mémoire, perdue à chaque déploiement) et brancher `predictive_seasonal_factors` (recalculée chaque mois, jamais lue) | M |
| 50 | **Unifier les 3 jeux de facteurs saisonniers** codés en dur (`cav.js /map`, `/fill-rate`, `/:id/activity`) dans une source unique partagée avec le moteur | M |
| 51 | Réparer la **boucle d'apprentissage capteur** (décalage de colonne identifié dans le flux temps réel) et supprimer les catch muets de la chaîne | S |

**Preuve de fin de vague 1** : requête de réconciliation kg entrants vs sortants vs déclarés sur un mois réel ; DPAV pré-remplie avec écart affiché ; un incident créé sur le terrain clôturé depuis le web ; backtest du prédictif documenté.

---

## Vague 2 — Ouvrir l'application à ses parties prenantes
*Horizon : 6 à 10 semaines. Dépend des arbitrages A4 (QHSE) et A5 (auditeurs).*

| # | Action | Persona servi | Effort |
|---|---|---|:---:|
| 52 | **Espace auditeur Refashion** (selon A5) : accès lecture seule AUTORITE au module Refashion (DPAV, subventions, exports, audit-trail), attestation liant DPAV et verrouillage trimestriel, pièce justificative sur les taux | Auditeur Refashion (2/10) | M-L |
| 53 | **Espace Métropole** : ReportingMetropole + FillRateMap + ETP conventionnés accessibles à AUTORITE, exports PDF/Excel de revue de convention, suivi du délai d'intervention sur incident CAV | Auditeur Métropole | M |
| 54 | **Rôles dédiés** : DPO (écrans RGPD sans pleins droits ADMIN), Finance consultation (direction/CA), QHSE — en s'appuyant sur le mécanisme de rôles personnalisés existant | Financier, QHSE, DPO | M |
| 55 | **Cloisonner RESP_BTQ par boutique** (middleware + UI) ; raccorder `BoutiquesPlanning.jsx` (jamais routée) ; vue consolidée multi-boutiques avec vraie comparaison N-1 | Resp. boutique, direction | M |
| 56 | **UI d'exécution du tri** (selon A1) : enregistrer crackage/tri fin par lot depuis l'atelier — le backend transactionnel existe (`POST /tri/executions`) | Manager de tri (5,5/10) | M-L |
| 57 | **Administration du référentiel tri** : chaînes, opérations, postes, catégories sortantes (aujourd'hui modifiables uniquement en SQL) | Manager de tri | M |
| 58 | **Module QHSE minimal** (selon A4) : registre accidents/presqu'accidents avec gravité et jours d'arrêt (taux de fréquence/gravité), habilitations à date d'expiration (CACES…), dotation EPI | Resp. QHSE (4,5/10) | L |
| 59 | **Exports finance** (PDF/Excel du P&L, bilan, trésorerie) + interface de saisie du budget annuel (aujourd'hui script développeur) ; contrôle croisé aides au poste ↔ ETP CDDI validés | Manager financier | M |
| 60 | **Boîte du directeur** : vue « KPIs de la veille » par défaut, alertes consolidées (véhicules + jalons + stock), seuils de stock ; étendre SolidataBot à la finance, l'insertion et les ventes | Directeur des opérations | M |
| 61 | **Confort CIP** : agenda personnel des entretiens, notion de CIP référent, comparaison sorties dynamiques vs objectif conventionné, plan d'action dans l'export PDF | CIP | M |
| 62 | Canal **manager → chauffeur** (notification push mobile ciblée, deep-link tournée) ; historique mobile des incidents/pesées synchronisés | Chauffeur, resp. logistique | M |
| 63 | VAK : gérer les **remboursements** sur la voie API/webhook (déjà gérés en CSV) ; passerelle Finance + taux d'écoulement | Direction | M |

**Preuve de fin de vague 2** : re-jeu des 10 parcours personas — objectif ≥ 7/10 partout, aucun verdict « rompu ».

---

## Vague 3 — Consolider le socle (fond continu)
*À mener en tâche de fond dès la vague 1, par lots.*

### 3.A Tests & anti-régression (la racine de T3)
- **Tests de contrat front/back** sur les écrans réparés (vague 0) puis sur chaque module — c'est LE correctif systémique de l'audit.
- Étendre le smoke test aux routes critiques réellement utilisées par les écrans ; mode strict en CI.
- Tests unitaires des moteurs : `insertion/engine.js` (échéancier, scoring), prédictif (normalisation, backtest), smart-tour/ré-optimisation, `sumup.js` (déjà amorcé).
- Bannir les `catch` muets : bandeau d'erreur utilisateur systématique (les 6 pages exutoires, finance, exports).

### 3.B Intégrité transactionnelle
- Encapsuler dans des transactions les écritures multi-tables identifiées : tri (DELETE-puis-réinsertion), tournées, planning-hebdo `/affecter`, recrutement/PCM (doublons), imports CSV boutiques et VAK (hash posé trop tôt), stock original (audit + écriture).
- Contraintes d'unicité manquantes (ex. `UNIQUE(session_id, question_number)` sur PCM ; clé ticket boutique avec date).

### 3.C Sécurité & RGPD (suite de T5)
- Révocation de session effective (jti/Redis ou `user_sessions` consulté par `authenticate`) ; journaliser `login_failed` + verrouillage de compte ; politique de mot de passe relevée.
- Journaliser les changements de permissions et de clés API dans le journal d'activité.
- **Pseudonymiser les données envoyées à l'API Anthropic** (insertion, chatbot) et fermer la garde RGPD contournable via rôles personnalisés ; documenter la sous-traitance IA au registre RGPD.
- Indexer `refresh_tokens` + purge planifiée ; passer backup/restore en asynchrone avec confirmation forte sur restore.

### 3.D Hygiène & observabilité
- **Supervision des chaînes silencieuses** : moniteur des jobs scheduler (fenêtres minute jamais exécutées, jobs sans timeout qui gardent le verrou), alerte si une chaîne capteur/GPS/webhook ne produit plus rien depuis N heures.
- Unifier le schéma : double définition `insertion_diagnostics`, schéma DB fragmenté sur 4 emplacements, migrations NOT NULL fragiles.
- Purger le code mort : `cv-processor.js`, `ml.js` (ou lui donner une UI), `historique.js`, `Reporting.jsx` orpheline, state machines déclarées non branchées (ou les brancher), modèle Claude déprécié résiduel (3 fichiers), `ai-agent/` selon A3.
- Performance : réécrire `fill-rate/map` en agrégats groupés + cache court ; N+1 de `generateIntelligentTour`.

---

## Récapitulatif des charges

| Vague | Contenu | Volume indicatif |
|---|---|---|
| **0** | 25 correctifs (22 S + 3 M) | ~2 à 3 semaines·homme |
| **1** | 26 chantiers de recâblage (S/M, 1 L selon A1) | ~5 à 7 semaines·homme |
| **2** | 12 ouvertures parties prenantes (M, 2 L selon A4/A5) | ~6 à 8 semaines·homme |
| **3** | 4 axes de fond, par lots | continu, ~20 % de la capacité |

*Volumes à affiner après les arbitrages A1-A5 ; les vagues 0 et 1 sont largement parallélisables.*

## Indicateurs de réussite du plan

1. **Zéro écran structurellement vide ou faux** (liste de la vague 0 rejouée en recette).
2. **Réconciliation matière** : kg entrants vs sortants vs déclarés rapprochés automatiquement sur un trimestre, vues DPAV non vides.
3. **Smoke test + tests de contrat verts** requis au déploiement (mode strict).
4. **Re-test personas** : aucun verdict « rompu », moyenne ≥ 7/10 (aujourd'hui 5,5).
5. **KPI RH/boutiques/Métropole certifiés** : absentéisme, formation, % d'atteinte, kg/hab/an validés sur un mois de données réelles.
6. **Dossier auditeur Refashion** : parcours de contrôle réalisable en autonomie (selon A5), audit-trail DPAV complet.
