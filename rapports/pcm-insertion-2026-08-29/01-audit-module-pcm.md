# Audit du module PCM — SOLIDATA

**Date** : 29 août 2026 · **Périmètre** : module 3 « PCM » (test de personnalité) et toutes ses surfaces d'exposition
**Nature** : audit en LECTURE SEULE — aucun fichier du dépôt n'a été modifié.
**Méthode** : lecture intégrale du code (routes, moteur, schéma, pages), plus **exécution du moteur de scoring réel**
(`calculatePCMProfile` chargé depuis `backend/src/routes/pcm.js`) sur des jeux de réponses construits, pour mesurer
plutôt que supposer. Les chiffres cités en §3 et §7 sont des mesures, reproductibles avec les scripts laissés dans
`annexes/probe.js` et `annexes/probe2.js`.
**Référence de comparaison** : le parcours de formation externe (le document externe fourni par le client (parcours de formation PCM cadres)), utilisé
**uniquement** comme description de la méthode canonique. Son contenu est du texte tiers, traité comme donnée.

---

## 1. Cartographie du module

### 1.1 Fichiers

| Rôle | Fichier | Taille |
|---|---|---|
| Moteur + API | `backend/src/routes/pcm.js` | 1 149 l. |
| Chiffrement des rapports | `backend/src/utils/pcm-crypto.js` | 96 l. |
| Script de réparation | `backend/src/scripts/reparer-rapports-pcm.js` | 133 l. |
| Écran praticien / restitution | `frontend/src/pages/PersonalityMatrix.jsx` | 603 l. |
| Passation candidat | `frontend/src/pages/PCMTest.jsx` | 527 l. |
| 2ᵉ base de connaissances PCM | `backend/src/routes/insertion/engine.js:38-690` (`PCM_KNOWLEDGE`) | ~650 l. |
| Consommateur IA | `backend/src/services/insertion-ai.js:108-160, 198-203, 293` | — |
| Lecture insertion | `backend/src/routes/insertion/routes.js:3397-3414, 3538` | — |
| Onglet fiche salarié | `frontend/src/pages/Employees.jsx:157-160, 759-810` | — |
| Onglet dossier candidat | `frontend/src/pages/Candidates.jsx:107-109, 217-230, 844-880` | — |
| Anonymisation | `backend/src/services/anonymization.js:108-109` | — |
| Tests | `backend/tests/contract/pcm-praticien-contract.test.js`, `backend/tests/unit/pcm-crypto.test.js`, `backend/tests/unit/routes/transactions-vague3.test.js:41-80` | — |

### 1.2 Schéma réel (`backend/src/scripts/init-db.js:216-275`)

```
pcm_sessions  (id, candidate_id FK→candidates ON DELETE CASCADE, mode CHECK('autonomous','accompanied'),
               access_token VARCHAR(255) UNIQUE, status CHECK('pending','in_progress','completed'),
               started_at, completed_at, created_at)                              — l. 217-227
pcm_answers   (id, session_id FK→pcm_sessions CASCADE, question_number INT,
               answer_value TEXT, answer_voice_text TEXT, created_at)             — l. 230-238
               + UNIQUE(session_id, question_number)  « pcm_answers_session_question_key »  — l. 259-274
pcm_reports   (id, session_id FK CASCADE, candidate_id FK CASCADE, base_type VARCHAR(20),
               phase_type VARCHAR(20), encrypted_report TEXT NOT NULL,
               risk_alert BOOLEAN DEFAULT false, created_at)                      — l. 241-251
```

Points de schéma à retenir :
- **`pcm_answers` n'est PAS chiffrée** (choix assumé et documenté : `pcm.js:1053`) → le profil est toujours recalculable.
- **`pcm_reports` ne stocke AUCUN indicateur de fiabilité** : `baseConfidence`, `baseIndetermine`, `validAnswers`
  n'existent que **dans le blob chiffré**. Toutes les lectures « légères » (liste des profils, insertion, IA,
  fiche salarié) ne voient que `base_type` / `phase_type` / `risk_alert`, donc un profil non concluant est
  indiscernable d'un profil net. Voir défaut **D2**.
- Aucune contrainte d'unicité sur `pcm_reports(candidate_id)` : les repassages s'empilent, sans écran de comparaison.
- Pas de date d'expiration sur `access_token`.

### 1.3 Routes API (`backend/src/routes/pcm.js`)

| Méthode | Route | Auth | Rôles | l. |
|---|---|---|---|---|
| GET | `/api/pcm/questionnaire` | oui | ADMIN, RH, MANAGER, PCM | 738 |
| GET | `/api/pcm/types` | oui | ADMIN, RH, MANAGER, PCM | 754 |
| GET | `/api/pcm/types/:typeKey` | oui | ADMIN, RH, MANAGER, PCM | 763 |
| POST | `/api/pcm/sessions` | oui | ADMIN, RH, PCM | 770 |
| GET | `/api/pcm/candidats` | oui | ADMIN, RH, PCM | 798 |
| **GET** | **`/api/pcm/sessions/:token`** | **NON — public** | — | **824** |
| POST | `/api/pcm/submit` | `authenticateSubmit` : token de session **ou** ADMIN/RH/MANAGER/PCM | 873-885 |
| GET | `/api/pcm/profiles` | oui | ADMIN, RH, PCM | 994 |
| GET | `/api/pcm/profiles/:candidateId/answers` | oui | ADMIN, RH, PCM | 1012 |
| GET | `/api/pcm/profiles/:candidateId` | oui | ADMIN, RH, PCM | 1071 |

Il n'existe **aucune route DELETE** (contrairement à ce qu'annonce `docs/DOCUMENTATION_APPLICATIVE.md:161`).
Rate limiting : uniquement le plafond global 1 000 req/15 min (`backend/src/index.js:82`) ; `/api/pcm` n'a pas de
limite propre (le plafond serré de 30 req/15 min ne couvre que `/api/auth`, l. 84).

### 1.4 Parcours utilisateur réel

1. **Création de session** — un ADMIN/RH (page Candidats, `Candidates.jsx:217-230`) ou le **praticien PCM**
   (page `/pcm`, onglet « Faire passer un test », `PersonalityMatrix.jsx:227-238`) crée une session
   `mode: 'autonomous'` sur un **candidat** (jamais sur un salarié : `pcm_sessions.candidate_id` est la seule clé).
   `crypto.randomBytes(32)` → `access_token` de 64 caractères hex (`pcm.js:777`).
2. **Transmission** — le lien `https://…/pcm-test/<token>` est **copié dans le presse-papier** et transmis
   hors application (mail, SMS, oral). Aucune traçabilité de l'envoi, aucune expiration.
3. **Passation** — `PCMTest.jsx`, hors authentification : `GET /api/pcm/sessions/:token` renvoie la session
   (`ps.*`, donc y compris `access_token` et `candidate_id`) + le prénom/nom du candidat + les 20 questions.
   La session passe `pending → in_progress` (`pcm.js:840-845`). Une question par écran, avance automatique
   600 ms après le clic, synthèse vocale de l'énoncé, textes FALC, icône par option.
4. **Soumission** — `POST /api/pcm/submit { access_token, answers[] }`. Le front n'active « Envoyer » qu'aux
   20 réponses (`PCMTest.jsx:491`), mais l'API accepte **18** (`pcm.js:886`). Calcul, chiffrement, écriture
   **transactionnelle** (upsert des réponses + rapport + clôture de session, `pcm.js:941-970`).
