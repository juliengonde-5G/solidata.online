# Contrats techniques — PR D « Reporting autorité et présentation » (lots 6 + 8)

> Orchestrateur, 14/09/2026. Empilée sur la PR C (#168, branche `claude/solidata-cip-redesign-9fskwq-pr-c`).
> Branche : `claude/solidata-cip-redesign-9fskwq-pr-d`. Version cible : **2.55.0**. Dernière PR du plan 07.
> Sources : plan `07-plan-action.md` (lots 6 et 8, décision 9 § 8, amendements § 9 : Indicateur 12, exports, A5/S5/S6), matrice de l'autorité `09-matrice-reporting-autorite.md` (§ 1.3 S1-S7, § 1.5 les 15 indicateurs, § 2 (d) et (e), § 4.3 les cinq conditions de la présentation), `06-persona-autorite.md`.
> Même méthode que PR A/B/C : contrats FIGÉS, deux lots à fichiers DISJOINTS, pré-câblage par l'orchestrateur, puis revue sécurité (lecture seule), debug sur PostgreSQL réel, correctifs, documentation finale.

---

## 0. Ce que PR D livre, en une phrase par lot

- **Lot 6 — « Reporting autorité »** (agent `reporting`) : ce que la gestionnaire de l'autorité recevra — la **synthèse de dialogue de gestion (e)** en 9 blocs imposés (PDF + CSV, strictement non nominative, chaque taux avec sa règle en toutes lettres), un **dénominateur des sorties honnête** (toutes les fins de parcours, ligne « sortie non documentée », les deux méthodes imprimées côte à côte en 2026, rapprochement ASP), l'**ETP ASP en premier** sur une seule base 1 820 h, les **freins entrée → dernière évaluation** par axe, le **débouché des PMSMP** et la trajectoire immersion → embauche, les **orientations DORA** et **aides mobilisées** sur les actions, le **compteur « ruptures de droits évitées »**, le **tableau des freins enrichi (d)**, et le reporting RH aligné sur la nomenclature.
- **Lot 8 — « Documentation et présentation »** (agent `docs`, `docs/` seulement) : le dossier avec lequel la direction se présente à l'autorité — **matrice « qui voit quoi » sur une page**, **déroulé de démonstration** répondant aux cinq conditions du § 4.3 (dossier tiré au hasard et imprimé en moins de cinq minutes, correction d'un entretien clôturé, écran de l'encadrant sans santé/judiciaire/budget, exports (a) et (e) avec la ligne du journal et le refus d'un export vide, pièces hors logiciel), guide collaborateurs avec les visuels existants, `NOTE_CERTIFICATEURS` **purgée de toute promesse non tenue**, documentation applicative.

**Ce qui n'est PAS dans PR D** : aucun nouvel écran de saisie (le lot 6 ne touche la fiche que pour trois champs d'action : DORA, aide mobilisée, débouché PMSMP) ; aucune IA ; aucune API Emplois de l'inclusion ; les pièces hors logiciel (AIPD, PV du CSE, note d'information) restent à la direction — le lot 8 en fournit la **liste et les gabarits**, pas les pièces.

---

## 1. Propriété des fichiers (DISJOINTE)

### 1.1 Pré-câblé par l'orchestrateur AVANT le lancement des lots
| Fichier | Ce qui est posé |
|---|---|
| `backend/src/routes/insertion/index.js` | `router.use('/reporting', require('./reporting'));` monté AVANT `routes.js` |
| `backend/src/scripts/init-db.js` | après `insertion-salarie` : `await require('./migrations/insertion-reporting').run(client);` |
| `backend/src/utils/insertion-settings.js` | clés du § 4 |
| `frontend/src/utils/rgpd-libelles.js` | codes du § 7 |
| `frontend/src/App.jsx` | rien (aucune page nouvelle : la synthèse vit dans `AuditInsertion.jsx`, onglet « Dialogue de gestion ») |
| Squelettes | `routes/insertion/reporting.js`, `services/dialogue-gestion.js`, `services/sorties-engine.js`, `scripts/migrations/insertion-reporting.js`, `frontend/src/components/insertion/pdf-dialogue-gestion.js`, `frontend/src/components/insertion/DialogueGestionPanel.jsx` |

