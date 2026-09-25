# PR E « Suivi Convergence (programme CVG) » — correctifs

> Agent de correctifs, 25/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-e`, base `39134f3`
> (après le debug sur base réelle, rapport 31). Lot **2.60.0**. Périmètre traité : les **16 constats de la
> revue de sécurité** (`32-revue-securite-PR-E.md` — 2 bloquants, 3 majeurs, 11 mineurs), dans l'ordre de
> son § 7. **Tous traités** — m-09 par décision argumentée de ne pas coder (§ 3). Les défauts D-xx du debug
> (rapport 31) étaient déjà corrigés et n'ont pas été touchés ; sa suite e2e sert de filet et a été
> étendue. Aucune commande git. Méthode : `29-correctifs-PR-D.md`.

---

## 0. En une phrase

Le document que la structure transmet à une association privée cesse d'être, sur un semestre ordinaire
(3 et 4 sortants), **la fiche santé-justice de personnes que tout l'atelier sait nommer** : par défaut,
seuil de confidentialité **k = 5** (plancher de code 1, abaissable par le seul DPO) sur les tableaux des
sortis et sur la Partie 1 des petits effectifs, **frein judiciaire ni lu ni transmis**, mention de
**diffusion restreinte** sur chaque page ; une source illisible ne s'imprime plus « 0 » ; « Non concerné »
ne vaut plus RQTH ; le registre des moyens humains a enfin une durée de vie. **Jest 277 suites / 5 663
tests verts** (+59), **e2e PR E 62/62** (53 → 62) sous `TZ=UTC` **et** `TZ=Europe/Paris`, sur base migrée
**et** base neuve, non-régression PR A-D **399/399** dans les deux fuseaux, build Vite vert, **12
contre-épreuves par mutation** sur les suites unitaires/contrat et **4 sur PostgreSQL réel** — toutes font
tomber leurs tests.

---

## 1. Tableau des constats

| # | Gravité | Constat (rapport 32) | Correctif | Fichier:ligne | Preuve |
|---|---|---|---|---|---|
| **B-02** | Bloquant | Frein judiciaire (art. 10) transmis à un tiers privé | Réglage `insertion.cvg_transmettre_justice` **défaut `false`** ; lu AVANT toute requête ; à `false`, la colonne `frein_judiciaire` n'est **pas lue** (cohorte, dernière évaluation) — retrait à la source, comme `AXES_BLOC3` ; ligne « Justice — non transmis (donnée relevant de l'article 10 du RGPD) » **structurelle** dans les trois couches (écran, PDF, CSV) ; phrase de méthode ; entrée art. 30 et § 4 du contrat 30 mis à jour. Seul un `true` explicite rétablit la transmission | `utils/insertion-settings.js:165` ; `services/convergence-cvg.js:84-86, 284-286` ; CSV `cvgVersCsv` ; `convergence-cvg-structure.js` (`nonTransmis`) ; `pdf-convergence-cvg.js` (`nonTransmisTd`) ; `migrations/insertion-convergence.js` (`CATEGORIES_DONNEES`) | Unitaires § 7 (SQL sans `frein_judiciaire`, CSV, `'oui'`/`1`/`'true'`/`null` ≠ `true`) ; contrat § 7 ; **e2e V-90** ; mutation → 6 unit/contrat + 2 e2e |
| **B-01** | Bloquant | Tableaux « sortis » sans seuil : fiche santé / justice / parcours de soin d'une personne | Réglage `insertion.cvg_k_min` **défaut 5, plancher de code 1** (illisible, 0, négatif → 5). **Jumeaux** (`protegerJumeau`) : un tableau de 1 à k−1 personnes ne diffuse ni freins santé/justice, ni **tout** le logement entrée/sortie, ni la santé (5 lignes), ni « dont parcours de soin » — **zéros compris** (homogénéité) ; total, catégories, autres freins, post-sortie publiés. **Partie 1** (`protegerPartie1`) sous `max(20, k)` accueillis : `appliquerKAnonymat` **réutilisé** (voir § 2). Cellule retenue = `{ nb: null, pct: null, secret: true }`, imprimée « s » avec légende ; `confidentialite.sous_seuil` = compte **par bloc**, jamais le chemin, jamais une entrée à 0. Mention de **diffusion restreinte** (dès qu'une case publiée vaut 1 à 4) : en tête de chaque page du PDF (boîte de marge `@page`), ligne `# DIFFUSION RESTREINTE` du CSV, bandeau de l'aperçu. « Aucun nom de personne accompagnée » devient « … mais des effectifs très faibles peuvent désigner une personne ». **Encadré** au-dessus de « Générer » (k, provenance, justice) via `GET /convergence/parametres`. Phrase de méthode « À k = 5, avec 3 à 4 sortants par semestre, les lignes santé / justice des tableaux des sortis sont vides — c'est le prix de la protection, arbitrage DPO » | `services/convergence-cvg.js:282, 547-629, 686-704` ; `routes/insertion/convergence.js:156` ; `ConvergenceCvgPanel.jsx` (encadré, `Secret`, bandeau) ; `pdf-convergence-cvg.js` (`SECRET`, `@page @top-center`) ; `services/dialogue-gestion.js:418` | Unitaires § 8 (jumeaux 3 et 4, **jumeau d'UNE personne sans aucune ligne sensible non nulle**, Partie 1 de 8 accueillis sans aucune case 1-4 publiée, suppression complémentaire, plancher) ; **e2e V-91, V-92** (y compris l'instantané enregistré) ; rendu PDF § 5 ; mutations jumeaux (5 + 1 e2e), Partie 1 (2), plancher (7) |
| **M-01** | Majeur | Source illisible → « 0 » dans les tableaux « sortis » | Drapeaux `situationsLisibles` / `evaluationsLisibles` ; cellules de sortie (logement, santé, post-sortie, parcours de soin, non-renseignés de sortie) et résolutions → `null` si leur source est illisible ; deux phrases de méthode | `services/convergence-cvg.js:451-452, 708-709` | Unitaires § 9 ; **e2e V-93** (table renommée) ; mutation → 1 + 1 e2e (chaque drapeau) |
| **M-02** | Majeur | RTH déduite d'un texte libre (« Non concerné » → RTH) | **Liste blanche** dans une règle unique `utils/rqth.js` (`rqthDepuisStatutHandicap` → `true` ou `null`, jamais `false`) : seul un libellé qui DIT une reconnaissance compte (« RQTH », « RQTH 2024 », « Travailleur handicapé », « Reconnu », « Oui », « BOETH »…) ; négation ou démarche en cours (« non », « pas », « aucun », « en cours », « demande », « refus », « expirée »…) → inconnu. Proposition de `GET /situation-sortie` alignée (elle passe par `profilPersonne`). **Même famille, même règle** : export (d) et typologies de `/insertion/audit` | `utils/rqth.js` ; `services/convergence-cvg.js:203` ; `utils/insertion-freins-export.js:175` ; `routes/insertion/routes.js:4076` | Unitaires § 10 (8 + 4 valeurs) ; contrat § 7 (« Non concerné »… : aucune RQTH proposée) ; **e2e V-94** ; mutation → 12 + 1 e2e |
| **M-03** | Majeur | Registre des moyens humains : ni rétention, ni sortie à l'anonymisation | Anonymisation : `DELETE` des lignes du registre rattachées au salarié (et de l'historique de sa situation de sortie, m-03). **12ᵉ purge** `purgeCvgRessources` : ressources inactives ou dont la fin est passée, au-delà de `rgpd.cvg_ressources_retention_jours` (défaut **1 095 j**) comptés depuis `date_fin`, à défaut `updated_at` ; registre `PURGES_RGPD`, scheduler, supervision `JOB_SCHEDULE`, libellés `AUTO_/PURGE_CVG_RESSOURCES` ; entrée art. 30 mise à jour **une fois, seulement si elle porte le texte d'origine** (une rédaction du DPO n'est jamais écrasée) ; politique `GET /rgpd/politique` | `services/anonymization.js:364, 371` ; `services/rgpd-purges.js:882, 1117` ; `services/scheduler.js:2180` ; `routes/monitoring.js` ; `migrations/insertion-convergence.js:237` ; `routes/rgpd.js` | Unitaires purges (+3), anonymisation (+1), migration (+2) ; **e2e V-97** (purge réelle d'une ressource de 4 ans, ressource active épargnée, journal, anonymisation) ; registre art. 30 relu en base : ancien texte → nouveau texte, une seule entrée, rejoué 2× |
| m-01 | Mineur | `GET /situation-sortie` non journalisé | Journal **tolérant** `INSERTION_SORTIE_CVG_LECTURE` (salarié, parcours — jamais les valeurs) | `routes/insertion/convergence.js:432` | Contrat § 7 (y compris journal indisponible → 200) ; e2e V-95 |
| m-02 | Mineur | `GET /completude` nominative non journalisée | Journal **tolérant** `INSERTION_CVG_COMPLETUDE` (période + **nombre** de personnes, jamais les noms) | `routes/insertion/convergence.js:271` | Contrat § 7 ; e2e V-44 (inversé : la lecture est désormais tracée) |
| m-03 | Mineur | Auteur initial écrasé, aucun historique | `insertion_sortie_cvg.modifie_par` (migration idempotente) ; `saisi_par`/`saisi_at` ne changent plus après la création ; table **`insertion_sortie_cvg_history`** (modèle `insertion_notes_suivi_history` : `situation_id` sans FK, FK CASCADE sur le salarié) — l'état antérieur est déposé **avant** la modification, dans la transaction, ligne verrouillée `FOR UPDATE` ; la lecture rend `modifie_par_nom` et `versions_anterieures` (affichés sous le bloc) | `routes/insertion/convergence.js:470-510` ; `migrations/insertion-convergence.js:193` ; `SituationSortieCvg.jsx` | Contrat § 7 ; e2e V-41 (réécrit), V-96 ; mutation → 1 |
| m-04 | Mineur | « Dont parcours de soin » peut dépasser sa catégorie | Composeur : compté seulement sous `autre_positive` ; PUT : remis à `NULL` dans la **même écriture** quand la catégorie résultante (saisie ou existante) n'est pas `autre_positive` | `services/convergence-cvg.js:716` ; `routes/insertion/convergence.js:486` | Unitaire § 11 ; contrat § 7 (2 tests) ; e2e V-96 ; mutations composeur (1) et route (2) |
| m-05 | Mineur | `PUT` accepte tout `parcours_num` et toute personne | 409 `SANS_PARCOURS` si `insertion_status = 'none'` ; 400 `PARCOURS_INVALIDE` si `parcours_num` > parcours courant (PUT **et** GET) | `routes/insertion/convergence.js:345-357, 458-466` | Contrat § 7 ; e2e V-43 (réécrit : refus, puis second parcours réellement ouvert), V-96 |
| m-06 | Mineur | Registre : pas de journal, 23503 → 500, `actif: "1"` → `false`, borne ETP front ≠ serveur | Journal **tolérant** (`INSERTION_CVG_RESSOURCE_CREATION/_MODIFICATION/_SUPPRESSION`, entité `insertion_cvg_ressources`, champs sans valeurs) ; `user_id` / `employee_id` vérifiés → 400 ; `isBoolean({ strict: true })` ; borne écran portée à **2 ETP** (celle du serveur et du CHECK) | `routes/insertion/convergence.js:553, 590-600, 629-667` ; `ConvergenceCvgPanel.jsx` (`etpValide`) | Contrat § 7 ; e2e V-97 |
| m-07 | Mineur | `409 EXPORT_VIDE` affirme « aucun salarié » sur sources illisibles | `cvgEstVide` rend `null` (inconnu) ; génération et CSV répondent **503 `SOURCE_ILLISIBLE`** | `services/convergence-cvg.js:978` ; `routes/insertion/convergence.js:87` | Unitaire § 11 ; contrat § 7 ; mutation → 2 |
| m-08 | Mineur | Comparaison aveugle à un changement de réglage | `en_tete.parametres` (seuil, sans-bilan, k, justice) enregistré avec le document ; `comparerCvg` DIT chaque différence en toutes lettres et marque **non comparables** (`motif: 'methode'`) les indicateurs touchés ; instantané antérieur à 2.60.0 → phrase « réglages non enregistrés » ; `methode_identique` ; axes comparés = union des documents (la justice absente des deux n'ajoute pas un faux « non comparable ») ; « freins résolus » compté **hors santé et justice** (sinon non comparable presque chaque semestre, ou variable au gré d'un réglage) | `services/convergence-cvg.js:1004-1016, 1095-1140` ; `ConvergenceCvgPanel.jsx` (bandeau, marque) | Unitaires § 11 (2) ; **e2e V-98** (deux instantanés réels) ; mutation → 1 |
| m-09 | Mineur | Coût de la comparaison à la volée | **Non codé, décision argumentée** : la revue le juge acceptable (22 requêtes, surface ADMIN/RH + MFA, période ≤ 24 mois, journalisée) ; un cache introduirait une seconde source de vérité pour un document transmis | — | — |
| m-10 | Mineur | « Plus de 50 ans » ≠ règle « 50 ans et plus » | Libellé « 50 ans et plus » (CSV, écran, PDF) | `services/convergence-cvg.js:1231` ; `convergence-cvg-structure.js` | Unitaire § 11 |
| m-11 | Mineur | Vague d'obligations `sortie_cvg` au premier déploiement | Réglage `insertion.cvg_sortie_depuis` (AAAA-MM-JJ, **absent par défaut** = aucune borne ; illisible = aucune borne) : un parcours terminé avant ne lève pas d'obligation | `services/echeances-cip.js:258, 519` ; `insertion-settings.js:174` | Unitaire échéances (veille, jour même, illisible) |

**Compléments demandés.** La bannière « Programme Convergence (CVG) — en attente de la trame de reporting
(direction) » est retirée de la vue d'ensemble d'`AuditInsertion.jsx` et de son PDF ; le bloc `cvg` de
`GET /insertion/audit` passe de `trame_en_attente` à `livre` (contrat `insertion-contract` aligné).
Version du lot : `backend/package.json`, défaut `APP_VERSION` du compose et `.env.example` portés à
**2.60.0** (les documents transmis imprimaient 2.60.0).

---

## 2. Pourquoi `appliquerKAnonymat` est réutilisé pour la Partie 1… et pas pour les jumeaux

**Partie 1 — réutilisé, pas recopié.** La fonction de la synthèse est **paramétrée** (troisième argument
`regles`, défaut = les tables de la synthèse : son comportement est inchangé, 83/83 e2e PR D) : le
reporting Convergence lui passe **ses** tables — une projection de comptes (sans pourcentages : un `pct`
publié à côté d'un `nb` retiré le rendrait par multiplication, c'est pourquoi la cellule entière devient
secrète au report), l'effectif accueilli en liste blanche, et les cinq ventilations qui somment à cet
effectif (sexe, âge, formation, habitat, orienteur) en distributions pour la **suppression
complémentaire**. Les totaux (« Total formation », « Total habitat », « Total orienteurs ») valent
effectif − non renseigné : quand le non-renseigné est retenu, le total l'est aussi. Une seule règle,
quatre étapes, deux documents.

**Jumeaux — règle propre, et c'est voulu.** `appliquerKAnonymat` garde les **zéros** (« personne dans
cette catégorie ne désigne personne ») — juste sur une base large, **faux** sur un tableau de trois
personnes dont la catégorie de sortie est connue : « 0 % en difficulté de santé » y est un attribut des
trois autant que « 100 % ». La règle est donc « **tableau** sous le seuil → lignes sensibles retenues,
zéros compris », et non « **case** sous le seuil ». Tout le logement est retenu (pas seulement rue et
précaire) : retenir deux lignes sur cinq les laisserait se reconstituer par soustraction des trois autres
et du « non renseigné ».