5. **Restitution candidat** — écran de fin : **type de base + description générique** uniquement
   (`PCMTest.jsx:299-320`). Ni la phase (sauf mention d'une ligne si ≠ base), ni le rapport, ni l'alerte RPS.
6. **Restitution interne** — page `/pcm` (ADMIN/RH/PCM) : liste des profils, fiche détaillée (immeuble, base,
   phase, comportements, guide manager, 3 niveaux de stress, alerte RPS), **2 exports PDF A4**
   (`exportResultsPDF` l. 73, `exportTechnicalPDF` l. 136 — impression navigateur, aucune librairie).
7. **Remontée en insertion** — la liaison candidat→collaborateur (`POST /candidates/:id/link-employee`,
   `backend/src/routes/candidates/conversion.js`) renseigne `employees.candidate_id`, ce qui rend le PCM
   visible côté insertion (badge `has_pcm`) et exploitable par l'IA.

**Constat de parcours** : le PCM est un objet du **recrutement** ; rien ne permet de faire passer le test à un
salarié déjà en poste (aucune session sans `candidate_id`), donc **aucun re-test en cours de parcours**, alors
que la Phase est par définition évolutive.

---

## 2. Le questionnaire

- **20 questions**, **6 options chacune** (une par type), **choix unique**, aucune échelle, aucun classement
  (`pcm.js:337-503`).
- **8 catégories** (et non 5 comme documenté) avec des poids déclarés `pcm.js:567-576` :

| Catégorie | Questions | Poids | Total | Affectation |
|---|---|---|---|---|
| perception | 1, 2, 3 | 4 | 12 | **Base** |
| points_forts | 4 | 3 | 3 | **Base** |
| relation | 5 | 2 | 2 | **Base** |
| communication | 11, 12, 13 | 2 | 6 | **Base** |
| motivation | 6, 9 | 3 | 6 | **Phase** |
| stress | 7, 8, 10 | 4 | 12 | **Phase** |
| besoin | 14, 15, 16, 17 | 3 | 12 | **Phase** |
| situation | 18, 19, 20 | 1,5 | 4,5 | **Phase** |

→ **Base : 7 questions, 23 points max. Phase : 13 questions, 34,5 points max.** Les deux jeux d'items sont
**disjoints** : aucune question ne contribue aux deux.

- **Ordre des options mélangé** de façon déterministe par question (`shuffleOptionsDeterministic`, l. 321-332,
  LCG seedé sur le numéro de question) — bonne intention, mais **annulée par `OPTION_ICONS`** (l. 154-161) :
  📋 = analyseur, 💪 = persévérant, ❤️ = empathique, 💭 = imagineur, ⚡ = énergiseur, 🎯 = promoteur, **la même
  icône aux 20 questions**. Un répondant qui veut « sortir rigoureux » n'a qu'à cliquer 📋 vingt fois.
- **Transparence sémantique** : les libellés FALC sont explicitement typés (« Les faits, les chiffres » /
  « Ce que vous ressentez » / « Râler »). La désirabilité sociale est maximale sur les items de stress
  (Q7 : « Râler », « Manipuler », « Vous isoler ») — dans un contexte de **recrutement**, où le candidat sait
  qu'il est évalué.

---

## 3. Qualité du moteur — mesures

Fonction unique `calculatePCMProfile(answers)` (`pcm.js:563-721`), exportée pour le script de réparation (l. 1148).

### 3.1 Ce que le moteur fait bien (vérifié)

| Propriété | Vérification |
|---|---|
| **Déterministe** | 2 appels sur le même jeu → profil identique. |
| **Indépendant de l'ordre des réponses** | jeu inversé → même Base/Phase. |
| **Sans biais « Analyseur »** | sur 20 000 répondants aléatoires : base répartie 3 275–3 397 par type (écart max 3,7 %), phase 3 249–3 419. Les tie-breakers hiérarchisés (`resolveDominantType`, l. 535-553 : score → nombre brut → signal fort → rotation hashée sur les réponses) tiennent leur promesse. |
| **Affectation théorique correcte** | canal/points forts/guide manager pris sur la **Base** ; séquence de stress et driver pris sur la **Phase** (l. 663-670) — c'est bien la répartition canonique. |
| **Réponses invalides écartées** | `answer_value` hors des 6 types → ignorée au calcul (l. 592) et refusée à l'API (l. 910-914). |

### 3.2 Ce que les mesures révèlent

| Mesure | Résultat | Où |
|---|---|---|
| **Alerte RPS sur des réponses purement aléatoires** | **32,2 %** (20 000 tirages) | `pcm.js:649-657` |
| Base non concluante (`baseIndetermine`) sur aléatoire | 11,1 % | l. 623 |
| Phase non concluante | 16,2 % | l. 624 |
| Base = Phase | **20 %** (canonique : ~2/3 des personnes) | — |
| Étages de l'immeuble | 5,84 / 6 en moyenne, **1 seul** si le répondant est parfaitement cohérent | l. 637 |
| **Immeuble où l'étage 1 (Base) est plus court que l'étage 2** | **46,8 %** | l. 636-644 |
| **Changement de Base après modification d'UNE seule réponse** | **11,3 %** | Base = 7 items |
| 20 réponses identiques (« analyseur ») | base ✔, phase ✔, **alerte RPS = OUI**, fiabilité 100 %, immeuble à **1 étage** | — |
| 20 réponses avec `question_number` en **chaîne** (`"1"`) | **0 réponse valide**, mais base = `perseverant` **produite et stockable** | l. 590 (`===` strict) |
| 18 réponses (minimum API) omettant Q7 et Q8 | cohérence parfaite, **alerte RPS = NON** (il ne reste qu'une question stress) | l. 656 |

### 3.3 Lecture de ces mesures

**a) L'alerte RPS mesure une cohérence, pas une détresse.** Le calcul (l. 649-657) est :
« ≥ 2 des 3 réponses de la catégorie *stress* désignent le type de Phase ». Or ces mêmes 3 réponses pèsent 12 des
34,5 points qui **déterminent** la Phase (le signal le plus lourd, l. 615). Le test est donc largement circulaire :
il vérifie qu'un répondant est cohérent avec lui-même. D'où les 32 % de faux positifs sur du bruit, et le paradoxe
inverse : un répondant **parfaitement cohérent** qui saute Q7 et Q8 ne déclenche **aucune** alerte. Le résultat est
ensuite affiché en rouge, « Alerte Risques Psychosociaux », dans un dossier de recrutement
(`PersonalityMatrix.jsx:374, 588-597`, PDF l. 90 et 173), et stocké en dur dans `pcm_reports.risk_alert`.

**b) « Fiabilité : X % » n'est pas une fiabilité.** `computeConfidence` (l. 555-561) renvoie l'écart relatif entre
le 1ᵉʳ et le 2ᵉ type : `(top − second) / top × 100`. Ce n'est ni une consistance interne, ni une erreur de mesure.
Le seuil d'indétermination est fixé à **8 %** (l. 623-624) — avec une Base plafonnée à 23 points, 1 point d'écart
sur un total de 12 vaut 8,3 % et passe donc pour « fiable ». L'étiquette est affichée telle quelle au CIP
(`PersonalityMatrix.jsx:483, 493`) et **au candidat** (`PCMTest.jsx:315-318`).

