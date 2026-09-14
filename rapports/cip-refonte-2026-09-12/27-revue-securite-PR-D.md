# PR D « Reporting autorité et présentation » — revue de sécurité et de conformité RGPD

> **Agent de sécurité (lecture seule)** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq-pr-d`, HEAD `07a5ba8`, périmètre
> `git diff 892679c~1..HEAD` hors `docs/` (41 fichiers, +6 965 / −303 lignes ; les suites
> `backend/tests/e2e-pr-d/` de l'agent debug sont hors périmètre).
> **Références opposables** : contrat `25-contrats-techniques-PR-D.md` (§ 2 doctrines, § 3, § 5, § 6, § 8),
> matrice de l'autorité `09-matrice-reporting-autorite.md` (§ 2 règles communes, (d) et (e)),
> rapport de lot `26-realisation-lot6.md`, revues PR A `12-`, PR B `17-`, PR C `22-` (même grille,
> mêmes catégories), `CLAUDE.md` modules 5 / 12 / 14 / 32 et § 7-8.
> **Aucun fichier de code modifié, aucune commande git.** Chaque constat porte un fichier:ligne et,
> quand c'est possible, une REPRODUCTION exécutée (scripts jetables hors dépôt, `pg` simulé par
> l'aiguillage du lot lui-même, ou fonction réelle appelée telle quelle). Les 5 suites Jest du
> chantier ont été rejouées : **118 tests verts** — les constats ci-dessous sont donc, par
> construction, ce que ces tests ne couvrent pas.
> **Date** : 14 septembre 2026.

---

## 0. Verdict

**CONFORME SOUS RÉSERVE** — **3 constats BLOQUANTS**, **7 MAJEURS**, **13 MINEURS**.

Le lot tient sa promesse la plus difficile : `services/sorties-engine.js` est un moteur réellement
PUR, la règle du dénominateur y vit **une seule fois**, elle ne divise jamais par zéro, elle rend
`null` là où un 0 % mentirait, elle NOMME les deux écarts qui expliquent la différence entre les
deux méthodes (`bilans_sans_fin_parcours`, `hors_nomenclature`) et elle écrit ses propres règles en
français dans `regles`, que le bloc 9 imprime telles quelles. `composerBlocsInternes`
(`dialogue-gestion.js:1192`) est la bonne décision d'architecture : l'écran de pilotage et le
document signé passent par les **mêmes fonctions**, ils ne peuvent pas se contredire. La migration
est idempotente, ses CHECK sont posés par DO-scan, `job_dating` n'est pas perdu dans la
reconstruction, le seed CMS ne crée pas un doublon. La route `/reporting` fait `pool.connect()`
**dans** le `try` (`reporting.js:220`), déclare `historique` **avant** `/:id`, journalise la
génération **dans la transaction** du snapshot, et le refus du POST est posé par `authorize` avant
tout validateur. Les cinq codes RGPD ont leur libellé et la garde anti-dérive est verte. Le PDF
échappe tout (`esc`), n'ouvre aucune boîte native, et se compose **exclusivement** depuis `contenu`
— ce qui est la seule façon de rejouer ce qui est parti.

**Ce qui bloque tient en trois phrases, et les trois ont été reproduites.**

1. **Le k-anonymat ne couvre que deux blocs sur huit.** Il est appliqué au bloc 2, au bloc 3 et à
   deux champs du bloc 5 ; il est **absent** des blocs 4, 6, 7, 8 et du reste du bloc 5. Le document
   transmis à l'autorité publie donc, tel quel : la **raison sociale de l'unique entreprise d'accueil**
   d'une période à une seule immersion, le **montant exact** d'une aide financière d'urgence unique,
   le **nom du partenaire principal** d'un axe portant une seule action, « 1 entretien de
   conciliation », « 1 sortie en emploi durable » — pendant que la ligne voisine, elle, est
   supprimée. Et parce que l'effectif brut est publié et que les ventilations somment à cet
   effectif, **une case supprimée se retrouve par soustraction** — `sous_seuil` désignant
   obligeamment laquelle.
2. **Les statuts sociaux réservés ADMIN/RH reviennent au MANAGER par `/insertion/audit`.**
   `gatherAuditKpis` verse `publics_entree` — BRSA, catégorie France Travail, référent unique,
   critères d'éligibilité (dont « Travailleur handicapé ») — dans une réponse servie à
   ADMIN/RH/**MANAGER**, **sans aucune suppression** puisque le chemin interne passe `k = identité`.
   Sur une période à une seule personne, l'encadrant lit `brsa: 1` et « RQTH (1) ».
3. **Les trois champs libres que la PR D ajoute à une action CIP échappent au masquage de l'axe
   santé.** `ACTIONS_TEXTE_LIBRE` vaut toujours `['notes', 'resultat']` : pour un MANAGER, sur une
   action de l'axe santé, `notes` disparaît et `dora_service` = « CSAPA de Rouen — addictologie »
   reste.

Aucun des trois ne relève d'une négligence. Le premier est une règle appliquée là où on pensait à
elle et pas là où on n'y pensait pas — et les tests du lot ne l'exercent que sur les deux blocs où
elle est appliquée. Le deuxième est le prix d'une mutualisation par ailleurs juste : l'écran interne
et le document partagent leurs fonctions, et c'est la **projection par rôle** qui manquait à la
frontière. Le troisième est un dictionnaire de masquage non tenu à jour — exactement la famille du
`SELECT im.*` de la PR C. Les correctifs tiennent chacun en quelques lignes.

---

## 1. Constats BLOQUANTS

### B-01 — Le k-anonymat ne couvre que deux blocs sur huit : le document (e) désigne des personnes

**Fichier** : `backend/src/services/dialogue-gestion.js`.
**Règle opposable** : contrat § 2.2 — « **k-anonymat** : tout agrégat portant sur moins de **5
personnes** est rendu `null` avec `sous_seuil: true` — sauf les effectifs bruts globaux d'un bloc » ;
matrice § 2 (e) « **Strictement non nominatif**, agrégats seuls ».

**Couverture réelle de `k()`**, relevée ligne à ligne :

| Bloc | Agrégats protégés | Agrégats publiés BRUTS |
|---|---|---|
| 2 Publics | `par_critere_eligibilite.n`, `brsa.n`, `par_categorie_ft`, `par_referent_unique`, `sexe`, `tranches_age`, `niveaux_formation` | `effectif` (exception déclarée), `brsa.n_asp` |
| 3 Freins | `concernes_entree`, `leves`, `stables`, `aggraves`, `non_evalues` (`:528-532`) | **`actions_engagees`**, **`partenaire_principal`**, **`orientations_dora`**, **`dora_resultats.*`** (`:533-541`), `nb_dossiers` |
| 4 Accompagnement | *aucun* — `k` n'est même pas passé à `bloc4Accompagnement` (`:1044`) | **`aides_mobilisees[].n`**, **`aides_mobilisees[].montant_total`**, `entretiens[].realises/echus`, `heures_accompagnement.nb_personnes` |
| 5 Immersions | `par_debouche`, `embauches_chez_accueillant` (`:670-674`) | **`conventions`**, **`jours`**, **`entreprises_distinctes`**, **`liste_entreprises`** |
| 6 Sorties | *aucun* — `bloc6Sorties` ne reçoit pas `k` (`:1045`) | **`par_classification.*`**, `documentees`, `par_type`, `rapprochement_asp.*` |
| 7 Résultats | `situation_6_mois`, `satisfaction.moyenne_globale` | `nb_sorties_suivies`, `satisfaction.nb_reponses` |
| 8 Conformité | `semaines_sous_15h.nb_personnes_concernees` seulement (`:840`) | **`conciliations`**, `points_etape_referent`, `fiches_referent_transmises`, `actualisations_ft_rappelees`, `nb_semaines`, `ruptures_droits_evitees.*`, `completude_fse_par_projet[].participants` |

#### Vecteur 1 — publication directe d'agrégats à une personne

**Reproduction** (cohorte de 46, période à une seule immersion, une seule aide chiffrée, une seule
action sur l'axe santé, une conciliation — `composerDialogueGestion` appelée telle quelle) :

```
cohorte = 46 personnes ; k = 5