### 1.2 Lot 6 — agent `reporting`
**Backend (crée)** : `routes/insertion/reporting.js`, `services/dialogue-gestion.js` (composition des 9 blocs), `services/sorties-engine.js` (PUR : dénominateur, deux méthodes, non documentées, rapprochement ASP), `scripts/migrations/insertion-reporting.js`, `tests/contract/insertion-reporting-contract.test.js`, `tests/unit/services/sorties-engine.test.js`, `tests/unit/services/dialogue-gestion.test.js`, `tests/unit/migrations/insertion-reporting.test.js`.
**Backend (modifie)** : `routes/insertion/routes.js` — UNIQUEMENT `gatherAuditKpis` (bloc `sorties` enrichi § 5.2, nouveaux blocs § 5.3 ; **aucune clé existante retirée ni renommée**), `POST/PUT /action-plans` (3 champs DORA + 3 champs aide, validation), `POST/PUT /pmsmp` (`debouche`, `debouche_date`, `embauche_accueillant`), `PARTENAIRE_CATEGORIES` (+ `cms`) et la liste des catégories d'action (+ `job_dating`, `formation_fle`) ; `routes/exports.js` — UNIQUEMENT `/insertion-freins` (colonnes (d) § 5.4) et `/insertion-synthese` (délégué au service `dialogue-gestion`, forme CSV § 5.1) ; `utils/insertion-freins-export.js` ; `routes/performance.js` — bloc `insertion` § 5.5 ; `services/anonymization.js` — rien attendu (aucune table nominative nouvelle) ; `services/mon-parcours.js` — libellés des deux nouvelles catégories (une ligne chacun, tableau `LIBELLES_CATEGORIE`) ; `scripts/init-db.js` **INTERDIT** (le seed du partenaire CMS va dans la migration du lot).
**Frontend (modifie)** : `pages/AuditInsertion.jsx` (onglet « Dialogue de gestion » + méthode des sorties), `pages/ReportingRH.jsx` et `pages/PerformanceDashboard.jsx` (§ 5.5), `components/insertion/ActionsPanel.jsx` (champs DORA + aide), `components/insertion/PmsmpPanel.jsx` (débouché), `components/insertion/freins.js` si un libellé manque.
**Frontend (crée / remplit)** : `components/insertion/DialogueGestionPanel.jsx`, `components/insertion/pdf-dialogue-gestion.js`.
**Rapport** : `26-realisation-lot6.md`.

