# Ce que j'attends de la refonte du module CIP — le point de vue de la conseillère

- **Qui écrit** : Nadia, conseillère en insertion professionnelle de Solidarité Textiles. 8 ans en SIAE, dont 3 ici. Je suis **seule** sur le poste : 0,86 ETP conventionné, soit à peu près 30 heures par semaine, pour **46 salariés en parcours**. Cela fait ~53 accompagnements par ETP, et environ **un jour et demi de CIP par salarié et par an**, entretiens compris.
- **Date** : 12 septembre 2026.
- **Ce que j'ai lu pour écrire ça** : les trois documents de Fariza D'André repris dans `00-exigences-autorite.md`, les trois reconnaissances (`01` backend, `02` frontend, `03` docs & reporting), le `GUIDE_CIP_INSERTION.md`, le `REFERENTIEL_PERFORMANCE_CIP.md`, et la revue UX de juillet 2026 (`rapports/insertion-2026-07-22/06-revue-ux-cip.md`, les 19 REC-UX).
- **Ce que j'ai vérifié moi-même dans le code** : `frontend/src/pages/InsertionParcours.jsx`, `components/insertion/DiagnosticForm.jsx`, `EntretienForm.jsx`, `backend/src/routes/insertion/routes.js`, `backend/src/routes/employees.js`, `backend/src/routes/exports.js`, `backend/src/services/scheduler.js`. Quand j'affirme quelque chose de désagréable, je donne le fichier et la ligne. Je ne suis pas informaticienne, mais je sais lire une liste de champs autorisés, et j'ai le droit de vérifier ce qu'on me dit.
- **Statut** : avis d'utilisatrice. N'engage aucun code. Sert d'entrée au plan d'action de la refonte.

> **Mon cadre mental, en trois phrases.** Mon problème n° 1 c'est le **temps** : cinq minutes de saisie en plus par bilan, ce sont trente minutes perdues par semaine, et donc un salarié que je ne vois pas. Mon problème n° 2 c'est la **double saisie** entre SOLIDATA et les plateformes d'État (les Emplois de l'inclusion, Ma Démarche FSE+, DORA, RDV-Insertion). Mon problème n° 3 c'est de me faire **piéger par une pièce manquante** en contrôle : une sortie non renseignée dans le mois bloque le dépôt du bilan financier FSE+, et ce n'est pas un incident informatique, c'est de l'argent qui n'arrive pas.

---

## 1. Ma semaine type avec SOLIDATA, telle qu'elle est aujourd'hui

### 1.1 Le budget réel de ma semaine

30 heures. Voici où elles partent, en moyenne sur un trimestre. Les durées sont les miennes, chronométrées sur deux semaines de septembre parce que je savais que j'écrirais ce document.

| Bloc | Volume hebdo | Temps réel | Dont saisie SOLIDATA |
|---|---|---|---|
| Entretiens en face-à-face (bilans, diagnostics, période d'essai, sorties) | 6 à 8 | 7 h 00 | — |
| Saisie et clôture de ces entretiens | 6 à 8 | **3 h 00** | 3 h 00 |
| Renouvellements CDDI (relance encadrant, instruction, circuit direction) | ~2 | 1 h 30 | 0 h 40 |
| Actions au fil de l'eau (CAF, CPAM, bailleur, préfecture, auto-école) | 15 à 25 | 4 h 00 | **0 h 15** |
| Accueil / diagnostic d'un nouvel entrant | ~0,7 | 2 h 00 | **0 h 50** |
| Revue du lundi + replanification | 1 | 0 h 40 | 0 h 40 |
| Partenaires, réseau, visites d'entreprise, PMSMP à monter | — | 4 h 00 | 0 h 20 |
| Plateformes d'État (Emplois de l'inclusion, MDFSE+, actualisations) | — | **2 h 30** | 0 h 00 (aucune reprise) |
| Réunions internes, encadrants, direction | — | 2 h 30 | — |
| Reporting périodique (trimestriel FSE+, comités, ASP) | amorti | 1 h 30 | 1 h 30 |
| Imprévus (et il y en a toujours) | — | 1 h 20 | — |

**Total de saisie dans SOLIDATA : ~7 h 15 par semaine, soit un quart de mon temps.** Sur ces 7 h 15, j'estime qu'il y a **2 h 30 de saisie qui ne sert à personne d'autre qu'à remplir un champ** — soit parce que je l'ai déjà tapée ailleurs, soit parce que personne ne la relit jamais.

### 1.2 Lundi, 8 h 30 — la revue de semaine (35-40 min)

J'ouvre **Espace CIP** (`/insertion`, `InsertionParcours.jsx`). J'atterris sur le `CohortePanel`, qui est franchement une bonne page. Dans l'ordre :

1. **`AgendaBloc`** : mes entretiens d'aujourd'hui et de la semaine, avec l'heure et le badge « Préparation IA prête ». C'est exactement ce que la revue de juillet demandait en REC-UX-07, et ça a été tenu. Je clique, j'arrive sur la fiche du bon salarié. Bien.
2. **`AlertesBloc`** : regroupées par salarié, trois couleurs, et surtout le bouton **« Vu — me le rappeler dans 7 jours »** qui est *enregistré en base et partagé*, pas dans mon navigateur. REC-UX-08 tenue. C'est le genre de détail qui fait la différence entre un outil et un décor.
3. **`RenouvellementsBloc`** : les fins de contrat dans 42 jours, avec « Créer l'entretien » et le lien vers le formulaire encadrant. Utile — mais voir §1.5, le lien ne marche pas comme annoncé.
4. Les 4 KPI (En parcours / Entretiens en retard / À venir 7 j / Sorties dynamiques) et la jauge d'objectif.

**Où je perds du temps dès cet écran** :

- La **colonne de gauche** liste « Salariés suivis », et **il n'y a ni champ de recherche, ni filtre, ni pagination**. J'ai vérifié : `InsertionParcours.jsx:1002-1018` affiche `employees.map(...)` sans aucun filtrage, et la requête `GET /insertion` (`routes.js:134-141`) fait `WHERE e.is_active = true` — **tous les salariés actifs**, pas seulement ceux en parcours. Donc ma liste contient aussi les permanents : encadrants, chauffeurs, administratif. Je dois faire défiler ~70 noms pour en trouver un parmi 46. Quand quelqu'un m'appelle au téléphone et que je dois ouvrir sa fiche pendant qu'il parle, je fais **Ctrl+F dans le navigateur**. Ce n'est pas une fonctionnalité, c'est un contournement.
- La case **« Mes salariés »** ne filtre **que les statistiques** du tableau de bord : elle passe `?mine=1` à `/insertion/cohorte/stats` (`InsertionParcours.jsx:510`) et ne touche pas la liste de gauche. Je suis seule CIP, donc ça ne me gêne pas aujourd'hui — mais si la structure recrute la seconde CIP annoncée dans l'AAP du Département (S2), ça devient un vrai problème le premier jour.
- Pour revenir au tableau de bord après avoir ouvert une fiche, il faut **recliquer le bouton « Tableau de bord CIP »** en haut de la liste. Je le perds une fois sur trois.

### 1.3 Mardi — les entretiens (le cœur du métier)

**Préparation, 10-15 min par entretien.** La synthèse factuelle s'affiche tout de suite, et quand la préparation IA J-7 est là, elle est vraiment utile : elle me rappelle des choses que j'avais oubliées d'un bilan sur l'autre. Je la corrige toujours, souvent beaucoup. Le fait qu'elle soit **étiquetée « proposition »** et **historisée** avec mes corrections, c'est ce qui me permet de la défendre en réunion : ce n'est pas l'ordinateur qui a décidé, c'est moi, et ça se prouve.

**L'entretien, 45 à 60 min.** Je suis en face de la personne. Je ne tape pas pendant l'entretien — ou alors très peu, pour cocher les freins pendant qu'on en parle. Le **mode relecture** (REC-UX-17), quand je l'utilise, change vraiment la conversation : on regarde l'écran ensemble au lieu que je sois derrière.

**La saisie et la clôture, 20 à 30 min.** Et là, ce qui marche vraiment bien :

- **L'étape « Depuis le dernier bilan »** avec les objectifs et actions repris automatiquement, un tap par ligne [Atteint / En partie / Non fait], et le respect des échéances **calculé et pas demandé**. C'est REC-UX-03 et c'est excellent. C'est ce qui fait que le bilan SOLIDATA est plus rapide que mon ancien Word.
- **L'autosave** : j'ai fermé l'onglet en plein diagnostic une fois, j'ai tout retrouvé. REC-UX-01 tenue.
- **La clôture contrôlée** (`routes.js:693`) : le refus de clôture champ par champ, avec les ancres qui me font défiler au bon endroit. Et surtout : **impossible de clôturer sans prochain rendez-vous**. Ça m'a évité au moins une dizaine de salariés « oubliés » depuis juillet. Je râle contre au moment où ça me bloque, et je suis contente trois semaines plus tard.
- **Le verrou `locked_at` et l'historique `insertion_milestones_history`**. Je sais ce que ça vaut en contrôle. La réouverture motivée par un ADMIN, c'est pénible, mais c'est exactement la garantie qu'un contrôleur veut voir.