--- bloc 4 « Accompagnement » (aides mobilisées) ---
 { "nature": "financiere_urgence", "label": "Aide financière d'urgence",
   "n": 1, "montant_total": 340, "nb_montants_saisis": 1 }

--- bloc 5 « Immersions » ---
 { conventions: 1, jours: 12, entreprises_distinctes: 1,
   liste_entreprises: [ 'GARAGE MARTIN SARL (Darnétal)' ],
   par_debouche_embauche: null,          ← supprimé par le k-anonymat
   embauches_chez_accueillant: null }    ← supprimé par le k-anonymat

--- bloc 3 « Freins » — axe santé ---
 { actions_engagees: 1, partenaire_principal: 'CMS de Darnétal — Mme R.',
   orientations_dora: 1, dora_resultats: { pris_en_charge: 1, … } }

--- bloc 8 « Conformité » ---
 { conciliations: 1, … }

--- agrégats déclarés « sous seuil » ---
 blocs.5_immersions.par_debouche.embauche_accueillant
 blocs.5_immersions.embauches_chez_accueillant
 blocs.8_conformite.semaines_sous_15h.nb_personnes_concernees
```

La suppression est **cosmétique** : le document cache « dont embauche chez l'accueillant » et publie
dans le même bloc, deux lignes plus haut, **le nom de l'unique entreprise** qui a accueilli l'unique
immersion, et sa **durée exacte**. Ces trois lignes traversent le CSV
(`aplatirEnLignes`, `:1108-1115`) et le PDF (`pdf-dialogue-gestion.js:208-216`).

**Pourquoi ce sont bien des ré-identifications, et pas une précaution théorique.** Le destinataire
n'est pas un tiers quelconque : c'est **le Département et la DDETS**. Le CD76 finance les aides
(FSL, aide financière d'urgence) — un montant unique de 340 € se retrouve dans **ses propres
dossiers**. Le CD76 pilote les CMS — « axe santé, 1 action, partenaire *CMS de Darnétal — Mme R.*,
résultat : prise en charge » désigne un dossier dans un service qu'il administre, et le champ
`insertion_partenaires.nom` est libre : la conseillère y a écrit un nom de personne. Les immersions
sont déclarées à Immersion Facilitée — l'entreprise d'accueil est une clé de jointure.
« 1 entretien de conciliation » dit qu'une personne a fait l'objet d'une procédure contradictoire de
protection des droits dans le cadre RSA.

**Aggravant** : la **version trimestrielle** ne compose que les blocs 2 et 8 (`:1042-1049`), donc les
deux blocs les plus identifiants, sur une **cohorte trimestrielle** — quatre fois par an.

#### Vecteur 2 — reconstitution par complément

`effectif` est publié brut (exception déclarée) et **toutes** les ventilations du bloc 2 y somment.
Une seule case supprimée par distribution se retrouve donc par soustraction, et `sous_seuil` NOMME
la case à retrouver.

**Reproduction** (43 personnes, dont 2 femmes BRSA en catégorie G avec référent CMS) :

```
effectif publié : 43
sexe           : {"F":null,"M":41,"non_renseigne":0}
catégorie FT   : {"A":41,"B":0,…,"G":null,"non_renseignee":0}
BRSA           : {"n":null,"part_pct":null,"n_asp":null}

sous_seuil :
  · blocs.2_publics_entree.brsa.n
  · blocs.2_publics_entree.par_categorie_ft.G
  · blocs.2_publics_entree.par_referent_unique.cms
  · blocs.2_publics_entree.sexe.F

