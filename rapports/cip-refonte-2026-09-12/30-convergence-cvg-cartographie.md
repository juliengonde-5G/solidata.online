# 30 — Outil de dialogue de gestion 2024 (programme CVG, Convergence France) : cartographie contre le code et contrat du lot

*Établi le 25/09/2026 à réception du document scanné (4 pages, période « entre le 01/04/2026 et le 30/09/2026 », structure SOLIDARITE TEXTILES). Chaque ligne du tableau Convergence est confrontée au code de la branche `claude/solidata-cip-redesign-9fskwq-pr-d` fusionnée avec `main` (2.57.0) — jamais à ce que la documentation en dit.*

## 0. Ce que le document demande

Quatre pages, trois parties, une période libre (ici un semestre avril → septembre) :

1. **Partie 1 — Le public** : ETP conventionnés à la date de fin, salariés accueillis sur la période, en contrat à la date de fin ; ventilation des personnes salariées dans l'année (sexe, 3 tranches d'âge, 7 niveaux de formation, sans emploi depuis 2 ans et plus, RSA socle, ASS, demandeurs d'emploi RTH dont AAH, réfugiés) ; **type d'habitat à l'entrée** (5 types + « ayant connu un parcours de rue ») ; **8 difficultés à l'entrée** ; **type d'orienteur** (12 valeurs).
2. **Partie 2 — Moyens humains** : ressources internes (NOM Prénom, fonction, quotité totale en ETP, dont quotité d'accompagnement, dont quotité d'encadrement) et ressources mutualisées (nom, fonction et employeur, quotité affectée au chantier).
3. **Sorties** : nombre de sortis sur la période, durée moyenne du parcours en mois ; puis **deux tableaux jumeaux** — sortants en emploi ou formation (emploi / suite de parcours en insertion / formation) et sortants hors emploi (retraite / sans solution emploi / sans nouvelles / sortie neutre / sortie autre reconnue positive dont parcours de soin) — chacun avec l'**évolution des 8 freins** (difficultés à l'entrée → résolution totale ou partielle à la sortie), l'**évolution du logement** entrée/sortie (5 types) et l'**évolution de la situation santé** (RQTH, AAH, pension d'invalidité, médecin traitant, amélioration de la couverture santé), et le nombre ayant bénéficié d'un **accompagnement post-sortie**.

Les pourcentages sont calculés sur le total des sorties (première ligne) ou sur le sous-total du tableau (freins, logement, santé).

## 1. Cartographie ligne par ligne

Légende : **✓** disponible tel quel · **≈** disponible sous une forme voisine (transcodage ou approximation à documenter) · **✗** absent (à programmer).

### 1.1 Partie 1 — Le public

| Indicateur Convergence | État | Source dans SOLIDATA | Remarque |
|---|---|---|---|
| ETP conventionnés à la date de fin | ✓ | `settings` `effectifs.convention_<année>.etp_conventionnes` (module Effectifs ETP), repli `insertion.cible_etp_conventionnes` | `null` si non paramétré — jamais inventé |
| Salariés en insertion accueillis sur la période | ✓ | `employees.insertion_start_date` ∈ période, `insertion_status <> 'none'` + garde `relevantDeLaCip` (contrats) | Même périmètre que l'espace CIP |
| Salariés en insertion en contrat à la date de fin | ✓ | `employee_contracts` (période effective couvrant la date) ; repli `employees.contract_start/end` | |
| Hommes / Femmes | ✓ | `employees.gender` (fait foi), repli `civility` (2.19.1) | « non renseigné » compté à part |
| < 26 ans / 26-50 / > 50 | ≈ | `employees.birth_date` ; `bloc2Publics` calcule déjà des tranches (`ageBracket`) | Les bornes CVG (26, 50) sont recalculées à la date de fin de période |
| Niveaux de formation 1-2 / 3 / 4 / 5 / 6 / 7 / 8 | ≈ | `insertion_diagnostics.niveau_formation` : `infra3`, `niv3`, `niv4`, `niv5`, `niv6plus` | **6, 7 et 8 confondus** dans `niv6plus` → nomenclature à affiner (`niv6`, `niv7`, `niv8`, `niv6plus` conservé en lecture) |
| N'ayant pas travaillé depuis 2 ans et plus | ✓ | `insertion_diagnostics.fse_entree.duree_sans_emploi = 'gt_24m'` ; critère d'éligibilité `detld` | Deux sources cohérentes, la plus récente prime |
| Bénéficiaires du RSA socle | ✓ | `employees.brsa` (ADMIN/RH) ; critère `brsa` ; `ressources` contient `rsa` | |
| Bénéficiaires de l'ASS | ✓ | critère d'éligibilité `ass` ; `ressources` contient `ass` | |
| Demandeurs d'emploi RTH | ✓ | critère `rqth` ; `insertion_diagnostics.rqth` ; `employees.disability_status` | |
| Dont bénéficiaires de l'AAH | ✓ | critère `aah` ; `ressources` contient `aah` | |
| Réfugiés | ✓ | critère `refugie_bpi` | |
| Type d'habitat à l'entrée (autonome / semi-durable / hébergement collectif / hébergement précaire / rue) | ≈ | `insertion_diagnostics.logement_statut` : `locataire_social`, `locataire_prive`, `proprietaire`, `heberge`, `sans_abri` | `heberge` ne distingue **ni** collectif / précaire / semi-durable ; « rue » ≈ `sans_abri`. **Colonne dédiée `habitat_type` (liste CVG) à ajouter au socle**, pré-remplie depuis `logement_statut` quand la correspondance est univoque |
| Personnes ayant connu un parcours de rue | ✗ | — | Booléen `parcours_rue` à ajouter au diagnostic (rubrique logement) |
| Difficultés à l'entrée (8 axes) | ✓ | 9 freins de `freins-registry.js` au diagnostic d'accueil, échelle 1 → 5 | Transcodage : illettrisme/FLE = `linguistique` ; démarches/droits = `administratif` ; surendettement = `finances` ; justice = `judiciaire` ; garde d'enfant = `famille` ; `numerique` **sans équivalent** (non transmis). « Difficulté » = niveau ≥ seuil `insertion.cvg_frein_seuil` (défaut 3) |
| Type d'orienteur (12 valeurs) | ≈ | `employees.orienteur_type` : `departement_cms`, `france_travail`, `mission_locale`, `cap_emploi`, `ccas`, `autre` | 6 valeurs pour 12 attendues. **Liste à étendre** (PLIE/PMIE, autre SPE, structure d'hébergement, maraude/veille sociale, Premières Heures en Chantier, autres SIAE, services sociaux du département, autre acteur local, candidature spontanée) ; `departement_cms` → services sociaux du département, `ccas` → autre acteur local d'accompagnement |

