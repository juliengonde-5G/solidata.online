# PR D « Reporting autorité » — correctifs

> Agent de correctifs, 14/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-d`,
> base `10d9e72`. Périmètre traité : les **23 constats de la revue de sécurité**
> (`27-revue-securite-PR-D.md` — 3 bloquants, 7 majeurs, 13 mineurs) et les **7 défauts du
> debug sur PostgreSQL réel** (`28-debug-postgres-PR-D.md`) plus ses **2 constats connexes**.
> **Tous corrigés.** Trois constats décrivent le même défaut sous deux plumes et reçoivent
> **un seul correctif** cité sous ses deux références (B-01 ≈ D-07, M-01 ≈ D-01, M-05).
> Méthode : `24-correctifs-PR-C.md`.

---

## 0. En une phrase

Le k-anonymat cesse d'être une intention appliquée là où on pensait à elle pour devenir
une **passe unique sur le document entier** ; les statuts sociaux cessent de revenir au
MANAGER par la route voisine ; et les cinq défauts que le debug a reproduits sur base
réelle — un mois sans contrat valant 1,00 ETP, une évolution « stable » inventée, « 0 semaine
sous 15 h » pour qui n'a rien de relevé, cinq dates reculées d'un jour, un montant hors
capacité rendant 500 — sont fermés, avec **9 tests rouges devenus verts**, **83 vérifications
e2e PR D** (contre 74), **5 070 tests Jest** et **11 contre-épreuves par mutation** dont
**deux ont démasqué un trou de couverture** que j'ai comblé.

---

## 1. Les trois bloquants

### B-01 ≈ D-07 — le k-anonymat ne couvrait que deux blocs sur huit

**Fichier** : `backend/src/services/dialogue-gestion.js` (refonte ; `:400-560` pour la passe).

**Ce qui était en cause.** Le garde-fou était posé à la main, agrégat par agrégat, au moment
de composer chaque bloc. Il couvrait donc exactement les endroits où son auteur avait pensé
à lui — les blocs 2 et 3, deux champs du 5 — et rien d'autre. Le document transmis publiait
pendant ce temps, sur la ligne voisine de celle qu'il venait de masquer : la raison sociale
de l'unique entreprise d'accueil d'une période à une immersion, le montant exact d'une aide
financière d'urgence unique (340 €, que le Département retrouve dans ses propres dossiers),
le nom du partenaire d'un axe portant une seule action (« CMS de Darnétal — Mme R. », champ
libre où une conseillère a écrit un nom de personne), « 1 entretien de conciliation »,
« 1 sortie en emploi durable ». Et l'effectif brut étant publié, une case supprimée dans une
ventilation qui y somme **se retrouvait par soustraction**, `sous_seuil` désignant
obligeamment laquelle.

**Ce que j'ai fait, et pourquoi autrement que proposé.** La revue proposait d'étendre la
liste des champs protégés (correctif 1 à 4) ; je ne l'ai pas fait, parce que c'est le
mécanisme même qui a échoué : une liste d'inclusion tenue à la main redevient fausse au
champ suivant, exactement comme `ACTIONS_TEXTE_LIBRE` (B-03), le `SELECT im.*` de la PR C et
le `SELECT e.*` de 2.43.0. Les blocs composent désormais des valeurs **brutes**, et une
**seule fonction** — `appliquerKAnonymat` — parcourt récursivement le document entier après
composition et avant le bloc « Méthode ». Tout entier de 1 à k−1 est retiré **par défaut**,
sauf s'il figure dans l'une des deux listes blanches explicites :

| Liste | Contenu | Raison |
|---|---|---|
| `K_EFFECTIFS_PUBLIES` (6 chemins) | effectif de la cohorte, conventions d'immersion, dénominateur des sorties, sorties documentées, sorties non documentées, la case `non_documentee` de la ventilation | chacun porte SA raison écrite dans la table — tête de chapitre, nombre d'actes, ou exigence explicite de l'indicateur n° 15 |
| `K_MESURES` (21 clés) | taux, heures, euros, ETP, base de calcul, nombre de mois, nombre d'organisations | ce ne sont pas des comptes de personnes ; elles tombent par **dépendance**, pas pour leur propre valeur |

Un bloc 10 écrit l'an prochain sera protégé sans que personne n'ait à y penser. C'est
l'inverse exact du dispositif précédent, et c'est le seul sens qui tienne : **on n'oublie
pas d'ajouter un champ à une liste d'exceptions, on oublie de l'ajouter à une liste de
protections.**

Trois canaux de reconstitution sont fermés avec lui :

1. **Les taux miroirs.** Un taux dont le dénominateur est publié rend son numérateur par
   multiplication : 20 % × 5 = 1, soit la case qu'on venait de masquer. `K_TAUX` fait suivre
   au taux le sort de sa case de comptage — **quand le dénominateur est publié seulement**,
   car un taux sur un dénominateur lui-même retiré ne reconstitue rien et l'autorité a besoin
   de ses taux. `dynamiques` est exempté, et c'est argumenté : il se déduit déjà des deux
   nombres que l'indicateur n° 15 exige, le masquer serait une protection que le document
   défait trois lignes plus haut.
2. **La suppression complémentaire.** Une ventilation qui somme à un total publié ne garde
   jamais **une seule** case retirée : la plus petite case publiée tombe avec elle. Et quand
   le total publié est LUI-MÊME sous le seuil (cas des sorties, où le dénominateur est
   mandaté), la ventilation entière est retirée : les zéros étant publiés, une suppression
   partielle s'y reconstituerait par élimination. Une case blanchie par mandat n'est jamais
   choisie comme victime — la retirer reprendrait d'une main ce que l'autorité demande de
   l'autre.
3. **`sous_seuil` ne nomme plus le chemin.** Un COMPTE par bloc (`[{ bloc, libelle, nb }]`
   plus `sous_seuil_total`) conserve l'honnêteté sans donner le mode d'emploi. Le détail non
   masqué se lit sur l'écran interne, qui n'applique aucun seuil : rien n'est perdu pour la
   CIP.

**Un quatrième canal, trouvé en corrigeant et absent des deux rapports** : le moteur PUR
recopiait le nombre de bilans sans fin de parcours **dans une phrase** de `regles`
(« 1 bilan(s) de sortie classé(s)… »), imprimée telle quelle. La passe ne protège que des
champs : un compte glissé dans une chaîne passait à travers. La phrase est rendue générique,
le nombre reste dans son champ, où il est protégé comme les autres.

**Tests qui verrouillent** : l'**assertion structurelle** demandée par la revue
(`dialogue-gestion.test.js`, « k-anonymat structurel ») — sérialiser le document composé sur
une cohorte d'**une personne** et échouer si un entier de 1 à k−1 apparaît hors liste
blanche, plus la vérification que ni la raison sociale ni le nom du partenaire n'en sortent,
plus une troisième qui prouve qu'au-dessus du seuil le document dit tout ce qu'il doit dire
(on ne vide pas la pièce). Et sur base réelle : `V-15` (compte par bloc), `V-15b`
(invariant de la suppression complémentaire), `V-15c` (taux miroirs), `V-15d`
(ventilations), `V-53b`, `V-53c`.

**Preuve** : les deux scénarios reproduits par la revue ne produisent plus rien —
`GARAGE MARTIN` et `Mme R.` sont introuvables dans la sérialisation, l'aide de 340 € est
retirée **avec** son effectif.

---

### B-02 — BRSA, catégorie France Travail et RQTH servis au MANAGER

**Fichiers** : `routes/insertion/routes.js:3846` (`gatherAuditKpis({ baseRole })`), `:3986`
(typologies), `:4283` (`projeterAuditPourRole`), `:4320` (`GET /audit`) ;
`routes/exports.js:1034` ; `services/dialogue-gestion.js` (`composerBlocsInternes({ avecPublics })`).

**Ce qui était en cause.** `publics_entree` partait vers deux routes ouvertes au MANAGER,
sans aucune suppression. Sur une période à une personne, l'encadrant lisait `brsa: 1`,
« RQTH (1) », « catégorie G = 1 » : à effectif 1, l'agrégat **EST** la donnée individuelle,
et il dispose par ailleurs de la file active nominative de la même période.

**Ce que j'ai fait.** Les deux ceintures, comme la revue le demandait et comme la PR B l'a
fait pour `par_salarie` :

- le bloc **n'est pas composé** hors ADMIN/RH (`avecPublics: false`) — sa requête ne part
  pas ; un filtrage après lecture serait un refus d'affichage, pas un refus d'accès ;
- la projection est **reposée à la frontière** (`projeterAuditPourRole`), pour que rien ne
  revienne par une clé dérivée écrite demain.

**Étendu, de mon initiative, à `typologies`** (bloc de la PR 2, hors des deux rapports) : il
porte `rqth` — un compte de travailleurs handicapés, que l'exigence nomme — et `ressources`,
les prestations sociales perçues. Mêmes colonnes non lues, même projection. Les tranches
d'âge et les niveaux de formation, qui ne sont pas des statuts sociaux, restent à
l'encadrant : le correctif ferme une surface, il n'ampute pas un écran de travail.

**Clé RETIRÉE et jamais nullifiée** (doctrine `maskActionPlansForRole`) : « non habilité » ne
doit pas se lire « nous n'avons pas su lire ». Une clé `projection_role` annonce la
suppression en français, plutôt que de la taire.

**Tests** : `insertion-audit-non-nominatif-contract` (4 tests neufs, dont la vérification que
les DEUX requêtes ne partent pas), `insertion-contract` (symétrie MANAGER / RH sur
typologies), `V-35d` et `V-35e` sur base réelle (5 BRSA et 3 RQTH dans la cohorte de
recette : l'ADMIN les reçoit, le MANAGER n'en voit aucune trace).

---

### B-03 — les trois champs libres DORA / aide échappaient au masquage de l'axe santé

**Fichier** : `routes/insertion/routes.js:123`.

`ACTIONS_TEXTE_LIBRE` valait toujours `['notes', 'resultat']`. Sur une action de l'axe santé,
un MANAGER perdait bien `notes` et `resultat` — et recevait `dora_service` =
« CSAPA de Rouen — addictologie », `dora_url` qui porte le même nom dans son chemin, et
`aide_organisme`, financeur d'une aide santé. Réouverture d'une fuite d'**article 9** fermée
par un correctif nommé (2.43.0).

**Correctif** : les trois champs entrent dans le dictionnaire. **Et pour qu'il ne redevienne
pas faux à la colonne suivante**, `tests/unit/actions-texte-libre.test.js` confronte le
dictionnaire au **schéma** : il recense les colonnes `TEXT`/`VARCHAR` de `cip_action_plans`
posées par `init-db.js` et les trois migrations, et échoue si l'une d'elles n'est ni masquée
ni inscrite dans une liste blanche explicite — dont chaque entrée porte sa raison (une valeur
de liste fermée ne peut pas contenir de phrase libre : c'est ce qui la rend inoffensive, et
c'est la seule raison recevable de ne pas la masquer). Le message nomme la colonne, pour
qu'une suite qui tombe ne se contourne pas en la rangeant dans la mauvaise liste.

**Tests** : 2 tests de contrat symétriques (ce que le MANAGER ne reçoit plus, ce que l'ADMIN
reçoit toujours) + 3 tests de garde statique.

---

## 2. Les sept majeurs

| # | Fichier:ligne | Ce qui est fait, et pourquoi | Test |
|---|---|---|---|
| **M-01 ≈ D-01** | `utils/insertion-freins-export.js:139` | `fmtDate` passe par `isoDate` (`utils/date-iso.js`). `node-pg` rend une colonne `DATE` à minuit LOCAL, `toISOString()` la relit en UTC : sous tout fuseau positif, la cellule rendait le JOUR PRÉCÉDENT. Cinq colonnes concernées, dont la date de naissance qui sert à APPARIER des personnes chez l'instructrice et la fin de Pass IAE dont un jour de recul change un statut. Famille D-05 de la PR B, dont le correctif de fond existait déjà sans avoir été porté ici. **Le grep de `toISOString().slice` est à zéro** dans `exports.js` et `insertion-freins-export.js` : les deux tampons de nom de fichier et le mois par défaut de l'export de production passent au jour civil de Paris (un export tiré le 1er janvier à 00 h 30 portait la date du 31 décembre). | `V-52` sous `TZ=Europe/Paris` |
| **M-02** | `routes/insertion/routes.js` × 8 | `pool.connect()` **dans** le `try`, `if (client)` au `catch` et au `finally`. Le rejet — `53300` — n'était attrapé par aucun `catch` ; Express 4 ne rattrape pas le rejet d'un gestionnaire `async`, aucun `unhandledRejection` n'existe dans le dépôt, Node ≥ 15 **termine le processus**. Ce n'est pas une requête pendante, c'est l'arrêt du backend — et la PR D rend l'épuisement plus probable. **Défaut connexe trouvé en corrigeant** : les deux handlers de compétences relâchaient leur client dans un retour anticipé ET dans le `finally` ; `pg` lève alors « Release called on client which has already been released » **depuis le `finally`**, hors de tout `catch` — même famille, même conséquence. | `insertion-pool-connect-contract` (5 tests + garde statique) — le trou comblé en PR B pour `temps.js` l'est ici |
| **M-03** | `services/dialogue-gestion.js` (`projeterSortieType`) | `sortie_type` est un `VARCHAR(50)` sans CHECK ni validateur : « CDI chez Leroy Merlin (oncle de M.) » devenait une CLÉ d'objet, rendue par l'API et **figée dans un snapshot**. Projection sur la liste fermée de `mon-parcours.js` — la MÊME, pas une copie ; hors liste → `autre`. J'ai gardé `par_type` (le contrat interdit de retirer une clé existante de `gatherAuditKpis`) : c'est la valeur qui est projetée, pas la structure. | contrat existant + `V-24` (JSONB relu en base) |
| **M-04** | `dialogue-gestion.js` blocs 3 et 4 | `actions == null` (échec) distingué de `[]` (rien) : le document affirmait « 0 action engagée » sur un axe où la structure en a peut-être mené quarante — un chiffre faux **dans le sens qui la dessert**, sur la pièce qui instruit son conventionnement. Idem entretiens et aides. Le bloc 9 gagne une ligne « Indicateur non rendu : la source n'a pas pu être lue » par bloc dégradé. | unitaire « une source ILLISIBLE ne s'imprime pas 0 aide » |
| **M-05** | `package.json`, `docker-compose.prod.yml`, les deux `.env.example` | `package.json` valait `1.0.0` et `APP_VERSION` n'était déclarée nulle part : les trois documents transmis portaient tous une version fausse, et le snapshot l'enregistrait — rejouer une synthèse ne disait jamais quelle version l'avait produite. Version à **2.55.0**, variable déclarée avec sa raison, `.env.example` documenté. | `tests/unit/app-version.test.js` (4 tests : les trois maillons + le repli) |
| **M-06** | `services/mon-parcours.js:120` | `CATEGORIE_ACTION_LABELS_RECAP` : `formation_fle` retombe sur « Formation » quand `insertion.recap_neutralise` est vrai. « Cours de français », daté, sur le document qu'une personne remet à un employeur, dit qu'elle a été identifiée comme ayant un frein linguistique — la classe de divulgation du correctif M-10 de la PR C. La catégorie reste NOMMÉE dans « Mon parcours en une page », qui ne circule pas. Réversible par le même réglage. | suites `mon-parcours` existantes (vertes) |
| **M-07** | `routes/performance.js:344` | `chargerSorties` est exportée par `dialogue-gestion.js` et **appelée** ; les deux requêtes recopiées disparaissent. Le moteur documente sa précondition (« le PREMIER bilan rencontré fait foi — la requête appelante les ordonne ») ; `performance.js` n'ordonnait pas. La règle vivait bien à un seul endroit, sa PRÉCONDITION s'était perdue en chemin — et une précondition ne se transmet pas par commentaire. | `V-13` (les quatre surfaces disent le même chiffre) |

---

## 3. Les sept défauts du debug

D-01, D-02, D-03, D-04, D-05, D-06, D-07 : **les neuf tests rouges sont verts**, sous
`TZ=UTC` **et** sous `TZ=Europe/Paris`.

| # | Ce qui est fait | Détail |
|---|---|---|
| **D-02** | `fetchFreinsRows` projette `lm.<col> AS <col>_actuel` (la dernière évaluation BRUTE) et `rowToCells` l'alimente | L'évolution comparait l'entrée à la valeur COURANTE, déjà repliée sur le diagnostic : elle comparait le diagnostic **avec lui-même** et rendait toujours « stable ». Or « stable » se lit « l'accompagnement n'a rien changé » là où la lecture juste est « nous ne l'avons pas remesuré », et l'indicateur central de la convention 2026-2027 sortait surévalué dans cette catégorie — pendant que la synthèse disait « non évalué » pour la même personne la même année. La valeur courante des colonnes 14-20 ne bouge pas ; la complétude redevient juste du même coup. `V-43b`, `V-43c`, `V-49` |
| **D-03** | `nb_semaines_relevees` est lu, côté export **et** côté synthèse | « 0 semaine sous 15 h » pour qui n'a aucune semaine relevée se lit, sur un document de contrôle, « cette personne n'est jamais passée sous le plancher » — l'exact contraire de ce qui est su. Cellule vide, `semaines_sous_15h: null` avec sa note, ligne de méthode au bloc 9, mention à l'écran de pilotage, feuille « Informations » corrigée. `V-46` |
| **D-04** | `DISTINCT ON` + `FILTER` sur `ec.id` | Un mois sans contrat produisait une ligne à NULL que le `COALESCE(…, 35)` transformait en 35 h : **1,00 ETP sorti de rien**, sur la colonne de contrôle d'un document de conventionnement, pour tout mois non encore couvert. Le `COALESCE(SUM(…), 0)` posé pour l'attraper ne se déclenchait jamais. **Connexe** : deux avenants ouverts comptaient deux fois — une personne pesait 1,49 ETP. `V-05b`, `V-05c` |
| **D-05** | `isFloat({ min: 0, max: 9999999.99 })` + `22003` traduit en 400 au POST et au PUT | La colonne est bornée, le validateur ne l'était que d'un côté. `V-55b` |
| **D-06** | `aplatirEnLignes` compose le libellé depuis `en_tete.k_anonymat` | Le fichier énonçait deux règles contradictoires sur sa propre méthode de suppression, dans le bloc que l'instructrice lit en premier quand un chiffre la surprend. `V-29b` |
| **Connexe 1** | voir D-04 | deux avenants ouverts |
| **Connexe 2** | `nb_dossiers` et `nb_sorties_suivies` entrent dans le **droit commun** | Le debug notait qu'ils sont exemptés « sans qu'aucune exigence ne les réclame ». Ils ne le sont plus : la liste blanche est réduite à ce qui est argumenté. |

---

## 4. Les treize mineurs

| # | Fait |
|---|---|
| **m-01** | voir D-05 (même correctif) |
| **m-02** | **Plancher à 5** sur `insertion.k_anonymat_min`. Un réglage à 1 désactivait toute suppression EN SILENCE pendant que le bloc 9 continuait d'écrire la règle. Un seuil de confidentialité ne se baisse pas par un champ de réglage ; il se relève. `V-29d` |
| **m-03** | couvert par B-01 : `nb_reponses` et `participants` sont des comptes de personnes, protégés par la passe, et `moyenne_globale` / `pct` tombent par dépendance |
| **m-04** | `ecrireJournal` ajoute `appelant` et `is_service` quand l'identité est une **clé d'API de service** (`id: null`) : la trace d'un export tiré par une clé était indiscernable d'une trace orpheline. C'est l'identité de l'APPELANT, l'objet même de la trace |
| **m-05** | La trace de l'**aperçu** devient BLOQUANTE. L'argument d'origine ne tient pas à l'examen : le registre et la synthèse vivent dans la MÊME base, et si le journal échoue, aucune des vingt requêtes de composition n'aurait abouti — le prix de disponibilité est théorique, celui de la trace perdue ne l'est pas |
| **m-06** | `niveau_formation` projeté sur la nomenclature fermée (5 valeurs) ; hors liste → « non renseigné ». Dix caractères libres devenaient un INTITULÉ DE LIGNE du document transmis. Le CSV imprime le libellé en clair |
| **m-07** | L'historique ne rend le prénom et l'initiale du générateur qu'à ADMIN/RH — le document lui-même ne porte que le RÔLE |
| **m-08** | En-tête de traçabilité du CSV des freins, en lignes commentées (`#`) : l'argument d'origine (« le tableau doit rester importable colonne à colonne ») est préservé, et un fichier de contrôle ne part plus sans date, sans périmètre et sans version |
| **m-09** | **11ᵉ purge** du registre : `insertion_dialogues_gestion`, 6 ans (durée des pièces justificatives d'un cofinancement européen), réglage `rgpd.dialogues_gestion_retention_jours`, branchée au scheduler, à la supervision et aux deux libellés français. `GET /rgpd/politique` compose désormais la règle des purges **depuis le registre** — la page qui décrit le code ne peut plus se désynchroniser de lui |
| **m-10** | Mesuré par le lot de debug (§ 5.7 : 29 ms, 61 requêtes sur la cohorte de recette, coût majoritairement fixe). Aucun cache ajouté : ajouter un cache sur une mesure qui ne montre pas de problème introduirait une source de chiffres périmés. **Reste à mesurer sur la cohorte de production au déploiement** |
| **m-11** | `routes/rse.js` projette explicitement `pmsmp` (3 compteurs) au lieu de l'étaler : le bilan RSE recevait `liste_entreprises` depuis la PR D |
| **m-12** | `refusDebouche` : 409 `PMSMP_NON_TERMINEE` sur une immersion en cours, 409 `DEBOUCHE_AVANT_FIN` sur une date antérieure à la fin, refus **avant écriture**. La garde n'existait que dans l'écran — une garde d'écran n'est pas une règle. `V-58b`, `V-58c` |
| **m-13** | Une complétude non calculable rend un trait pointillé neutre au lieu d'une barre vide qui se lit « 0 % » à côté d'un « — » |

---

## 5. Preuves

| Campagne | Résultat |
|---|---|
| `tests/e2e-pr-d`, `TZ=UTC` | **83 vertes / 83** (74 au départ, dont 9 rouges) |
| `tests/e2e-pr-d`, `TZ=Europe/Paris` | **83 vertes / 83** (10 rouges au départ) |
| `tests/e2e-pr-a` + `e2e-pr-b` + `e2e-pr-c`, les deux fuseaux | **316 vertes / 316** |
| Jest complet (sans base) | **251 suites / 5 070 tests verts**, 13 suites ignorées (e2e opt-in) |
| Build Vite | vert |
| `require` de chacun des 14 modules touchés | vert |
| Migrations, base existante | 2 passes, `exit 0` chacune (idempotentes) |
| Migrations, base NEUVE | échec de la passe 1 **reproduit à l'identique** (préexistant documenté PR A), puis `migrate-exutoires` → `migrate-finance` → 2 passes `exit 0` ; **245 tables**, `insertion_dialogues_gestion` à 7 colonnes, partenaire CMS en **exactement 1 ligne** |
| `grep toISOString().slice` sur `exports.js` et `insertion-freins-export.js` | **0** |

### 5.1 Contre-épreuves par mutation (11, toutes restaurées)

| # | Mutation | Tests verts qui tombent |
|---|---|---|
| 1 | k-anonymat neutralisé | **7** e2e + **6** unitaires/contrat |
| 2 | suppression complémentaire retirée | **3** unitaires — **0 e2e** (voir ci-dessous) |
| 3 | taux miroirs non suivis | **0 partout** → **trou comblé**, puis **1** e2e |
| 4 | `ACTIONS_TEXTE_LIBRE` ramené à deux champs | **3** |
| 5 | bloc des statuts sociaux recomposé pour tous | **2** contrat + **1** e2e |
| 6 | `fmtDate` repassé par UTC (`TZ=Europe/Paris`) | **1** |
| 7 | évolution relisant la valeur repliée | **3** e2e + **1** unitaire |
| 8 | mois sans contrat revalant 1,00 ETP | **2** |
| 9 | `pool.connect()` ressorti du `try` (POST /pmsmp) | **4** |
| 10 | colonne « semaines » réimprimant 0 | **2** |
| 11 | chargement partagé des sorties retiré de `performance.js` | **1** |

**Les deux mutations instructives, dites sans les arranger.**

- **La n° 3 ne faisait tomber aucun test, nulle part.** Les taux miroirs sont pourtant
  exactement le canal que B-01 ferme : un taux multiplié par un dénominateur publié rend son
  numérateur. Rien ne le gardait. `V-15c` le vérifie maintenant sur la cohorte réelle
  (dénominateur 5, « emploi durable » à 1 : publier 20 % rendrait la case).
- **La n° 2 ne fait tomber aucun test e2e**, et je ne le masque pas : sur la cohorte de
  recette, les ventilations ont déjà **plusieurs** cases sous le seuil, donc la règle du
  complément ne mord jamais. `V-15d` pose l'invariant (« jamais exactement une case
  retirée ») mais passe de façon non discriminante ici ; c'est le test **unitaire**, qui
  CONSTRUIT le cas — 6 personnes dont 1 en catégorie A —, qui tient réellement cette règle.