RECONSTITUTION : 43 − 41 = 2 → la case « F » supprimée valait 2
```

Les quatre suppressions portant sur les **mêmes deux personnes**, le lecteur apprend par
arithmétique élémentaire que *les deux femmes de la cohorte sont BRSA, en catégorie France Travail
G, suivies par un CMS*. Sur 43 personnes dont 2 femmes, c'est une désignation.

**Ce que le document affirme pendant ce temps.** Pied de page du PDF
(`pdf-dialogue-gestion.js:311-313`) : « **Aucune donnée permettant d'identifier une personne
accompagnée ne figure dans ce document** », au-dessus de « Signataire : la direction ». L'écran
(`DialogueGestionPanel.jsx:191-193`) répète « Strictement non nominatif ». Une affirmation signée
que les deux reproductions ci-dessus contredisent.

**Pourquoi les tests ne l'ont pas vu.** `dialogue-gestion.test.js:139` et
`insertion-reporting-contract.test.js:216` n'exercent le k-anonymat que sur
`blocs.2_publics_entree.par_categorie_ft` et `blocs.3_freins.par_axe.mobilite.leves` — les deux
seuls blocs où il est appliqué. La contre-épreuve n° 1 du lot (« k-anonymat retiré → 11 tests
tombent ») mesure donc la couverture du k-anonymat **là où il existe**, pas son absence ailleurs.

**Correctif proposé**
1. **Passer `k` aux blocs 4 et 6**, et l'appliquer dans le 8 — mécaniquement, à tout agrégat qui
   compte des PERSONNES ou des ÉVÉNEMENTS rattachés à une personne :
   `aides_mobilisees[].n` (et `montant_total` **supprimé avec lui** : un montant sans effectif est
   pire), `entretiens[].realises`, `heures_accompagnement.nb_personnes` (+ `moyenne_par_personne_h`,
   qui EST la valeur individuelle quand `nb_personnes` vaut 1), `par_classification.*` du bloc 6,
   `conciliations`, `points_etape_referent`, `fiches_referent_transmises`,
   `actualisations_ft_rappelees`, `nb_semaines`, `ruptures_droits_evitees.*`,
   `completude_fse_par_projet[].participants`, `nb_sorties_suivies`, `satisfaction.nb_reponses`,
   `actions_engagees` / `orientations_dora` / `dora_resultats.*` du bloc 3.
2. **Bloc 5** : `liste_entreprises` et `jours` ne sortent que si `conventions >= k` ; sinon
   `liste_entreprises: null` + chemin dans `sous_seuil`. `entreprises_distinctes` idem.
   La raison sociale n'est pas une donnée personnelle **en elle-même** ; sur une période à une
   convention, elle en devient un identifiant indirect au sens de l'art. 4-1.
3. **Bloc 3** : ne rendre `partenaire_principal` que si `actions_engagees >= k`. Le champ est du
   texte libre où un nom de personne peut se trouver — le projeter au travers d'un
   `nomOrganisme()` qui refuse une valeur portant une civilité serait une seconde ceinture.
4. **Fermer le complément** : dès qu'une distribution comporte **exactement une** case supprimée,
   en supprimer une deuxième (la plus petite publiée) — règle classique de *complementary
   suppression*, dix lignes dans `compte()`. Et **ne plus publier le chemin exact** dans
   `sous_seuil` : un compte suffit (« 4 indicateurs non rendus dans ce bloc »), le chemin est
   l'indication qui rend l'attaque triviale.
5. Ajouter au contrat de test une assertion **structurelle** plutôt que ponctuelle : sérialiser la
   synthèse composée sur une cohorte à 1 personne et **échouer si un entier compris entre 1 et k−1
   apparaît** ailleurs que dans la liste blanche des effectifs bruts déclarés. C'est la seule forme
   de test qui couvrira le bloc 10 écrit l'année prochaine.

---

### B-02 — BRSA, catégorie France Travail et critères d'éligibilité (dont RQTH) servis au MANAGER

**Fichiers** :
`backend/src/routes/insertion/routes.js:4008` (`gatherAuditKpis` appelle `composerBlocsInternes`),
`:4067` (`publics_entree: blocsAutorite.publics`), `:4116` (`GET /audit`, **aucune projection par
rôle**) ;
`backend/src/services/dialogue-gestion.js:1206` (`const k = (n) => … // identité : aucune suppression`) ;
`backend/src/routes/exports.js:1012` (`GET /insertion-synthese` JSON → `gatherAuditKpis`).
**Habilitations** : `/api/insertion` = `authorize('ADMIN','RH','MANAGER')` (`insertion/index.js:27`),
`/api/exports` = `authorize('ADMIN','MANAGER','RH')` (`exports.js:18`),
`/insertion/audit` côté front = `ProtectedRoute roles={['ADMIN','RH','MANAGER']}` (`App.jsx:211`).

**Règle opposable** : `CLAUDE.md` module 5 — « statuts sociaux **BRSA / catégorie FT ADMIN/RH
strict** » ; PR C — « `brsa` **jamais LU** pour un MANAGER » ; PR A constat bloquant — « la liste des
critères d'éligibilité — RSA, RQTH, AAH, “sortant de détention” — était servie à l'encadrant avec
ses libellés ».

**Reproduction 1** — cohorte de 3, `composerBlocsInternes` appelée telle quelle :

```
=== bloc « publics » servi à un MANAGER par /insertion/audit ===
 "brsa": { "n": 2, "part_pct": 66.7, "n_asp": 2 },
 "par_critere_eligibilite": [
   { "code":"RSA", "libelle":"Bénéficiaire du RSA",            "n":2, "part_pct":66.7 },
   { "code":"TH",  "libelle":"Travailleur handicapé (RQTH)",   "n":1, "part_pct":33.3 } ],
 "par_categorie_ft": { "A":1, …, "F":1, "G":1, … },
 "par_referent_unique": { "structure":1, "cms":1, "france_travail":1, … }
```

**Reproduction 2** — la même, sur une période à **une seule personne** :

```
UNE seule personne dans la période. Ce que le MANAGER reçoit :
  effectif                 = 1
  brsa.n                   = 1     → cette personne est BRSA
  critère d'éligibilité    = Travailleur handicapé (RQTH) (1)
  catégorie France Travail = G=1
  tranche d'âge            = {"40-49 ans":1}
  sexe                     = {"F":1,"M":0,"non_renseigne":0}
```

**Pourquoi c'est bloquant.** Ce n'est pas « un agrégat qui, à la marge, pourrait désigner » : à
effectif 1, l'agrégat **EST** la donnée individuelle, et le MANAGER dispose par ailleurs de la file
active nominative de la même période. La réserve E1 des trois revues précédentes — le MANAGER n'est
borné par aucune équipe — n'est pas une atténuation ici, c'en est l'aggravation : il n'y a pas de
périmètre qui limiterait la cohorte croisée. Le contrat § 5.3 affirme « les nouveaux blocs ne
portent **aucune** clé par salarié » : c'est vrai au sens littéral, et c'est insuffisant — la
protection dont ces données bénéficiaient n'était pas « pas de clé par salarié », c'était **le rôle**.
La règle « RQTH n'apparaît que comme code d'éligibilité, jamais comme information médicale »
(matrice § 2 (a)) vaut pour ce qui sort vers l'autorité ; elle ne dit rien de ce qu'un encadrant
technique a le droit de lire, et l'arbitrage de la PR A disait le contraire.

**Correctif proposé** — la frontière de rôle est la ROUTE, pas la composition (doctrine PR B, où
`heures_accompagnement.par_salarie` est retiré par `/audit` et non par le service) :

```js
// routes.js — GET /audit : les blocs de statut social ne sont pas composés pour un MANAGER.
const adminRh = ['ADMIN', 'RH'].includes(baseRoleOf(req));
const k = await gatherAuditKpis(year, { adminRh });   // ← et non filtrés APRÈS coup
```
et dans `gatherAuditKpis`, **ne pas appeler** `bloc2Publics` quand `adminRh` est faux (la requête ne
part pas — un filtrage après lecture serait un refus d'affichage, pas un refus d'accès ; c'est
exactement le correctif de `echeances-cip.js:369` en PR C). Même garde sur
`GET /exports/insertion-synthese` (JSON). Les blocs `freins_evolution`, `immersions`, `conformite`,
`accompagnement`, `etp_asp` peuvent rester : ils ne portent aucun statut social.
Ajouter au contrat `insertion-audit-non-nominatif-contract` : `expect(JSON.stringify(body)).not.toContain('brsa')`
et `.not.toContain('RQTH')` pour un MANAGER — assertion symétrique de celle qui existe déjà sur la
file active.

---

### B-03 — Les trois champs libres DORA / aide échappent au masquage de l'axe santé