### 1.3 Lot 8 — agent `docs` (`docs/` uniquement — aucun code, aucun test, aucun `rapports/`)
Crée : `docs/PRESENTATION_AUTORITE_DEMONSTRATION.md` (déroulé des cinq conditions), `docs/MATRICE_QUI_VOIT_QUOI_INSERTION.md` (une page), `docs/PIECES_HORS_LOGICIEL_INSERTION.md` (liste + gabarits : AIPD, consultation CSE, note d'information salariés avec trace de remise, base légale de la transmission au référent).
Modifie : `docs/PRESENTATION_AUTORITE_INSERTION.md` (réponses aux 9 questions **relues contre le code livré A→D**), `docs/GUIDE_CIP_INSERTION.md` (cas 29+ : dialogue de gestion, débouché PMSMP, DORA, aides ; visuels existants `rapports/cip-refonte-2026-09-12/maquettes/captures/*.jpg` référencés là où ils illustrent un cas), `docs/GUIDE_CIP_CONFORMITE_FSE.md` (§ 13 « Synthèse de dialogue de gestion »), `docs/NOTE_CERTIFICATEURS_INSERTION.md` (**chaque promesse vérifiée dans le code ; celles qui ne sont pas tenues sont retirées ou reformulées en « prévu »**), `docs/DOCUMENTATION_APPLICATIVE.md` § 2.3.4, `docs/VARIABLES_APPLICATION.md`, `docs/GUIDE_UTILISATEUR.md` § 4.4, `docs/FORMATION_MANAGER_RH_INSERTION.md` (renvoi vers les guides CIP à jour).
**Rapport** : aucun (compte rendu dans la réponse finale) ; l'orchestrateur écrit `26-realisation-lot8.md` d'après ce compte rendu.

### 1.4 Interdits communs
- Aucun lot ne touche `init-db.js`, `index.js`, `insertion/index.js`, `insertion-settings.js`, `rgpd-libelles.js`, `CLAUDE.md`, les rapports de l'autre lot, `echeances-cip.js`, `salarie.js`, `rsa.js`, `temps.js`, `fse.js`, `cadre.js`, `conformite.js`, `exports-fse.js`, `InsertionParcours.jsx`, `Employees.jsx`.
- Le lot 8 lit le code pour vérifier, n'écrit que dans `docs/`. Le lot 6 n'écrit pas dans `docs/`.

---

## 2. Doctrines (rappel, opposables)
1. **Jamais de valeur inventée** : cible non paramétrée → « objectif non paramétré » ; source absente → `null` nommé, jamais 0 ; cellule vide plutôt que zéro dans les exports.
2. **Strictement non nominatif** dans la synthèse (e) : aucun nom, aucun identifiant interne, **k-anonymat** : tout agrégat portant sur moins de **5 personnes** est rendu `null` avec `sous_seuil: true` (règle déjà appliquée aux enquêtes) — sauf les effectifs bruts globaux d'un bloc.
3. **Exports** (amendement § 9) : en-tête de traçabilité (généré le, par le rôle — jamais le nom —, version, périmètre, méthode), **zéro ligne ou zéro fin de parcours → 409 `EXPORT_VIDE` motivé, jamais un fichier vide**, journal RGPD **bloquant** (échec du journal = pas de fichier), neutralisation des formules CSV par `utils/export-csv.js`.
4. **Une seule base ETP dans un document de conventionnement : 1 820 h** ; l'ETP ASP validé (`etp_asp_mensuel`) est **premier**, l'ETP de contrôle ERP est **nommé « effectif pondéré »** et vient en second.
5. **Refus AVANT toute lecture** ; `pool.connect()` dans le try ; dates civiles par `utils/date-iso.js` et conversions par PostgreSQL ; jamais `Number(null)`.
6. **Une seule règle par indicateur** : le dénominateur des sorties vit dans `services/sorties-engine.js` (PUR) et est consommé par `gatherAuditKpis`, `/insertion-synthese`, `/reporting/dialogue-gestion` et `performance.js` — jamais recopié.
7. **Migrations idempotentes** dans la transaction d'init-db ; CHECK reconstruits par DO-scan.
8. Aucune dépendance nouvelle ; français ; aucun identifiant de modèle.

---

## 3. Schéma (`migrations/insertion-reporting.js`, lot 6)
```sql
-- 6.4 — débouché des PMSMP et trajectoire immersion → emploi (S1, S7)
ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS debouche VARCHAR(25);   -- liste fermée § 5.6
ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS debouche_date DATE;
ALTER TABLE insertion_pmsmp ADD COLUMN IF NOT EXISTS embauche_accueillant BOOLEAN;  -- NULL = inconnu
-- CHECK debouche par DO-scan : NULL ou IN ('embauche_accueillant','embauche_autre','formation','poursuite_parcours','aucun','inconnu')

-- 6.4 — orientation DORA et aide mobilisée sur une action CIP
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_service VARCHAR(150);
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_url TEXT;
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS dora_resultat VARCHAR(20);   -- NULL | 'oriente' | 'pris_en_charge' | 'refuse' | 'sans_suite'
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_nature VARCHAR(40);     -- liste fermée § 5.6
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_organisme VARCHAR(150);
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS aide_montant NUMERIC(9,2);   -- NULL = non chiffré, jamais 0

-- A5 / S5 / S6 — catégories
-- CHECK cip_action_plans.category reconstruit : + 'job_dating', 'formation_fle' (DO-scan)
-- CHECK insertion_partenaires.categorie reconstruit : + 'cms' ; seed « CMS (Département 76) » ON CONFLICT (nom) DO NOTHING

-- 6.1 — snapshot des synthèses de dialogue de gestion GÉNÉRÉES (preuve de ce qui est sorti, comme les fiches pour le référent)
CREATE TABLE IF NOT EXISTS insertion_dialogues_gestion (
  id SERIAL PRIMARY KEY,
  annee INTEGER NOT NULL,
  trimestre SMALLINT,                       -- NULL = annuelle ; 1-4 = version trimestrielle allégée (blocs 2 et 8)
  contenu JSONB NOT NULL,                   -- les 9 blocs, non nominatifs
  genere_par INTEGER REFERENCES users(id),
  genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
  version_application VARCHAR(20)
);
CREATE INDEX IF NOT EXISTS idx_insertion_dialogues_gestion_periode ON insertion_dialogues_gestion(annee, trimestre, genere_le DESC);
```
Aucune donnée nominative nouvelle → aucune entrée registre art. 30 ; l'anonymisation n'a rien à purger (le snapshot est agrégé).

---

## 4. Réglages (pré-câblés ; défauts EN CODE)
| Clé | Défaut | Usage |
|---|---|---|
| `insertion.sorties_methode_double_annee` | 2026 | année pour laquelle les deux méthodes de dénominateur sont imprimées côte à côte (décision 9) |
| `insertion.k_anonymat_min` | 5 | effectif sous lequel un agrégat de la synthèse (e) n'est pas rendu |
| `insertion.heures_annuelles_etp` | 1820 | base unique des documents de conventionnement (repli si `effectifs.convention_<annee>.heures_annuelles_etp` absent) |

Réutilisés : `insertion.cible_etp_conventionnes`, cibles de sorties (`/cibles`), `effectifs.convention_<annee>`, `insertion.cer_heures_min` (15), `post_sortie_mois`.

---

## 5. API et formes (figées)

### 5.1 `GET /api/insertion/reporting/dialogue-gestion?annee=&trimestre=&format=json|csv` (ADMIN/RH/MANAGER — **MANAGER lecture agrégée seule, aucune projection nominative n'existe dans ce document**)
`services/dialogue-gestion.js` → `composerDialogueGestion({ annee, trimestre })` renvoie **exactement** :
```jsonc
{
  "en_tete": { "structure": "Solidarité Textiles", "annee", "trimestre": null|1-4, "genere_le", "genere_par_role": "RH", "version": "2.55.0", "perimetre": "parcours d'insertion (CDDI / CDI inclusion), hors permanents", "mention": "Document agrégé non nominatif — dialogue de gestion" },
  "blocs": {
    "1_effectifs_etp": { "base_heures": 1820, "mois": [ { "mois": "2026-01", "etp_asp": 25.99|null, "effectif_pondere": 24.1|null } ], "etp_conventionnes": null|number, "taux_realisation_pct": null|number, "source_etp_asp": "etp_asp_mensuel", "note": "L'ETP ASP validé fait foi ; l'effectif pondéré est un contrôle interne." },
    "2_publics_entree": { "effectif": n, "par_critere_eligibilite": [ { "code", "libelle", "n", "part_pct" } ] /* jamais les critères sensible_art10 */, "brsa": { "n", "part_pct", "n_asp": null|n }, "par_categorie_ft": { "A":n,…,"non_renseignee":n }, "par_referent_unique": { "structure","cms","france_travail","autre","non_determine" }, "sexe": {…}, "tranches_age": {…}, "niveaux_formation": {…} },
    "3_freins": { "par_axe": [ { "axe", "label", "concernes_entree", "leves", "stables", "aggraves", "non_evalues", "actions_engagees", "partenaire_principal": null|"nom", "orientations_dora": n, "dora_resultats": { "oriente","pris_en_charge","refuse","sans_suite" } } ] /* judiciaire ABSENT sans mention */ },
    "4_accompagnement": { "entretiens": [ { "type","label","realises","echus","taux_pct" } ], "heures_accompagnement": { "total_h", "moyenne_par_personne_h", "nb_personnes" } | null, "delai_moyen_diagnostic_jours", "aides_mobilisees": [ { "nature", "n", "montant_total": null|number } ] },
    "5_immersions": { "conventions", "jours", "entreprises_distinctes", "par_debouche": {…}, "embauches_chez_accueillant": n, "liste_entreprises_anonymisee": [ "secteur ou raison sociale ?" → RAISON SOCIALE UNIQUEMENT (ce n'est pas une donnée personnelle), jamais le salarié ] },
    "6_sorties": { /* forme § 5.2 */ },
    "7_resultats": { "situation_6_mois": { "emploi_durable","emploi_transition","formation","recherche_emploi","autre","injoignable","non_renseigne" }, "satisfaction": { agrégats existants } },
    "8_conformite": { "completude_fse_par_projet": [ { "projet","participants","complets","pct" } ], "points_etape_referent": n, "fiches_referent_transmises": n, "actualisations_ft_rappelees": n, "semaines_sous_15h": { "nb_personnes_concernees", "nb_semaines" }, "conciliations": n, "ruptures_droits_evitees": { "actualisations_rappelees", "motifs_legitimes_documentes", "conciliations_tracees", "total" } },
    "9_methode": [ { "indicateur", "regle": "phrase complète en français" } ]   // UNE ligne par taux, y compris « objectif non paramétré »
  },
  "sous_seuil": [ "chemin.du.champ", … ]   // agrégats rendus null par k-anonymat
}
```
`format=csv` : trois colonnes `Bloc ; Indicateur ; Valeur` (comme l'actuel `/insertion-synthese`), en-tête de traçabilité en premières lignes, séparateur `;`, BOM, `neutraliserFormule`. **`POST /api/insertion/reporting/dialogue-gestion`** (ADMIN/RH) = génération **enregistrée** (snapshot `insertion_dialogues_gestion` + journal bloquant `INSERTION_DIALOGUE_GESTION_GENERATION`) → `{ id, contenu }` ; `GET …/dialogue-gestion/historique` liste les générations ; `GET …/dialogue-gestion/:id` rejoue un snapshot (journal `…_CONSULTATION`). Le GET sans enregistrement journalise `INSERTION_DIALOGUE_GESTION_APERCU`. **Le PDF est composé côté client depuis le `contenu` renvoyé** (`pdf-dialogue-gestion.js`, A4, 9 blocs, page « Méthode » obligatoire, signataire « la direction » en pied). `trimestre` fourni → seuls les blocs 2 et 8 (+ en-tête + méthode) sont composés.

### 5.2 Dénominateur des sorties — `services/sorties-engine.js` (PUR, entrées injectées, testé sans base)
`calculerSorties({ finsParcours, bilansClasses, sortiesAsp, annee, cibles, annee_double_methode })` où `finsParcours` = toutes les personnes dont le parcours s'est TERMINÉ dans la période (`employees.insertion_end_date` dans l'année, `parcours_num` courant), `bilansClasses` = bilans de sortie réalisés et classés (`sortie_classification` non nulle) rattachés à ces parcours. Renvoie :
```jsonc
{
  "methode_b": { /* NOUVELLE — dénominateur = toutes les fins de parcours */
    "denominateur", "documentees", "non_documentees",
    "par_classification": { "emploi_durable","emploi_transition","sortie_positive","autre","non_documentee" },
    "taux_pct": { "emploi_durable","emploi_transition","sortie_positive","dynamiques" },   // sur le DÉNOMINATEUR B
    "ecart_cible": { … }|null
  },
  "methode_a": { /* HISTORIQUE — dénominateur = bilans classés seuls ; imprimée UNIQUEMENT si annee === annee_double_methode */ "denominateur","par_classification","taux_pct" } | null,
  "rapprochement_asp": { "sorties_asp": n|null, "ecart": n|null, "note" } ,
  "regles": [ "Méthode B : …", "Méthode A : …", "Sortie non documentée : parcours terminé sans bilan de sortie classé — indicateur de qualité, pas une faute." ]
}
```
`gatherAuditKpis().sorties` **conserve toutes ses clés actuelles** (`total`, `dynamiques`, `autres`, `taux_dynamiques`, `par_classification`, `taux_par_classification`, `par_type`) — elles restent celles de la méthode A — et gagne `methode_b`, `non_documentees`, `rapprochement_asp`, `regles`. `AuditInsertion.jsx` affiche la méthode B en premier, la méthode A à côté avec sa mention « méthode historique, imprimée pour 2026 », et la ligne « sorties non documentées » en clair.

### 5.3 `gatherAuditKpis` — blocs ajoutés (non nominatifs)
`freins_evolution` (par axe : entrée → dernière évaluation, levé = baisse ≥ 1 niveau, aggravé = hausse ≥ 1, stable sinon, non évalué si l'une des deux manque ; judiciaire absent), `publics_entree` (critères d'éligibilité hors `sensible_art10`, BRSA + `n_asp` depuis `etp_asp_mensuel.nb_brsa` du dernier mois validé, catégorie FT, référent unique), `pmsmp` enrichi (`par_debouche`, `embauches_chez_accueillant`, `entreprises`), `actions_partenaires` (par catégorie d'action × partenaire principal), `dora` (orientations et résultats), `aides_mobilisees`, `ruptures_droits_evitees`, `etp_asp` (mois, base 1 820), `conformite` (complétude FSE+ par projet — réutilise `services/fse-participants.conformiteProjet`, points d'étape et fiches transmises — `insertion_milestones` type `point_etape_referent` + `insertion_alimentations_referent`, actualisations FT rappelées — `insertion_actualisations_ft`, semaines sous 15 h — `activiteHebdoCohorte`, conciliations). **Projection MANAGER** : `gatherAuditKpis` reste appelé sans rôle ; c'est la route `/audit` qui retire `heures_accompagnement.par_salarie` (déjà fait en PR B) — les nouveaux blocs ne portent **aucune** clé par salarié.

### 5.4 Tableau des freins (d) — `utils/insertion-freins-export.js` + `routes/exports.js /insertion-freins`
Colonnes **conservées** 1-23 ; intitulé 5 → « Heures par semaine (quotité contractuelle) » ; **ajoutées** après la 23 : `BRSA`, `Date de constat BRSA`, `Catégorie France Travail`, `Critères d'éligibilité IAE` (libellés hors `sensible_art10`, séparés par « ; »), `Statut du Pass IAE`, `Référent unique (type)`, `Référent unique (nom)`, `Projet cofinancé`, `Prescripteur habilité`, `Semaines sous 15 h (année)` ; et **par axe de frein**, à côté de la valeur courante : `<axe> — entrée` et `<axe> — évolution` (levé / stable / aggravé / non évalué). Judiciaire : inchangé (variante `sensibles=1` seule, journal distinct). Feuille « Informations » : règle de valorisation + règle d'évolution imprimées. `completude` étendue aux nouvelles colonnes.

### 5.5 Reporting RH (`performance.js`, `ReportingRH.jsx`, `PerformanceDashboard.jsx`)
`insertion.parcours_termines / total` (legacy) remplacé par `{ en_parcours, fins_parcours_annee, sorties: { documentees, non_documentees, dynamiques, taux_dynamiques_pct (méthode B) } }` calculé par `sorties-engine` ; les deux écrans affichent « Sorties dynamiques (méthode B, année) » et « Sorties non documentées » à la place de « Parcours terminés / total ». Aucun pourcentage sans dénominateur > 0.

### 5.6 Fiche — trois saisies nouvelles (lot 6, écrans existants)
- `PmsmpPanel.jsx` : à la clôture d'une PMSMP (date de fin passée), sélecteur **« Débouché »** (liste fermée : embauche chez l'accueillant / embauche ailleurs / formation / poursuite du parcours / aucun / inconnu) + date ; `embauche_accueillant` déduit du choix (true / false / null pour inconnu).
- `ActionsPanel.jsx` : bloc repliable « Orientation DORA » (service, lien, résultat en liste fermée) et « Aide mobilisée » (nature en liste fermée : `mobilite`, `logement`, `sante`, `numerique`, `garde_enfants`, `formation`, `administrative`, `financiere_urgence`, `autre` ; organisme ; montant facultatif). Validation serveur : `dora_url` https uniquement (400 sinon), montant ≥ 0 ou null.
- Catégories d'action `job_dating` (« Rencontre avec des employeurs / job dating ») et `formation_fle` (« Formation linguistique (FLE) ») ajoutées à la liste fermée, au CHECK, aux libellés front et à `mon-parcours.js`.