---

## 6. Tests de lot amendés, et pourquoi

Un correctif qui change une règle change les tests qui la mesuraient. Chacun porte la raison
de son changement dans le fichier ; les voici rassemblés.

| Test | Ce qui change | Raison |
|---|---|---|
| `V-03`, `V-05` | vérifient le SQL sur `/audit` (écran interne, sans suppression) et la SUPPRESSION sur le document | leurs valeurs — 3 points d'étape, 1 conciliation, un partenaire unique — sont précisément ce que B-01/D-07 retire |
| `V-13` | n'exige plus l'égalité terme à terme des taux | après correctif le document **dit moins** que l'écran ; la cohérence exigible est qu'il ne dise jamais **autre chose**, et c'est ce qui est asserté |
| `V-15`, `V-16`, unitaires bloc 2 / bloc 3 | portent sur le compte par bloc | `sous_seuil` ne nomme plus le chemin |
| `V-29b`, `V-29c` | seuil d'essai 8 au lieu de 3 | le plancher m-02 refuse un seuil sous 5 |
| `V-43c` | lit les blocs internes | même motif que `V-03` |
| unitaires bloc 4/5/7/8 | fixtures portées au-dessus du seuil, et deux cas neufs **sous** le seuil | ils mesuraient des valeurs que la passe retire désormais |
| `V-114` (PR C) | compare au `PURGES_RGPD.length` au lieu de figer « 10 » | figer le compte ferait tomber une suite de PR C pour une évolution de PR D, sans rien prouver de plus |
| lecture CSV des suites (d) | filtre les lignes `#` | conséquence de m-08 |