**Où je perds du temps pendant la saisie** :

- Je **ressaisis les freins à chaque entretien** alors qu'ils sont déjà dans le diagnostic. Ils sont pré-remplis avec la dernière évaluation, d'accord — mais je dois quand même repasser sur les neuf axes, confirmer, et c'est neuf gestes × 6 bilans par semaine.
- **Il n'y a aucun champ de durée sur un entretien.** J'ai vérifié : `insertion_milestones` n'a pas de colonne de durée (recon `01`, §3 ; et dans `EntretienForm.jsx` les seuls « durée » sont `renouvellement_duree_mois` et `sortie_duree_contrat_mois`). Or le `REFERENTIEL_PERFORMANCE_CIP.md` publie un indicateur **B5 « Volume d'accompagnement (heures) »** défini comme « durées des entretiens réalisés + durées saisies sur les actions », et le `GUIDE_CIP_INSERTION.md` §9 promet noir sur blanc « durée de l'entretien (valeur proposée, ajustable) » dans la fenêtre de clôture. **Ce champ n'existe pas.** Je ne peux donc produire aucun volume d'heures d'accompagnement — c'est-à-dire précisément la matière de l'article 5 de la convention, et bientôt la matière des feuilles de temps FSE+ (F3). C'est le trou le plus embêtant de tout le module.

### 1.4 Mercredi — les actions au vol (30 secondes, et c'est parfait)

Le **`QuickActionButton` « + Action »** est la meilleure chose du module. Deux champs, Entrée, toast, je reste sur ma page, les derniers dossiers consultés en premier. REC-UX-04 tenue et chronométrée. Je l'utilise 15 à 25 fois par semaine. **Ne touchez à rien.**

Le tableau **Actions CIP** (`/insertion/actions`) fait le reste : filtres, statut éditable en ligne, export CSV. Ce qui me manque : les actions n'ont pas de **partenaire obligatoire** ni de **durée renseignée en pratique** (le champ `duree_minutes` existe côté base et n'est **jamais agrégé nulle part** — recon `03` §9), et je ne peux pas sortir de statistique par partenaire (c'est l'EXG-19 resté ouvert depuis juillet). Or c'est exactement ce que le Département va me demander pour justifier le « réseau mobilisé pour la levée des freins » (S2).

### 1.5 Jeudi — les renouvellements (~2 par semaine, ~100 par an)

Le circuit est : encadrant technique → moi → direction. L'écran **`RenouvellementETI`** existe (`/insertion/renouvellement/:milestoneId`), il est FALC, gros boutons, un salarié un écran. C'est la REC-UX-06, elle a été déclarée bloquante en juillet et elle a été livrée. Sauf que :

**Le lien « à envoyer à l'encadrant » n'est pas envoyable.** J'ai vérifié dans `frontend/src/App.jsx:208` : la route est sous `<ProtectedRoute roles={['ADMIN','RH','MANAGER']}>`. Il n'y a **aucun jeton public**. Donc l'encadrant doit : avoir un compte SOLIDATA, être MANAGER, être connecté, et avoir passé la double authentification. Dans les faits, deux de mes trois encadrants n'ouvrent jamais l'outil. Résultat : **je remplis leur formulaire moi-même** à partir de ce qu'ils me disent dans le couloir, ce qui vide de son sens la « triple validation » que je présente en contrôle comme une preuve de co-décision. C'est exactement la double saisie que REC-UX-06 devait supprimer.

Comparez avec la tournée du chauffeur : là, il y a un jeton par véhicule, une URL, un raccourci sur l'écran d'accueil, et une révocation. Ce modèle existe déjà dans la maison (`vehicles.qr_token`). Je ne comprends pas pourquoi l'encadrant n'y a pas droit.

### 1.6 Vendredi — les sorties, les exports, et la peur du contrôle

**Une sortie** me prend 30 à 40 minutes : bilan de sortie, classification en 4 catégories, documents de sortie (STC, certificat, attestation France Travail), satisfaction, et le bloc `fse_sortie`. La classification en 4 catégories alignée sur la nomenclature, c'est du bon travail — je n'ai plus la discussion « est-ce que c'est une sortie positive ? » avec la direction, la définition est écrite dans l'outil.

**Ce qui me fait peur, et j'insiste** : la règle FSE+ dit que le statut de sortie doit être saisi **dans le mois suivant le départ**, sinon la plateforme **bloque le dépôt des bilans financiers** (F7). Aujourd'hui, rien dans SOLIDATA ne me le rappelle. Il y a une alerte « entretien en retard », mais un salarié qui part sans bilan de sortie — parce qu'il a disparu, parce qu'il a trouvé un emploi du jour au lendemain, parce qu'il a été licencié — ne déclenche **aucune alerte de type « sortie non renseignée »**. Je le sais parce que c'est arrivé deux fois cette année et que c'est ma mémoire qui a sauvé le dossier, pas l'outil.

**L'export FSE+ trimestriel** me prend 2 à 3 heures, parce que je vérifie tout à la main. Et là j'ai trouvé quelque chose de sérieux en lisant la recon `03` §5.1, que j'ai vérifié dans `backend/src/routes/exports.js` : la colonne **« Heures travaillées (trimestre) »** est calculée par un `SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600)` sur la table `work_hours` — **qui n'a pas ces colonnes**. La requête échoue, elle est rattrapée par un `.catch(() => ({ rows: [] }))`, et l'export sort **avec une colonne d'heures vide, sans aucun message d'erreur**. J'ai remis cet export à la gestionnaire FSE+ en juillet en pensant qu'il était complet. Ce n'est pas un détail esthétique : c'est une pièce de dossier fausse, remise à un financeur, sans que rien ne me prévienne.

Et pendant qu'on y est : **l'export FSE+ et l'export Excel complet ne sont pas journalisés** alors que la `NOTE_CERTIFICATEURS_INSERTION.md` promet aux contrôleurs que « chaque export nominatif est journalisé ». Seul le tableau des freins l'est. Si un contrôleur vérifie cette promesse, c'est moi qui suis devant lui.

### 1.7 Ce qui marche, et que je veux qu'on garde — liste explicite

Parce qu'une refonte qui casse ce qui marche, ce serait pire que pas de refonte.

1. Le **« + Action » en 30 secondes**, partout, avec les récents en premier.
2. La **clôture contrôlée** et son refus champ par champ, y compris l'impossibilité de clôturer sans prochain RDV.
3. Le **verrou + historique** des entretiens clôturés, et la réouverture motivée.
4. Les **alertes acquittables en base et partagées**.
5. L'étape **« Depuis le dernier bilan »** avec le report automatique et le calcul des échéances.
6. L'**autosave** du diagnostic et du bilan, avec reprise à la rubrique.
7. La **note de profil initial** générée à la liaison : elle me fait gagner une vraie demi-heure de lecture de dossier de recrutement, et l'ordre choisi (la parole de la personne en premier, le PCM en dernier, les manques nommés) fait qu'elle ne m'enferme pas dans une étiquette.
8. Le **choix « Non évalué »** sur les freins, distinct de 1. C'est un détail technique qui est en réalité une position déontologique, et elle est juste.
9. Le **masquage MANAGER** de la santé et du judiciaire, et les **notes de suivi chiffrées, ADMIN/RH strict**.
10. Les **deux gabarits PDF** (exemplaire salarié FALC / exemplaire dossier).

---

## 2. Ce que les nouvelles exigences changent dans mon travail

Je reprends les références de `00-exigences-autorite.md`. Pour chacune : ce que je fais **aujourd'hui, à la main ou en double**, et ce que SOLIDATA devrait porter. J'indique à chaque fois s'il s'agit de **NOUVEAU**, de **RÉORGANISATION** ou de **CORRECTIF**.

### 2.1 Loi Plein Emploi et référent unique (A1 → A6)

