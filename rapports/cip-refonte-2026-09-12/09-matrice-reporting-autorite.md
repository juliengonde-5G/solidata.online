# Matrice de reporting opposable — avis de l'autorité sur le plan d'action

> **Auteur** : Fariza D'André, gestionnaire IAE (DDETS 76 / CD76), pour le dialogue de gestion ACI
> et l'instruction des dossiers FSE+ 2026-2027.
> **Objet** : vérifier que le plan d'action arrêté par la direction de Solidarité Textiles le
> 12/09/2026 (`07-plan-action.md`, lots 0 à 8, décisions du § 8) et l'organisation d'écrans prévue
> (`08-organisation-section-cip.md`) produisent **les pièces que je demanderai**.
> **Suite de** : `06-persona-autorite.md` (mes 33 exigences et mes 15 indicateurs).
> **Date** : 12 septembre 2026.
>
> **Portée de ce document** : il vaut engagement de ma part. Si les lots 0 à 6 sont livrés dans les
> termes ci-dessous, je considérerai le reporting de la structure comme **opposable** au dialogue de
> gestion et au contrôle de service fait. Les spécifications d'export du § 2 sont **dictées par
> moi** : elles priment sur toute interprétation ultérieure.
>
> **Ce que je ne peux pas sourcer** est marqué *« à confirmer sur la plateforme »*.

---

## 0. Avis sur le plan — trois lignes

Le plan répond **à l'essentiel de ce que j'ai demandé**, dans le bon ordre (PR A d'abord : le FSE+
est le seul volet où le retard est irrattrapable), et il ne cède pas à la tentation de tout refaire.
Les quatre décisions du § 8 sont **toutes tenables** de mon côté ; celle de rester **structure
d'accueil** me convient et simplifie mon contrôle (§ 3).

Deux découvertes du plan que je n'avais pas faites moi-même et que je retiens : le **Pass IAE n'est
saisissable nulle part** (ni écran, ni interface de modification) — ce qui rend inopérantes toutes
les alertes d'échéance dont on m'avait vanté le mécanisme ; et le **questionnaire FSE+ d'entrée est
la 13ᵉ rubrique sur 14** du diagnostic, c'est-à-dire celle que l'on saute. Ces deux points suffisent
à expliquer pourquoi je n'aurais rien pu contrôler.

Un refus et trois réserves subsistent (§ 4).

---

## 1. Matrice exigence → livrable prévu → verdict

**Verdicts** : **Couvert si livré** = la pièce que j'attends sortira de ce lot ; **Partiel** = la
brique est prévue mais il manque un élément que je nomme ; **Toujours absent** = rien dans le plan.
**Les références d'export** renvoient aux spécifications du § 2 : (a) FSE+ participants,
(b) bilan d'exécution, (c) feuille de temps, (d) tableau des freins, (e) synthèse de dialogue de
gestion, (f) fiche d'alimentation du référent.

### 1.1 Réforme du RSA et contrat d'engagement (A1-A6, C1-C7)