**Tests neufs** : `actions-texte-libre` (3), `insertion-pool-connect-contract` (6),
`app-version` (4), k-anonymat structurel (3), B-02 contrat (4), `V-05c`, `V-15b`, `V-15c`,
`V-15d`, `V-29d`, `V-35d`, `V-35e`, `V-58b`, `V-58c`, m-07, D-02 « jamais réévaluée »,
M-04 « source illisible », B-01 « raison sociale sous le seuil », suppression complémentaire.

---

## 7. Arbitrages restants — et le défaut que j'ai appliqué

Chacun est **fermé au plus sûr** et **réversible**.

1. **Le seuil k et son plancher.** Défaut appliqué : plancher **5**, réglage utilisable
   seulement pour **durcir**. Si la direction veut pouvoir l'abaisser (petite structure,
   document interne), c'est une décision DPO, pas un champ de réglage — et il faudra retirer
   le `Math.max` en le disant.
2. **La suppression complémentaire coûte un chiffre par ventilation.** Défaut appliqué :
   **oui**, conformément à la recommandation de la revue (§ 6.2). Sur une distribution à deux
   cases non nulles, les deux disparaissent : c'est la conséquence arithmétique, pas un
   réglage. À arbitrer si l'autorité juge le document trop pauvre.
3. **Ce que l'indicateur n° 15 mandate reste publié.** Dénominateur, sorties documentées et
   non documentées sortent en clair même sous le seuil — l'autorité les exige. Conséquence
   assumée et **dite au bloc 9** : sur une période à moins de cinq sorties, la ventilation
   entière est retirée, sans quoi elle se reconstituerait par élimination.