**Fichier** : `backend/src/routes/insertion/routes.js:123-134` —
`const ACTIONS_TEXTE_LIBRE = ['notes', 'resultat'];`
**Colonnes ajoutées par la PR D** : `scripts/migrations/insertion-reporting.js:94-101`
(`dora_service` VARCHAR(150), `dora_url` TEXT, `aide_organisme` VARCHAR(150)).
**Surfaces** : `GET /api/insertion/action-plans/:employeeId` (`routes.js:1501`, `SELECT ap.*`) et
`routes.js:2219` (vue transversale des actions).
**Rendu** : `frontend/src/components/insertion/ActionsPanel.jsx:262-276`.

Le commentaire de `maskActionPlansForRole` énonce lui-même la règle qu'il n'applique plus :
« `notes` et `resultat` sont du texte libre où un CIP peut légitimement recopier un élément de santé
(art. 9) ou de contexte judiciaire (art. 10) rattaché à l'action ». Or `dora_service` **est par
construction** le nom du service vers lequel on a orienté : sur l'axe santé, c'est un service de
soin. `dora_url` porte le même nom dans son chemin. `aide_organisme` est le financeur d'une aide
santé.

**Reproduction** (logique exacte de `maskActionPlansForRole`, recopiée — la fonction n'est pas
exportée) :

```
Ce qu'un MANAGER reçoit de GET /api/insertion/action-plans/:id (axe SANTÉ) :
{
 "frein_type": "sante",
 "action_label": "Orientation vers un service de soin",
                                   ← "notes" retiré ✓, "resultat" retiré ✓
 "dora_service": "CSAPA de Rouen — addictologie",
 "dora_url": "https://dora.inclusion.beta.gouv.fr/service/csapa-rouen-sevrage",
 "dora_resultat": "pris_en_charge",
 "aide_nature": "sante",
 "aide_organisme": "CPAM 76 — complémentaire santé solidaire (ALD)",
 "aide_montant": "120.00"
}
```

**Pourquoi c'est bloquant.** C'est la réouverture d'une fuite fermée par un correctif nommé
(2.43.0, audit d'isolement § B.3) sur une donnée d'**article 9**, au profit d'un rôle dont
l'arbitrage a explicitement exclu ces éléments. Le mécanisme de fuite — un dictionnaire de champs
sensibles non tenu à jour quand des colonnes s'ajoutent à la table — est le même que celui du
`SELECT im.*` de la PR C et du `SELECT e.*` de 2.43.0.

**Correctif proposé**

```js
const ACTIONS_TEXTE_LIBRE = ['notes', 'resultat', 'dora_service', 'dora_url', 'aide_organisme'];
```
et, pour que la liste ne redevienne pas fausse à la colonne suivante, une **garde statique** dans
les tests : recenser les colonnes `TEXT`/`VARCHAR` libres de `cip_action_plans` posées par les
migrations et échouer si l'une d'elles n'est ni dans `ACTIONS_TEXTE_LIBRE` ni dans une liste blanche
explicite de champs réputés non sensibles. Deux tests de contrat symétriques de ceux qui existent
pour `notes`.

---

## 2. Constats MAJEURS

### M-01 — Le tableau des freins (d) décale toutes ses dates d'un jour hors UTC

**Fichier** : `backend/src/utils/insertion-freins-export.js:139-143` —
`const d = new Date(v); return d.toISOString().slice(0, 10);`
**Colonnes concernées** : `Date de naissance`, `Date d'entrée ACI`, `Fin PASS IAE`, `PMSMP (dern.)`
et, **ajoutée par cette PR**, `Date de constat BRSA` (`:198`).
**Règle opposable** : contrat § 2.5 — « dates civiles par `utils/date-iso.js` » ; PR B constat D-05,
dont le correctif a produit `utils/date-iso.js` précisément parce que « l'export FSE+ 29 colonnes
**décalait la date de naissance** transmise à l'autorité ». `exports.js:2` importe déjà `isoDate` ;
`insertion-freins-export.js` non.

**Reproduction** (colonne `DATE` rendue par `node-pg` comme un `Date` à minuit LOCAL) :

```
--- TZ=UTC ---            --- TZ=Europe/Paris ---
Date de naissance    1988-07-01 ✓        1988-06-30 ✗
Date de constat BRSA 2026-03-02 ✓        2026-03-01 ✗
Fin PASS IAE         2027-01-01 ✓        2026-12-31 ✗
Date d'entrée ACI    2026-01-05 ✓        2026-01-04 ✗
PMSMP (dern.)        2026-06-01 ✓        2026-05-31 ✗
```

Sans effet en production aujourd'hui (les conteneurs tournent en UTC), **à une variable `TZ` près**
d'une pièce de contrôle dont l'instructrice a écrit qu'elle regarde les dates en premier. Une fin de
Pass IAE reculée d'un jour change un statut ; une date d'entrée ACI reculée change un mois de
conventionnement.

**Correctif** : `const { isoDate } = require('./date-iso');` et `const fmtDate = (v) => isoDate(v) || '';`
— une ligne, et le helper rend déjà `null` sur une valeur illisible plutôt qu'une chaîne tronquée.

### M-02 — `pool.connect()` hors du `try` dans les deux handlers PMSMP que la PR D rouvre

**Fichiers** : `backend/src/routes/insertion/routes.js:2681` (`POST /pmsmp`) et `:2741`
(`PUT /pmsmp/:id`) — les deux handlers auxquels la PR D ajoute `VALIDATEURS_DEBOUCHE` et les trois
colonnes de débouché. Six autres occurrences du même motif subsistent dans le même fichier
(`:1024`, `:1291`, `:1818`, `:1863`, `:4367`, `:4408`).
**Règle opposable** : contrat § 2.5 — « `pool.connect()` **dans le try** » ; corrigée en PR A
(constat D-04), retrouvée et recorrigée en PR B (« fuite de pool… et aucun test n'exerçait
`pool.connect()` en échec »). Tous les routeurs nés en PR A/B/C/D respectent la règle
(`reporting.js:220`, `echeances.js:164`, `salarie.js:169`, `rsa.js:288`, `temps.js:350`,
`eti-public.js:279`, `cadre.js:558`) ; `routes.js` ne l'a jamais reçue.

**Reproduction** (motif exact, `pool.connect()` rejetant en `53300 remaining connection slots`) :

```
PROCESSUS TUÉ par rejet non géré : 53300
```

Express 4 n'attrape pas le rejet d'un gestionnaire `async`, et aucun `process.on('unhandledRejection')`
n'existe dans le dépôt (vérifié) : Node ≥ 15 **termine le processus**. Ce n'est donc pas une requête
pendante, c'est **l'arrêt du backend**. Et la PR D rend l'épuisement du pool plus probable : chaque
ouverture de `/insertion/audit`, de `/exports/insertion-synthese` (JSON) et du bilan RSE déclenche
désormais `composerBlocsInternes` (une vingtaine de requêtes + `conformiteProjet` par projet +
`activiteHebdoCohorte`), sous un plafond global de 1 000 requêtes / 15 min (`index.js:83`).

**Correctif** : `let client;` au-dessus, `client = await pool.connect();` en première ligne du `try`,
`if (client)` dans le `catch` et le `finally` — le motif déjà écrit six fois ailleurs. Et un test qui
exerce `pool.connect()` en échec sur au moins un de ces handlers (le trou comblé en PR B).

### M-03 — `sortie_type`, texte libre sans validateur, entre dans la synthèse et est FIGÉ dans le snapshot

**Chaîne** : `sortie_type` est un `VARCHAR(50)` **sans CHECK** (`init-db.js:3658`), listé dans
`MILESTONE_EDITABLE_FIELDS` (`routes.js:873`) **sans validateur de liste fermée** →
`dialogue-gestion.js:691` le sélectionne → `sorties-engine.js:137` et `:145` en font une **clé d'objet** de
`methode_b.par_type` → rendu par `GET /dialogue-gestion` et **enregistré tel quel** dans
`insertion_dialogues_gestion.contenu`.
`services/mon-parcours.js:148-151` documente exactement le contraire pour le même champ :
« liste FERMÉE… une valeur hors liste devient `null` (jamais recopiée) ».

**Reproduction** :

```
bloc 6 — par_type (rendu en JSON + figé dans le snapshot) :
 { "CDI chez Leroy Merlin (oncle de M.)": 1 }
```

Le CSV et le PDF ne l'impriment pas (`aplatirEnLignes` ne parcourt pas `par_type`) — la fuite passe
par le **JSON** que l'écran reçoit et surtout par le **snapshot**, table qui n'a ni rétention, ni
purge, ni accroche d'anonymisation (vérifié : `insertion_dialogues_gestion` n'apparaît ni dans
`services/rgpd-purges.js` ni dans `services/anonymization.js`). Un texte libre écrit par la CIP y
survit donc à l'anonymisation du salarié qu'il décrit.