---

## 3. Contre-épreuves par mutation (16, toutes restaurées — `diff` vide contre l'original)

| # | Mutation | Unit + contrat (106 tests) | e2e PostgreSQL (62) |
|---|---|---|---|
| 1 | B-02 : `transmettreJustice = true` | **6** tombent | **2** tombent |
| 2 | B-01 : `protegerJumeau` neutralisé | **5** | **1** |
| 3 | B-01 : `protegerPartie1` neutralisé | **2** | — |
| 4 | B-01 : plancher retiré (`k` libre, défaut 1) | **7** | — |
| 5 | M-01 : drapeau situations retiré | **1** | **1** |
| 6 | M-01 : drapeau évaluations retiré | **1** | — |
| 7 | M-02 : ancienne règle « tout texte non vide sauf non/aucun » | **12** | **1** |
| 8 | m-04 composeur : parcours de soin hors catégorie | **1** | — |
| 9 | m-04 route : remise à vide retirée | **2** | — |
| 10 | m-03 : historique non déposé | **1** | — |
| 11 | m-07 : `cvgEstVide` rend `true` sur l'inconnu | **2** | — |
| 12 | m-08 : indicateurs touchés comparés quand même | **1** | — |

---

## 4. Preuves

| Suite | Résultat |
|---|---|
| `cd backend && npx jest` (sans base) | **277 suites / 5 663 tests verts**, 505 ignorés (e2e), 0 échec |
| Unitaires `convergence-cvg` | 30 → **64** |
| Contrat `insertion-convergence-contract` | 27 → **42** |
| `rgpd-purges` (+3), `insertion-convergence` migration (+2), `echeances-cip` (+1), `anonymization` (+1), garde des libellés RGPD (codes 2.60.0 recensés) | verts |
| e2e PR E, base migrée (`solidata_test`) | **62/62** sous `TZ=UTC` et **62/62** sous `TZ=Europe/Paris` |
| e2e PR E, base neuve (`solidata_neuve_e`) | **62/62** sous `TZ=UTC` et **62/62** sous `TZ=Europe/Paris` (`--runInBand` obligatoire : les trois suites partagent la base, en parallèle V-10 voit la cohorte de la suite voisine) |
| Non-régression e2e PR A / B / C / D | 93 / 87 / 136 / 83 — **399/399** dans les deux fuseaux |
| Migration | `init-db.local.js` régénéré (commande complète du rapport 13 § 9), rejoué **2×** sur chaque base : exit 0, `insertion_sortie_cvg_history` et `modifie_par` posés, entrée art. 30 **une seule**, passée du texte d'origine au texte 2.60.0 |
| `cd frontend && npm run build` | vert |