4. **`liste_entreprises` ou le secteur d'activité ?** Défaut appliqué : la liste est
   conservée **au-dessus du seuil** et retirée en dessous (avec `jours` et
   `entreprises_distinctes`). La revue suggérait d'étudier le remplacement par le secteur
   d'activité, « qui est ce que l'autorité regarde réellement » — la donnée n'existe pas en
   base, c'est un chantier de saisie.
5. **L'axe santé au bloc 3** (écart E-6, arbitrage n° 1 de la revue). Défaut appliqué :
   **conservé**. La revue demandait de corriger B-01 d'abord puis de trancher ; B-01 est
   corrigé, l'agrégation tient donc son argument. Si la direction le retire, cela coûte une
   ligne (`AXES_BLOC3` filtre déjà un axe).
6. **Le périmètre du MANAGER**, réserve E1 des quatre revues. B-02 ferme la surface ; il ne
   règle pas la question de fond — un encadrant n'est borné par aucune équipe. Ouvert depuis
   la PR A.
7. **L'exemption de MFA des clés de service** sur les exports (e) et (d). m-04 rend la trace
   lisible ; la décision d'exempter reste celle de la 2.45.0.
8. **La base légale de la transmission au référent** (PR B) reste ouverte, et
   `insertion_dialogues_gestion` n'a toujours **aucune entrée art. 30** — défendable (contenu
   agrégé, conforme au contrat § 3), mais à confirmer par le DPO maintenant que la table a
   une rétention écrite.
