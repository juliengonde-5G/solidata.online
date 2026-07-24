# Réalisation — Module « Énergie & GES » (RSEI-11)

- **Date** : 23 juillet 2026
- **Action** : RSEI-11 du plan `rapports/rsei-2026-07-22/03-plan-action-rsei.md` (§2.2)
- **Objet** : combler le critère **4.2 « Énergies & GES »** (le seul critère à 0 du référentiel RSEi 2026) et servir 4.1 (démarche environnementale) et 4.5 (indicateurs environnementaux) par la mesure des impacts environnementaux **propres** de la structure.
- **Version** : 2.14.0 — 29e module de l'ERP.

## Périmètre livré

**Schéma (5 tables, `init-db.js` idempotent, prouvé sur PostgreSQL 16 réel)**
- `energie_sites` (bâtiments/sites ; seed du siège Le Houlme `WHERE NOT EXISTS`).
- `energie_compteurs` (électricité / gaz / eau / autre, unité paramétrable).
- `energie_releves` (consommation mensuelle + coût, `UNIQUE(compteur, année, mois)`).
- `carburant_pleins` (par véhicule, litres, €, `km_compteur` relevé au plein, type de carburant).
- `ges_facteurs` (facteurs d'émission kgCO2e/unité, `UNIQUE(poste, année)`) — **seed de 6 facteurs ADEME indicatifs** (millésime 2024) sourcés en commentaire, **paramétrables**. Entrée au registre RGPD.

**Backend `/api/energie`** : CRUD sites/compteurs/relevés/pleins/facteurs ; `GET /dashboard?annee=` (émissions par poste énergie + carburant, totaux tCO2e, intensité tCO2e/k€ CA, L/100 km par véhicule + dérive) ; `GET /vsme-b3b6?annee=` (données VSME B3 énergie/GES + B6 eau, préparées pour un futur export VSME — RSEI-09). Habilitations : lecture ADMIN/MANAGER/RH/QHSE, écriture ADMIN/RH/MANAGER, facteurs ADMIN/RH. Scheduler `checkEnergieSaisie`. Catalogue de module `energie`.

**Frontend `/energie` (`EnergieGES.jsx`, 4 onglets)** : tableau de bord GES (Recharts), relevés énergie (grille compteur × 12 mois), carburant (pleins + conso), réglages (sites/compteurs/facteurs).

## Doctrines de conception

1. **Facteurs d'émission jamais présentés comme exacts** : valeurs ADEME indicatives, millésimées, éditables par la structure ; bandeau d'avertissement permanent à l'écran.
2. **Jamais de faux zéro** : un poste sans facteur est exclu du total et listé « à renseigner » ; le CA non résolu affiche « CA non renseigné » (cascade honnête `settings` → GL 70/74 → CA opérationnel → `null`, `ca_source` exposé).
3. **L/100 km méthode plein-à-plein** (km saisi au compteur au moment du plein) ; dérive = dépassement du seuil `energie.derive_seuil_pct` (défaut 20 %) vs la moyenne du véhicule — synergie avec la maintenance.

## Vérification

- **Jest 907/907** (66 suites, +32) ; **mobile 40/40** ; **build Vite OK**.
- Migration idempotente **prouvée sur PostgreSQL 16 réel** (double init-db ; 6 facteurs / 1 site / 1 entrée RGPD stables, contraintes UNIQUE/CHECK/FK vérifiées).
- Contrats front↔back concordants ; aucun nom du corpus ; aucune nouvelle dépendance npm.

## Points d'attention (documentés)

- **Km saisi manuellement** au plein : les checklists mobiles / GPS ne fournissent pas le kilométrage à la pompe.
- **Rapprochement coûts ↔ classe 60** (Pennylane) non implémenté en v1 (évite une dépendance fragile) ; les coûts saisis sont conservés, le rapprochement reste possible côté finance.
- Le **niveau 3 du critère 4.2** (« postes principaux identifiés, plan d'action, efficacité mesurée ») devient démontrable après **12 mois de données** — d'où l'intérêt de démarrer la saisie sans attendre.

## Reste du plan RSEi

Chantiers logiciels suivants : **RSEI-13 module « Enquêtes »** (QVCT/satisfaction/sensibilisation), **RSEI-17 achats responsables**, **RSEI-18 générateurs avancés** (rapport RSE annuel + dossier de candidature, sur le module Pilotage RSE). Prérequis **direction** (hors logiciel) : **RSEI-00 recevabilité ACI** et P1-P5 (référent, projet d'entreprise, socles CSE/DUERP/formation, charte égalité).

## Déploiement

`bash deploy/scripts/deploy.sh update` — migration automatique et idempotente ; aucun paramétrage requis (facteurs seedés éditables). Pour un cloisonnement fin, créer le module `energie` dans `/admin/permissions`.