**Suite e2e étendue** (`backend/tests/e2e-pr-e/pr-e-convergence-e2e.test.js`) : la cohorte du scan se
vérifie désormais au **format brut** (réglages `k = 1`, justice transmise posés en `beforeAll`, retirés en
`afterAll`) — c'est la décision que le DPO peut prendre, et elle garde les 53 vérifications cellule par
cellule ; un bloc « correctifs 2.60.0 » (V-90 → V-98) retire les réglages et éprouve les **défauts du
code** : justice non lue, jumeaux retenus (y compris dans l'instantané enregistré), `/parametres`, table
des situations renommée, « Non concerné », lecture tracée, parcours de soin et permanent refusé, registre
(référence inconnue, purge réelle, anonymisation), comparaison de deux instantanés composés avec des
réglages différents. V-41, V-43 et V-44 ont été réécrits pour m-03, m-05 et m-02.

---

## 5. Contrôle du PDF au rendu (Chromium)

Harnais `scratchpad/cvg-pdf/` mis à jour (`render.mjs` : contenu synthétique à la forme 2.60.0 — justice
absente, `parametres`, `mention_diffusion`, `confidentialite`, jumeaux retenus ; `render2.mjs` : rendu d'un
contenu **réellement composé** par le service, extrait par `scratchpad/cvg-dump/`).

- **Synthétique (méthode de 4 phrases, comme la référence du rapport 31)** : **5 pages**, la mention de
  diffusion restreinte en tête de **chacune** (boîte de marge `@page`, vérifiée par extraction de texte
  page par page).
- **Contenu réel à k = 5** : 6 pages = les 5 pages du formulaire + la page « Méthode » (22 phrases). La
  **version d'origine du générateur** produit elle aussi 6 pages sur un contenu réel (19 phrases de
  méthode) — ce n'est pas un effet des correctifs ; le pied de page a été resserré pour que la mention
  n'en coûte pas une.