9. **`typologies.rqth` dans le bilan RSE.** Le module RSE appelle `gatherAuditKpis` sans rôle
   (défaut ADMIN) et reçoit donc le compte RQTH de la structure entière, alors que REF_RSE a
   pour base MANAGER. Hors périmètre des deux rapports, et hors PR D — mais c'est la même
   question que B-02, posée sur un autre module.
10. **`m-10`, coût de `/insertion/audit`.** 29 ms et 61 requêtes sur 12 dossiers ; à mesurer
    sur les ~46 de production au déploiement.

---

## 8. Phrases de documentation que ces correctifs rendent fausses

*(Le lot 8 n'est pas repassé après moi ; je ne modifie pas `docs/`.)*

| Fichier | Phrase | Ce qu'il faut écrire |
|---|---|---|
| `VARIABLES_APPLICATION.md:398` | « `insertion.k_anonymat_min` \| `5` \| … n'est **pas** restitué (`null` + `sous_seuil: true`) » | le réglage ne sert qu'à **durcir** (plancher 5) ; `sous_seuil` n'est plus un drapeau par champ mais un **compte par bloc**, et `sous_seuil_total` s'y ajoute |
| `VARIABLES_APPLICATION.md:294` | « Les **dix** purges » | **onze** (`rgpd.dialogues_gestion_retention_jours`, 2 190 j, à ajouter au tableau) |
| `VARIABLES_APPLICATION.md` | — (absent) | **`APP_VERSION`** manque : elle est désormais déclarée dans le compose et dans les deux `.env.example`, et porte l'en-tête de traçabilité des trois documents transmis |
| `GUIDE_CIP_CONFORMITE_FSE.md:423` (§ 13, bloc 8) | « …semaines sous 15 h » | ajouter que l'indicateur n'est **pas rendu** quand aucune semaine n'est relevée — ce n'est pas « zéro semaine sous le plancher » |
| `GUIDE_CIP_CONFORMITE_FSE.md:427` | « tout agrégat portant sur **moins de cinq personnes** est rendu absent » | vrai, mais incomplet : préciser que les **comptes d'actions, d'orientations, d'aides et de gestes de conformité** le sont aussi, que la **liste des entreprises d'accueil** disparaît sous le seuil, qu'une **seconde case** peut tomber par suppression complémentaire, et que le document donne le **nombre** d'agrégats retirés par bloc et non leur emplacement |
| `GUIDE_CIP_CONFORMITE_FSE.md:434` | « → “Aperçu” (ne rien enregistre) » | l'aperçu **journalise désormais de façon bloquante** (m-05) : il ne crée toujours aucun snapshot, mais il ne s'affiche pas si le journal est indisponible |
| `GUIDE_CIP_CONFORMITE_FSE.md:223` | « une seule ligne d'en-tête, et cinq lignes de traçabilité » (export FSE+) | inchangé — mais le **tableau des freins en CSV** a maintenant lui aussi son en-tête commenté (m-08), à mentionner là où ce guide décrit l'export (d) |
| `NOTE_CERTIFICATEURS_INSERTION.md:105` | « les moyennes de freins présentées en agrégat de pilotage incluent l'axe judiciaire pour les rôles ADMIN/RH ; …k-anonymat faible… » | à préciser : la **synthèse transmise** applique désormais un k-anonymat structurel sur tout le document et **n'a jamais porté l'axe judiciaire** ; la réserve ne vaut que pour l'écran interne ADMIN/RH |
| `DOCUMENTATION_APPLICATIVE.md:256` | « l'indicateur `nb_semaines_sous_seuil`, lui, compte aussi les arrêts » | vrai, mais la restitution change : une cohorte **sans aucune semaine relevée** ne rend plus 0, elle rend `null` avec sa note |

## 8 bis. Phrases marquées « non livré » que le lot 6 a pourtant livrées

Les écrans existent et sont câblés : `DialogueGestionPanel.jsx` (19,7 Ko) est monté comme
onglet « Dialogue de gestion » d'`AuditInsertion.jsx:987`, `pdf-dialogue-gestion.js`
(20,6 Ko) compose le PDF, `ActionsPanel.jsx` porte les six champs DORA / aide,
`PmsmpPanel.jsx` le sélecteur de débouché, et le tableau des freins enrichi sort ses 45 / 48
colonnes (prouvé par `V-39`, `V-40`, `V-44` sur base réelle).

| Fichier | Phrase à reprendre |
|---|---|
| `GUIDE_CIP_CONFORMITE_FSE.md:395` | « **État au 14/09/2026 : calcul livré, écran non livré.** … ni le formulaire d'orientation DORA / aide mobilisée, ni le sélecteur de débouché d'une PMSMP, ni l'onglet “Dialogue de gestion” lui-même » — **les trois sont livrés** |
| `GUIDE_CIP_CONFORMITE_FSE.md:488` (FAQ 12) | « **Nulle part encore** au 14/09/2026… aucun écran ne les propose. Ne cherchez pas un bouton caché : il n'existe pas encore » — il existe |
| `GUIDE_CIP_CONFORMITE_FSE.md:480` (FAQ 8) | « **La synthèse de dialogue de gestion (§ 13, chantier D) ne l'est pas** » |
| `GUIDE_CIP_CONFORMITE_FSE.md:14`, `:23` | « § 13, chantier D — en cours de livraison » / « n'a, au 14/09/2026, aucun écran » |
| `GUIDE_CIP_INSERTION.md:9` et pied de page | « **Trois de ces quatre cas décrivent un écran qui n'existe pas encore** » — à retirer, et les cas 29 à 32 à passer au présent |
| `NOTE_CERTIFICATEURS_INSERTION.md:16` | « **aucun écran** ne donne accès à ce qui précède … ces quatre écrans restent … un squelette. Le **tableau des freins enrichi** n'est pas non plus commencé » — **tout est livré**, et c'est la phrase la plus exposée du dossier : elle part à des certificateurs |
| `NOTE_CERTIFICATEURS_INSERTION.md:77` (item 12) | « *Prévu, chantier D, non encore branché* : l'écran “Pilotage & indicateurs” n'affiche pas encore ce nouveau dénominateur » — il l'affiche |
| `NOTE_CERTIFICATEURS_INSERTION.md:147-148` | le tableau « Points retirés ou reformulés » décrit une ligne de partage qui n'existe plus |
| `DOCUMENTATION_APPLICATIVE.md:282`, `:291` | « **couche serveur livrée, couche écran non livrée** » ; « chacun distinguant explicitement le calcul serveur (livré) de l'écran (non livré) » |
| `MATRICE_QUI_VOIT_QUOI_INSERTION.md:30-31` | **rien à corriger, mais à signaler** : les lignes « BRSA ∅ MANAGER » et « Catégorie France Travail ∅ MANAGER » décrivaient une intention que le code ne tenait pas (elles revenaient par `/insertion/audit`). Depuis B-02, **la matrice dit vrai** |

---

## 9. Ce que je n'ai pas fait

- **Aucune écriture dans `docs/` ni dans `CLAUDE.md`** (§ 8 et 8 bis les recensent).
- **Aucune entrée art. 30** pour `insertion_dialogues_gestion` : le contrat § 3 dit « aucune
  donnée nominative nouvelle → aucune entrée », et la rétention est désormais écrite. À
  confirmer par le DPO (arbitrage n° 8).
- **Aucun cache** sur `/insertion/audit` (m-10) : la mesure du lot de debug ne montre pas de
  problème, et un cache ajouté par précaution devient une source de chiffres périmés.
- **Le PDF n'est pas éprouvé au rendu** (limite n° 1 du rapport 28) : je l'ai modifié
  (`sous_seuil` agrégé, liste d'entreprises retirée nommée comme telle) et le build est vert,
  mais le rendu A4 relève d'un contrôle visuel qui reste à faire.
- **Le front n'est pas ouvert dans un navigateur** (limite n° 2, inchangée).

---

*Agent de correctifs, PR D, 14 septembre 2026. 9 commits, 36 fichiers, +2 107 / −275.
Aucun `git push`.*