| Réf. | Ce que je fais aujourd'hui | Ce que SOLIDATA devrait porter | Type |
|---|---|---|---|
| **A1** — inscription automatique FT des BRSA | Je sais qui est BRSA par ce que la personne me dit en entretien et par la colonne `ressources` du diagnostic (case « RSA ») — donc **du déclaratif**. La seule source fiable de la structure est l'état ASP importé côté Effectifs. Je note l'identifiant FT sur un post-it quand la personne me l'apporte. | Un attribut **BRSA** de la personne, daté, avec sa source (déclaratif entretien / attestation CAF / état ASP), distinct d'une case cochée dans un diagnostic. Le champ `france_travail_id` existe déjà en base — il n'est **saisissable nulle part**. | NOUVEAU + CORRECTIF |
| **A2** — orienteur unique ≠ référent unique | Je confonds les deux dans la fiche parce que SOLIDATA n'a qu'un seul champ « prescripteur ». L'organisme qui a **orienté** (CMS, Mission locale) et celui qui est **référent unique** du parcours ne sont pas forcément le même, et pour certains BRSA c'est **nous**. | Trois champs distincts : **orienteur** (qui a envoyé la personne), **prescripteur habilité** (qui a délivré le Pass), **référent unique** (qui tient le CER) — avec la valeur « Solidarité Textiles » possible sur le dernier. Le référentiel `prescripteur_orgas` et ses 8 types est la bonne base, il faut juste arrêter de tout ranger dedans. | RÉORG + NOUVEAU |
| **A3** — actualisation mensuelle si le référent est FT | Rien. Je ne le trace pas, et je découvre les ruptures de droits quand la personne me dit qu'elle n'a pas été payée. | Une **échéance mensuelle récurrente** sur les salariés dont le référent unique est FT, avec case « actualisation rappelée le … ». Ce n'est pas moi qui actualise — mais c'est moi qui préviens, et une rupture de droits, ça casse un parcours en deux semaines. | NOUVEAU |
| **A4** — CER obligatoire, 15-20 h/semaine d'activités | J'ai un CER **en Word**, hors de l'outil, pour les quelques BRSA dont nous sommes référents. Le volume horaire, je ne le compte pas : je suppose que le CDDI à 26 h suffit. **Je ne peux pas le prouver.** | Voir §2.2. Pour les heures : la table **`employee_week_hours`** existe déjà (heures hebdo réelles importées de la paie : travaillées, attendues, contractuelles, absences) et **n'est lue par absolument rien** (recon `03` §7). C'est la brique du compteur 15-20 h, elle est déjà là. | NOUVEAU (mais brique existante) |
| **A5** — CMS, forums, job datings Job 76 | Je les note en action libre, avec un libellé que j'invente à chaque fois (« job dating », « forum emploi », « Job76 »). Impossible d'en tirer un chiffre. | Une **catégorie d'action « événement emploi »** et des partenaires typés « CMS ». Le référentiel `insertion_partenaires` (16 seedés) accepte déjà une catégorie : il suffit d'en ajouter et d'en faire un **filtre de reporting** (EXG-19, ouvert depuis juillet). | RÉORG |
| **A6** — DTR trimestrielle, conciliation, suspension-remobilisation | Quand un salarié risque une sanction, je rédige un courrier à la main en fouillant dans mes notes pour retrouver les absences justifiées. Ça me prend une heure et je ne suis jamais sûre d'être exhaustive. | Un **relevé d'assiduité par salarié** composé depuis `employee_leaves` (import paie, déjà là) + les notes de suivi datées, imprimable en une page « éléments de contexte transmis au référent ». **C'est un outil de protection du salarié**, pas de contrôle. | NOUVEAU (assemblage de briques existantes) |

### 2.2 Le Contrat d'Engagements Réciproques (C1 → C7)

Le CER est **le trou le plus béant** : il n'existe pas du tout dans SOLIDATA (0 occurrence, recon `01` §7). Aujourd'hui je le fais en Word, et je ressaisis dans ce Word ce qui est déjà dans le diagnostic.

| Réf. | Ce que je fais aujourd'hui | Ce que SOLIDATA devrait porter | Type |
|---|---|---|---|
| **C1** — rédigé en entretien individuel | Entretien fait, trace Word, aucun lien avec le parcours SOLIDATA. | Un **7ᵉ type d'entretien : « CER / point d'étape CER »**. Les 6 types existants sont déjà gérés proprement (contrainte CHECK, échéancier, clôture) : on ajoute une ligne, pas un module. | NOUVEAU (extension d'un mécanisme existant) |
| **C2** — diagnostic partagé | Je **recopie** à la main dans le Word les rubriques logement / santé / mobilité / garde d'enfants que je viens de saisir dans `DiagnosticForm`. **C'est ma double saisie n° 1.** | Un **export « CER » du diagnostic** : un PDF à la trame du CER, alimenté par le diagnostic et les 9 freins. Le moteur de PDF existe (`pdf-insertion.js`, 5 générateurs). C'est un 6ᵉ gabarit, pas une refonte. | NOUVEAU (gabarit) |
| **C3** — co-construction, démarches réalistes | Les objectifs à origine « salarié » existent et sont bien faits. Je les recopie dans le Word. | Les objectifs **d'origine salarié** deviennent les « engagements du bénéficiaire » du CER. Aucune saisie nouvelle : c'est un affichage. | RÉORG |
| **C4** — engagements du bénéficiaire (dont 15-20 h et présence aux RDV) | Rien de comptabilisable. | Le **compteur d'activité hebdomadaire** (§2.1 A4) + la **présence/absence aux entretiens** (voir P3). | NOUVEAU |
| **C5** — engagements du Département (aides mobilisées, points d'étape) | J'écris « aide mobilité accordée » dans une note. Le montant, je ne le note nulle part. | Un type d'action **« aide mobilisée »** avec nature et montant. Les actions ont déjà catégorie/partenaire/résultat : c'est une catégorie de plus et deux champs. | RÉORG + petit NOUVEAU |
| **C6** — durée 6-12 mois, renouvelable après bilan, **avenants**, exemplaire remis | Word, versions successives dans un dossier réseau, et la trace de remise... nulle part. | Un **document CER daté et versionné**, avec avenants, et la **trace de remise** — qui existe déjà pour le diagnostic (`remise_salarie` JSONB) et qu'il suffit de réutiliser. | NOUVEAU (mais patron existant) |
| **C7** — non-respect → entretien de conciliation | Je note « entretien de recadrage » dans une note de suivi chiffrée. | Un sous-type **« conciliation »** du type d'entretien CER, avec les **motifs légitimes** documentés. Attention : ce champ doit rester du côté « protection », pas du côté « dossier à charge ». | NOUVEAU |

### 2.3 Plateforme de l'inclusion (P1 → P5)

| Réf. | Ce que je fais aujourd'hui | Ce que SOLIDATA devrait porter | Type |
|---|---|---|---|
| **P1** — Emplois de l'inclusion / Pass IAE | Je saisis tout sur la plateforme. Dans SOLIDATA, le badge Pass IAE s'affiche… **mais le numéro n'est saisissable nulle part**. J'ai vérifié : `backend/src/routes/employees.js:219-231`, la liste `allowed` du `PUT /api/employees/:id` ne contient ni `pass_iae_number`, ni `pass_iae_start`, ni `pass_iae_end`, ni `eligibilite_criteres`, ni `france_travail_id`, ni `cddi_derogation_motif`. Le seul chemin d'écriture est la fiche **candidat** (`candidates/individual.js:48`), et `Candidates.jsx` n'affiche **aucun champ Pass IAE** (0 occurrence). Autrement dit : pour la plupart de mes salariés, **le Pass IAE ne peut pas entrer dans l'outil**, et le badge affiche « Pass IAE non renseigné » à vie. Toutes les alertes Pass (7 mois / 2 mois) et le « Bilan de prolongation PDF » sont donc **morts** pour ces dossiers. | 1) **Rendre le Pass IAE saisissable** (numéro, début, fin, statut **actif / suspendu / prolongé**) — c'est le correctif n° 1 du module. 2) Des **critères d'éligibilité IAE typés** en cases à cocher (BRSA, DELD, jeune < 26, senior ≥ 50, RQTH, QPV, ZRR, ASS, AAH, réfugié/protection subsidiaire, sortant de détention, parent isolé) avec la **pièce justificative rattachée** — aujourd'hui c'est **un champ texte libre** (`eligibilite_criteres TEXT`), inexploitable en reporting. 3) La **suspension** de Pass, qui n'existe pas du tout. | **CORRECTIF majeur** + NOUVEAU |
| **P2** — DORA | J'ouvre DORA dans un onglet, je cherche un service (garde d'enfants en horaires décalés, bilan de santé, atelier budget, FLE), j'oriente, et dans SOLIDATA j'écris une action texte « orientation DORA ». Le lien vers la fiche service, je ne le garde pas. | Sur **chaque frein**, un bouton **« Orienter »** qui crée une action typée avec : le lien de la fiche service DORA, la date d'orientation, et le **résultat** (accepté / refusé / sans réponse). Sans API dans un premier temps : un champ URL suffit. Ce qui compte, c'est le chaînage **frein → orientation → résultat**, parce que c'est exactement ce que S2 demande (« freins identifiés, freins levés, actions par frein »). | NOUVEAU (léger) |
| **P3** — RDV-Insertion | Je convoque par téléphone et par SMS depuis mon portable personnel. L'absentéisme aux entretiens, je ne le mesure pas. | **Convocation** depuis l'entretien planifié (Brevo existe déjà dans la maison) + trace **présent / absent / reporté + motif**. Le motif d'absence est aussi la matière de A6. | NOUVEAU |
| **P4** — Mon Récap | Rien. Quand un partenaire me demande « où en est le parcours ? », je réécris un mail de synthèse. 20 minutes. | Un **récapitulatif de parcours partageable** : étapes datées, sans aucune donnée art. 9/10. Le gabarit « exemplaire salarié » et le bilan de prolongation Pass IAE font déjà 80 % du travail : c'est un 7ᵉ gabarit PDF avec une liste blanche de champs. | NOUVEAU (gabarit) |
| **P5** — Marché de l'inclusion | Hors de mon périmètre. | Rien. | — |