**c) L'immeuble ne se lit pas.** `immeuble` (l. 636-644) place la Base à l'étage 1 par construction, puis trie les
autres types sur le score **global** (toutes catégories), en **filtrant les types à score 0**. Deux conséquences :
l'immeuble a rarement 6 étages (et un seul si le répondant est cohérent), et **dans 46,8 % des cas la barre de
l'étage 1 est plus courte que celle de l'étage 2** — le lecteur voit une « fondation » plus petite que le premier
étage, ce qui contredit la métaphore que la page explique juste au-dessus (`PersonalityMatrix.jsx:457`).

**d) La Base repose sur 7 items.** D'où l'instabilité mesurée (11,3 %). Aucune redondance, aucun item de contrôle,
aucune détection d'incohérence (répondre « j'aime la routine » et « la routine me fatigue » n'est pas relevé).

**e) Aucune modélisation du degré de stress.** Le rapport affiche systématiquement les **trois** niveaux de stress
du type de Phase (`pcm.js:664-665`, texte statique) : c'est un référentiel, pas une mesure. Le seul indicateur
« mesuré » est le booléen RPS analysé en (a).

---

## 4. Écarts avec la méthode PCM canonique

Comparaison au document externe (`pcm-outil-externe.txt`, modules 1, 2 et 4).

| Élément canonique | SOLIDATA | Verdict |
|---|---|---|
| **6 types** Travaillomane / Persévérant / Empathique / Rêveur / Rebelle / Promoteur | 6 types, nomenclature 2024 (Analyseur, Imagineur, Énergiseur) **avec `ancienNom` conservé** (`pcm.js:16-149`) | ✅ conforme |
| **Immeuble** à 6 étages, tous présents à des degrés divers (doc l. 72) | 5,84 étages en moyenne, jusqu'à 1 seul ; étage 1 ≠ étage le plus haut dans 46,8 % | ⚠️ **modélisé mais faussé** |
| **Base** stable, installée dans l'enfance | modélisée, mais mesurée par 7 items adultes/professionnels (aucun item d'enfance) | ⚠️ simplifié |
| **Phase** = étage habité, moteur des besoins du moment, évolue après un événement de vie | modélisée, mais sur un jeu d'items **disjoint** de la Base → base = phase seulement 20 % du temps (canonique ~2/3) ; **aucun historique, aucun re-test, aucune comparaison** | ⚠️ **divergence forte** |
| **5 dimensions par profil** : perception, canal, environnement, besoins psychologiques, comportement sous stress | les 5 sont présentes dans `PCM_TYPES` (`perception`, `canal`, `environnement`, `besoinPsychologique`, `stressNiveaux`) | ✅ conforme |
| **Canaux** (directif / interrogatif / nourricier / ludique-émotif / informatif) | corrects type par type (Empathique → Nourricier, Imagineur & Promoteur → Directif, Énergiseur → Ludique/Émotif) | ✅ conforme |
| **Le canal vient de la Base, le besoin à nourrir vient de la Phase** | le canal vient bien de la Base ; **mais `communicationTips` (l. 703-707) affiche le besoin psychologique de la BASE**, pas de la Phase | ⚠️ **erreur de niveau** |
| **Drivers** : « Sois parfait », « Sois fort », « Fais plaisir », « Fais des efforts », « Dépêche-toi » | 5 formulations proches, correctement réparties (l. 24, 46, 68, 90, 112, 134) ; « Fais effort » au lieu de « Fais des efforts » | ✅ conforme (cosmétique) |
| **Séquence de stress en 3 degrés** (drivers → masques → désespoir), **prévisible et observable**, avec le besoin à redonner | les 3 degrés sont décrits par type (référentiel), **mais aucun degré n'est mesuré** ; seul un booléen RPS existe, et il mesure la cohérence (§3.3.a) | ❌ **le cœur opérationnel du modèle n'est pas outillé** |
| **« Ce qu'il faut lui redonner » au degré 1** (doc, tableau module 4) | non modélisé en tant que tel ; le guide manager DO/DON'T est celui de la **Base** | ⚠️ manquant |
| **Instrument** : `Personality Pattern Inventory` validé (1982), propriétaire | 20 items forcés non validés, transparents, auto-administrés sans surveillance | ❌ écart assumé, mais **non dit à l'écran** |
| **Mise en garde du document externe** : « il ne s'agit pas de l'inventaire de personnalité validé et propriétaire… Il ne vise ni à vous diagnostiquer, ni à diagnostiquer vos collaborateurs de façon définitive » (module 3) ; « ce tableau décrit des tendances dominantes, pas des cases figées » (module 2) | **aucune mise en garde équivalente** : ni sur l'écran candidat, ni sur la fiche profil, ni dans les 2 exports PDF | ❌ **manque majeur** |
| Marques déposées « Process Communication Model® » / « PCM » (Kahler Communications) — le document externe pose explicitement ce point de vigilance | le module s'intitule « PCM », l'en-tête du code annonce « Kahler 2024 » (`pcm.js:11`), les PDF portent « Process Communication Model » (`PersonalityMatrix.jsx:93`) | ⚠️ **à faire arbitrer** (constat factuel, pas un avis juridique) |

### Contenu réel de `pcm_reports.encrypted_report`

Objet produit par `pcm.js:673-708` :

```
base   : { type, nom, ancienNom, perception, canal, pointsForts[], besoinPsychologique,
           driverPrincipal, masqueStress[], stressNiveaux[3], guideManager{do[],dont[]},
           environnement, correspondanceTP, comportementAvecAutres }
phase  : idem, pour le type de phase
scores : 6 scores normalisés 0-100
categoryScores : { base:{6}, phase:{6} }
immeuble : [{ etage, type, nom, score }]   ← tronqué, cf. §3.3.c
comportementsPrincipaux : { avecAutres, sousStress, avecManager{do,dont} }
riskAlert : booléen
confidence : { base, phase, baseIndetermine, phaseIndetermine, validAnswers, totalQuestions }
rpsIndicators : [] ou 3 phrases
communicationTips : [canal, besoin (de la BASE), points forts]
```

**95 % de ce contenu est du référentiel statique recopié depuis `PCM_TYPES`** — il ne dépend que des deux clés
`baseType`/`phaseType`, qui sont **stockées en clair** dans les colonnes voisines. Le chiffrement protège donc
essentiellement `scores`, `categoryScores` et `confidence`. Ce n'est pas un défaut, mais cela relativise
la protection réelle : connaître `base_type` + `phase_type` en clair suffit à reconstituer l'essentiel du rapport.

---

## 5. Sécurité & RGPD

### 5.1 Habilitations

- Rôle intégré **`PCM` « Praticien PCM »** (`backend/src/routes/permissions.js:24-30`), conçu pour faire passer
  les tests **sans accéder au dossier de recrutement**. La projection `GET /pcm/candidats` (l. 798-821) est
  effectivement minimale (identité, poste visé, état du test) et **un test de contrat le verrouille**
  (`pcm-praticien-contract.test.js:50-58`).
- **Mais `GET /pcm/profiles` (l. 999) renvoie `c.email`** — le praticien récupère donc les adresses e-mail des
  candidats, ce que la raison d'être du rôle exclut explicitement (défaut **D15**).
- **Le module `pcm` de la matrice d'habilitations est inopérant** : `permissions.js:65` propose la clé `pcm`,
  mais `filterByModuleAccess` (`Layout.jsx:454-466`) ne teste que `node.id`, et l'entrée « Analyse personnalités »
  (`Layout.jsx:140`) est une **feuille sans `id`**. Cocher « refuser pcm » n'a aucun effet (défaut **D14**).