- **Aucune cellule vide non expliquée** : toute case retenue s'imprime « s » avec la note du tableau
  (« Tableau de moins de 5 personnes : … ») et la légende en tête ; la ligne « Justice » dit « non
  transmis (donnée relevant de l'article 10 du RGPD) » ; les « — » restants sont les non-paramétrés
  nommés en méthode (ETP conventionnés). Contrôle visuel des pages 1 (petit effectif : « s » dans la
  Partie 1), 4 et 5 (jumeaux).

---

## 6. Fichiers touchés

**Backend** : `services/convergence-cvg.js`, `routes/insertion/convergence.js`, `utils/rqth.js`
(nouveau), `utils/insertion-settings.js`, `services/dialogue-gestion.js` (paramètre `regles`),
`services/anonymization.js`, `services/rgpd-purges.js`, `services/scheduler.js`, `routes/monitoring.js`,
`routes/rgpd.js`, `services/echeances-cip.js`, `utils/insertion-freins-export.js`,
`routes/insertion/routes.js`, `scripts/migrations/insertion-convergence.js`, `package.json`,
`.env.example` ; `docker-compose.prod.yml`.
**Tests** : `tests/unit/services/convergence-cvg.test.js`, `tests/contract/insertion-convergence-contract.test.js`,
`tests/unit/services/rgpd-purges.test.js`, `tests/unit/migrations/insertion-convergence.test.js`,
`tests/unit/services/echeances-cip.test.js`, `tests/unit/services/anonymization.test.js`,
`tests/unit/rgpd-audit-libelles.test.js`, `tests/contract/insertion-contract.test.js`,
`tests/e2e-pr-e/pr-e-convergence-e2e.test.js`.
**Frontend** : `components/insertion/convergence-cvg-structure.js`, `ConvergenceCvgPanel.jsx`,
`pdf-convergence-cvg.js`, `SituationSortieCvg.jsx`, `pages/AuditInsertion.jsx`, `utils/rgpd-libelles.js`.
**Docs** : `GUIDE_CIP_INSERTION.md` (cas 33), `GUIDE_CIP_CONFORMITE_FSE.md` (§ 16), `VARIABLES_APPLICATION.md`
(purges, section Convergence, 3 réglages + 1 rétention), `DOCUMENTATION_APPLICATIVE.md`,
`PRESENTATION_AUTORITE_INSERTION.md` (arbitrages Convergence), `NOTE_CERTIFICATEURS_INSERTION.md` (§ 3 et
point 12) — uniquement les phrases devenues fausses ; contrat `30-…` § 4 (point 5, art. 10).

**Réglages ajoutés** : `insertion.cvg_k_min` (5), `insertion.cvg_transmettre_justice` (false),
`insertion.cvg_sortie_depuis` (absent), `rgpd.cvg_ressources_retention_jours` (1 095).

---

## 7. Ce qui reste à l'arbitrage (direction / DPO)

1. **Seuil k** : 5 par défaut ; le poser à 1 reproduit le format brut du réseau — décision du DPO, à
   consigner. Le coût est dit en méthode : avec 3-4 sortants par semestre, les lignes santé / justice /
   logement des tableaux des sortis seront vides chaque semestre à k = 5.
2. **Frein judiciaire** : ne le transmettre (`true`) que sur base légale établie (art. 46 LIL) ; aucune
   instruction à ce jour.
3. **Durée du registre des moyens humains** : trois ans proposés (recomposer et comparer les semestres
   récents) — à valider ; information des permanents (art. 13-14) sur leur nom transmis au réseau.
4. **Borne de mise en service** `insertion.cvg_sortie_depuis` : à poser à la date du déploiement si la
   direction ne veut pas d'une vague d'obligations sur les semestres déjà transmis.
5. **Liste blanche RQTH** : construite sur les formes observées dans le code et les tests (aucune valeur de
   production relevée) ; une forme de paie inconnue est comptée « inconnue », jamais RQTH — à confronter
   aux valeurs réelles du classeur Malibou (`SELECT DISTINCT disability_status FROM employees`). Appliquée
   aussi, par appartenance à la même famille, à l'export (d) et aux typologies du pilotage (« Non
   concerné » y valait « Oui »).
6. Restent ouverts du rapport 32 § 6 : base légale de la transmission au réseau et convention de
   confidentialité côté Convergence, transcodage « sans bilan → sans nouvelles », **AIPD** ; du rapport 31 :
   même famille que D-01 dans la méthode B de la synthèse annuelle, règles R-01 / R-02 / R-04.