**Correctif** : projeter `sortie_type` sur la liste fermée `SORTIE_TYPE_LABELS` **avant** d'en faire
une clé (`sorties-engine` étant PUR, la projection revient à l'appelant, ou une liste blanche lui est
injectée) ; valeur hors liste → clé `autre`. Et, quel que soit l'arbitrage, retirer `par_type` de
l'objet enregistré : le bloc 6 du document ne l'imprime pas.

### M-04 — Une source illisible s'imprime « 0 » aux blocs 3 et 4 du document transmis

**Fichiers** : `dialogue-gestion.js:533-541` (`num(a.n_actions) || 0`, `num(a.n_dora) || 0`,
`dora_resultats` à quatre zéros) et `:568-576` (`entretiens[].realises/echus`).
**Règle opposable** : contrat § 2.1 — « source absente → `null` nommé, **jamais 0** ». Le bloc 8 la
respecte (`un()` rend `null`, `:786-789`) ; les blocs 3 et 4 non.

**Reproduction** (les deux requêtes d'actions par axe échouent en `42703`, base non migrée) :

```
Axe mobilité, requêtes d'actions EN ÉCHEC :
  actions_engagees     = 0     ← imprimé « 0 » alors que la source est illisible
  orientations_dora    = 0
  dora_resultats       = {"oriente":0,"pris_en_charge":0,"refuse":0,"sans_suite":0}
  partenaire_principal = null  (« aucun partenaire » et « source illisible » se confondent)
  Le bloc 9 « Méthode » signale-t-il la dégradation ? non
```

Le document signé par la direction affirmerait alors « 0 action engagée » sur un axe où la structure
en a peut-être mené quarante — un chiffre faux **dans le sens qui la dessert**, sur la pièce qui
instruit son conventionnement, sans que le bloc 9 le mentionne. Idem au bloc 4, dont le PDF imprime
un tableau d'entretiens entièrement à zéro et la phrase « Aucune aide mobilisée saisie sur la
période » (`pdf-dialogue-gestion.js:185`).

**Correctif** : distinguer `actions == null` (échec) de `actions == []` (rien) et rendre `null` dans
le premier cas, comme `bloc8Conformite` ; ajouter au bloc 9 une ligne « Indicateur non rendu : la
source n'a pas pu être lue » pour chaque bloc dégradé, sur le modèle de la ligne déjà écrite pour
les heures d'accompagnement (`:900-903`).

### M-05 — `APP_VERSION` n'est posée nulle part : les documents transmis portent « 1.0.0 »

**Fichiers** : `dialogue-gestion.js:64`, `exports.js:674`, `exports-fse.js:40`, `health.js:6` —
tous `process.env.APP_VERSION || require('../../package.json').version`, et
`backend/package.json:3` vaut **`"1.0.0"`**. `APP_VERSION` n'apparaît **ni dans
`docker-compose.prod.yml`, ni dans `.env.example`** (vérifié).

L'en-tête de traçabilité est une **règle commune impérative** de la matrice (§ 2, « Version de
l'outil »). Elle est donc systématiquement fausse sur les trois documents que la structure
transmettra : (a) FSE+ participants, (d) tableau des freins, (e) synthèse de dialogue de gestion.
Le snapshot l'enregistre aussi (`insertion_dialogues_gestion.version_application`) : rejouer une
synthèse ne dira jamais quelle version l'a produite — ce qui prive le snapshot d'une partie de sa
valeur probante. Le rapport de lot le signale honnêtement (§ 6.1 point 3) et le classe hors
périmètre ; il l'est pour le lot, il ne l'est pas pour la PR.

**Correctif** : `APP_VERSION: 2.55.0` dans le service `backend` de `docker-compose.prod.yml` et dans
`.env.example` ; à défaut, faire porter la version par `package.json` et le tenir à jour au même
commit que `CLAUDE.md`.

### M-06 — « Cours de français » entre dans « Mon Récap », le document qui circule

**Fichier** : `backend/src/services/mon-parcours.js:120` — `formation_fle: 'Cours de français'`,
consommé par `engagements_structure` (`:402`, « Mon parcours en une page », qui ne circule pas)
**et** par `etapes` (`:530`, « Mon Récap », que la personne peut remettre à un employeur).
La neutralisation `insertion.recap_neutralise` ne couvre que `TYPE_ENTRETIEN_LABELS_RECAP` et
l'entreprise d'une PMSMP (`:448`, `:520`) — **pas** les catégories d'action.

Le fichier énonce lui-même la doctrine, deux dictionnaires plus haut (`:77-90`) : « Sur un document
qui circule, une ligne datée suffit à faire comprendre qu'il y a eu litige — et à contredire la
mention de pied de page ». « Cours de français », daté, sur le document qu'une personne remet à un
employeur, dit qu'elle a été identifiée comme ayant un frein linguistique. C'est la même classe de
divulgation que celle qui a fait regrouper « Entretien de conciliation » sous un libellé générique
au correctif M-10 de la PR C.

**Correctif** : un `CATEGORIE_ACTION_LABELS_RECAP` où `formation_fle` (et, à vérifier avec la CIP,
`frein`) retombe sur « Formation » / « Accompagnement », appliqué quand `neutralise` est vrai —
strictement le motif déjà écrit pour les types d'entretien, réversible par le même réglage.

### M-07 — `performance.js` recopie les requêtes de sorties sans l'`ORDER BY` dont le moteur dépend

**Fichiers** : `backend/src/routes/performance.js:344-352` face à
`backend/src/services/dialogue-gestion.js:687-694`.
`sorties-engine.js:117-120` fixe la règle : « Deux bilans pour un même parcours : **le PREMIER
rencontré fait foi — la requête appelante les ordonne** ». `dialogue-gestion` ordonne
(`ORDER BY COALESCE(im.completed_date, im.updated_at::date), im.id`) ; `performance.js` **n'ordonne
pas**. Sur un parcours réouvert puis repris — le cas même que le commentaire décrit — PostgreSQL ne
garantit aucun ordre, et le reporting RH peut classer la sortie « emploi de transition » là où la
synthèse transmise écrit « emploi durable ».

C'est le défaut que le contrat § 2.6 cherchait à fermer : la règle vit bien à un seul endroit, mais
sa **précondition** a été recopiée de façon incomplète. Troisième copie de ces deux requêtes
(dialogue-gestion, performance, et le chemin `gatherAuditKpis` via `composerBlocsInternes`).

**Correctif** : ajouter l'`ORDER BY` — ou, mieux, exporter depuis `dialogue-gestion.js` un
`chargerSorties(db, p)` que `performance.js` appelle, de sorte que la précondition ne puisse plus se
perdre en chemin.

---

## 3. Constats MINEURS

| # | Où | Constat | Correctif |
|---|---|---|---|
| **m-01** | `routes.js:1478` | `aide_montant` : `isFloat({min:0})` accepte `99999999.99` et `1e308`, que `NUMERIC(9,2)` refuse en `22003` — code non capté par les `catch` du POST (`23503` seul) ni du PUT (`23503`/`23514`) → **500 « Erreur serveur »** au lieu d'un 400 lisible. `checkFalsy: true` laisse en outre passer `false` jusqu'à la base. | Borner `isFloat({ min: 0, max: 9999999.99 })` et ajouter `22003` aux codes traduits en 400. |
| **m-02** | `dialogue-gestion.js:986` | `insertion.k_anonymat_min` n'a **pas de plancher** : un réglage à `1` désactive toute suppression en silence, pendant que le bloc 9 continue d'écrire « tout agrégat comptant entre 1 et 0 personnes est rendu vide ». | Plancher à 5 (`Math.max(5, …)`), ou refus explicite + mention dans le document si la direction abaisse le seuil. |
| **m-03** | `dialogue-gestion.js:747`, `:780` | `satisfaction.nb_reponses` et `completude_fse_par_projet[].participants` sont des **comptes de personnes** publiés bruts, hors de la liste d'exceptions déclarée (§ 2.2 du rapport de lot). À 2 réponses, la moyenne est supprimée mais l'effectif ne l'est pas. | Les passer par `k()` (couvert par le correctif B-01). |
| **m-04** | `utils/insertion-journal.js:48` | Un export tiré par une **clé d'API de service** (`id: null`, `username: 'api:<nom>'`, `middleware/auth.js:83`) écrit `user_id = NULL` et **aucune autre identité** : la trace de l'export (e) est alors indiscernable d'une trace orpheline. Les clés de service sont exemptées de MFA et autorisées en GET. | Ajouter `username` / `is_service` aux `details` de `ecrireJournal`. |
| **m-05** | `reporting.js:117` | L'aperçu JSON rend le **document complet** (identique au CSV) sous un journal **tolérant**. Contrat-sanctionné, mais un document non nominatif est aussi un document qui peut être copié depuis le navigateur sans laisser de trace si le journal est indisponible. | À dire dans le registre plutôt qu'à corriger ; ou rendre le journal bloquant pour l'aperçu annuel. |
| **m-06** | `dialogue-gestion.js:437` | `niveaux_formation` prend pour clés les valeurs brutes de `insertion_diagnostics.niveau_formation` — `VARCHAR(10)` **non validée côté serveur** (`routes.js:420` : « nomenclature contrôlée applicativement côté front »). Dix caractères libres deviennent un intitulé de ligne du document transmis (et du CSV). | Projeter sur la nomenclature fermée ; hors liste → `non_renseigne`. |
| **m-07** | `reporting.js:141-158` | `GET /dialogue-gestion/historique` rend le **prénom et l'initiale** du générateur à ADMIN/RH/**MANAGER**, alors que le document lui-même ne porte que le rôle. | Borner l'historique nominatif à ADMIN/RH, ou n'y rendre que le rôle. |
| **m-08** | `exports.js:869-877` | Le **CSV** du tableau des freins (d) est délibérément « strict » et n'a **aucun en-tête de traçabilité**, alors que la règle § 2 de la matrice l'impose « en première feuille (tableur) **ou en première ligne (CSV)** » et que le rapport de lot annonce « en-tête de traçabilité complet ». | Soit l'en-tête commenté (`#`) comme pour la synthèse, soit retirer la variante CSV : (d) est spécifié en `.xlsx`. |
| **m-09** | `migrations/insertion-reporting.js:176` | `insertion_dialogues_gestion` n'a **ni rétention, ni purge, ni entrée art. 30** — absente de `rgpd-purges.js` et d'`anonymization.js`. Défendable tant que le contenu est agrégé ; ne l'est plus avec B-01 et M-03. | Après correction de B-01/M-03, poser tout de même une rétention (la pièce de conventionnement se conserve, mais une durée écrite vaut mieux qu'aucune). |
| **m-10** | `routes.js:4008` | `composerBlocsInternes` (≈ 20 requêtes + `conformiteProjet` par projet + `activiteHebdoCohorte`) s'exécute désormais à **chaque** ouverture de `/insertion/audit`, de `/exports/insertion-synthese` (JSON) et du bilan RSE, sous un plafond de 1 000 req/15 min. Combiné à M-02, l'épuisement du pool cesse d'être théorique. | Mesurer sur base réelle (objet du lot de debug) ; cache court par année, ou calcul à la demande derrière l'onglet. |
| **m-11** | `routes/rse.js:183` | `pmsmp: k.pmsmp \|\| null` est **étalé en entier** : le bilan RSE (rôle REF_RSE, base MANAGER) reçoit désormais `liste_entreprises`. Sans gravité (raisons sociales), mais le module promet « agrégats non nominatifs uniquement » et projette explicitement partout ailleurs. | Projeter les clés attendues, comme les autres blocs du bilan. |
| **m-12** | `routes.js:2655-2660`, `:2676` | Le serveur accepte un `debouche` sur une immersion **non terminée** (la garde `estTerminee` n'existe que dans `PmsmpPanel.jsx`), et `debouche_date` n'est jamais confrontée à `date_fin`. L'indicateur S7 « embauche chez l'accueillant » peut donc être alimenté avant la fin de l'immersion. | Refus 409 motivé quand `date_fin > CURRENT_DATE`, et `debouche_date >= date_fin`. |
| **m-13** | `AuditInsertion.jsx:648` | `<Bar pct={c.pct ?? 0} />` : une complétude FSE+ non calculable peint une barre **vide**, qui se lit « 0 % », alors que le texte voisin affiche « — ». | Ne pas rendre la barre quand `pct == null`. |

---

## 4. Tableau récapitulatif

| # | Gravité | Constat | Reproduit |
|---|---|---|---|
| B-01 | **BLOQUANT** | k-anonymat limité aux blocs 2, 3 et à deux champs du 5 : entreprise d'accueil unique, montant d'aide unique, partenaire d'un axe à une action, conciliation unique, classifications de sortie à 1 ; et reconstitution des cases supprimées par complément de l'effectif | **oui** (2 scénarios) |
| B-02 | **BLOQUANT** | BRSA, catégorie FT, référent unique et critères d'éligibilité (dont RQTH) servis au MANAGER par `/insertion/audit` et `/exports/insertion-synthese`, sans k-anonymat | **oui** (2 scénarios) |
| B-03 | **BLOQUANT** | `dora_service` / `dora_url` / `aide_organisme` échappent au masquage de l'axe santé pour un MANAGER | **oui** |
| M-01 | Majeur | `fmtDate` du tableau des freins (d) : toutes les dates décalées d'un jour hors UTC (D-05 de la PR B non porté ici ; la PR D y ajoute `Date de constat BRSA`) | **oui** |
| M-02 | Majeur | `pool.connect()` hors du `try` dans les deux handlers PMSMP modifiés (+ 6 autres dans `routes.js`) : le rejet **tue le processus** | **oui** |
| M-03 | Majeur | `sortie_type` (texte libre sans validateur) devient une clé de `par_type`, rendue par la synthèse et figée dans un snapshot sans purge ni anonymisation | **oui** |
| M-04 | Majeur | Une source illisible s'imprime « 0 » aux blocs 3 et 4 du document transmis (le bloc 8 rend `null`) | **oui** |
| M-05 | Majeur | `APP_VERSION` absente du compose : tous les documents transmis — et les snapshots — portent « 1.0.0 » | oui (lecture) |
| M-06 | Majeur | « Cours de français » entre dans « Mon Récap », document remis à un employeur, hors neutralisation | oui (lecture) |
| M-07 | Majeur | `performance.js` recopie les requêtes de sorties sans l'`ORDER BY` dont `sorties-engine` dépend | oui (lecture) |
| m-01 → m-13 | Mineurs | voir § 3 | partiel |

---

## 5. Ce qui est bien fait

- **`sorties-engine.js` est un vrai module pur.** Aucune E/S, entrées injectées, `pct()` qui rend
  `null` sur dénominateur nul, `ecart()` qui rend `null` dès qu'un terme manque, un compteur
  initialisé sur les **cinq** lignes pour qu'aucune ne puisse manquer, et deux nombres rendus —
  `bilans_sans_fin_parcours` et `hors_nomenclature` — qui **nomment** ce qui explique les écarts au
  lieu de les ranger silencieusement dans « autre ». Les phrases de `regles` sont écrites pour être
  imprimées telles quelles, et elles le sont.
- **`composerBlocsInternes` est la bonne décision.** Recopier les requêtes dans `gatherAuditKpis`
  aurait produit deux chiffres pour le même indicateur dans deux documents portant la même
  signature. Les deux différences assumées (pas de k-anonymat, pas d'en-tête) sont écrites et
  argumentées. Le défaut B-02 n'est pas dans ce choix, il est dans la **frontière de rôle** qui n'a
  pas suivi.
- **Deux projections explicites, posées dans le service et non à la frontière de la route.**
  `heuresAccompagnement` compose `par_salarie` (liste nominative) et `conformiteProjet` rend ses
  participants nominatifs : les deux sont projetés **là où ils sont lus** (`:594-606`, `:766-786`),
  avec le motif écrit. Le test du lot fait délibérément rendre aux services simulés leur forme
  nominative entière, puis cherche les neuf clés interdites dans la sérialisation complète — c'est
  la bonne méthode de preuve.
- **Le judiciaire est retiré à la source, pas à l'affichage.** `AXES_BLOC3` filtre le registre
  (`:74`), la colonne n'est **pas lue en SQL** (`bloc3Freins` compose ses `dCols`/`lmCols` depuis
  cette liste), et les colonnes d'entrée et d'évolution du tableau des freins suivent exactement le
  sort de la valeur courante (`axesExport`, `insertion-freins-export.js:114-120`). Les critères
  `sensible_art10` sont exclus **par une propriété du référentiel** et non par une liste recopiée,
  y compris dans la variante `sensibles=1`.
- **`escCsv` partagé, et le bon diagnostic.** Le remplacement de l'`esc` locale de `exports.js` est
  la bonne correction (D-3 du rapport de lot) : une commune valant `=HYPERLINK(…)` composait une
  exfiltration en un clic sur le poste de l'instructrice. Toutes les cellules des trois CSV passent
  par `escCsv`, y compris les raisons sociales, les noms de partenaires et les intitulés composés ;
  le XLSX n'est pas concerné (ExcelJS écrit des cellules texte). Vérifié ligne à ligne.
- **La discipline de journal est tenue** : aperçu tolérant, export et génération **bloquants**, la
  génération **dans la transaction** du snapshot, un code d'action **distinct** pour la variante
  enrichie du tableau des freins (« un journal qui les confondrait ne permettrait plus de savoir ce
  qui est sorti »), et les cinq codes ont leur libellé — la garde anti-dérive est verte, rejouée.
- **`estVide` élargi plutôt que recopié** : le contrat demandait un refus sur zéro fin de parcours ;
  le lot a compris qu'une année sans départ est un document parfaitement significatif, et a exigé
  **aussi** une cohorte vide. Le refus est partagé entre `/reporting` et `/exports/insertion-synthese`
  par un `module.exports.estVide` plutôt que par une seconde implémentation.
- **Les trois pièges de la doctrine sont évités là où ils comptent** : `num()` ne confond jamais
  `null` avec 0, un montant d'aide non chiffré reste `null` (« une aide non chiffrée ne vaut pas zéro
  euro »), `embauche_accueillant` est un booléen **nullable** déduit serveur-side d'un seul champ, et
  `evolutionFrein` rend « non évalué » plutôt que « stable » — la contre-épreuve n° 6 le prouve.