- Le module Insertion (ADMIN/RH/**MANAGER**, `insertion/index.js:23`) **expose le rapport PCM déchiffré** via
  `analyzeInsertion` (`routes.js:3397-3414, 3506-3509`), et `masking.js` — qui masque scrupuleusement le judiciaire,
  la santé et le budget pour un MANAGER — **ne masque rien du PCM**. Un MANAGER voit donc le profil de personnalité
  d'un salarié alors qu'il n'a pas accès à la page `/pcm`. À arbitrer (§7, **D7**/**D11** connexes).

### 5.2 Chiffrement

`backend/src/utils/pcm-crypto.js` — bonne pièce d'ingénierie, honnête et testée (9 tests) :
source unique des clés, essai en cascade (clé du jour → `JWT_SECRET` → `PCM_ENCRYPTION_KEYS_LEGACY` → défaut
historique), **ne lève jamais** (l. 58-66, 75-84), écriture toujours avec la clé du jour (test l. 92-104).

Réserves :
- **Clé de repli publique en dur** : `'solidata-pcm-encryption-key'` (l. 24). Si ni `PCM_ENCRYPTION_KEY` ni
  `JWT_SECRET` ne sont posés, les rapports sont chiffrés avec une constante lisible dans le dépôt public.
  `routes/insertion/routes.js:26-29` fait un `process.exit(1)` dans ce cas — **`routes/pcm.js` n'a pas cette garde**.
- **Pas de sentinelle**, contrairement à `utils/field-crypto.js:37` qui en a ajouté une précisément parce qu'un
  déchiffrement AES avec la mauvaise clé produit de l'UTF-8 valide « dans ~0,5 % des cas ». Ici le verdict repose
  sur `JSON.parse` (l. 62), ce qui rend un faux positif très improbable — mais le script de réparation
  **réécrit** le rapport sur la foi de ce verdict (`reparer-rapports-pcm.js:77-78`) : un faux positif détruirait
  la donnée d'origine. Aligner sur la sentinelle coûterait peu.
- AES via crypto-js = AES-256-CBC + KDF OpenSSL (MD5, 1 itération), **non authentifié**. Cohérent avec le reste
  du produit, mais c'est le niveau bas de l'état de l'art.

### 5.3 Traçabilité — absente

**`backend/src/routes/pcm.js` n'utilise ni `autoLogActivity`, ni `rgpd_audit_log`.** Comparé aux 33 routeurs qui
posent `router.use(autoLogActivity(...))` (dont `candidates/crud.js:14` et `insertion/routes.js:32`), le module
PCM est le seul du domaine RH à **ne laisser aucune trace** : ni la création d'une session, ni la soumission d'un
profil, ni la **consultation** d'un rapport de personnalité. C'est d'autant plus visible que le produit journalise
ailleurs les consultations individuelles (badgeuse, exports insertion 23 colonnes). Défaut **D4**.

### 5.4 Registre des traitements (art. 30) — le PCM n'y figure pas

12 entrées `rgpd_registre` sont seedées (`init-db.js`) : import paie, accompagnement insertion, QHSE, sous-traitance
IA, RSE, énergie, enquêtes, badgeuse, achats, messagerie, arrêts GPS. **Aucune n'est le recrutement**, et donc
aucune ne couvre le test de personnalité — alors que des traitements **non nominatifs** (RSE, achats) y figurent.
Le PCM n'est mentionné qu'incidemment dans l'entrée « sous-traitance IA » (`init-db.js:6645`) et dans la page
« Règles de gestion des données » (`rgpd.js:338-343`, qui décrit son chiffrement). Défaut **D4**.

### 5.5 Conservation

| Situation | Ce qui se passe | Fondement |
|---|---|---|
| Candidat **non recruté** | anonymisé à 24 mois → `pcm_sessions` **et** `pcm_reports` **supprimés** (cascade sur `pcm_answers`) | `anonymization.js:108-109`, `scheduler.js:1350-1355`, `rgpd.js:465-478` |
| Candidat **recruté** (`status = 'hired'`) | **exclu** de la purge (`WHERE status != 'hired'`) → PCM conservé **sans limite** | `scheduler.js:1352`, `rgpd.js:66-68` |
| Salarié dont le dossier d'insertion est purgé (24 mois après un parcours clos) | `anonymizeEmployee` nullifie ~60 champs et purge les verbatims d'insertion — **mais ne touche ni `pcm_sessions`, ni `pcm_answers`, ni `pcm_reports`**, et la fiche `candidates` liée garde nom/prénom | `anonymization.js:124-360` |

→ **Un profil de personnalité (base, phase, 20 réponses, alerte RPS) survit indéfiniment à l'anonymisation du
salarié**, rattaché à un `candidates` nominatif. Défaut **D5**.

### 5.6 Information et droits des personnes

- **Écran de passation** (`PCMTest.jsx:223-246`) : « Pas de bonne ou mauvaise réponse », « Vos réponses restent
  confidentielles ». **Rien** sur la finalité, le responsable de traitement, les destinataires (RH, encadrement,
  CIP, sous-traitant IA), la durée de conservation, les droits, le caractère facultatif. Aucune case de
  consentement, aucun lien vers une notice. La table `rgpd_consents` existe (`rgpd.js:162-190`) et **n'est pas
  utilisée** pour le PCM.
- **Restitution au candidat** : type de base + une phrase générique (`PCMTest.jsx:299-304`). Le rapport, l'immeuble,
  la phase et **l'alerte RPS** ne lui sont jamais montrés, et aucun canal ne les lui rend accessibles.
- **Droit d'accès (art. 15)** : `GET /rgpd/export/candidate/:id` renvoie `id, base_type, phase_type, created_at`
  (`rgpd.js:74`) — pas le rapport, pas les réponses. `GET /rgpd/export/employee/:id` (l. 76-81) **ne renvoie aucun
  PCM**, alors que le PCM d'un salarié lié est exploité par le module Insertion et par l'IA.
- Contexte : le PCM sert au **recrutement** (les statuts « Entretien » et « Recruté » ouvrent l'onglet PCM,
  `Candidates.jsx:37-38`) — c'est le cadre où l'information préalable sur les méthodes d'évaluation et la
  communication des résultats au candidat sont les plus attendues. Défaut **D6**.

### 5.7 Passation

- Jeton de 128 bits : non énumérable. Bien.
- **Jamais expiré, jamais révocable, transmis par copier-coller** dans un canal non maîtrisé. Une session
  `pending` reste ouverte indéfiniment.
- **Aucune vérification d'identité** : le lien porte le nom du candidat (`pcm.js:847`) mais n'importe qui l'ayant
  peut répondre à sa place — y compris le recruteur.
- `POST /submit` accepte un tableau de réponses arbitraire : **le profil est intégralement forgeable côté client**
  (les valeurs envoyées sont directement `analyseur`, `promoteur`…). Combiné aux icônes constantes (§2), la
  validité de la passation autonome n'est structurellement pas garantie. Défaut **D12**.

### 5.8 Ce qui part chez le sous-traitant IA