### 5.7 Journalisation
`journalPour('insertion_reporting', '[INSERTION][REPORTING]')` de `utils/insertion-journal.js`. Exports : journal **bloquant** avant envoi (`journaliserDocument`), 409 `EXPORT_VIDE` quand `finsParcours.length === 0 && bilansClasses.length === 0` pour la synthèse annuelle, ou zéro salarié pour le tableau des freins (déjà le cas — vérifier).

---

## 6. Front (formes)
- `AuditInsertion.jsx` : nouvel onglet **« Dialogue de gestion »** (`DialogueGestionPanel`) : sélecteur année / trimestre, « Aperçu » (GET), « Générer et enregistrer » (POST → PDF), « CSV », historique des générations (rejouer un snapshot en PDF), liste des agrégats sous seuil affichée en clair (« 3 indicateurs non rendus : moins de 5 personnes »). Onglet existant « Pilotage » : bloc Sorties réécrit (méthode B / méthode A / non documentées / rapprochement ASP / règles), bloc « Freins : évolution entrée → dernière évaluation » (tableau par axe levés / stables / aggravés), bloc « Immersions » (débouchés), bloc « Conformité » (8 indicateurs).
- `pdf-dialogue-gestion.js` : `exportDialogueGestionPDF(contenu)` — A4 portrait, en-tête de traçabilité, 9 blocs dans l'ordre imposé, tableaux, **page « Méthode »**, pied « Signataire : la direction — document non nominatif », via `openPrintWindow`. Rendu exclusivement depuis `contenu`.
- Aucun `alert()` / `window.confirm`.