### 1.2 Partie 2 — Moyens humains

| Indicateur | État | Source | Remarque |
|---|---|---|---|
| Ressources internes : nom, fonction, ETP total, dont accompagnement, dont encadrement | ✗ | `insertion_projet_postes.quotite_pct` ne porte que la quotité **par projet FSE+ (OCS)** d'un `user_id` ; `users` n'a ni fonction ni quotité | **Registre à créer** (`insertion_cvg_ressources`) |
| Ressources mutualisées : nom, fonction et employeur, quotité affectée | ✗ | — | Même registre, `type = 'mutualisee'`, employeur libre |

### 1.3 Sorties

| Indicateur | État | Source | Remarque |
|---|---|---|---|
| Salariés sortis sur la période | ✓ | `services/sorties-engine.js` méthode B : **toutes** les fins de parcours (`insertion_end_date` ∈ période) | Même dénominateur que la synthèse de dialogue de gestion |
| Durée moyenne du parcours (mois) | ✓ | `insertion_end_date − insertion_start_date` des sortants | Repli contrats si la date de parcours manque |
| Emploi (CDI, CDD, création…) / Suite de parcours en insertion / Formation | ≈ | `insertion_milestones.sortie_type` : `CDI`, `CDD`, `CDD_court`, `interim`, `creation_activite` → emploi ; `autre_IAE` → suite de parcours ; `formation` → formation | Transcodage automatique **proposé**, confirmable |
| Retraite / Sans solution emploi / Sans nouvelles / Sortie neutre / Sortie autre reconnue positive / dont parcours de soin | ≈ / ✗ | `fin_contrat` → sans solution ; `sans_suite` → sans nouvelles (approximation) ; **retraite, sortie neutre, sortie autre reconnue positive, parcours de soin : absents** ; la « sortie non documentée » (parti sans bilan) → sans nouvelles | **Catégorie CVG en liste fermée à saisir à la sortie** (`sortie_cvg`), pré-remplie depuis `sortie_type` |
| Évolution des freins entrée → sortie (par sous-population) | ≈ | Niveau au diagnostic vs niveau à la **dernière évaluation** (`bloc3Freins` : levé / stable / aggravé) | « Résolution totale ou partielle » = niveau de sortie < niveau d'entrée ; à restreindre aux sortants de la période et à ventiler emploi / hors emploi |
| Logement à l'entrée / à la sortie (5 types) | ≈ / ✗ | Entrée : `habitat_type` (à créer) ; **sortie : rien** | Champ `habitat_type_sortie` dans le bloc de sortie |
| RQTH / AAH / pension d'invalidité / médecin traitant / amélioration couverture santé, entrée et sortie | ≈ / ✗ | Entrée : `rqth` ✓, `aah` ✓ (ressources / critère), `mutuelle_statut` ✓ ; **pension d'invalidité et médecin traitant : absents** ; **à la sortie : rien** | Deux booléens au diagnostic (`pension_invalidite`, `medecin_traitant`) + bloc « situation santé à la sortie » (5 valeurs) |
| Accompagnement post-sortie (ayant bénéficié) | ≈ | Entretien `suivi_post_sortie` réalisé (+6 mois) | Un suivi à +6 mois n'est pas un accompagnement : **booléen explicite** `accompagnement_post_sortie` à la sortie, le suivi réalisé restant la valeur proposée |