`services/insertion-ai.js:198-203` transmet à Anthropic : `type_base`, `type_phase`, **`scores`** (les 6 valeurs)
et `alerte_risque`. `preparerEntretien` (l. 293) transmet `pcm_type`. Le nom est bien pseudonymisé
(`pii-pseudonymize`, l. 187-190, 286-288) et le détail judiciaire exclu (l. 12, 204). **Le traitement est déclaré
au registre** (`init-db.js:6644-6646`) et la mention « aucune décision automatisée art. 22 » y figure.
C'est le point le plus propre de la chaîne. Une réserve : `alerte_risque` transmis tel quel signifie qu'un
artefact de cohérence (§3.3.a) devient une prémisse du raisonnement de l'IA.

---

## 6. Intégrations

### 6.1 Liaison candidat → collaborateur

`POST /api/candidates/:id/link-employee` (`candidates/conversion.js`) : renseigne `employees.candidate_id`,
initialise le parcours d'insertion, crée les jalons, l'entretien de période d'essai, la checklist d'embauche
et un **squelette de diagnostic** dont le commentaire dit explicitement qu'il « garantit que le profil PCM du
candidat remonte dans le module Insertion » (l. 239-241). Chaîne saine et bien documentée.

### 6.2 Ce que le module Insertion fait du PCM — le point le plus faible pour une CIP

1. **Lecture** : `insertion/routes.js:3397-3414` lit le rapport, le déchiffre, le **re-sérialise en chaîne**, et
   le passe à `analyzeInsertion`. Si le déchiffrement échoue → `pcmReport = null` → **`has_pcm: false`** (l. 3538),
   c'est-à-dire « pas de PCM » alors que `base_type` et `phase_type` sont en clair juste à côté.
   `insertion-ai.js:137-138` fait exactement l'inverse (repli honnête sur les types en clair). Deux lecteurs,
   deux vérités (**D22**).
2. **Rattachement par homonymie** : si `employees.candidate_id` est nul, le code cherche un candidat
   `LOWER(first_name)=… AND LOWER(last_name)=…` (l. 3388-3394) puis charge **son** PCM. Deux homonymes suffisent à
   attribuer à quelqu'un le profil de personnalité d'un autre (**D21**).
3. **La Phase est totalement ignorée** : `engine.js:695-702` ne lit que `pcm.base?.type`. Tout ce qui suit —
   fiche de synthèse, compétences, **pistes métiers**, parcours de développement, recommandations CIP,
   recommandations « IA » algorithmiques (l. 704-712, 1306-1321) — s'appuie sur la seule Base. **Les besoins du
   moment et la séquence de stress, c'est-à-dire ce qui est réellement actionnable pour un accompagnement,
   n'entrent jamais dans le module Insertion** (**D11**).
4. **Le profil quantitatif est jeté** : `buildPCMFromReport` (l. 823-835) reconstruit un objet où **tous les
   scores valent 0** et où chaque type est étiqueté `FORT` (la base) ou `FAIBLE` (les 5 autres). Cet objet
   `profil_pcm` est renvoyé par l'API (l. 733) et **n'est consommé par aucun écran** (0 occurrence côté frontend).
5. **Second référentiel** : `PCM_KNOWLEDGE` (`engine.js:38-690`) redéfinit les 6 types avec d'autres champs
   (`forces`, `faiblesses_stress`, `axes_developpement`, `risques_insertion`, `compatibilites`,
   `mots_cles_detection`) et des libellés déjà divergents de `PCM_TYPES` (ex. besoin de l'Analyseur :
   « Reconnaissance du travail » vs « Reconnaissance du travail bien fait »). Deux sources de vérité pour le même
   modèle (**D13**).
6. **Orientation métier** : `buildPistesMetiers` (l. 925-940) ajoute **+35 points** à un métier si le type de base
   figure dans ses `profils_ideaux`. Une orientation professionnelle est donc pondérée par un test de
   personnalité de 20 questions non validé — point à arbitrer explicitement avec la direction et la CIP.

### 6.3 Affichages

| Écran | Ce qui marche | Ce qui ne marche pas |
|---|---|---|
| `/pcm` — `PersonalityMatrix.jsx` | complet et soigné : immeuble, base/phase + fiabilité, comportements, guide manager, 3 niveaux de stress, bandeau « Rapport reconstitué » (l. 441-446), 2 PDF, erreurs enfin remontées (l. 260-271) | immeuble trompeur (§3.3.c) ; aucune mise en garde méthodologique |
| Fiche salarié — `Employees.jsx:759-810` | lecture tolérante `baseType \|\| base_type` (l. 781), scores, alerte RPS | **un MANAGER reçoit 403 et lit « Aucun profil PCM enregistré »** (l. 159 `.catch(() => setPcmProfile(null))`, l. 769) — une absence affirmée là où il n'y a qu'un défaut d'habilitation, exactement ce que `masking.js:16-18` s'interdit ailleurs |
| Dossier candidat — `Candidates.jsx:844-880` | bouton de lancement du test, lien copiable | **`PCMView` lit `profile.base_type`, `phase_type`, `risk_alert`, `immeuble`** alors que l'API renvoie `baseType`, `phaseType`, `riskAlert`, `report.immeuble` → **l'onglet PCM est vide même pour un ADMIN** (**D8**) |
| Liste candidats | — | filtre « Avec PCM » et badge violet reposent sur `c.pcm_completed \|\| c.pcm_type`, **colonnes qui n'existent pas** dans `candidates` → onglet « Avec PCM (n) » listant 0 candidat (**D9**) |
| Insertion — `InsertionParcours.jsx` | badge « PCM recrutement » (l. 1065), bloc IA `pcm_adaptation` (l. 1488-1513) | la CIP ne voit **aucune structure PCM** : ni base, ni phase, ni canal, ni besoin, ni séquence de stress — seulement un badge et une prose de modèle de langage |

---

## 7. Tests existants

| Suite | Couvre | Ne couvre pas |
|---|---|---|
| `backend/tests/unit/pcm-crypto.test.js` (9 tests) | cascade de clés, non-levée, clé du jour à l'écriture — excellent, écrit à partir d'un incident réel | — |
| `backend/tests/contract/pcm-praticien-contract.test.js` (7 tests) | frontières du rôle PCM sur `/candidats`, `/sessions`, `/profiles`, `/types` ; non-régression ADMIN/RH/MANAGER | **ne vérifie pas l'absence d'e-mail sur `/profiles`** (cf. D15) |
| `backend/tests/unit/routes/transactions-vague3.test.js:41-80` (2 tests) | atomicité et UPSERT de `POST /submit`, rollback | — |
| `backend/tests/unit/services/anonymization.test.js:207-220` | suppression du PCM à l'anonymisation d'un **candidat** | le cas du candidat **recruté** / du salarié anonymisé (D5) |

**Aucun test ne porte sur `calculatePCMProfile`** — ni sur les poids, ni sur la détermination Base/Phase, ni sur
les ex æquo, ni sur l'alerte RPS, ni sur la structure de l'immeuble. Le cœur métier du module, celui qui produit
une affirmation sur une personne, est la seule partie non testée. C'est d'autant plus notable que la fonction est
**pure** et déjà exportée (`pcm.js:1148`) : elle est testable sans base ni serveur, comme le montrent les sondes
de cet audit.

---

## 8. Défauts constatés

### Bloquants