---

## 7. Codes RGPD (pré-câblés)
| Code | Libellé |
|---|---|
| `INSERTION_DIALOGUE_GESTION_APERCU` | Aperçu de la synthèse de dialogue de gestion (sans enregistrement) |
| `INSERTION_DIALOGUE_GESTION_GENERATION` | Génération enregistrée de la synthèse de dialogue de gestion |
| `INSERTION_DIALOGUE_GESTION_CONSULTATION` | Consultation d'une synthèse de dialogue de gestion déjà générée |
| `EXPORT_DIALOGUE_GESTION` | Export CSV de la synthèse de dialogue de gestion |
| `EXPORT_INSERTION_FREINS_ENRICHI` | Export du tableau des freins enrichi (cadre 2026) |

---

## 8. Preuves attendues (lot 6)
Jest complet vert (suites/tests avant → après) ; contrats : rôles refusés avant requête, 409 `EXPORT_VIDE`, journal bloquant (échec → aucun fichier), k-anonymat (un agrégat à 4 personnes → null + `sous_seuil`), absence prouvée de toute clé nominative (`nom`, `prenom`, `employee_id`, `first_name`, `last_name`, `birth_date`, `email`, `phone`) dans la sérialisation de la synthèse, judiciaire absent du bloc 3 et de l'évolution, `sorties-engine` par cas (0 fin de parcours, fins sans bilan, bilans sans fin de parcours datée, cibles absentes → null, année ≠ double méthode → `methode_a: null`), migration rejouée deux fois sur client simulé ; build Vite vert ; `require` de chaque module ; **au moins 4 contre-épreuves par mutation** (retirer le k-anonymat, réintroduire le judiciaire dans le bloc 3, retirer la ligne « non documentée » du dénominateur, rendre le journal tolérant).

## 9. Ordre après les lots (orchestrateur)
Intégration → revue sécurité (`27-revue-securite-PR-D.md`) + debug PostgreSQL réel (`backend/tests/e2e-pr-d/`, `28-debug-postgres-PR-D.md`) en parallèle → correctifs (`29-correctifs-PR-D.md`) → docs finales (le lot 8 repasse sur ce que les correctifs ont changé) → CLAUDE.md 2.55.0 → PR D vers la branche PR C.