### 1.4 Bilan

- **Disponible tel quel** : 14 lignes (ETP, effectifs, sexe, RSA, ASS, RTH, AAH, réfugiés, sans emploi 2 ans, freins à l'entrée, sorties, durée moyenne, post-sortie approché).
- **Disponible à transcodage près** : âge (bornes), niveaux de formation (6-8 confondus), habitat (liste voisine), orienteur (6/12), catégories de sortie (emploi / formation / suite de parcours).
- **Absent** : parcours de rue, pension d'invalidité, médecin traitant, situation logement et santé **à la sortie**, retraite / sortie neutre / autre positive / parcours de soin, accompagnement post-sortie explicite, **toute la Partie 2** (moyens humains).

## 2. Contrat du lot « Suivi Convergence (CVG) » — 2.60.0

### 2.1 Doctrine

1. **Remplissage permanent, jamais une campagne** : chaque information CVG est saisie là où elle naît — le socle du diagnostic à l'entrée (habitat, parcours de rue, pension, médecin traitant), le bilan de sortie à la sortie (catégorie CVG, parcours de soin, habitat et santé à la sortie, accompagnement post-sortie). L'écran CVG ne fait que **lire** et **nommer ce qui manque** (complétude par personne, lien vers la fiche). Une **obligation** « situation de sortie CVG à saisir » entre dans Mes échéances (10ᵉ famille, `sortie_cvg`, échéance 30 j après la fin de parcours, reportable comme les autres, jamais acquittable).
2. **Repère périodique** : une génération enregistrée = un **instantané** (`insertion_dialogues_gestion` réutilisée avec `type = 'cvg'`, `periode_debut`, `periode_fin`), daté, versionné, journalisé, purgé par la 11ᵉ purge (6 ans). Périodes proposées : semestres Convergence (1ᵉʳ avril → 30 septembre, 1ᵉʳ octobre → 31 mars), année civile, ou dates libres.
3. **Analyse d'évolution** : la comparaison de deux instantanés (ou de deux périodes composées à la volée) rend, indicateur par indicateur, l'écart en nombre et en points de pourcentage, puis une **lecture rédigée en toutes lettres** (hausse / baisse / stable au-delà d'un seuil, structure du public, sorties, freins levés), sans jamais inventer une cause.
4. **Jamais de valeur inventée** : une ligne dont la donnée n'est pas saisie s'écrit `null` et compte dans « non renseigné » ; le document dit le nombre de non-renseignés par bloc.
5. **Confidentialité** : la Partie 1 et les Sorties sont **agrégées**, ADMIN/RH strict (elles portent BRSA, RQTH, AAH, freins santé/judiciaire) ; le k-anonymat structurel de la synthèse (plancher 5) **n'est pas appliqué** à ce document parce que Convergence le reçoit avec des effectifs de 1 et 2 (c'est son format) — la décision est **à confirmer par le DPO** (§ 4). La Partie 2 nomme des **salariés permanents** (fonction, quotité) : données RH ordinaires, ADMIN/RH.
6. Le frein `numerique` de SOLIDATA n'a pas d'équivalent Convergence : il n'est pas transmis, le document le dit en méthode.

### 2.2 Schéma (migration `migrations/insertion-convergence.js`, idempotente, appelée par init-db)

- `insertion_diagnostics` : `habitat_type VARCHAR(30)` CHECK (`autonome`,`semi_durable`,`hebergement_collectif`,`hebergement_precaire`,`rue`), `parcours_rue BOOLEAN`, `pension_invalidite BOOLEAN`, `medecin_traitant BOOLEAN`. Le socle (`diagnostic-socle-champs.json`, copie front) gagne `habitat_type`.
- `niveau_formation` : valeurs `niv6`, `niv7`, `niv8` acceptées en plus ; `niv6plus` conservé et compté « 6 et plus (niveau non détaillé) ».
- `employees.orienteur_type` : CHECK élargi aux 12 valeurs CVG + les 6 existantes ; libellés dans `utils/convergence-cvg-referentiels.js`.
- `insertion_sortie_cvg` : `employee_id`, `parcours_num`, UNIQUE(employee_id, parcours_num), `categorie` CHECK (`emploi`,`suite_parcours_insertion`,`formation`,`retraite`,`sans_solution`,`sans_nouvelles`,`sortie_neutre`,`autre_positive`), `parcours_de_soin BOOLEAN`, `habitat_type_sortie`, `rqth_sortie`, `aah_sortie`, `pension_invalidite_sortie`, `medecin_traitant_sortie`, `couverture_sante_amelioree BOOLEAN`, `accompagnement_post_sortie BOOLEAN`, `saisi_par`, `saisi_at`, `updated_at`. Purgée à l'anonymisation (`services/anonymization.js`).
- `insertion_cvg_ressources` : `type` CHECK (`interne`,`mutualisee`), `user_id` nullable, `employee_id` nullable, `nom`, `fonction`, `employeur`, `etp_total NUMERIC(4,2)`, `etp_accompagnement`, `etp_encadrement`, `date_debut`, `date_fin`, `actif`.
- `insertion_dialogues_gestion` : `type VARCHAR(20) NOT NULL DEFAULT 'dialogue'`, `periode_debut DATE`, `periode_fin DATE`.
- Réglages (`insertion-settings.js`) : `insertion.cvg_frein_seuil` 3, `insertion.cvg_sortie_delai_jours` 30.
- Codes RGPD (`rgpd-libelles.js`) : `INSERTION_CVG_APERCU`, `INSERTION_CVG_GENERATION`, `INSERTION_CVG_CONSULTATION`, `INSERTION_CVG_COMPARAISON`, `EXPORT_CVG`, `INSERTION_SORTIE_CVG_ECRITURE`.

### 2.3 Backend

- `services/convergence-cvg.js` : `composerCvg({ debut, fin, db })` → `{ en_tete, partie1, partie2, sorties: { total, duree_moyenne_mois, emploi: {...}, hors_emploi: {...} }, completude, methode }` reproduisant la structure du formulaire ; `comparerCvg(a, b)` PUR (deux contenus → deltas + `lecture[]` de phrases) ; `transcoderSortieType(sortie_type)` PUR ; `transcoderHabitat(logement_statut)` PUR.
- `routes/insertion/convergence.js` (monté `/insertion/convergence`, ADMIN/RH) : `GET /apercu?debut&fin` (journal bloquant), `POST /generer` (snapshot, journal bloquant, 409 `EXPORT_VIDE` si aucun accueilli ni sorti), `GET /historique`, `GET /snapshot/:id`, `GET /comparaison?a=&b=` (ids d'instantanés) ou `?debut_a&fin_a&debut_b&fin_b` (à la volée), `GET /completude?debut&fin`, `GET /csv?debut&fin`, `GET|PUT /situation-sortie/:employeeId`, CRUD `/ressources`.
- `services/echeances-cip.js` : famille `sortie_cvg`.
- `GET /insertion/dialogue-gestion/historique` : filtre `type = 'dialogue'` (les instantanés CVG ne s'y mélangent pas).

### 2.4 Frontend

- `AuditInsertion.jsx` : onglet **« Convergence (CVG) »** → `ConvergenceCvgPanel.jsx` (période, Aperçu au format du formulaire, Générer et enregistrer, Historique, **Comparer deux périodes** avec l'analyse rédigée, Complétude, Moyens humains) ; `pdf-convergence-cvg.js` (A4, 4 pages dans l'ordre du formulaire, en-tête de traçabilité).
- `DiagnosticForm.jsx` : rubrique logement (habitat CVG, parcours de rue), rubrique santé (pension d'invalidité, médecin traitant), niveaux 6/7/8.
- `EntretienForm.jsx` (bilan de sortie) : bloc « Situation à la sortie (Convergence) » pré-rempli depuis `sortie_type`, `rqth`, `habitat_type`.
- `DossierAdministratif.jsx` : liste d'orienteurs étendue.

### 2.5 Preuves attendues

Jest : unitaires PURS du composeur et du comparateur (cohorte injectée reproduisant les chiffres du scan : 46 accueillis, 9 sortis, 3 en emploi / 4 hors emploi, 9,3 mois), contrats de routes (403 avant toute requête pour COLLABORATEUR / AUTORITE / DPO / jeton chauffeur, journal bloquant, 409 vide), échéances (famille `sortie_cvg`), garde socle front = back, libellés RGPD. Build Vite vert.

## 3. Ce qui reste hors logiciel

Le formulaire est un classeur Excel de Convergence : SOLIDATA en produit les valeurs et un PDF au même format, il ne remplit pas le fichier Excel du réseau (aucune trame numérique n'a été fournie — seulement un scan). Si Convergence transmet le classeur, un export XLSX cellule par cellule est une suite naturelle.

## 4. Arbitrages posés à la direction / au DPO

1. Effectifs de 1 et 2 transmis à Convergence **sans k-anonymat** (format du réseau) — à confirmer ; à défaut, appliquer le plancher 5 de la synthèse.
2. Transcodage proposé `sans_suite → sans nouvelles` et « sortie non documentée » → sans nouvelles : à valider par la CIP (la catégorie reste saisissable).
3. `numerique` non transmis (absent du référentiel Convergence).
4. La Partie 2 nomme les permanents : entrée art. 30 « reporting Convergence » à poser (données RH, base légale : intérêt légitime / convention).
5. *(Ajouté le 25/09/2026, correctifs de la revue de sécurité — rapport 33.)* **Frein judiciaire (art. 10 RGPD)** : transmettre ou non une donnée d'infraction à une association privée — non soumis à l'arbitrage dans la première version de ce contrat. En attendant la décision du DPO (base légale art. 46 LIL), il **n'est pas transmis** (`insertion.cvg_transmettre_justice` = `false`). Et, sur le point 1 : le document applique par défaut un seuil `insertion.cvg_k_min` = 5 (plancher de code 1), que seul le DPO peut abaisser.
