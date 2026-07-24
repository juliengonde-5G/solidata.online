# Réalisation — Module « Achats responsables » (RSEI-17)

- **Date** : 24 juillet 2026
- **Action** : RSEI-17 du plan `rapports/rsei-2026-07-22/03-plan-action-rsei.md` (§2.3)
- **Objet** : outiller le critère **1.7 « Achats durables et socialement responsables »** — référentiel fournisseurs, critères d'achat, registre des FDS, et estimation de la part d'achats responsables. La politique d'achats elle-même reste un acte de direction ; l'ERP en porte la formalisation, le suivi et la mesure.
- **Version** : 2.16.0 — 31e module de l'ERP.

## Périmètre livré

**Schéma (3 tables, `init-db.js` idempotent, prouvé sur PostgreSQL 16 réel)**
- `achats_fournisseurs` — 4 statuts responsables (`local`, `inclusif` ESS/SIAE/EA, `demarche_rse`, `labellise`) ; « responsable » = au moins un statut (calcul applicatif). 7 familles d'achat.
- `achats_criteres` — critères d'achat par famille (`UNIQUE(famille, critere)`), seed de 8 critères de départ, administrable.
- `achats_fds` — registre des fiches de données de sécurité des produits dangereux (upload PDF, dates FDS/révision, EPI requis, `fournisseur_id` FK SET NULL). Entrée au registre RGPD (données non nominatives).

**Backend `/api/achats`** : CRUD fournisseurs/critères/FDS (+ upload/download), `GET /dashboard` (part de fournisseurs responsables, répartition par statut et par famille, FDS à traiter, part d'achats responsables en montant).

**Frontend `/achats` (4 onglets)** : tableau de bord (Recharts), fournisseurs, critères d'achat, registre FDS.

## Doctrines de conception

1. **Part en montant honnête** : rapprochement de la classe 60 du Grand Livre (`financial_gl_entries`, Pennylane pull) — dénominateur = somme des comptes 60 %, numérateur = rapprochement des tiers GL avec les noms des fournisseurs responsables. C'est une **estimation par nom (borne basse)**, jamais présentée comme un chiffre comptable certifié. Si le total classe 60 est indisponible ou aucun tiers n'est rapproché : `part_montant_pct = null`, `part_source = 'indisponible'` — **jamais de valeur inventée**. La part en **nombre** de fournisseurs reste toujours disponible.
2. **FDS à traiter** : produit dangereux sans fiche jointe, sans date, ou fiche périmée sous `achats.fds_fraicheur_jours` (défaut 365 j).

## Vérification

- **Jest 963/963** (70 suites, +25) ; **mobile 40/40** ; **build Vite OK**.
- Migration idempotente **prouvée sur PostgreSQL 16 réel** (seed non dupliqué, agrégats FILTER, jointure GL, FK SET NULL).
- Contrats front↔back concordants ; aucun nom du corpus ; aucune nouvelle dépendance npm.

## Points d'attention (documentés)

- La **part en montant** est une estimation par nom de tiers ; un tagging fournisseur des lignes GL la fiabiliserait (évolution possible).
- **QHSE en lecture seule** sur les FDS (les FDS relèvent pourtant du domaine QHSE) — arbitrage à régler dans `/admin/permissions` (module `achats`) ou à ouvrir en écriture si la direction le souhaite.

## Reste du plan RSEi

Dernier module logiciel : **RSEI-18 générateurs avancés** (rapport RSE annuel + dossier de candidature générés depuis le module Pilotage RSE). Puis les prérequis **direction** (hors logiciel) : recevabilité ACI (RSEI-00), nomination du référent, projet d'entreprise, socles CSE/DUERP/formation, charte égalité — et les évolutions légères des modules existants (RSEI-06/07/08/09/12/16/19 : QHSE, RH, VSME).

## Déploiement

`bash deploy/scripts/deploy.sh update` — migration automatique et idempotente ; aucun paramétrage requis.