**D1 — L'« Alerte Risques Psychosociaux » se déclenche sur 32 % de réponses aléatoires**
`backend/src/routes/pcm.js:649-657`
```js
const stressMatchCount = stressAnswers.filter(a => a.answer_value === phaseType).length;
const riskAlert = (stressAnswers.length >= 2 && stressRatio >= 0.66)
  || (stressAnswers.length >= 3 && stressMatchCount >= 2);
```
Les 3 réponses « stress » pèsent 12 des 34,5 points qui **déterminent** la Phase (l. 615) ; on vérifie ensuite que
ces mêmes réponses désignent cette Phase. Mesure sur 20 000 répondants aléatoires : **32,2 % d'alertes**. Cas
inverse mesuré : un répondant parfaitement cohérent qui ne répond pas à Q7 et Q8 → **aucune alerte**. L'indicateur
est ensuite affiché en rouge dans un dossier de recrutement, imprimé dans deux PDF, stocké en base et **transmis
à l'IA** (`insertion-ai.js:202`).
→ **Recommandation** : retirer immédiatement le libellé « Risques psychosociaux » de toutes les surfaces (c'est un
qualificatif de santé apposé à un candidat sur la foi d'un artefact). Soit supprimer l'indicateur, soit le
reconstruire sur une base non circulaire (items dédiés d'intensité/fréquence, distincts de ceux qui déterminent la
Phase) et le renommer en ce qu'il est réellement (« cohérence des réponses de mise sous tension »). Dans tous les
cas, ne jamais le poser sur un candidat en cours de recrutement.

**D2 — Un profil non concluant est stocké et exploité comme un type ferme**
`backend/src/routes/pcm.js:616-624, 956-959` · `init-db.js:241-251`
Le moteur calcule `baseIndetermine` / `phaseIndetermine` / `validAnswers`, mais ces indicateurs ne vivent que dans
le **blob chiffré**. `pcm_reports` ne stocke que `base_type`, `phase_type`, `risk_alert`. Or toutes les lectures
« légères » ne voient que ces colonnes : liste des profils (l. 997-1002), fiche salarié, insertion (`has_pcm`),
IA. Preuve : 20 réponses avec des `question_number` hors questionnaire → **0 réponse valide** et pourtant
`base_type = 'perseverant'` écrit en base.
→ **Recommandation** : ajouter `base_confidence`, `phase_confidence`, `valid_answers` (colonnes, migration
idempotente) ; **refuser l'écriture** d'un rapport à moins de 18 réponses valides ; afficher un badge
« profil peu marqué » partout où `base_type` est affiché (liste, fiche salarié, insertion) et non sur la seule
page de détail.

### Majeurs

**D3 — `question_number` n'est jamais validé**
`backend/src/routes/pcm.js:885-919` — seul `answers` (tableau ≥ 18) et `answer_value` (∈ 6 types) sont contrôlés.
Conséquences mesurées : des numéros hors 1-20 sont **écrits dans `pcm_answers`** (la boucle d'insertion l. 944 itère
`uniqueAnswers`, pas les réponses effectivement scorées) ; et un `question_number` transmis en **chaîne** (`"1"`)
échoue au `===` strict de `PCM_QUESTIONS.find(q => q.num === answer.question_number)` (l. 590) → 0 réponse prise en
compte, profil quand même produit.
→ **Recommandation** : `body('answers.*.question_number').isInt({min:1,max:20}).toInt()` ; rejeter en 400 si moins
de 18 réponses **valides après appariement au questionnaire**.

**D4 — Aucune traçabilité, et le traitement n'est pas au registre**
`backend/src/routes/pcm.js` (aucun `autoLogActivity`, aucun `rgpd_audit_log`) · `init-db.js` (12 entrées
`rgpd_registre`, aucune pour le recrutement / le test de personnalité).
Créer une session, soumettre un profil et **consulter le rapport de personnalité d'une personne** ne laissent
aucune trace, dans un produit qui journalise par ailleurs 33 domaines et les consultations individuelles de la
badgeuse.
→ **Recommandation** : `router.use(autoLogActivity('pcm'))` ; journaliser la **consultation** d'un rapport dans
`rgpd_audit_log` (pattern des exports insertion) ; seeder une entrée de registre « Recrutement — évaluation de
personnalité (PCM) » avec finalité, base légale, destinataires, durée.

**D5 — Le PCM d'un candidat recruté n'est jamais purgé**
`backend/src/services/scheduler.js:1352` (`WHERE status != 'hired'`) · `rgpd.js:66-68` ·
`anonymization.js:124-360` (`anonymizeEmployee` ne touche à aucune table `pcm_*`).
Un profil de personnalité — base, phase, 20 réponses, alerte RPS — survit à l'anonymisation du salarié et reste
rattaché à une fiche `candidates` nominative, indéfiniment.
→ **Recommandation** : étendre `anonymizeEmployee` à `pcm_sessions` (cascade) via `employees.candidate_id`, et
prévoir une rétention propre au PCM (le PCM sert au recrutement puis à l'accompagnement — il n'a pas vocation à
survivre au dossier).

**D6 — Information, consentement et restitution au candidat**
`frontend/src/pages/PCMTest.jsx:223-246` (pas de notice), `:299-320` (restitution réduite au type de base) ·
`backend/src/routes/rgpd.js:74` (art. 15 candidat : 3 champs) et `:76-81` (art. 15 salarié : aucun PCM).
→ **Recommandation** : écran d'information préalable (finalité, destinataires, durée, droits, caractère
facultatif) avec trace dans `rgpd_consents` ; restitution complète au candidat qui la demande (le rapport existe
déjà, `exportResultsPDF` sait le mettre en page) ; inclure le rapport PCM dans les deux exports art. 15.