| Réf. | Lot / écran prévu | Verdict | Pièce attendue au bout |
|---|---|---|---|
| **A1** BRSA | 1.2 (`employees.brsa` + date) ; 1.6 (`nb_brsa` conservé à l'import ASP) | **Couvert si livré** | Colonne `BRSA` + `Date de constat BRSA` dans (a), (d), (e) ; ligne « Effectif BRSA (source ASP) » dans (e), trimestrielle |
| **A2** Orienteur / prescripteur / référent unique | 1.2 (trois champs distincts) ; onglet Cadre administratif 3.3 | **Couvert si livré** | Colonnes `Orienteur`, `Prescripteur habilité`, `Référent unique (type)`, `Référent unique (nom)` dans (d) ; ventilation agrégée dans (e), trimestrielle |
| **A3** Actualisation mensuelle FT | 3.5 (échéance périodique si référent = FT) | **Partiel — il manque la date** | Un booléen ne se contrôle pas. Je veux `Date de la dernière actualisation rappelée` et le **nombre de rappels non honorés** dans (e). Faible coût |
| **A4** Volume 15-20 h (temps CDDI inclus, décision 4) | 3.3 (`employee_week_hours` + accompagnement + PMSMP) ; alerte « semaine sous 15 h » | **Partiel — l'indicateur n'est pas le bon** | La moyenne ne m'intéresse pas : à 26 h contractuelles elle sera toujours au-dessus. Je veux le **nombre de semaines sous 15 h par personne** et la **part de personnes ayant connu au moins une semaine sous 15 h** dans (e) et (f) |
| **A5** Partenaires locaux (CMS, forums, job datings) | 6.4 (DORA sur l'action) ; référentiel partenaires existant | **Partiel** | Les **CMS de la métropole** au référentiel de partenaires, et une catégorie d'action `job_dating / relation entreprise`. Sans elle, aucun comptage n'est possible |
| **A6** Motifs légitimes d'absence | 3.4 (`presence`, `absence_motif` liste fermée, `absence_piece_ref`, relevé imprimable) | **Couvert si livré** | **Relevé d'assiduité individuel PDF**, produit à la demande, joignable à un dossier de conciliation. Liste fermée impérative : `sante`, `administratif`, `garde`, `transport`, `autre` — **jamais de texte médical** |
| **C1** Type d'entretien du contrat d'engagement | Décision 1 : pas de CER rédigé ; types `point_etape_referent` et `conciliation` | **Couvert autrement — j'accepte** | Voir § 3. Je contrôlerai la **trace de l'échange avec le référent**, pas le contrat |
| **C2** Diagnostic exploitable par le référent | 3.2 — fiche d'alimentation du référent | **Couvert si livré, sous condition de contenu** | Export (f), au format que je spécifie |
| **C3** Co-construction (origine « salarié ») | Existant, conservé | **Couvert (déjà)** | Rien à faire. Je le citerai en exemple |
| **C4** Engagements, présence aux RDV, changements de situation | 3.4 (présence/motif) ; notes de suivi existantes | **Couvert si livré** | Colonnes `RDV honorés / proposés` et `Absences non excusées` dans (f) |
| **C5** Aides mobilisées (mobilité, garde, transport) | 5.3 (champs nature / organisme / montant sur l'action) | **Couvert si livré** | Bloc « Aides mobilisées » dans (e) : nature, nombre, montant total. Le Département veut savoir ce que ses aides produisent |
| **C6** Durée, avenants, remise d'exemplaire | Sans objet (le contrat est tenu par le référent) | **Sans objet — j'en prends acte** | Je conserve l'exigence de **trace de remise** pour (f) et pour le PDF « Mon parcours en une page » |
| **C7** Conciliation | 3.1 (type `conciliation`) | **Couvert si livré** | Trace datée + relevé d'assiduité joint (A6) |

### 1.2 Plateforme de l'inclusion (P1-P5)

| Réf. | Lot / écran prévu | Verdict | Pièce attendue |
|---|---|---|---|
| **P1a** Critères d'éligibilité typés | 1.1 (référentiel `insertion_eligibilite_criteres` + `employee_eligibilite`, 15 valeurs seedées) | **Couvert si livré** | Typologie d'entrée par critère dans (e), annuelle. **Je fournis la liste de l'arrêté en vigueur** ; le seed proposé (BRSA, ASS, AAH, DELD, DETLD, −26, 50+, RQTH, QPV, ZRR, BPI, sortant de détention, parent isolé, sans domicile, autre) en est proche — *liste définitive à recaler sur l'arrêté* |
| **P1b** Pass IAE : saisie + statut + suspension | 0.5 (saisie enfin possible) ; 1.3 (statut + `insertion_pass_iae_evenements`) | **Couvert si livré** | Colonnes `N° Pass IAE`, `Fin de Pass`, `Statut du Pass` dans (d). **Le lot 0.5 est bloquant** : sans lui les trois autres exigences ne valent rien |
| **P1c** Justificatifs référencés, non dupliqués | 1.4 — table `insertion_pieces` avec upload | **Réserve — voir § 4.1** | Je maintiens : **référencer**, ne pas recopier ce qui vit sur la plateforme |
| **P1d** État de la candidature | Non retenu | **Toujours absent — sans conséquence** | Je ne le demande pas : la plateforme fait foi |
| **P2** Orientation DORA rattachée au frein | 6.4 (`dora_url`, `dora_service`, résultat) | **Couvert si livré** | Bloc « Freins → orientations → résultat » dans (e), semestriel |
| **P3** Convocation, rappel, présence | 3.4 (présence) ; 7.3 (rappels Brevo sur consentement) | **Couvert si livré** | Voir C4. Le **consentement tracé** est une condition, pas une option |
| **P4** Récapitulatif partageable (Mon Récap) | 7.2 | **Couvert si livré** | Confondu avec (f) dans mon usage — un seul document suffit |
| **P5** Marché de l'inclusion | Hors périmètre | **Sans objet** | — |

### 1.3 Performance départementale (S1-S7)

| Réf. | Lot / écran prévu | Verdict | Pièce attendue |
|---|---|---|---|
| **S1** PMSMP : nombre, durée, **débouché** | 6.4 (`insertion_pmsmp.debouche`) | **Couvert si livré** | Bloc PMSMP de (e) : conventions, jours, entreprises, **débouché (embauche / formation / aucun)**, semestriel |
| **S2** Freins identifiés → **levés** | 3.1 (tableau des deltas) ; 6.2 (entrée → dernière évaluation par axe) ; 6.3 | **Couvert si livré** | Bloc « Freins » de (e) : par axe, effectif concerné à l'entrée, **levés / stables / aggravés**, actions engagées, partenaire principal. **C'est l'indicateur central de la convention 2026-2027** |
| **S3** Cohorte du projet cofinancé | 2.1 (deux projets seedés : ASI 2026-2027, Postes CIP OCS 2026-2027) | **Couvert si livré** | Rattachement **daté et saisi**, jamais déduit du statut BRSA — le plan le dit, je l'approuve |
| **S4** Catégorie France Travail F/G | 1.2 (`ft_categorie` A-G + date) ; alerte « catégorie G > 30 j » | **Couvert si livré** | Ventilation par catégorie dans (e), trimestrielle ; la catégorie G est mon signal de dossier qui dort |
| **S5** FLE / frein linguistique | Existant (CECRL) ; catégorie d'action non listée | **Partiel** | Une catégorie d'action `formation FLE` pour le comptage |
| **S6** Job dating / relation entreprise | Non explicitement listé | **Partiel** | Voir A5 : deux valeurs de liste |
| **S7** Trajectoire immersion → emploi | 6.4 (rattachement immersion → sortie) | **Couvert si livré** | Ligne « PMSMP ayant donné lieu à une embauche chez l'accueillant » dans (e). C'est la phrase qui justifie un financement |

### 1.4 FSE+ (F1-F8)

| Réf. | Lot / écran prévu | Verdict | Pièce attendue |
|---|---|---|---|
| **F1** Rattachement au projet | 2.1 | **Couvert si livré** | Colonne `Projet` et `Date d'entrée dans le projet` dans (a) |
| **F2** Postes affectés au projet OCS | 2.1 + 4.4 | **Partiel — il manque deux choses** | La **quotité d'affectation** du poste au projet et le **taux forfaitaire retenu** (OCS). Sans eux, (c) ne se rattache à aucun plan de financement |
| **F3** Feuilles de temps par projet | 4.4 (composée, rapprochée des congés, double validation) | **Couvert si livré** | Export (c), mensuel, **signé intervenant + RH**. Le rapprochement automatique avec `employee_leaves` est exactement ce qui me fait écarter des dépenses ailleurs : bonne idée |
| **F4** Bilan d'exécution composable | 2.6 | **Couvert si livré** | Export (b), à chaque bilan intermédiaire et au solde |
| **F5** Éligibilité à l'entrée, sortie, **+6 mois** | 0.3 (jalon à +6 mois, `post_sortie_mois` défaut 6) ; 2.2 ; 2.5 | **Couvert si livré** | Colonnes `Situation à +6 mois` et `Date du relevé à +6 mois` dans (a). Le maintien du +3 mois en facultatif est une bonne pratique d'accompagnement : gardez-le pour vous, il ne m'est pas destiné |
| **F6** Questionnaire d'entrée dès l'arrivée | 2.2 (typé, complétude) ; socle J+30, **rubrique 2 sur 7** | **Couvert si livré** | La remontée en 2ᵉ position règle le défaut de fond. *Items définitifs à confirmer sur la plateforme* — je fournis la maquette |
| **F7** Sortie saisie dans le mois | 2.3 (écran de sortie, **saisie possible sans bilan**) ; 2.4 (alerte J+15 / J+25, non acquittable) | **Couvert si livré** | Colonnes `Date de sortie`, `Date de saisie de la sortie`, `Délai de saisie (jours)` dans (a). **La saisie possible sans bilan est le point décisif** : c'est précisément la personne partie sans entretien qui bloquait vos bilans |
| **F8** Bilan + taux de complétude | 2.5 (dossier de conformité, 9 pièces) ; 2.6 | **Couvert si livré** | Taux de complétude par projet dans (b), et liste nominative des dossiers incomplets à usage interne |

### 1.5 Mes 15 indicateurs (§ 4 du rapport 06)

| # | Indicateur | Lot / écran | Verdict | Forme et fréquence retenues |
|---|---|---|---|---|
| 1 | Typologie par critère d'éligibilité | 1.1 → 6.2 | **Couvert si livré** | Agrégat, effectifs bruts + part — (e), annuel |
| 2 | Effectif BRSA et part | 1.2 + 1.6 → 6.2 | **Couvert si livré** | Agrégat + chiffre ASP en référence — (e), trimestriel |
| 3 | Catégorie France Travail | 1.2 → 6.2 | **Couvert si livré** | Agrégat — (e), trimestriel |
| 4 | Référent unique (structure / CMS / FT / non déterminé) | 1.2 → 6.2 | **Couvert si livré** | Agrégat — (e), trimestriel. Voir § 3 |
| 5 | Contrat d'engagement : signés, volume, points d'étape | Décision 1 | **Hors périmètre de la structure** | Je l'obtiendrai du référent. Je demande à la structure les **points d'étape tenus avec le référent** — (e), trimestriel |
| 6 | Volume hebdomadaire d'activité | 3.3 | **Partiel** | Voir A4 : **semaines sous 15 h**, pas la moyenne — (e) et (f) |
| 7 | PMSMP + débouché | 6.4 | **Couvert si livré** | Agrégat + liste anonymisée des entreprises — (e), semestriel |
| 8 | Freins identifiés → levés | 6.2 / 6.3 | **Couvert si livré** | Agrégat par axe — (e), semestriel |
| 9 | Sorties à +6 mois | 0.3 + 2.2 | **Couvert si livré** | Agrégat + (a) importable — semestriel |
| 10 | Complétude MDFSE+ | 2.5 / 2.6 | **Couvert si livré** | Taux + liste des dossiers incomplets — **mensuel** |
| 11 | Feuilles de temps par projet | 4.4 | **Couvert si livré** | (c), mensuel, signé |
| 12 | Ruptures de droits évitées | 3.5 + 3.4 | **Partiel** | Il manque un compteur : actualisations rappelées, motifs légitimes documentés, conciliations — (e), trimestriel |
| 13 | Cohorte ASI | 2.1 | **Couvert si livré** | (a) nominatif réservé au contrôle, (b) agrégé — semestriel |
| 14 | Heures d'accompagnement | 4.1 / 4.2 | **Couvert si livré** | Agrégat + moyenne par personne — (e), annuel. **Tient enfin la promesse faite aux certificateurs** |
| 15 | Sorties non documentées | 6.1 | **Couvert si livré** | Valeur absolue — (e), annuel. C'est un indicateur de qualité, pas une faute |

**Bilan de la matrice** : sur 33 exigences — **23 couvertes si livrées**, **8 partielles** (A3, A4, A5, C4 partiellement, P1c en réserve, S5, S6, F2), **1 sans conséquence** (P1d), **1 sans objet**
(P5). Sur 15 indicateurs — **11 couverts si livrés**, **3 partiels** (6, 12, et 5 hors périmètre),
**0 absent**. C'est un plan qui répond.

---

## 2. Spécification des exports que je recevrai

Règles **communes et impératives** à tous les exports ci-dessous :

- **En-tête de traçabilité**, en première feuille (tableur) ou en première ligne (CSV) : `Export`,
  `Généré le` (date et heure), `Généré par` (compte), `Périmètre` (filtres appliqués en toutes
  lettres), `Nombre de lignes`, `Version de l'outil`, et la mention
  « **Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion
  Facilitée, Ma Démarche FSE+) font foi** ».
- **Zéro ligne → refus explicite**, jamais un fichier vide (lot 0.1). Un export qui échoue en
  silence est pire qu'un export absent.
- **Un intitulé de colonne en français par colonne.** Aucun contenu technique dans une cellule,
  aucune fusion, aucune couleur porteuse de sens, une seule ligne d'en-tête.
- **Toute génération nominative est journalisée** (`rgpd_audit_log`), et un échec d'écriture du
  journal fait échouer l'export.
- **Champ non renseigné = cellule vide**, jamais un zéro ni une valeur par défaut.
- **Exclusions absolues dans tout export qui sort de la structure** : frein santé et son détail,
  frein judiciaire sous toute forme, commentaire de santé, commentaire de budget, contre-indications,
  suivi médical, note de profil, contenu PCM, notes de suivi.

### (a) Export FSE+ participants — `fse-participants_<projet>_<AAAA>_T<n>.csv`

**Fréquence** : trimestriel, et à toute demande de bilan. **Habilitation** : ADMIN/RH.
**Périmètre** : les participants rattachés au projet, un par ligne. **Signataire** : néant (fichier
de données) — c'est (b) qui est signé.

| # | Colonne | Règle |
|---|---|---|
| 1 | Identifiant interne | Clé de rapprochement avec vos dossiers |
| 2 | NOM | Nom de famille en majuscules |
| 3 | Prénom | |
| 4 | Date de naissance | AAAA-MM-JJ |
| 5 | Sexe | |
| 6 | Commune de résidence | Pas l'adresse complète |
| 7 | Projet | `ASI 2026-2027` / `Postes CIP OCS 2026-2027` |
| 8 | Date d'entrée dans le projet | Saisie, jamais déduite |
| 9 | Date de sortie du projet | |
| 10 | Critères d'éligibilité IAE | Codes séparés par virgule, issus du référentiel |
| 11 | BRSA | Oui / Non / Non renseigné |
| 12 | Catégorie France Travail | A à G |
| 13 | Référent unique (type) | Structure / CMS / France Travail / Autre |
| 14 | Date d'entrée en parcours | 1er CDDI |
| 15 | Date de fin de contrat | |
| 16-20 | **Questionnaire d'entrée** : Situation avant l'entrée · Durée sans emploi · Niveau d'instruction · Foyer monoparental · Sans domicile stable | **Une colonne par item**, jamais de JSON. *Items définitifs à confirmer sur la plateforme* |
| 21 | Date de recueil du questionnaire d'entrée | Permet de vérifier qu'il précède ou accompagne l'entrée |
| 22 | Complétude du questionnaire d'entrée (%) | |
| 23 | Date de sortie de l'opération | |
| 24 | **Situation à la sortie** | Emploi durable / Emploi de transition / Formation / Inactivité / Autre / Non renseignée |
| 25 | Date de saisie de la sortie | |
| 26 | **Délai de saisie (jours)** | Colonne 25 − colonne 23. **C'est la colonne que je regarde en premier** |
| 27 | Situation à +6 mois | Emploi / Formation / Inactivité / Injoignable / Non relevée |
| 28 | Date du relevé à +6 mois | |
| 29 | Complétude du dossier participant (%) | Sur les 9 pièces du dossier de conformité |

**Exclusions** : aucun frein, aucune donnée de santé — la **reconnaissance de travailleur handicapé
n'apparaît que comme code d'éligibilité en colonne 10**, jamais comme information médicale.
*À confirmer sur la plateforme* : si l'opération « Postes CIP OCS » est déclarée avec participants,
les colonnes 16 à 29 s'y appliquent à l'identique ; sinon seules 1 à 15 sont attendues.

### (b) Bilan d'exécution agrégé — `fse-bilan-execution_<projet>_<periode>.pdf`

**Fréquence** : à chaque bilan intermédiaire et au solde. **Habilitation** : ADMIN/RH.
**Signataire** : **la direction** (nom, qualité, date, signature). **Strictement non nominatif.**

Sections imposées : 1. Identification (projet, convention, période, cofinanceurs) · 2. Participants
(entrés, sortis, présents en fin de période, par sexe, par tranche d'âge, par critère d'éligibilité,
part BRSA) · 3. Indicateurs d'entrée (distribution de chacun des items) · 4. Indicateurs de sortie
(par situation, **et la ligne « sortie non renseignée »**) · 5. Indicateurs de résultat à +6 mois
(**et la ligne « non relevée »**) · 6. **Taux de complétude** par pièce du dossier, avec le nombre
de dossiers incomplets · 7. Moyens (postes affectés, quotité, feuilles de temps validées / dues) ·
8. Méthode de calcul de chaque taux, écrite.

### (c) Feuille de temps — `temps_<nom-intervenant>_<AAAA-MM>.pdf` + `.csv`

**Fréquence** : mensuelle, close au 10 du mois suivant. **Habilitation** : ADMIN/RH ; chaque
intervenant voit la sienne. **Signataires** : **l'intervenant puis la RH**, horodatés.

Une ligne par jour travaillé : Date · Projet (`ASI` / `OCS` / `Hors projet`) · Activité
(entretien / action / atelier collectif / réunion de projet) · Bénéficiaire concerné (identifiant
interne, **jamais le nom en clair dans la version transmise**) · Durée en minutes · Origine
(composée automatiquement / saisie manuelle). Puis un pied : total mensuel, total par projet,
**quotité d'affectation au projet**, **taux forfaitaire appliqué**, et une ligne
« **Cohérence avec les congés : conforme / à expliquer** » avec le détail des jours en anomalie.

**Ce qui me fait écarter la dépense** : une signature manquante ; une journée renseignée un jour
d'absence ; un total mensuel supérieur au temps de travail contractuel ; l'absence de la ligne de
cohérence.

### (d) Tableau des freins enrichi — `insertion_freins_<AAAA-MM-JJ>.xlsx`

**Fréquence** : annuelle, et à la demande en contrôle sur place. **Habilitation** : ADMIN/RH.
**Ne sort de la structure que sous la forme agrégée (e)** — la version nominative se consulte sur
place. **Conserver intégralement** les 23 colonnes actuelles, la feuille « Informations » et la
règle de valorisation imprimée, qui sont bonnes. **Ajouter** :

`BRSA` · `Date de constat BRSA` · `Catégorie France Travail` · `Critères d'éligibilité IAE` ·
`Statut du Pass IAE` · `Référent unique (type)` · `Référent unique (nom)` · `Projet cofinancé` ·
`Prescripteur habilité` · et, **par axe de frein**, la valeur d'**entrée** à côté de la valeur
courante plus une colonne `Évolution` (levé / stable / aggravé / non évalué).

**Corriger** l'intitulé de la colonne 5 : « Heures par semaine **(quotité contractuelle)** » — ce
n'est pas l'activité constatée. **Ajouter** en regard : `Semaines sous 15 h (année)`.
**Le frein judiciaire reste exclu par défaut** ; sa variante demeure réservée, journalisée
distinctement, et **ne m'est jamais transmise**.

### (e) Synthèse de dialogue de gestion — `dialogue-gestion_<AAAA>.pdf` + `.csv`

**Fréquence** : annuelle (transmise **15 jours avant la séance**), plus une version trimestrielle
allégée pour les blocs 2 et 8. **Habilitation** : ADMIN/RH/MANAGER. **Signataire** : la direction.
**Strictement non nominatif**, agrégats seuls.

| Bloc | Contenu imposé |
|---|---|
| 1. Effectifs et ETP | **ETP ASP validé en premier** (base 1 820 h), mois par mois ; ETP de contrôle ERP **en second, nommé « effectif pondéré »** ; ETP conventionné de l'annexe ; taux de réalisation. **Une seule base dans ce document** |
| 2. Publics à l'entrée | Par **critère d'éligibilité**, effectifs bruts et part ; **BRSA** (dont chiffre ASP) ; **catégorie FT** ; **référent unique** ; sexe, tranches d'âge, niveaux de formation |
| 3. Freins | Par axe : concernés à l'entrée · **levés / stables / aggravés** · actions engagées · partenaire principal · orientations DORA et leur résultat |
| 4. Accompagnement | Entretiens réalisés / échus par type · **heures d'accompagnement** totales et moyenne par personne · délai moyen du diagnostic · aides mobilisées (nature, nombre, montant) |
| 5. Immersions | PMSMP : conventions, jours, entreprises · **débouché** · **dont embauche chez l'accueillant** |
| 6. Sorties | **Dénominateur = toutes les fins de parcours de la période**, ligne « **sortie non documentée** » apparente · par catégorie officielle · taux vs cibles · **et, pour 2026 seulement, les deux méthodes imprimées côte à côte** · rapprochement avec les sorties déclarées à l'ASP |
| 7. Résultats | Situation à +6 mois · satisfaction de sortie (agrégat) |
| 8. Conformité | Complétude FSE+ par projet · points d'étape tenus avec les référents · actualisations FT rappelées · semaines sous 15 h · conciliations |
| 9. Méthode | La règle de calcul de **chaque** taux, en toutes lettres, et la mention « objectif non paramétré » là où la cible n'est pas connue |

### (f) Fiche d'alimentation du référent externe — `alimentation-referent_<identifiant>_<AAAA-MM-JJ>.pdf`

**C'est le document le plus sensible de la liste**, parce qu'il **sort de la structure vers un
tiers** (CMS ou France Travail). **Fréquence** : à chaque point d'étape (défaut : trimestriel) et à
toute demande du référent. **Habilitation** : ADMIN/RH. **Signataire** : la conseillère, avec date.
**Remise tracée**, et **un exemplaire remis à la personne**.

Contenu **limitatif** — ce qui n'est pas dans cette liste n'y figure pas :

1. Identité, identifiant interne, référent unique destinataire, période couverte.
2. **Situation d'emploi** : type de contrat, dates, quotité contractuelle, fin prévue.
3. **Activité réalisée** : heures travaillées par semaine sur la période, heures d'accompagnement,
   jours de PMSMP — et le **nombre de semaines sous 15 h**, avec la raison catégorisée.
4. **Assiduité** : rendez-vous proposés / honorés, absences **par motif catégorisé**
   (santé / administratif / garde / transport / autre) — **jamais la nature médicale, jamais une
   pièce de santé**.
5. **Freins** : uniquement les axes **mobilité, administratif, financier, logement, linguistique,
   famille, numérique**, en niveau et évolution. **Santé et judiciaire : exclus, sans mention de
   leur exclusion** (mentionner l'exclusion, c'est encore désigner).
6. **Actions engagées** : nature, partenaire, orientation DORA, résultat.
7. **Objectifs en cours**, avec leur origine (salarié / conseillère).
8. Prochain rendez-vous, prochaine échéance de contrat, contact de la conseillère.

**Base légale et information** : la transmission d'informations nominatives à un référent externe
est un traitement à part entière. Je demande qu'elle soit **inscrite au registre**, **portée à la
note d'information** remise au salarié, et que la fiche porte en pied de page la mention des droits
de la personne. *Point à faire trancher par votre délégué à la protection des données* : selon que
la transmission s'appuie sur la mission d'intérêt public du dispositif ou sur l'accord de la
personne, la conduite à tenir en cas de refus diffère. **Je ne demanderai jamais cette fiche
directement à la structure** : elle appartient au référent.

---

## 3. Conséquence de la décision « structure d'accueil »

La direction a tranché : Solidarité Textiles **n'est pas référent unique** ; le contrat
d'engagement est tenu par le CMS ou par France Travail. **Cette décision me convient**, et je veux
qu'elle soit comprise pour ce qu'elle est : elle **réduit vos obligations** et **déplace mon
contrôle**, elle ne les supprime pas.

**Ce que je ne vous demanderai plus** : le contrat d'engagement lui-même, son contenu, ses avenants,
sa signature, le respect formel des 15-20 h au sens du contrat, les décisions de suspension. Tout
cela relève du référent, et je l'obtiendrai de lui. Le plan a raison de supprimer le gabarit de
contrat : **un contrat rédigé en double est un contrat qui diverge**.

**Ce que je vous demanderai à la place**, et sur quoi je serai exigeante :

1. **Que vous sachiez, pour chaque salarié BRSA, qui est son référent** — type, nom, contact, à
   jour. Une structure d'accueil qui ne sait pas à qui parler ne peut pas alimenter qui que ce soit.
   C'est l'indicateur n° 4, et je le veux à 100 % pour les BRSA : un « non déterminé » est un
   signalement à faire au Département, pas une case vide.
2. **Que vous alimentiez ce référent, et que vous le prouviez.** La preuve que j'accepte est la
   **fiche d'alimentation (f) datée et sa trace de remise**, ou l'entretien de type
   `point_etape_referent` renseigné. Fréquence attendue : **au moins trimestrielle**, et sans délai
   en cas d'événement significatif (arrêt, rupture, entrée en formation, changement d'adresse).
   L'indicateur que je suivrai est : **points d'étape tenus / dus**.
3. **Que vous documentiez l'assiduité et les motifs légitimes.** C'est là que la décision change le
   plus les choses. Vous n'êtes pas décisionnaire d'une suspension, mais **vous êtes le seul témoin
   des faits**. Si un référent engage une procédure et que la seule pièce disponible est votre
   relevé d'assiduité, ce relevé fait la différence. Je le demanderai en contrôle sur place, et je
   recommande à vos conseillères de le produire **spontanément** au référent dès qu'une absence
   répétée apparaît. Liste fermée de motifs, pièce référencée, aucune donnée médicale.
4. **Que vous teniez le compteur d'activité hebdomadaire**, temps de travail CDDI inclus
   (décision 4). Le référent en a besoin pour justifier le volume d'activité de la personne, et il
   ne peut le tenir que de vous. **L'indicateur utile est le nombre de semaines sous 15 h**, pas la
   moyenne : à 26 heures contractuelles, la moyenne sera toujours confortable et ne dira rien.
   L'alerte prévue est bien placée.
5. **Que vous traciez l'actualisation mensuelle** pour les salariés dont le référent est France
   Travail. Ce n'est pas votre obligation, c'est celle de la personne — mais un oubli lui coûte ses
   droits, et vous êtes la seule à la voir toutes les semaines. Un rappel tracé est une protection.

**Ce qui reste inchangé** : la décision n'a **aucun effet** sur le volet FSE+, sur le
conventionnement ACI, ni sur mes exports (a) à (e). Elle ne porte que sur le volet RSA.

---

## 4. Ce que je refuse encore, et mes cinq conditions

### 4.1 Un refus

**Le dépôt des justificatifs d'éligibilité dans l'outil (lot 1.4) — je maintiens mon objection.**
Le plan prévoit une table de pièces jointes couvrant « éligibilité / CER signé / entretien signé /
autre ». J'ai validé, dans mon rapport 06, le choix inverse : **référencer** les justificatifs
d'éligibilité sans les recopier, parce qu'ils vivent sur la plateforme des emplois de l'inclusion,
et qu'une seconde copie est une seconde version qui peut diverger — plus une surface de risque
supplémentaire pour des pièces qui contiennent souvent bien plus que le critère qu'elles prouvent
(une notification de droits porte des informations de ressources, parfois de santé).

**Ce que j'accepte dans ce lot** : le dépôt des pièces **que la plateforme ne conserve pas** —
l'exemplaire signé d'un entretien, une convention de PMSMP, un accusé de remise. Ce sont des pièces
dont vous êtes la seule dépositaire, et leur absence est justement la jambe manquante de votre
« faisceau de preuve » (RES-03). **Conditions** : servies authentifiées, jamais sous un dossier
statique, consultation journalisée, purgées à l'anonymisation.

### 4.2 Trois réserves

1. **F2 — l'affectation des postes au projet OCS est incomplète.** Sans quotité d'affectation ni
   taux forfaitaire, la feuille de temps ne se raccorde à aucun plan de financement. Deux champs.
2. **A3 et A4 — deux indicateurs mal formés** : un booléen d'actualisation sans date ne se contrôle
   pas ; une moyenne d'heures hebdomadaires ne dit rien. Corrections nommées au § 1.1.
3. **La charge de la conseillère.** Le plan reconnaît lui-même (§ 7) que les obligations nouvelles
   excèdent ce que l'outil peut économiser, à 0,86 ETP pour environ 46 accompagnements. **Je ne peux
   pas exiger un reporting que personne n'a le temps de saisir.** Je note que le renforcement des
   postes de conseiller est précisément l'objet de l'appel à projets 2026-2027 : je soutiendrai une
   demande argumentée, chiffrée sur les heures d'accompagnement que l'indicateur n° 14 produira.
   **C'est le seul sujet de ce dossier où c'est moi qui vous dois quelque chose.**

### 4.3 Mes cinq conditions pour la présentation de l'outil (lot 8)

Je viendrai. Une heure suffira si ces cinq conditions sont remplies — et je préfère une
démonstration ratée et honnête à une démonstration répétée.

1. **Tirez un dossier au hasard devant moi et imprimez-le en entier, en moins de cinq minutes.**
   C'est moi qui désigne le dossier. Si cela prend un quart d'heure, le reste ne m'intéresse pas.
2. **Corrigez devant moi un entretien déjà clôturé.** Je veux voir la réouverture, le motif, la
   trace, ce que devient la version antérieure, et le fait que les validations tombent. **Si cette
   démonstration se passe bien, elle vaut tout le reste de la présentation.**
3. **Montrez-moi la matrice « qui voit quoi » sur une page**, puis prouvez-la : connectez-vous
   devant moi avec un compte d'encadrant technique et montrez-moi que les volets santé, judiciaire
   et budget sont **absents de l'écran**, pas simplement grisés.
4. **Générez devant moi l'export (a) et l'export (e)**, et montrez-moi dans le journal la ligne que
   cette génération vient d'écrire. Puis **provoquez un export vide** et montrez-moi qu'il est
   refusé avec un motif.
5. **Apportez les pièces hors logiciel** : l'analyse d'impact validée par votre délégué à la
   protection des données, la trace de la consultation des représentants du personnel, la note
   d'information remise aux salariés dans sa version diffusée avec sa trace de remise. **Ce sont les
   seules lignes de ce dossier sur lesquelles je n'ai aucune marge d'appréciation**, et leur absence
   me ferait écrire une non-conformité quelle que soit la qualité de l'outil.

**Ce que je fournirai de mon côté, avant la présentation** : la maquette du questionnaire
participant MDFSE+ en vigueur, la liste des critères d'éligibilité de l'arrêté applicable, les
cibles conventionnelles de l'annexe financière, et la table des codes motifs de sortie ASP.

---

*Fariza D'André — 12 septembre 2026. Document de travail interne au chantier
`cip-refonte-2026-09-12`. Aucune donnée nominative. Les spécifications du § 2 valent cahier des
charges de mes attentes ; les points marqués « à confirmer sur la plateforme » seront levés par la
transmission des maquettes annoncées.*