- **Le rapport de lot dit ses écarts et ses limites**, y compris un échec de test observé une fois et
  non reproduit, et l'absence totale de vérification sur PostgreSQL réel. Un rapport qui signale un
  `FAIL` qu'il n'a pas su reproduire vaut mieux que quinze passages verts racontés seuls.

---

## 6. Points à l'arbitrage direction / DPO

1. **Le frein santé au bloc 3 (écart E-6 du rapport de lot).** Le contrat § 5.1 n'exclut que le
   judiciaire ; la matrice § 2 énonce, dans ses **règles communes à tout export qui sort de la
   structure**, l'exclusion du « frein santé et son détail ». Le bloc ne porte qu'un agrégat
   (combien de personnes concernées, combien de freins levés), non une donnée individuelle — mais
   **avec le k-anonymat incomplet de B-01, l'argument de l'agrégation ne tient plus tant que B-01
   n'est pas corrigé**. Recommandation : corriger B-01 d'abord, puis trancher ; si la direction
   maintient l'axe santé, le faire dire par le bloc 9 (« l'axe santé est rendu en effectifs
   agrégés, jamais en détail »). Le retirer coûte une ligne (`AXES_BLOC3` filtre déjà un axe).
2. **Le seuil k = 5 et la règle « zéro reste zéro ».** L'argument du lot est juste : supprimer les
   zéros protégerait une personne qui n'existe pas et rendrait le document illisible. Mais le
   corollaire — l'effectif brut publié + les ventilations qui y somment — rend l'attaque par
   complément possible (B-01 vecteur 2). L'arbitrage à poser est : accepte-t-on une **suppression
   complémentaire** (deux cases supprimées au lieu d'une), au prix d'un chiffre de moins par
   distribution ? Ma recommandation est oui : l'autorité sait lire « n < 5 », elle ne peut pas lire
   un document qui la met en position de ré-identifier.
3. **La publication de `sous_seuil` en clair.** Le document dit ce qu'il ne dit pas — intention
   excellente, mise en œuvre contre-productive : le chemin exact désigne la case à reconstituer.
   Un **compte par bloc** conserve l'honnêteté sans l'indication.
4. **La liste des entreprises d'accueil.** Une raison sociale n'est pas une donnée personnelle, et
   la matrice ne l'interdit pas. Sur une période à une ou deux immersions, elle en devient un
   identifiant indirect pour un destinataire qui reçoit par ailleurs les données d'Immersion
   Facilitée. À trancher : liste conservée au-dessus du seuil, ou remplacée par le **secteur
   d'activité** — qui est ce que l'autorité regarde réellement.
5. **Le périmètre du MANAGER, réserve E1 des trois revues précédentes.** Elle revient ici avec un
   poids nouveau : ce n'est plus seulement « un encadrant voit les dossiers d'une autre équipe »,
   c'est « un encadrant reçoit les statuts sociaux agrégés de la structure entière ». Le correctif
   B-02 ferme la surface ; il ne règle pas la question de fond, qui reste ouverte depuis la PR A.
6. **L'exemption de MFA des clés de service sur les exports (e) et (d).** Une clé d'API de service
   en lecture seule peut tirer la synthèse de dialogue de gestion et, si son `service_role` le
   permet, le tableau des freins nominatif. C'est la « vigilance dite » de la 2.45.0 ; elle mérite
   d'être rappelée au registre maintenant que la surface d'export s'élargit (voir m-04).
7. **La rétention du snapshot `insertion_dialogues_gestion`.** Aucune n'est posée. Une pièce de
   conventionnement se conserve — mais une durée écrite vaut mieux qu'une absence de règle, et le
   registre art. 30 gagnerait à la porter même si le contenu est agrégé.
8. **`APP_VERSION`** (M-05) : la décision est d'exploitation, pas de développement — poser la
   variable dans le compose, et arrêter une règle qui la tienne à jour avec `CLAUDE.md`.

---

## 7. Méthode et limites de cette revue

- **Lecture seule.** Aucun fichier de code modifié, aucune commande `git`. Les reproductions
  vivent dans le scratchpad de session et sont rejouables : elles chargent les **modules réels**
  (`services/dialogue-gestion.js`, `utils/insertion-freins-export.js`) avec un faux `pg` injecté
  dans le cache de `require`, en reprenant **l'aiguillage de requêtes écrit par le lot lui-même**
  (`tests/unit/services/dialogue-gestion.test.js:74-114`), pour que l'objet inspecté soit celui que
  la composition produit et non une maquette. Le constat B-03 rejoue la logique **exacte** de
  `maskActionPlansForRole`, recopiée du fichier — la fonction n'est pas exportée.
- **Ce qui n'a PAS été vérifié** : aucun SQL n'a été exécuté sur PostgreSQL réel (c'est l'objet du
  lot de debug, `28-debug-postgres-PR-D.md`). Les trois requêtes neuves que le rapport de lot
  signale comme jamais exécutées — les deux `LEFT JOIN LATERAL` avec `ARRAY_AGG` de
  `fetchFreinsRows`, le `generate_series` + `make_date` de `bloc1Effectifs`, le
  `ROW_NUMBER() OVER (PARTITION BY)` de `bloc3Freins` — restent à éprouver. La reconstruction du
  CHECK `cip_action_plans_category_check` sur une base **peuplée** (elle valide toutes les lignes
  existantes) n'a pas non plus été exercée ; les six valeurs de la PR A y sont bien reprises
  (`insertion-cadre.js:286` vs `insertion-reporting.js:67`), ce qui rend l'échec improbable sans
  l'exclure.
- **Injection SQL** : aucune trouvée. Les fragments composés de `dialogue-gestion.js` (`dCols`,
  `lmCols`, `imCols`) viennent du registre statique `FREINS` ; `annee` et `trimestre` sont
  normalisés par `bornes()` en entiers puis passés en `$n` ; `generate_series(1, 12)` est littéral
  et `make_date($1::int, …)` paramétré ; le filtre optionnel de `historique` est paramétré. Les
  validateurs `dora_url` (https + protocole requis, `javascript:` et `data:` refusés, ~2 083
  caractères par `validator.isURL`), `debouche`, `dora_resultat` et `aide_nature` sont des listes
  fermées importées de la migration plutôt que recopiées.
- **Front** : aucun `alert()`, aucun `window.confirm`, aucun `dangerouslySetInnerHTML` dans le
  périmètre ; `esc()` (complet depuis le correctif m-01 de la PR C) couvre toutes les interpolations
  du PDF, y compris les raisons sociales, les noms de partenaires et les clés de tableau ;
  `<a href={dora_url}>` porte `target="_blank" rel="noopener noreferrer"` et le scheme est validé
  serveur **et** écran.
- **Les 5 suites Jest du chantier ont été rejouées : 118 tests verts.** La garde anti-dérive des
  libellés RGPD est verte également. Les constats ci-dessus sont donc, par construction, ce que ces
  tests ne couvrent pas — et le § B-01 explique pourquoi la contre-épreuve n° 1 du lot ne pouvait
  pas les révéler.

---

*Agent de sécurité (lecture seule), 14 septembre 2026 — PR D, chantier `cip-refonte-2026-09-12`.
Aucun fichier de code modifié. Ce rapport est le seul écrit produit.*