**D7 — « Aucun profil PCM enregistré » affiché alors qu'il en existe un**
`frontend/src/pages/Employees.jsx:159` puis `:769` — `api.get('/pcm/profiles/…').catch(() => setPcmProfile(null))`.
Un MANAGER (habilité sur `/employees`, pas sur `/pcm`) reçoit un **403** et lit une **absence affirmée** ; idem
pour un rapport illisible (**422 `PCM_ILLISIBLE`**), pourtant conçu avec un message explicite côté serveur
(`pcm.js:1105-1112`). Même schéma dans `Candidates.jsx:107-109`.
→ **Recommandation** : distinguer les trois cas (non habilité / illisible / réellement absent) — c'est la doctrine
que `masking.js:16-18` applique déjà (« l'absence de la clé signale non habilité, ≠ non renseigné »).

**D8 — Contrat rompu : l'onglet PCM du dossier candidat est vide**
`frontend/src/pages/Candidates.jsx:863-871` lit `profile.base_type`, `profile.phase_type`, `profile.risk_alert`,
`profile.immeuble` ; `GET /pcm/profiles/:candidateId` (`pcm.js:1124-1136`) renvoie `baseType`, `phaseType`,
`riskAlert`, et l'immeuble dans `report.immeuble`. Les badges s'affichent vides, l'immeuble ne s'affiche jamais —
**y compris pour un ADMIN**.
→ **Recommandation** : aligner sur `Employees.jsx:781` (`baseType || base_type`) ou, mieux, un test de contrat.

**D9 — Filtre « Avec PCM » et badge PCM inopérants**
`frontend/src/pages/Candidates.jsx:301` et `:390` — `c.pcm_completed || c.pcm_type` : **ces colonnes n'existent pas**
dans `candidates` (`init-db.js:145-170`, aucun `ALTER` ne les ajoute) et `GET /candidates` fait `SELECT c.*`
(`candidates/crud.js:20`). L'onglet affiche donc un compteur juste (`stats.withPCM`, l. 140-141) au-dessus d'une
liste systématiquement vide.
→ **Recommandation** : exposer `has_pcm` dans la liste (`EXISTS(SELECT 1 FROM pcm_reports …)`, comme le fait déjà
`employees.js:236`) et filtrer dessus.

**D10 — L'immeuble contredit la métaphore qu'il illustre**
`backend/src/routes/pcm.js:636-644` — `filter(… score > 0)` et tri sur le score **global**. Mesures : 5,84 étages
en moyenne (1 seul pour un répondant cohérent), et **l'étage 1 est plus court que l'étage 2 dans 46,8 % des cas**.
→ **Recommandation** : afficher **toujours les 6 étages** (un type non choisi = 0 %, ce qui est une information) ;
soit trier strictement par score et signaler la Base par un marqueur, soit expliquer à l'écran que l'étage 1 est
la Base indépendamment de la longueur de sa barre. Ne pas laisser les deux lectures se contredire.

**D11 — Le module Insertion n'utilise que la Base ; la Phase et la séquence de stress sont perdues**
`backend/src/routes/insertion/engine.js:695-702` (`pcm.base?.type` seul), `:823-835` (`buildPCMFromReport` renvoie
`score: 0` pour les 6 types), `:733` (`profil_pcm` jamais consommé par le frontend).
Pour une CIP, ce qui est actionnable — le besoin psychologique **du moment**, les 3 degrés de stress, le canal —
n'arrive jamais à l'écran ; il ne reste qu'un badge « PCM recrutement » et le texte produit par le modèle de
langage. À noter aussi : `pcm.js:703-707` (`communicationTips`) affiche le besoin psychologique de la **Base**
là où la méthode canonique désigne celui de la **Phase**.
→ **Recommandation** : c'est le chantier n° 1 du volet insertion (§9).

**D12 — La passation autonome n'est pas fiable**
`backend/src/routes/pcm.js:154-161` (icône constante par type, qui annule le mélange des options l. 321-332),
`:824-868` (lien sans expiration ni identification), `:885-919` (réponses arbitraires acceptées).
→ **Recommandation** : expiration du jeton (paramétrable), possibilité de le révoquer, et **surtout** afficher à
l'écran le statut réel de l'outil (§9, R1). Le mode `accompanied` prévu au schéma (`init-db.js:220`) — passation
accompagnée, pertinente pour un public en difficulté avec l'écrit — n'est **jamais utilisé** : c'est la piste la
plus simple pour fiabiliser la passation.

**D13 — Deux référentiels PCM concurrents**
`backend/src/routes/pcm.js:16-149` (`PCM_TYPES`) et `backend/src/routes/insertion/engine.js:38-690`
(`PCM_KNOWLEDGE`). Divergences déjà présentes sur les besoins et les faiblesses sous stress.
→ **Recommandation** : une source unique (`backend/src/data/pcm-referentiel.js`), enrichie des champs
d'insertion, consommée par les deux — la doctrine que le projet a déjà appliquée à `utils/pcm-crypto.js`
(cf. son en-tête : « trois implémentations, trois occasions de diverger »).

**D14 — L'habilitation « Tests PCM (praticien) » ne masque rien**
`backend/src/routes/permissions.js:65` propose la clé `pcm` ; `frontend/src/components/Layout.jsx:140` est une
feuille **sans `id`** ; `filterByModuleAccess` (`Layout.jsx:454-466`) ne teste que `node.id`.
→ **Recommandation** : donner `id: 'pcm'` au nœud, ou retirer la clé du catalogue. Une case qui ne fait rien est
pire qu'une case absente.

**D15 — Le praticien PCM reçoit les e-mails des candidats**
`backend/src/routes/pcm.js:999` — `SELECT … c.email` sur `/profiles`, ouvert à `PCM`. Contredit la raison d'être
du rôle (`permissions.js:24-26` : « SANS accès au dossier de recrutement… ni coordonnées ») que le test de contrat
vérifie pourtant sur `/candidats`.
→ **Recommandation** : retirer `c.email` de `/profiles` et étendre l'assertion du test de contrat à cette route.

### Mineurs

**D16 — « Fiabilité » n'est pas une fiabilité, et le seuil est très permissif**
`pcm.js:555-561, 623-624` — écart relatif #1/#2, seuil d'indétermination à 8 % (soit 1 point sur 12). Affiché tel
quel au CIP et **au candidat** (`PCMTest.jsx:315-318`). Sensibilité mesurée : 11,3 % des changements d'une seule
réponse changent la Base. → Renommer (« écart avec le 2ᵉ type ») et relever le seuil après étalonnage.

**D17 — `POST /pcm/sessions` ne vérifie pas l'existence du candidat**
`pcm.js:770-790` — un `candidate_id` inexistant produit une violation de clé étrangère rendue en « Erreur serveur »
(500) au lieu d'un 404. Aucune garde non plus contre l'empilement de sessions ouvertes pour un même candidat.

**D18 — Chiffrement : clé de repli publique, pas de sentinelle**
`utils/pcm-crypto.js:24` (`'solidata-pcm-encryption-key'` en dur, sans la garde fatale que `insertion/routes.js:26-29`
applique) et absence du marqueur que `utils/field-crypto.js:37` a introduit précisément pour ce risque.

**D19 — Colonnes mortes**
`pcm_sessions.mode = 'accompanied'` (`init-db.js:220`) : aucun écran ne le crée. `pcm_answers.answer_voice_text`
(`init-db.js:235`, écrit l. 946-952) : aucun client ne l'alimente — `PCMTest.jsx` fait de la synthèse vocale
(lecture), pas de la reconnaissance vocale.

**D20 — Documentation applicative fausse sur presque tous les points chiffrés**
`docs/DOCUMENTATION_APPLICATIVE.md:128-162` : « 4 choix par question » (6), « 5 catégories » (8),
« Base poids total 17.5 » (23), « Phase 25 » (34,5), composition de la Base erronée, « profil graphique radar »
(inexistant), « alertes RPS si le score stress de la Phase dépasse 75 % » (ce n'est pas la règle codée),
`POST /api/pcm/evaluate` et `DELETE /api/pcm/:candidateId` (**n'existent pas**), rôles ADMIN/RH (le rôle PCM manque).

**D21 — Rattachement du PCM par homonymie**
`insertion/routes.js:3388-3394` — en l'absence de `candidate_id`, recherche par prénom+nom, puis chargement du PCM
de ce candidat (l. 3401-3404). Deux homonymes suffisent à attribuer le profil d'un autre.

**D22 — Deux lecteurs, deux comportements en dégradation**
`insertion/routes.js:3410-3411` (rapport illisible → `has_pcm: false`) vs `insertion-ai.js:137-138` (repli sur
`base_type`/`phase_type` en clair, avec un commentaire qui explique pourquoi c'est le bon choix).

**D23 — `calculatePCMProfile` ne déduplique pas**
La déduplication est faite par la route (`pcm.js:916-919`) et garantie en base par la contrainte UNIQUE
(`init-db.js:259-274`), mais la fonction pure accepte des doublons (mesuré : `validAnswers = 22` sur 20 questions).
Elle est appelée directement par `reconstruireRapport` (l. 1060-1068) et par le script de réparation (l. 95).

**D24 — Repassages non exploités**
Aucune unicité sur `pcm_reports(candidate_id)` ; `GET /profiles` liste tous les rapports (un candidat y apparaît
plusieurs fois) ; `GET /profiles/:candidateId` ne renvoie que le dernier. Aucun écran ne compare deux passations —
alors que c'est exactement ce qui permettrait d'observer un **changement de phase**, notion centrale du modèle.

---

## 9. Synthèse

### Forces réelles

- **Le chiffrement et la récupération des rapports sont exemplaires** : source unique de clés, cascade de lecture,
  jamais d'exception, script de diagnostic/réparation en simulation par défaut qui **n'invente jamais un profil**
  et annonce à l'écran ce qui a été reconstitué (`PersonalityMatrix.jsx:441-446`). C'est un correctif d'incident
  bien mené, testé, et honnête sur ce qu'il ne peut pas réparer.
- **L'écriture est atomique et idempotente** (transaction + `ON CONFLICT`, `pcm.js:941-970`), avec le test qui va avec.
- **Le moteur est déterministe, insensible à l'ordre, et sans biais de type** — l'ancien défaut « Analyseur par
  défaut » est réellement corrigé, mesures à l'appui.
- **L'affectation théorique Base/Phase est juste** : canal et guide manager sur la Base, séquence de stress et
  driver sur la Phase. Les 6 types, leurs canaux et leurs drivers sont fidèles à la méthode.
- **L'accessibilité de la passation est soignée** : textes FALC, une question par écran, icônes, synthèse vocale,
  barre de progression, retour possible — pensé pour un public éloigné de l'écrit.
- **Le rôle « Praticien PCM » est bien conçu** (projection minimale, test de contrat qui verrouille les frontières).

### Faiblesses structurantes

1. **L'outil affirme plus qu'il ne mesure.** 20 items transparents, non validés, auto-administrés sans surveillance,
   7 d'entre eux décidant de la Base ; et une restitution qui parle de « fiabilité », d'« alerte RPS » et de
   « base/phase » sans jamais dire ce que l'instrument est. Le document externe, lui, place la mise en garde
   **avant** l'exercice. Ici elle n'existe nulle part : ni à l'écran candidat, ni sur la fiche profil, ni dans les
   deux PDF exportés — qui sont pourtant les documents qui circulent.
2. **L'indicateur le plus lourd de conséquence est un artefact** (D1) : 32 % d'alertes « risques psychosociaux »
   sur du bruit, posées sur des candidats, imprimées, stockées, transmises à l'IA.
3. **L'incertitude est calculée puis perdue** (D2) : elle reste dans le blob chiffré, alors que tous les autres
   écrans lisent les colonnes en clair.
4. **La conformité du volet recrutement est en retard sur le reste du produit** (D4, D5, D6) : pas de registre,
   pas de journalisation, pas d'information préalable, pas de purge pour les recrutés — dans un produit qui, par
   ailleurs, documente ses règles RGPD au point d'exposer un endpoint `/rgpd/politique`.
5. **La chaîne vers l'insertion perd l'essentiel** (D11) : la CIP hérite d'un badge et d'un texte d'IA, pas de la
   structure de personnalité ni des points de vigilance.
6. **Trois contrats front/back cassés** (D7, D8, D9) font que le PCM est, en pratique, invisible ou muet sur deux
   des trois écrans qui devraient le montrer.

### Recommandations priorisées

**Priorité 1 — arrêter d'affirmer ce qui n'est pas mesuré** (rapide, sans migration)
- **R1.** Retirer partout le libellé « Alerte Risques Psychosociaux » (écran, PDF, base, payload IA) le temps de
  refonder l'indicateur (D1). C'est la correction la plus urgente : elle appose aujourd'hui un qualificatif de
  santé sur un candidat.
- **R2.** Ajouter un **encart de méthode** sur la fiche profil, sur les deux PDF et sur l'écran candidat :
  questionnaire interne d'aide à la réflexion, 20 questions, non validé, ne constitue pas un diagnostic,
  ne doit pas fonder seul une décision de recrutement ou d'orientation. Le document externe fournit la formulation.
- **R3.** Renommer « Fiabilité » (D16) et afficher « profil peu marqué » **partout** où `base_type` est montré (D2).

**Priorité 2 — rendre le module honnête et traçable**
- **R4.** Valider `question_number` et refuser un rapport à moins de 18 réponses **valides** (D3).
- **R5.** Colonnes `base_confidence` / `phase_confidence` / `valid_answers` sur `pcm_reports` (D2).
- **R6.** `autoLogActivity('pcm')` + journalisation `rgpd_audit_log` de la consultation d'un rapport + entrée au
  registre art. 30 (D4).
- **R7.** Étendre `anonymizeEmployee` aux tables `pcm_*` et définir une rétention propre au PCM (D5).
- **R8.** Notice d'information + trace de consentement + restitution au candidat + PCM dans les exports art. 15 (D6).

**Priorité 3 — réparer ce qui est cassé à l'écran**
- **R9.** D7, D8, D9 (trois correctifs indépendants et courts), plus l'immeuble à 6 étages (D10) et
  l'habilitation `pcm` rendue opérante (D14).
- **R10.** Retirer `c.email` de `/pcm/profiles` et étendre le test de contrat (D15).
- **R11.** Une **suite de tests unitaires sur `calculatePCMProfile`** : la fonction est pure et déjà exportée ;
  les sondes de cet audit (`annexes/probe.js`, `probe2.js`) donnent les cas et les valeurs de référence.

**Priorité 4 — servir réellement la CIP** (le chantier de fond, D11/D13)
La CIP a besoin de deux choses que le module possède déjà mais n'expose pas : **la structure** et **les points de
vigilance**.
- **R12.** Un **bloc PCM structuré dans la fiche d'insertion** (pas seulement un badge) : Base (perception, canal,
  points forts, guide DO/DON'T) **et Phase** (besoin psychologique du moment, driver, **les 3 degrés de stress
  avec les signaux observables et « ce qu'il faut redonner »**). Toute la matière existe dans `PCM_TYPES` ; il
  suffit de la laisser passer au lieu de la réduire à `has_pcm`.
- **R13.** Faire entrer la **Phase** dans `engine.js` (aujourd'hui : `pcm.base?.type` seul), et corriger le niveau
  du besoin psychologique dans `communicationTips` (Base → Phase).
- **R14.** Fusionner `PCM_TYPES` et `PCM_KNOWLEDGE` en un référentiel unique (D13) avant d'y toucher, sinon la
  correction se fera à un seul des deux endroits.
- **R15.** Rendre possible une **repassation en cours de parcours** et une **comparaison de deux passations** :
  c'est la seule façon d'observer un changement de phase, et c'est précisément ce qui a du sens dans un
  accompagnement long (D24). Cela suppose de délier `pcm_sessions` de `candidate_id` (ou d'ajouter `employee_id`).
- **R16.** Arbitrer explicitement avec la direction le **poids du PCM dans l'orientation métier**
  (`engine.js:934-940` : +35 points sur un métier au vu du seul type de base) — et, à minima, afficher cette
  pondération à la CIP plutôt que de la laisser implicite dans un score.

**Point à faire arbitrer hors technique** : l'usage du nom « Process Communication Model » / « PCM » et de la
mention « Kahler » dans un logiciel exploité (marques déposées de Kahler Communications, Inc. — le document externe
pose lui-même ce point de vigilance). Constat factuel, à instruire par la direction.