### 2.4 Contexte SIAE 2026 (S1 → S7)

| Réf. | Ce que je fais aujourd'hui | Ce que SOLIDATA devrait porter | Type |
|---|---|---|---|
| **S1** — PMSMP massives | `PmsmpPanel` fonctionne bien : bornes 31 j / 60 j contrôlées, jauge de cumul, forçage motivé. Mais je saisis **deux fois** : Immersion Facilitée puis SOLIDATA. | Garder le contrôle des bornes (c'est ce qui me protège) et ajouter un **« Copier pour Immersion Facilitée »** : un bloc structuré prêt à coller. Et surtout : la PMSMP doit devenir un **indicateur de première page**, pas un panneau enfoui dans l'onglet Synthèse. | RÉORG + petit NOUVEAU |
| **S2** — conventions ACI 2026-2027, levée des freins chez les BRSA | Je produis ça à la main, en croisant l'export freins et ma mémoire. | Une vue **« freins identifiés / freins levés »** avec le **delta entre deux évaluations** et les **actions rattachées à chaque frein**. Les données existent toutes (les freins sont historisés dans chaque entretien) : c'est un écran, pas une collecte. | RÉORG |
| **S3** — ASI cofinancé FSE+ | Rien. Aucun salarié n'est rattaché à un « projet » dans l'outil. | Un objet **« projet cofinancé »** (ASI 2026-2027, et les autres) et un **rattachement du salarié au projet**, avec dates d'entrée et de sortie du projet. C'est la clé de tout le volet FSE+ : sans ça, on ne peut ni filtrer, ni contrôler la complétude, ni produire un bilan d'exécution. | NOUVEAU |
| **S4** — catégories FT **F** et **G** | Rien. 0 occurrence dans le code. | Un champ **catégorie FT** sur la personne, avec une alerte sur les dossiers en **catégorie G (en attente d'orientation)** — parce que le document dit explicitement que c'est là que se produisent les ruptures de droits. | NOUVEAU |
| **S5** — primo-arrivants, FLE à visée professionnelle | Le CECRL existe au diagnostic, et c'est bien. Les actions FLE, je les saisis en libre. | Une catégorie d'action **« formation FLE »** et un croisement CECRL × actions FLE dans le pilotage. | RÉORG |
| **S6** — Job 76, SEVE Emploi 2027 | Voir A5. | Catégories d'action « job dating » et « relation entreprise ». | RÉORG |
| **S7** — logique de performance, trajectoire de sortie | Je produis un taux de sorties dynamiques. Je ne sais pas dire « les personnes passées par une PMSMP sortent-elles mieux ? ». | Un indicateur de **trajectoire** : PMSMP → sortie, et **suivi à +6 mois**. Les deux bouts existent, le chaînage n'est fait nulle part. | RÉORG |

### 2.5 FSE+ — Ma Démarche FSE+ (F1 → F8)

C'est le volet le plus risqué, parce que c'est celui où une case vide se transforme en euros non versés.

| Réf. | Ce que je fais aujourd'hui | Ce que SOLIDATA devrait porter | Type |
|---|---|---|---|
| **F1** — cofinancement 60/40 | Rien, c'est la Finance. Mais le **rattachement au projet** (S3) est la base du calcul, et c'est moi qui l'ai. | Le rattachement des participants au projet. | NOUVEAU |
| **F2** — OCS, forfait sur les coûts salariaux CIP | Rien. | Savoir quels **postes** (moi, les encadrants) sont affectés au projet. À faire porter par la RH, pas par moi. | NOUVEAU (hors module CIP ?) |
| **F3** — **feuilles de temps ultra-précises**, cohérentes avec les congés, signées | **Rien du tout.** Si un contrôle arrive demain sur ce point, nous ne pouvons rien produire. | Une **feuille de temps CIP par projet**, alimentée par ce que je saisis **déjà** : durée des entretiens (à créer, §1.3), `duree_minutes` des actions (existe, jamais agrégé), croisée avec `employee_leaves` (existe), et **signable**. C'est le chantier qui réconcilie B5 du référentiel de performance et F3 du FSE+ — un seul travail répond aux deux. | NOUVEAU (assemblage) |
| **F4** — bilan d'exécution, avance 30 %, CSF | Rien. | Un **export « bilan d'exécution »** composé depuis l'outil. | NOUVEAU |
| **F5** — dossier individuel strict : éligibilité à l'entrée, sortie, **+6 mois** | Je garde les justificatifs d'éligibilité dans un classeur papier. Et surtout : le job `createPostSortieFollowups` (`scheduler.js:512`) crée le suivi post-sortie à **+3 mois**, pas à +6. **Le FSE+ demande +6.** Je n'ai donc pas la donnée qui valide la subvention. | **Pièces justificatives d'éligibilité rattachées au dossier** (upload, comme les documents de recrutement) ; **suivi à +6 mois** en plus (ou à la place) du +3. | CORRECTIF (le +6) + NOUVEAU (les pièces) |
| **F6** — questionnaire d'entrée dès l'arrivée | Le bloc `fse_entree` est la **13ᵉ rubrique sur 14** du `DiagnosticForm` (`DiagnosticForm.jsx:152`), tout à la fin d'un stepper qui fait ~80 champs. Concrètement : quand je n'ai pas eu le temps de finir, c'est cette rubrique-là qui saute. Elle contient 5 champs. | Le questionnaire d'entrée doit **remonter dans le socle obligatoire J+30** et faire partie de la **complétude bloquante** pour les participants rattachés à un projet FSE+. Et il doit avoir un **schéma**, pas un JSONB libre (recon `01` §9.6 : `fse_entree`/`fse_sortie` n'ont « ni schéma ni validation ni complétude » alors que c'est la donnée à piste d'audit ≥ 5 ans). | RÉORG + CORRECTIF |
| **F7** — **statut de sortie saisi dans le mois**, sinon blocage des bilans | Ma mémoire. | Une **alerte dédiée « sortie non renseignée »** à J+15 (ambre) et J+25 (rouge) après la fin de contrat, **même sans bilan de sortie créé**. C'est la demande qui m'évite le pire scénario. | NOUVEAU |
| **F8** — CSF vérifie les questionnaires entrée/sortie complets | Je vérifie à la main, dossier par dossier, la veille du rendez-vous. | Une vue **« dossiers FSE+ complets / incomplets »** avec la liste des pièces manquantes **par personne** et un lien direct vers le champ à remplir. Le mécanisme existe déjà pour l'export freins (`/insertion-freins/completude`, REC-UX-14) : il faut le dupliquer sur le FSE+. | RÉORG (patron existant) |

---

## 3. Ce qui me manque, écran par écran

### 3.1 `InsertionParcours.jsx` — la liste de gauche

- **Pas de recherche.** Le plus gros irritant quotidien. (CORRECTIF)
- **Pas de filtre** : en parcours / permanents, sans diagnostic, sans prochain RDV, fin de contrat < 60 j, mes salariés, projet FSE+, BRSA. (CORRECTIF)
- **La liste mélange les 46 en parcours et les permanents**, parce que `GET /insertion` renvoie tous les `is_active`. Un encadrant technique n'a rien à faire dans ma file active. (CORRECTIF)
- **Pas de signal sur la ligne** : je vois PCM / Diag / urgence, mais pas « prochain RDV le … », pas « Pass expire le … », pas « dossier FSE+ incomplet ». (RÉORG)

### 3.2 `InsertionParcours.jsx` — l'en-tête de fiche

- Les badges sont bons (Parcours n°, Pass, CDDI n/24, PCM, Prescripteur, CIP référent). **Mais aucun n'est cliquable pour corriger la donnée qu'il affiche.** Le badge « Pass IAE non renseigné » me nargue depuis juillet et il n'y a aucun chemin pour le renseigner (§2.3 P1). (CORRECTIF)
- Il manque : **BRSA**, **catégorie FT (F/G)**, **référent unique**, **projet FSE+**, **CER en cours / échu**. (NOUVEAU)
- La **modale « Nouvel entretien »** est une modale maison (`InsertionParcours.jsx:1134+`), pas le composant `Modal` partagé qui a pourtant un focus-trap. Détail, mais c'est aussi ce qui fait qu'on ne peut pas naviguer au clavier. (CORRECTIF)

### 3.3 Les 7 onglets de la fiche

Sept onglets pour une personne, c'est trop. Mon diagnostic écran par écran :

| Onglet | Ce que j'en fais | Mon verdict |
|---|---|---|
| **Synthèse** | Je l'ouvre 10 fois par jour. Mais il empile Checklist → Note de profil → encart diagnostic → **Frise** → **Timeline** → PMSMP → Satisfaction → fiche synthèse. **La frise et la timeline racontent la même chose deux fois** (la revue de juillet, REC-UX-05, voulait la timeline *sous* la frise comme vue de référence — en pratique j'ai deux objets qui se concurrencent et je scrolle). | À **recomposer**, garder |
| **Diagnostic** | Une fois par salarié, à l'entrée. Ensuite jamais. | À sortir du cycle quotidien |
| **Entretiens & bilans** | Mon écran principal avec la Synthèse. | Garder tel quel |
| **Compétences** | C'est l'encadrant qui devrait le remplir. Comme il n'a pas accès pratique à l'outil, c'est souvent vide. | Garder, mais régler l'accès encadrant |
| **Objectifs & actions** (+ Notes de suivi) | Très utilisé. Les notes de suivi chiffrées sont excellentes. | Garder |
| **Freins** (radar seul) | Je l'ouvre rarement : le radar est joli mais **ce que je veux c'est le tableau des deltas** (frein / niveau / évolution ↗↘=), qui était la REC-UX-11 et qui n'est pas là. | À **fusionner** dans Synthèse |
| **Assistant IA** | J'utilise « Analyser le profil » de temps en temps. Le bouton **« Tester la connexion IA »** qui affiche la clé, le modèle et des informations Docker n'a **rien à faire sur l'écran d'une CIP**. | À nettoyer |

### 3.4 `DiagnosticForm.jsx` — trop long, et mal ordonné pour ce qui est obligatoire

14 rubriques, ~80 champs, dont le **style d'apprentissage Kolb en 24 items**. En face-à-face ça représente 1 h 30, et je le fais en deux séances dans 4 cas sur 5.

Le problème n'est pas la longueur en soi — c'est que **rien ne distingue ce qui est réglementairement obligatoire de ce qui est un approfondissement pédagogique**. Résultat : les rubriques obligatoires (FSE+ entrée, ressources → BRSA, CECRL, projet pro) sont **noyées**, et la rubrique FSE+ est **l'avant-dernière**. Ce qui saute quand le temps manque, c'est ce qui bloque une subvention. C'est exactement l'inverse de ce qu'il faudrait.

Ma proposition de découpage est au §4.5.

Deux irritants de saisie en plus : les freins se re-saisissent **à chaque entretien** après le diagnostic (double saisie interne), et le jargon **AFOM / COA / FSE+** n'est expliqué nulle part à l'écran — moi je sais, mais ma remplaçante pendant mes congés ne savait pas.

### 3.5 `EntretienForm.jsx`

Globalement bon (voir §1.3). Manques : **pas de durée d'entretien** (§1.3), **pas de présence/absence** (P3), **pas de champ pour le questionnaire FSE+ de sortie autrement qu'en JSONB libre**, et la check-list « Prêt à clôturer » est en `hidden md:block` — elle disparaît sur petit écran, ce qui est dommage car c'est le seul endroit qui me dit ce qui manque.

### 3.6 `RenouvellementETI.jsx`

Voir §1.5 : l'écran est bon, **le chemin d'accès est cassé**. Sans lien public à jeton, la promesse « l'encadrant remplit, la CIP instruit » n'est pas tenue et je fais la double saisie. C'est mon **correctif prioritaire n° 2** après le Pass IAE.

### 3.7 `ActionsCIP.jsx`

Bon écran. Manque : **statistiques par partenaire** (EXG-19), **agrégat des durées**, et l'export CSV est **calculé côté navigateur sur la page affichée seulement** — donc si je filtre mal, j'exporte un sous-ensemble sans le savoir.

### 3.8 `AuditInsertion.jsx` — « Pilotage & indicateurs »

C'est l'écran de la direction, pas le mien, et c'est bien ainsi. Deux remarques : les **cibles conventionnelles** sont toujours « objectif non paramétré » parce que l'annexe 2 n'a jamais été fournie (EXG-47, ouvert depuis juillet) — ce n'est pas un bug, c'est une décision qui n'a pas été prise ; et l'encart **CVG « trame en attente »** attend une trame Convergence depuis deux mois.

### 3.9 `AdminInsertion.jsx`

**Sept paramètres, sept boutons « Enregistrer »** (`AdminInsertion.jsx:243`, un par ligne). Je change rarement ces réglages, mais quand je le fais j'en oublie toujours un. Un seul bouton en bas. (CORRECTIF, 10 minutes de travail)

### 3.10 `Employees.jsx` — l'onglet « Parcours insertion » en lecture seule

Il est conforme à REC-UX-12 (un seul chemin d'édition), et je comprends la règle. Mon problème est ailleurs : **c'est sur cette fiche que vivent les données administratives** (contrats, prescripteur, dates) et je ne peux pas y écrire ce dont j'ai besoin (Pass IAE, éligibilité, catégorie FT). Je passe donc mon temps à **faire l'aller-retour** entre `/employees` et `/insertion` pour lire à un endroit ce que je dois utiliser à l'autre.

### 3.11 La navigation

**Aucun compteur dans le menu.** `/candidates` et `/tours` en ont ; l'insertion non. Je voudrais une pastille sur « Espace CIP » avec le nombre d'échéances rouges. Aujourd'hui, si je n'ouvre pas la page, je ne sais pas qu'il y a le feu. (CORRECTIF)

---

## 4. Comment j'organiserais la section CIP si on me laissait dessiner

Mon principe : **partir de ce que je dois faire aujourd'hui, pas de l'endroit où les données sont rangées.** L'organisation actuelle est un plan de base de données affiché à l'écran : diagnostic ici, entretiens là, objectifs ailleurs, freins dans un quatrième onglet. Or ma journée ne s'organise pas comme ça. Elle s'organise par **échéance** et par **personne**.

Je propose **quatre écrans** au lieu de la dispersion actuelle.

### 4.1 Écran 1 — « Mes échéances » (remplace le tableau de bord actuel) — RÉORGANISATION + NOUVEAU

C'est ma page d'accueil. Une seule question : **qu'est-ce qui doit être fait cette semaine, et qu'est-ce qui me met en risque ?**

Organisée **par obligation**, pas par type d'objet :

| Bloc | Contenu | Origine |
|---|---|---|
| **Aujourd'hui / Cette semaine** | Mes entretiens avec heure, badge préparation, lien direct. | existe (`AgendaBloc`) — garder tel quel |
| **⛔ Risque réglementaire** | Sorties à saisir sous 30 j (**F7**) · Pass IAE < 2 mois ou expiré (**P1**) · CDDI ≥ 23 mois sans dérogation · Diagnostic > 30 j · **Questionnaire FSE+ d'entrée manquant** (**F6**) | partiellement existant + NOUVEAU |
| **📅 Échéances périodiques** | Actualisation mensuelle FT (**A3**) · Points d'étape CER dus (**C6**) · Suivi post-sortie à **+6 mois** (**F5**) · DTR trimestrielle (**A6**) | NOUVEAU |
| **⏳ Organisation du suivi** | Bilans en retard · RDV non planifié · Renouvellements < 42 j · Actions critiques en retard | existe |
| **📊 Ma file active** | 4 KPI + jauge, et **la liste filtrable** (voir 4.2) | existe, à corriger |

Chaque ligne reste **acquittable 7 jours** comme aujourd'hui — sauf les lignes du bloc « Risque réglementaire », qu'on ne doit **pas** pouvoir faire disparaître d'un clic. On peut les reporter 48 h, pas 7 jours. Une échéance FSE+ qui se cache, c'est le contraire de ce qu'on veut.

**La liste de gauche devient une vraie file active** : recherche par nom, filtres (en parcours / mes salariés / projet FSE+ / BRSA / sans diagnostic / sans prochain RDV / fin de contrat < 60 j), et **les permanents en sortent**. Sur chaque ligne : nom, prochain RDV, et une pastille de risque.

### 4.2 Écran 2 — La fiche salarié, réorganisée en **4 onglets** au lieu de 7 — RÉORGANISATION

| Nouvel onglet | Ce qu'il contient | Ce qu'il devient |
|---|---|---|
| **1. Situation** (par défaut) | Note de profil · **tableau des deltas de freins + radar** (fusion de l'onglet Freins) · frise du parcours (**une seule**, la timeline verticale passe en « voir le détail » repliable) · check-list d'embauche tant qu'elle est incomplète · encart PMSMP · satisfaction | fusion de *Synthèse* + *Freins* |
| **2. Suivi** | Entretiens & bilans (liste + formulaire) · objectifs · actions · notes de suivi · compétences ETI en encart | fusion de *Entretiens* + *Objectifs & actions* + *Compétences* |
| **3. Cadre administratif** ⭐ | **Éligibilité IAE** (cases typées + pièces) · **Pass IAE** (n°, dates, **statut actif/suspendu/prolongé**, bouton « Bilan de prolongation ») · **orienteur / prescripteur habilité / référent unique** · **catégorie FT (F/G)** · **BRSA** · **projet FSE+ de rattachement** · **CER** (version en cours, avenants, points d'étape, remise) · dérogation CDDI | **NOUVEAU** — c'est l'onglet qui n'existe pas et qui manque le plus |
| **4. Diagnostic** | Le socle + les approfondissements (§4.5) | conservé, allégé |

L'**Assistant IA** disparaît comme onglet : « Préparer cet entretien » vit déjà dans le formulaire d'entretien, « Analyser le profil » devient un bouton de l'onglet Situation. Et la sonde technique « Tester la connexion IA » **sort de mon écran** pour aller dans `/admin/insertion`.

### 4.3 Écran 3 — « Dossier de conformité » par salarié — NOUVEAU

Accessible depuis l'onglet Cadre administratif et depuis une vue transversale. C'est une **liste de pièces avec un état**, rien de plus, et c'est ce qui me permettra de dormir avant un contrôle.

| Pièce | État | Source |
|---|---|---|
| Justificatif d'éligibilité IAE (attestation RSA, DELD, RQTH…) | ✅ / ⛔ manquant | upload (**F5**) |
| Pass IAE (n°, dates, statut) | ✅ / ⛔ | saisie (**P1**) |
| Questionnaire FSE+ **entrée** | ✅ complet / ⚠ partiel (3/5) / ⛔ | diagnostic (**F6**) |
| CER signé + avenants | ✅ / ⛔ | document (**C6**) |
| Diagnostic d'accueil socle | ✅ / ⚠ / ⛔ | diagnostic |
| Questionnaire FSE+ **sortie** | ✅ / ⛔ / *sans objet* | bilan de sortie (**F5**) |
| Statut de sortie saisi dans le mois | ✅ / ⛔ **J+xx** | (**F7**) |
| Suivi à **+6 mois** | ✅ / ⛔ / *échéance le …* | (**F5**) |
| Trace de remise des documents | ✅ / ⛔ | `remise_salarie` (existe) |

Et une **vue transversale « Conformité FSE+ »** : la même chose en tableau, tous participants du projet, avec un taux de complétude et un lien direct vers le champ manquant. C'est le patron déjà appliqué à l'export freins (`/insertion-freins/completude`) : il fonctionne, il suffit de le réutiliser. **C'est la demande qui répond directement à F8.**

### 4.4 Le sort de la fiche collaborateur en lecture seule (`Employees.jsx`) — RÉORGANISATION

**Je la garde, et je la réduis.** Elle sert à la RH et à la direction, pas à moi, et le principe « un seul chemin d'édition » est sain : je ne veux pas de deux formulaires de bilan qui divergent.

Mais je demande deux changements :
1. Elle devient **plus courte** : un résumé (statut, parcours n°, prochain RDV, référent CIP, dernier entretien) + le bouton « Ouvrir dans l'espace CIP ». Aujourd'hui elle rejoue alertes + checklist + note de profil + frise + objectifs + actions + notes + compétences, ce qui fait **une deuxième page complète à maintenir** pour rien.
2. Les champs administratifs que je dois pouvoir écrire (Pass IAE, éligibilité, catégorie FT, BRSA, référent unique) **ne restent pas sur `/employees`** : ils vont dans l'onglet **Cadre administratif** de la fiche CIP (4.2), parce que c'est moi qui les tiens, et parce qu'aujourd'hui le `PUT /api/employees/:id` **ne les accepte même pas**.

### 4.5 Ce que je ferais du diagnostic : un **socle J+30** et des **approfondissements** — RÉORGANISATION

Le diagnostic actuel confond deux choses : ce qui doit être fait **dans les 30 jours parce que c'est la règle**, et ce qui se construit **quand la personne est prête**. Je les sépare.

**A. Socle obligatoire — à faire sous 30 jours, ~30 champs, 45 minutes**

Sept rubriques, dans cet ordre (c'est l'ordre d'une vraie conversation d'accueil, et l'ordre des priorités administratives) :

1. **Cadre administratif et éligibilité** — BRSA, catégorie FT, référent unique, ressources (`ressources TEXT[]`, déjà là), pièce d'identité / titre de séjour, allocataire CAF. *Alimente P1, A1, A2, S4.*
2. **Questionnaire FSE+ d'entrée** — les 5 champs, **remontés de la 13ᵉ place à la 2ᵉ**. *F6.*
3. **Logement** — statut, satisfaction. *C2.*
4. **Santé** — minimum : RQTH, contre-indications, suivi en cours. (Le détail chiffré et masqué reste, et reste facultatif : on ne force personne à parler de sa santé au premier entretien.)
5. **Mobilité** — permis, véhicule, moyens de transport. *C2, A4.*
6. **Situation & projet professionnels** — niveau de formation, emploi visé + code ROME, disposition à se former, CECRL. *S5, S7.*
7. **Expression du salarié + les 9 freins** — ce que la personne dit elle-même, puis l'évaluation des freins. *C3.*

**B. Approfondissements — quand c'est le moment, jamais à J+15**

- **Portefeuille de compétences et AFOM/SWOT** (10 champs) → devient un **atelier rattaché à un objectif**, typiquement à M+4 / M+8, quand la personne construit un projet. C'est d'ailleurs comme ça qu'on travaille en vrai.
- **Style d'apprentissage Kolb** (24 items) → **sort du diagnostic**. Franchement : 24 questions à quelqu'un qui, trois jours après son arrivée, a peur de perdre son logement, c'est une maladresse. C'est un outil de construction de projet, il se passe plus tard, et il est **facultatif**.
- **Budget détaillé, crédits en cours** → quand le sujet s'ouvre, souvent au 2ᵉ ou 3ᵉ bilan.
- Le **COA** (choix d'orientation) → à la formalisation du projet.

**Effet attendu** : le diagnostic obligatoire passe de ~1 h 30 à ~45 min et il est **fini à J+30 dans 100 % des cas au lieu de 60 %**. Et surtout, ce qui est obligatoire ne saute plus en dernier.

**Une seule règle à ajouter** : la **complétude du socle** est affichée sur la fiche et dans le dossier de conformité. Pas un blocage — un compteur honnête. Bloquer une CIP ne l'aide jamais ; lui dire ce qui manque, si.

### 4.6 Le journal d'heures d'accompagnement / feuille de temps FSE+ — NOUVEAU

C'est la brique qui répond **en une fois** à B5 du référentiel de performance, à l'article 5 de la convention, et à **F3** du FSE+.

Le principe : **je ne saisis rien de nouveau.** La feuille de temps se compose de ce que je saisis déjà, à condition d'ajouter **un seul champ** :

| Source | Existe ? | Ce qu'il manque |
|---|---|---|
| Durée des entretiens réalisés | ❌ | **une colonne de durée** sur l'entretien, avec une valeur proposée par type (diagnostic 90 min, bilan 45, période d'essai 30, renouvellement 30, sortie 60), ajustable — c'est ce que le guide promet déjà |
| Durée des actions | ✅ `cip_action_plans.duree_minutes` | **n'est agrégé nulle part** |
| Congés et absences de la CIP | ✅ `employee_leaves` (import paie) | le croisement (F3 exige la cohérence) |
| Rattachement au projet cofinancé | ❌ | l'objet « projet » (S3) |

**Écran** : une page mensuelle « Mon temps d'accompagnement », par salarié et par activité, avec le **total imputable au projet**, l'incohérence avec les congés signalée, un **export**, et un **espace de signature** (case + horodatage + PDF, comme la triple validation du renouvellement qui fonctionne déjà).

Je le dis clairement : **je préfère mille fois un compteur automatique alimenté par mes saisies qu'un tableur à remplir à la fin du mois.** Un tableur mensuel, je le remplirai de mémoire, ce sera faux, et ça ne passera pas un Contrôle de Service Fait. Un compteur alimenté au fil de l'eau, ajusté à la clôture de chaque entretien, sera juste — et me coûtera 5 secondes par entretien.

---

## 5. Mes 15 demandes prioritaires

**P1 = bloquant réglementaire** (je ne peux pas tenir mon obligation sans) · **P2 = gain de temps majeur** · **P3 = confort**

### P1 — bloquant réglementaire

**1. Rendre le Pass IAE saisissable (n°, début, fin, statut actif/suspendu/prolongé).** *Type : CORRECTIF.* Aujourd'hui c'est **impossible** (`employees.js:219-231`). Conséquence : les alertes 7 mois / 2 mois, le bilan de prolongation et le pilotage des échéances sont **inopérants** sur la quasi-totalité des dossiers. **Gain : risque évité — une fin de Pass non anticipée, c'est un salarié qui ne peut plus être employé du jour au lendemain.** Réf. P1.

**2. Alerte « sortie non renseignée » à J+15 et J+25 après la fin de contrat, même sans bilan de sortie créé.** *Type : NOUVEAU.* **Gain : risque évité — blocage du dépôt des bilans financiers FSE+.** Réf. F7.

**3. Critères d'éligibilité IAE typés + pièces justificatives rattachées.** *Type : CORRECTIF (remplace un texte libre) + NOUVEAU (upload).* **Gain : risque évité au CSF + 2 h par contrôle** (aujourd'hui : classeur papier). Réf. P1, F5.

**4. Suivi post-sortie à +6 mois (aujourd'hui le job crée +3 mois).** *Type : CORRECTIF.* **Gain : risque évité — c'est l'indicateur de résultat qui valide la subvention.** Réf. F5, `scheduler.js:512`.

**5. Objet « projet cofinancé » + rattachement des participants + vue de complétude « dossier FSE+ complet / incomplet ».** *Type : NOUVEAU (l'objet) + RÉORG (la complétude, patron existant).* **Gain : 2 h par trimestre de vérification manuelle + risque évité.** Réf. S3, F8.

**6. Réparer la colonne « Heures travaillées » de l'export FSE+, et journaliser les exports FSE+ et Excel complet.** *Type : CORRECTIF.* La requête porte sur des colonnes inexistantes et échoue en silence ; l'export sort vide sans avertir. **Gain : risque évité — pièce fausse remise à un financeur ; et promesse de la note aux certificateurs tenue.** Réf. `exports.js`, recon `03` §5.1 et §5.9.

**7. Durée sur l'entretien + agrégat d'heures d'accompagnement + feuille de temps par projet.** *Type : NOUVEAU (le champ) + NOUVEAU (l'écran).* **Gain : risque évité — sans feuille de temps, le CSF bloque le paiement (F3) ; et l'indicateur B5 publié devient enfin calculable.** Réf. F3, B5, article 5 de la convention.

**8. Lien public à jeton pour le formulaire de renouvellement de l'encadrant.** *Type : CORRECTIF.* Le modèle existe dans la maison (jeton véhicule du mobile). **Gain : ~25 min par renouvellement × ~100 par an ≈ 40 h/an, et la fin d'une double saisie qui vide la triple validation de son sens.** Réf. REC-UX-06, `App.jsx:208`.

### P2 — gain de temps majeur

**9. Recherche + filtres sur la liste des salariés, et sortir les permanents de la file active.** *Type : CORRECTIF.* **Gain : ~20 min/semaine** (≈ 15 h/an), et la fin du Ctrl+F au téléphone. Réf. `routes.js:134`, `InsertionParcours.jsx:1006`.

**10. Diagnostic découpé en socle obligatoire J+30 (~30 champs) + approfondissements différés.** *Type : RÉORGANISATION.* **Gain : ~45 min par nouvel entrant** (≈ 25 h/an sur 35 entrées) **et surtout : le questionnaire FSE+ d'entrée cesse d'être ce qui saute en premier.** Réf. F6, C2.

**11. Onglet « Cadre administratif » sur la fiche + fiche réorganisée en 4 onglets.** *Type : RÉORGANISATION + NOUVEAU.* **Gain : ~15 min/jour d'allers-retours entre `/employees` et `/insertion`** (≈ 50 h/an). Réf. A2, P1, C6, S3, S4.

**12. Export « CER » du diagnostic (gabarit PDF) + type d'entretien « CER / point d'étape » + avenants.** *Type : NOUVEAU (gabarit + un type d'entretien).* **Gain : ~40 min par CER, et surtout la fin de ma double saisie n° 1** (recopie du diagnostic dans un Word). Réf. C1, C2, C6.

**13. Orientation DORA rattachée au frein (lien + date + résultat) et statistiques par partenaire.** *Type : NOUVEAU (léger) + RÉORG.* **Gain : ~1 h par comité de pilotage, et c'est la preuve directe de ce que demande S2 (freins identifiés → actions → freins levés).** Réf. P2, S2, EXG-19.

### P3 — confort (mais du confort qui compte)

**14. Compteur d'échéances rouges dans le menu latéral ; un seul bouton « Enregistrer » dans les réglages ; tableau des deltas de freins à côté du radar ; sortir la sonde technique IA de mon écran.** *Type : CORRECTIF.* **Gain : ~10 min/semaine et moins d'erreurs.** Réf. REC-UX-11, recon `02` §7.

**15. Convocation aux entretiens (SMS/mail) + trace présent/absent/motif.** *Type : NOUVEAU.* **Gain : ~20 min/semaine de relances téléphoniques, et le motif d'absence alimente la protection du salarié en conciliation (A6).** Réf. P3, A6, C7.

---

## 6. Ce que je refuse

Ce ne sont pas des préférences. Ce sont des conditions.

**1. Pas de classement des salariés.** Pas de score d'employabilité, pas de note de « probabilité de sortie dynamique », pas de tri par « potentiel ». Le jour où un écran range mes 46 personnes de la plus prometteuse à la moins prometteuse, cet écran décide à ma place de qui reçoit du temps — et il le décide sur des données qui reflètent surtout la pauvreté des gens. Les freins se lisent **par personne**, jamais en palmarès.

**2. Pas d'IA décisionnelle.** L'IA prépare, propose, résume. Elle **ne fixe aucun niveau de frein, ne classe aucune sortie, ne rédige aucun CER définitif, ne suggère aucune orientation qui s'appliquerait sans moi.** Ce qui existe aujourd'hui est au bon endroit : pseudonymisé, étiqueté « proposition », historisé avec mes corrections. Si on ajoute de l'IA sur le CER ou sur l'éligibilité, la même règle s'applique — et le contrôleur doit pouvoir voir que l'humain a tranché.

**3. Pas d'exposition santé ni judiciaire à l'encadrant technique.** Le masquage MANAGER actuel (`masking.js`) et les notes de suivi en ADMIN/RH strict sont **exactement** au bon niveau. Quand on ouvrira le lien public de renouvellement à l'encadrant (demande 8), il doit voir **le poste, l'assiduité, les compétences, son avis** — et rien du dossier social. Un lien plus simple ne doit jamais devenir un lien plus bavard.

**4. Pas de saisie en double avec les plateformes d'État.** Je ne saisirai pas une troisième fois ce qui est déjà sur les Emplois de l'inclusion et sur Ma Démarche FSE+. **Si SOLIDATA ne peut pas écrire dans ces plateformes — et je comprends très bien que ce soit le cas —, alors qu'il me prépare un bloc « copier-coller » structuré** : les champs dans l'ordre du formulaire officiel, prêts à coller, avec un bouton Copier. C'est un travail de trois jours qui m'économise deux heures par semaine. Ce qui serait inacceptable, c'est un nouveau formulaire SOLIDATA qui reproduit le formulaire d'État sans rien en reprendre ni rien lui donner.

**5. Pas de champ obligatoire qui bloque l'enregistrement d'un entretien.** Les contrôles de **clôture** sont bons (on ne clôture pas un dossier incomplet). Les contrôles de **saisie** seraient nuisibles : en face-à-face, on n'obtient pas toujours une réponse, et forcer une valeur, c'est fabriquer une donnée fausse. Le « Non évalué » doit rester possible partout.

**6. Pas de suppression du « Non évalué » ni de valeur par défaut sur les freins.** Un frein à 1 par défaut, c'est un salarié qu'on déclare sans difficulté alors qu'on ne lui a rien demandé. Cela fausse les moyennes, et surtout cela fausse le dialogue avec le financeur — dans le mauvais sens pour la structure comme pour la personne.

**7. Pas de compteur d'heures d'accompagnement transformé en objectif individuel.** Le journal d'heures (demande 7) existe pour justifier un cofinancement et décrire une charge. Le jour où il devient « Nadia doit faire 12 h d'accompagnement par semaine », je produirai des heures, pas de l'accompagnement. Le `REFERENTIEL_PERFORMANCE_CIP.md` le dit déjà pour les actions (« ne jamais fixer d'objectif de volume ») : cette règle doit être écrite au même endroit pour les heures.

---

## 7. Mes questions à la direction

Ces questions ne sont pas rhétoriques : plusieurs demandes ci-dessus **changent de forme** selon la réponse, et je préfère qu'on tranche avant qu'on développe.

**Q1 — Sommes-nous référent unique au sens de la loi Plein Emploi pour nos salariés BRSA, ou seulement structure d'accueil ?**
C'est la question qui détermine tout le volet CER. Si nous sommes référents, **c'est moi qui rédige le CER** et SOLIDATA doit le produire, le versionner et tracer sa remise (demande 12). Si nous ne le sommes pas, nous **alimentons** le référent du CMS et il me faut alors surtout le « récapitulatif de parcours partageable » de Mon Récap (P4). Ce n'est pas le même travail, ni le même écran. `00-exigences-autorite.md` pose explicitement la question comme non tranchée.

**Q2 — Quel(s) projet(s) FSE+ portons-nous exactement en 2026-2027, et quels salariés y sont rattachés ?**
L'ASI ? Les postes CIP en OCS ? Les deux ? Et sur quel critère un salarié entre-t-il dans la cohorte (BRSA ? orientation sociale ? les plus vulnérables — mais selon quelle définition écrite) ? Sans cette réponse je ne peux pas construire le rattachement (demande 5), et sans rattachement il n'y a ni complétude, ni bilan d'exécution.

**Q3 — Pouvons-nous obtenir la liste exacte des questions des questionnaires MDFSE+ d'entrée et de sortie ?**
Le bloc `fse_entree` de SOLIDATA a **5 champs** que quelqu'un a choisis chez nous. Je ne sais pas s'ils correspondent au formulaire réel de la plateforme. Tant que je n'ai pas la liste officielle, tout export FSE+ est une approximation — et c'est l'approximation que le CSF vérifiera. Il faut la récupérer sur la plateforme ou auprès de la gestionnaire.

**Q4 — Tentons-nous une intégration API avec les Emplois de l'inclusion, ou assumons-nous le copier-coller structuré ?**
Mon avis : **commençons par le copier-coller** (§6 point 4). Une API, c'est un chantier, des habilitations, une maintenance, et un risque de désynchronisation entre deux vérités. Un bloc structuré prêt à coller me fait gagner l'essentiel du temps pour une fraction du coût. Mais c'est une décision de direction, pas la mienne.

**Q5 — Qui remplit la feuille de temps FSE+ : moi, la RH, ou la badgeuse ?**
Le module 33 « Temps & Présence » existe et produit déjà des exports. Mais il mesure une **présence**, pas une **imputation à un projet** : il ne sait pas que l'heure de 14 h était consacrée à un participant ASI. Ma proposition : **la badgeuse pour le temps total, SOLIDATA pour la ventilation par salarié et par activité**, la RH pour le rapprochement et la signature. À valider avec la RH, parce que c'est elle qui devra signer.

**Q6 — Le temps de travail en CDDI compte-t-il dans les 15-20 h d'activité hebdomadaire du CER ?**
Un CDDI à 26 h dépasse largement le seuil. Si le temps de travail compte, la question est réglée pour tout le monde et il me suffit de savoir le **prouver** (`employee_week_hours`, déjà là). S'il ne compte pas, alors ce sont les **heures hors temps de travail** (ateliers, formations, PMSMP, entretiens) qu'il faut compter, et c'est un tout autre compteur. `00-exigences-autorite.md` pose la question sans la trancher ; le Département doit nous répondre.

**Q7 — Recrutons-nous la seconde CIP annoncée dans l'AAP du Département (S2) ?**
Ce n'est pas une question de confort. Plusieurs choix d'écran en dépendent : le filtre « mes salariés » sur la file active, le cloisonnement par référent, les acquittements d'alertes partagés (aujourd'hui acquitter, c'est acquitter pour tout le monde — à deux, ça devient un sujet). Et pour être honnête : **0,86 ETP pour 46 parcours plus le CER, plus le FSE+, plus l'actualisation mensuelle, plus les PMSMP massives, ce n'est pas tenable.** L'outil peut me faire gagner deux heures par semaine ; les nouvelles obligations en demandent davantage.

**Q8 — Quand obtenons-nous les cibles conventionnelles (annexe 2) et la trame Convergence ?**
Le pilotage affiche « objectif non paramétré » depuis juillet et l'encart CVG attend une trame. Ce ne sont pas des bugs, ce sont deux documents que personne ne nous a transmis. Tant qu'ils manquent, je présente des taux sans point de comparaison en comité — et on me demande à chaque fois « c'est bien ou pas ? », à quoi je ne peux pas répondre.

---

## 8. Récapitulatif — demande, type, priorité, gain

> Les lignes 1 à 15 sont mes quinze demandes prioritaires du §5, dans le même ordre. Les lignes 16 à 20 sont
> les demandes qui découlent directement des exigences du §2 et que je n'ai pas mises dans mon « top 15 »
> parce qu'elles sont plus petites ou moins urgentes pour moi — mais elles font partie du chantier, et je ne
> voudrais pas qu'elles disparaissent parce que je me suis limitée à quinze.

| # | Demande | Type | Priorité | Gain estimé |
|---|---|---|---|---|
| 1 | Pass IAE saisissable (n°, dates, statut actif/suspendu/prolongé) — P1 | **CORRECTIF** | **P1** | Risque évité : fin de Pass non anticipée. Débloque alertes + bilan de prolongation (morts aujourd'hui) |
| 2 | Alerte « sortie non renseignée » J+15 / J+25 — F7 | **NOUVEAU** | **P1** | Risque évité : blocage du dépôt des bilans financiers FSE+ |
| 3 | Critères d'éligibilité IAE typés + pièces justificatives — P1, F5 | **CORRECTIF + NOUVEAU** | **P1** | Risque évité au CSF ; ~2 h par contrôle |
| 4 | Suivi post-sortie à **+6 mois** (aujourd'hui +3) — F5 | **CORRECTIF** | **P1** | Risque évité : indicateur de résultat qui valide la subvention |
| 5 | Objet « projet cofinancé » + rattachement + vue de complétude FSE+ — S3, F8 | **NOUVEAU + RÉORG** | **P1** | 2 h/trimestre + risque évité |
| 6 | Réparer les heures de l'export FSE+ ; journaliser FSE+ et Excel — F8, EXG-43 | **CORRECTIF** | **P1** | Risque évité : pièce fausse remise au financeur ; promesse aux certificateurs tenue |
| 7 | Durée d'entretien + agrégat d'heures + feuille de temps par projet — F3, B5 | **NOUVEAU** | **P1** | Risque évité : sans feuille de temps, le CSF bloque le paiement |
| 8 | Lien public à jeton pour le renouvellement encadrant — REC-UX-06 | **CORRECTIF** | **P1** | ~40 h/an + fin d'une double saisie qui vide la triple validation de son sens |
| 9 | Recherche + filtres sur la file active ; sortir les permanents | **CORRECTIF** | **P2** | ~20 min/sem (≈ 15 h/an) |
| 10 | Diagnostic : socle J+30 (~30 champs) + approfondissements différés — F6, C2 | **RÉORGANISATION** | **P2** | ~45 min/entrée (≈ 25 h/an) + le FSE+ d'entrée ne saute plus |
| 11 | Onglet « Cadre administratif » + fiche en 4 onglets — A2, P1, C6, S3, S4 | **RÉORG + NOUVEAU** | **P2** | ~15 min/jour d'allers-retours (≈ 50 h/an) |
| 12 | Export CER du diagnostic + type d'entretien CER + avenants — C1, C2, C6 | **NOUVEAU** | **P2** | ~40 min/CER + fin de la double saisie Word |
| 13 | Orientation DORA rattachée au frein + stats par partenaire — P2, S2, EXG-19 | **NOUVEAU + RÉORG** | **P2** | ~1 h/comité + preuve directe « frein → action → levée » |
| 14 | Compteur menu, bouton unique dans les réglages, tableau des deltas de freins, sonde IA hors écran CIP | **CORRECTIF** | **P3** | ~10 min/sem + moins d'erreurs |
| 15 | Convocation SMS/mail + trace présent/absent/motif — P3, A6 | **NOUVEAU** | **P3** | ~20 min/sem + protège le salarié en conciliation |
| 16 | Actualisation mensuelle FT tracée (échéance récurrente) — A3 | **NOUVEAU** | **P2** | Risque évité : rupture de droits |
| 17 | Compteur d'activité hebdomadaire 15-20 h depuis `employee_week_hours` — A4, C4 | **NOUVEAU** (brique existante, jamais lue) | **P2** | Rend le CER justifiable ; ~30 min/CER |
| 18 | Relevé d'assiduité et motifs légitimes imprimable — A6, C7 | **NOUVEAU** (assemblage) | **P2** | ~1 h par situation de conciliation ; protège le salarié |
| 19 | Récapitulatif de parcours partageable (Mon Récap) — P4 | **NOUVEAU** (gabarit PDF) | **P3** | ~20 min par demande partenaire |
| 20 | Catégorie FT (F/G) + alerte sur les dossiers en catégorie G — S4 | **NOUVEAU** | **P2** | Risque évité : dossiers « en attente » qui décrochent |

---

*Je suis disponible pour une séance de maquettage sur les écrans « Mes échéances », « Cadre administratif » et « Dossier de conformité » — ce sont les trois qui changent ma semaine. Et je redis ce que la revue de juillet disait déjà, parce que c'est resté vrai : si la saisie devient plus longue que mon ancien classeur, je retournerai au classeur, et tout le monde y perdra — à commencer par les dossiers que le financeur viendra contrôler.*

*— Nadia, CIP, 12 septembre 2026.*
