# Audit fonctionnel — Module Finance, Facturation & synchronisation Pennylane

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{billing.js, finance.js, pennylane.js, factures-exutoires.js}`, `backend/src/services/BillingService.js`, `backend/src/repositories/InvoiceRepository.js`, pages `Finance*`, `Pennylane*`, `Billing`, `ExutoiresControleFacturation`
**Utilisateurs cibles** : Manager financier, direction, conseil d'administration

---

## 1. Couverture fonctionnelle réelle

Le module couvre un périmètre large pour une structure de cette taille :

- **Import/synchronisation comptable** (`pennylane.js`, 1281 lignes) : connexion API Pennylane v2 chiffrée AES-256-CBC, avec gestion propre du rate-limit (retry exponentiel + respect du `Retry-After`), pagination par curseur, et trois flux **PULL** — Grand Livre analytique (`/sync/gl`), transactions bancaires (`/sync/transactions`), factures clients pour contrôle (`/sync/customer-invoices`). Un flux d'enrichissement asynchrone (`enrichGLCategories`) va chercher, ligne par ligne, les axes analytiques Pennylane. Un import Excel alternatif existe côté `finance.js` (GL, transactions, budget) pour les cas où l'API n'est pas utilisée.
- **Pilotage financier** (`finance.js`, 1569 lignes) : compte de résultat par centre analytique avec budget vs réalisé (`/gl/:year/pl`), bilan simplifié + Soldes Intermédiaires de Gestion + ratios + seuil de rentabilité (`/gl/:year/bilan`), trésorerie (position, cascade mensuelle, flux par catégorie), KPIs dirigeant avec alertes automatiques (résultat négatif, trésorerie négative, BFR élevé, dérive budgétaire), **rentabilité matière** (coût complet collecte → tri → qualité, avec répartition des frais généraux à la clé volumique), et 9 **contrôles qualité des données** (équilibre comptable, comptes non affectés, montants nuls, affectation analytique...).
- **Contrôle facturation exutoires** (`factures-exutoires.js`) : rapprochement des factures clients importées de Pennylane avec les `commandes_exutoires`, matching automatique + manuel avec score de proximité, calcul d'écart quantité/montant vs pesée client, tolérance paramétrable, validation d'écart, déliaison réservée ADMIN.
- **Facturation interne** (`billing.js` + `BillingService.js` + `InvoiceRepository.js`) : un module CRUD factures HT/TVA/TTC avec numérotation automatique et state machine de statut (`draft→sent→paid/overdue/cancelled`), architecturé proprement (pattern Repository, service métier isolé, transactions).

Le tout est cohérent avec l'historique documenté dans `CLAUDE.md` (bascule PULL-only du 03/05/2026, scission vue compta / config technique du même jour).

## 2. Adéquation aux utilisateurs et parties prenantes

L'accès est restreint à `ADMIN`/`MANAGER` sur les quatre routeurs (`finance.js` l.11, `billing.js` l.11, `factures-exutoires.js` l.6), avec un resserrement `ADMIN` seul sur la configuration Pennylane, les mappings et le délier de facture. C'est cohérent avec la sensibilité des données mais cela pose un vrai manque pour la partie prenante **conseil d'administration** explicitement visée par ce module : il n'existe aucun rôle de consultation seule. Les rôles personnalisés (fonctionnalité v2.4.1) ne permettent que de masquer des sections de menu, pas de retirer les droits d'écriture au niveau API — un administrateur voulant donner un accès de lecture à un membre du CA doit donc lui attribuer `MANAGER` ou `ADMIN`, avec tous les pouvoirs d'écriture que cela implique (déclenchement d'imports qui **suppriment et réinjectent** un exercice comptable entier, validation d'écarts, etc.).

Pour le pilotage de SIAE, l'« aide au poste » (ressource centrale d'un chantier d'insertion) est bien prise en charge, mais uniquement via le mécanisme générique d'axes analytiques Pennylane / catégories de budget (confirmé par `backend/src/scripts/seed-budget-2026.js` l.19, catégorie « Aide au poste » ~49 357 €/mois). C'est flexible mais il n'existe **aucun rapprochement croisé** avec le module Insertion (nombre d'ETP en parcours réellement actif vs montant d'aide au poste perçu) — un contrôle différenciant qu'un outil dédié SIAE proposerait nativement.

## 3. Benchmark marché

Le choix **PULL-only** vis-à-vis de Pennylane (aucune écriture poussée) est aligné avec l'usage courant du marché — l'API publique Pennylane est conçue pour ce sens d'intégration côté BI/contrôle de gestion (des outils tiers comme Kyklos suivent le même schéma). L'architecture (comparatif N/N-1, budget mensualisé par catégorie, coût complet par centre avec clé de répartition des frais généraux) est **plus sophistiquée** que ce qu'ont typiquement les structures de cette taille, souvent limitées à des tableurs.

Deux points de contexte à noter : (1) les logiciels dédiés IAE (SIL'ESA, Ming Insertion, la plateforme d'État « Emplois de l'inclusion ») embarquent nativement la télétransmission ASP et des tableaux de bord DREETS — Solidata délègue à raison ces démarches à la plateforme officielle, mais laisse un vide sur le rapprochement aide au poste ↔ effectif réel évoqué ci-dessus. (2) La facturation électronique devient obligatoire en France au **1er septembre 2026** (réception généralisée) ; cela ne remet pas en cause le rôle PULL-only de Solidata (Pennylane assure cette conformité en amont), mais fragilise la pertinence du module `billing.js`, qui génère des PDF « faits maison » hors de toute chaîne de facturation électronique (voir §4).

## 4. Forces / faiblesses / manques

### Forces
- Architecture backend propre : `BillingService` et `InvoiceRepository` illustrent un vrai effort de factorisation (numérotation sécurisée par regex anti-injection, calculs centime-exact, state machine de statut explicite).
- Gestion robuste du rate-limiting Pennylane (retry avec back-off + lecture du `Retry-After`) et des transactions SQL (rollback systématique sur échec d'import).
- `ExutoiresControleFacturation.jsx` est une des pages les mieux conçues du périmètre : KPIs, filtres, modale de rapprochement avec scoring, section des commandes orphelines — un vrai outil de contrôle de gestion opérationnel.
- Les 9 contrôles qualité (`/finance/controls/:year`) donnent une vraie autonomie de diagnostic à un non-expert avant de faire confiance aux chiffres.
- Note méthodologique affichée directement dans `FinanceRentabilite.jsx` — bonne pratique de transparence du calcul.

### Faiblesses, bugs et manques constatés dans le code

- **`FinanceOperations.jsx` (données opérationnelles) est non fonctionnelle de bout en bout.** Le frontend attend `res.data.auto/overrides/results` (l.66-68) alors que `GET /finance/operations/:year/auto` (`finance.js` l.944-996) renvoie l'objet `auto` à plat, sans clé `results` ni `overrides` : les 4 cartes KPI et le tableau « Résultat par centre » n'affichent donc jamais rien, et 15 des 17 indicateurs « valeur auto » restent vides (noms de champs non alignés, ex. `tonnes_au_tri` côté API vs `tonnes_triees` côté page). Le bouton « Sauvegarder » (l.89-99) envoie en outre `{ overrides }` alors que `PUT /finance/operations/:year` (l.923-941) attend `{ data: [...] }` — la sauvegarde échoue systématiquement (500) sans message à l'écran (juste un `console.error`).
- **Le tableau « Flux de trésorerie par catégorie » de `FinanceTresorerie.jsx` (l.182-193) ne classe jamais rien.** Il filtre sur `g.type`/`g.class`, deux champs que le backend ne renseigne pas dans `cash_flow` (`finance.js` l.804-816) : les sections « Revenus » et « Dépenses » affichent toujours « Aucun(e) … sur la période » et la ligne « Solde net » vaut 0, alors que les données existent réellement et sont visibles ailleurs sur la même page.
- **Deux boutons de `FinanceControles.jsx` appellent des routes inexistantes** : « Actualiser » cible `POST /finance/controles/:year/refresh` et « Exporter » cible `GET /finance/controles/:year/export` (l.44 et l.54), alors que seule `GET /finance/controls/:year` existe côté serveur (`finance.js` l.1396, orthographe anglaise). Les deux actions échouent en 404, silencieusement.
- **`Pennylane.jsx` conserve un bouton mort « Synchroniser factures / Pousser vers Pennylane »** (l.79-89, `POST /pennylane/sync/invoices`) alors que ce flux push a été explicitement retiré le 03/05/2026 (historique `CLAUDE.md`) — l'endpoint n'existe plus dans `pennylane.js`. Le bouton contredit en plus la doctrine PULL-only désormais affichée dans le sous-titre de la page contrôle facturation. La configuration Pennylane est en outre dupliquée entre cette page (modale) et `PennylaneConfig.jsx`, seule cette dernière étant à jour.
- **Le module « Facturation » interne (`Billing.jsx`) est un angle mort de navigation.** Aucune entrée dans `Layout.jsx` ne pointe vers `/billing` (seule « Contrôle facturation » → `/exutoires-controle-facturation` existe) ; la page n'est accessible qu'en tapant l'URL. Son bouton d'export PDF (`window.open('/api/exports/invoice/:id')`, l.44) échouera systématiquement en 401 : `authenticate` (`middleware/auth.js` l.14-18) exige un header `Authorization: Bearer`, uniquement injecté par l'intercepteur Axios (`services/api.js` l.10-16) — une navigation directe du navigateur ne le porte jamais. Si ce module venait à être (re)découvert et utilisé, il créerait des factures **déconnectées de Pennylane**, sans validité vis-à-vis de la facturation électronique obligatoire dès septembre 2026.
- **Le matching automatique facture ↔ commande (`autoMatchCommande`, `pennylane.js` l.435-471)** repose sur une regex assez permissive (`\b\d{4,8}\b`) qui peut rapprocher — et donc **clôturer automatiquement** — la mauvaise commande si un nombre de 4 à 8 chiffres apparaît par coïncidence dans un libellé Pennylane. Le rapprochement erroné n'est visible qu'après coup, via un écart anormal.
- La synchronisation des factures clients (le cœur du contrôle facturation) n'est **pas planifiée** dans `scheduler.js`, contrairement au GL et aux transactions (sync quotidienne 2h, `scheduler.js` l.550-592) : elle dépend d'un clic manuel régulier, sans alerte si elle est oubliée.
- Pas de rôle de lecture seule pour la direction/CA (voir §2) ; pas de rapprochement aide au poste ↔ effectif en parcours ; le bilan reste un PCG générique sans les rubriques propres aux associations (fonds dédiés, contributions volontaires en nature).

## 5. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|---|---|---|
| 1 | Réparer le contrat frontend/backend de `FinanceOperations` (forme de réponse `/operations/:year/auto`, payload `PUT`) | P0 | M |
| 2 | Corriger la classification Revenus/Dépenses de `FinanceTresorerie` (tagger `type`/`class` côté API) | P0 | S |
| 3 | Réparer ou retirer les boutons « Actualiser »/« Exporter » de `FinanceControles` et « Synchroniser factures » de `Pennylane.jsx` | P0 | S |
| 4 | Corriger l'export PDF de `Billing.jsx` (fetch + blob au lieu de `window.open`) | P0 | S |
| 5 | Statuer sur le devenir du module Facturation interne : le relier proprement à la navigation ou le retirer pour éviter une facturation parallèle non conforme | P1 | S–L |
| 6 | Créer un rôle de consultation seule (direction/CA) pour le module Finance | P1 | M |
| 7 | Fiabiliser `autoMatchCommande` (seuil de confiance, revue des rapprochements automatiques) | P1 | M |
| 8 | Planifier automatiquement la synchronisation des factures clients (comme GL/transactions) | P1 | S |
| 9 | Ajouter un indicateur croisé « aide au poste attendue vs perçue » (Insertion × Finance) | P1 | M |
| 10 | Unifier la configuration Pennylane sur une seule page | P2 | S |
| 11 | Rendre le mapping de colonnes d'import plus visible/robuste (retour utilisateur en cas de format non reconnu) | P2 | M |
| 12 | Harmoniser le retour d'erreur utilisateur (toast) sur toutes les pages Finance | P2 | S |
| 13 | Étudier l'ajout des rubriques comptables associatives (fonds dédiés, CVN) si le bilan sert au-delà du pilotage interne | P2 | M |

## Conclusion

Le module est fonctionnellement riche et la partie contrôle de gestion (P&L, bilan, rentabilité matière, contrôles qualité) dépasse ce qu'ont généralement les structures de cette taille, avec une intégration Pennylane PULL bien conçue et alignée sur les pratiques du marché. Mais plusieurs fonctionnalités visibles à l'écran sont en réalité inertes suite à des désynchronisations frontend/backend (données opérationnelles, ventilation trésorerie, deux boutons de contrôle) et un module entier (Facturation interne) est à la fois invisible en navigation et cassé sur son export. Ces défauts n'empêchent pas le pilotage global (les KPIs dirigeant de la page Finance fonctionnent), mais réduisent la confiance qu'un manager ou un membre du CA peut accorder aux écrans détaillés, et méritent une correction rapide avant la prochaine revue de direction.
