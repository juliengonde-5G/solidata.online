# Réalisation — DUERP/IRP + REX SST au module QHSE (RSEI-06 + RSEI-07)

- **Date** : 24 juillet 2026
- **Actions** : RSEI-06 et RSEI-07 du plan `rapports/rsei-2026-07-22/03-plan-action-rsei.md` (§2.1)
- **Objet** : outiller le critère **2.4 « Santé et sécurité au travail »** du référentiel RSEi. Deux évolutions légères du module QHSE existant (item 58, Vague 2) : (RSEI-06) un registre des documents de prévention avec trace de consultation des IRP/CSE et échéance de révision ; (RSEI-07) la boucle de retour d'expérience SST sur les accidents/presqu'accidents déjà saisis.
- **Version** : 2.18.0.

## Périmètre livré

**Schéma (`init-db.js` idempotent, prouvé sur PostgreSQL 16.13 UTF8 réel)**
- **RSEI-06** — nouvelle table `qhse_documents` : 6 types (`duerp`, `plan_prevention`, `rps`, `protocole_securite`, `consignes`, `autre`), pièce jointe (pattern Refashion : `fichier_path`/`fichier_original_name`/`fichier_mime`), **trace de consultation IRP/CSE** (`irp_consultation_date` + `irp_consultation_avis`), **échéance de révision** (`date_revision_prevue`). Index type + révision. Ajoutée au resync des séquences SERIAL.
- **RSEI-07** — 4 colonnes idempotentes (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) sur `qhse_events` : `analyse_causes`, `action_corrective`, `efficacite_verifiee_le`, `efficacite_constat`.

**Backend `/api/qhse`**
- **Documents** : `GET /documents` (liste + statut de fraîcheur calculé `documentStatut`), `GET /documents/synthese` (présence des socles DUERP/plan/RPS, à réviser, révision proche, IRP non tracée), `POST`/`PATCH`/`DELETE /documents`, `POST /documents/:id/fichier` (upload, nettoie l'orphelin si l'UPDATE DB échoue), `GET /documents/:id/fichier` (download).
- **REX** : les 4 champs REX ajoutés au `PATCH /events/:id` existant ; `GET /rex?annee=` (taux d'analyse, nb actions correctives, nb efficacité vérifiée, liste « à analyser », **croisement avec `incidents` de type accident** — délai moyen de résolution déjà mesuré).

**Scheduler** : job instrumenté `checkQhseDocuments` (documents à réviser / révision proche sous `qhse.revision_alerte_jours` défaut 60 j / **DUERP absent**) — la page QHSE reste la surface d'alerte live, le job double d'une trace `job_runs`.

**Frontend (`Qhse.jsx`, `App.jsx`)** : 2 onglets — « Documents de prévention » (synthèse des socles + tableau + modal avec bloc consultation IRP/CSE + upload de pièce) et « Retours d'expérience » (cartes KPI + boucle analyse → action → efficacité). Bloc REX ajouté au modal d'édition d'un accident. Bandeau de périmètre réécrit.

## Doctrines de conception

1. **La preuve d'abord** : le DUERP et sa **consultation des IRP/CSE** (attendu N1 le plus scruté du 2.4) deviennent une preuve datée d'un clic ; l'échéance de révision est surveillée par le scheduler.
2. **L'ERP héberge, ne produit pas** : le module date, trace et rappelle la révision du DUERP/plan de prévention/RPS ; leur rédaction reste un acte employeur.
3. **La boucle SST existe déjà dans les données** : RSEI-07 la met en récit (analyse des causes → action corrective → efficacité vérifiée) et en revue, sans nouveau flux.
4. **RGPD** : `qhse_documents` = pièces **organisationnelles non nominatives** (le DUERP porte sur des unités de travail, pas des personnes) — le traitement QHSE au registre art. 30 les couvre, aucune nouvelle entrée.

## Vérification

- **Jest 982/982** (71 suites, +15 : `documentStatut`, référentiels DOC/REX, schéma statique `qhse-documents-schema`) ; **build Vite OK**.
- **Migration idempotente prouvée sur PostgreSQL 16.13 UTF8 réel** : séquence base neuve `init-db → migrate-exutoires → migrate-finance → init-db ×2` verte (74 ✓, 0 erreur), `qhse_documents` (16 colonnes + CHECK type) et les 4 colonnes REX vérifiées, round-trip d'insertion OK.
  - *NB méthodologique* : un premier essai sur un cluster **SQL_ASCII** (initdb en locale C) faisait apparaître un faux dépassement `VARCHAR(100)` sur une chaîne accentée (comptage d'octets). Reproduit puis écarté en recréant la base en **UTF8** (encodage de la production) : aucun bug réel sur `main`.
- Contrats front↔back concordants ; aucune dépendance npm ajoutée.

## Reste du plan RSEi côté logiciel

Évolutions légères restantes : **RSEI-08** (indicateurs égalité F/H, reporting RH), **RSEI-09** (export VSME B1-B11), **RSEI-12** (plan de formation). Puis les prérequis **direction hors logiciel** : recevabilité ACI (RSEI-00), nomination du référent, projet d'entreprise, socles CSE/DUERP/formation, charte égalité.

## Déploiement

`bash deploy/scripts/deploy.sh update` — migration automatique et idempotente ; **aucun paramétrage requis** (`qhse.revision_alerte_jours` défaut 60 j éditable dans settings).
