# Réalisation — PR C, lot 7 « Le salarié »

> Agent `salarie`, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-c`.
> Contrat : `20-contrats-techniques-PR-C.md` § 1.3, 2, 3.2, 4, 5.6-5.7, 6, 7, 8, 9.
> Deux commits : `1775217` (cœur du lot) et `4460e07` (branchements partagés).

---

## 0. Ce que le lot livre, en une phrase

Les deux premiers documents de l'outil écrits **pour la personne accompagnée** —
« Mon parcours en une page » et « Mon Récap », composés côté serveur en liste
blanche, avec remise tracée — et les **rappels de rendez-vous J-1** par SMS ou
e-mail, sur consentement individuel tracé et révocable, sans jamais nommer le
type d'entretien.

---

## 1. Livré, point par point

### 1.1 Schéma — `backend/src/scripts/migrations/insertion-salarie.js` (224 l.)

| Ce qui est posé | Ligne | Décision tenue |
|---|---|---|
| 5 colonnes `employees.rappel_rdv_*` | 87-93 | `rappel_rdv_consent BOOLEAN` **sans DEFAULT** : trois états, et `NULL` (« jamais demandé ») n'est pas `false` (« a refusé »). Un défaut `false` ferait qu'on ne repose plus jamais la question. |
| CHECK du canal par DO-scan | 97-108 | `ADD CONSTRAINT` n'accepte pas `IF NOT EXISTS` : une seconde exécution échouerait en 42710. |
| `insertion_documents_salarie` | 115-129 | `contenu JSONB` = SNAPSHOT et non vue (§ 3.2) ; `parcours_num` parce qu'une personne peut revenir en parcours. |
| `insertion_rappels_rdv` | 140-153 | `UNIQUE(milestone_id)` et `destinataire_masque` : la colonne du contact en clair **n'existe pas** dans cette table. |
| 2 gabarits `message_templates` | 163-179 | Seedés **actifs** : le job ne peut rien envoyer sans consentement individuel, et un gabarit désactivé ajouterait une seconde condition à vérifier le jour où un rappel ne part pas. |
| Entrée registre art. 30 | 188-218 | Traitement DISTINCT de l'accompagnement : la base légale l'est (consentement art. 6-1-a), le destinataire est un sous-traitant (Brevo), la durée est celle de la trace. |

Rejouable : aucune instruction non gardée (`IF NOT EXISTS`, DO-scan, `WHERE NOT
EXISTS`), aucun `BEGIN`/`COMMIT` — elle vit dans la transaction d'`init-db`.

### 1.2 Composition — `backend/src/services/mon-parcours.js` (541 l.)

- `composerMonParcours` (l. 278) et `composerMonRecap` (l. 399), formes **exactes**
  du § 5.6.1 et § 5.6.2. `MON_PARCOURS_CLES` (9) et `MON_RECAP_CLES` (7) exportées
  et vérifiées par test.
- **Liste blanche, pas liste noire** : chaque rubrique est énumérée. `CLES_INTERDITES`
  (l. 159) est exportée pour que le test parcoure l'arbre complet des deux
  documents et prouve qu'aucune clé ne contient `frein_`, `sante`, `judiciaire`,
  `brsa`, `ft_categorie`, `note`, `observations`, `commentaire*`, `motif*`,
  `presence`, `absence*`, `bilan_`, `avis_`, `description`.
- **Trois conséquences tenues jusqu'au bout** (et testées une par une) :
  1. une étape du récapitulatif porte le **libellé de son type** (dictionnaire
     fermé) et jamais le `titre` saisi — la colonne n'est même pas SÉLECTIONNÉE
     (l. 424-431). C'est exactement le défaut bloquant trouvé par la revue de
     sécurité de la PR B sur le relevé transmis au CMS ;
  2. une action est décrite par sa **catégorie** et son partenaire, jamais par son
     libellé libre ; celles rattachées au frein santé ou judiciaire sont écartées
     **en SQL**, ligne entière (l. 339-347 et 436-444), la liste des freins
     sensibles étant LUE du registre (`FREINS_EXCLUS`, l. 88) et non recopiée ;
  3. `sortie_type` est un `VARCHAR(50)` libre : une valeur hors dictionnaire rend
     `null` plutôt que d'être recopiée sur un document destiné à circuler (l. 519).
- **Les heures, sans seuil** : `lireHeuresSemaine` (l. 254) rend la dernière semaine
  **relevée** sous la forme `{ semaine, travail_h, accompagnement_h, total_h }` —
  quatre clés, aucune cible, aucune alerte. L'année précédente est consultée si
  l'année courante ne porte rien (janvier, import de paie en retard). Aucun
  relevé → `null`, jamais `0`. Un test lit le **code dépouillé de ses commentaires**
  et échoue si « seuil », « 15 h », « plancher » ou « obligation » y apparaît.

### 1.3 Rappels — `backend/src/services/rappels-rdv.js` (310 l.)

- `doitEnvoyerRappels(now, heure)` (l. 73), **fonction pure** sur l'heure murale de
  Paris (`Intl`, DST géré), patron de `shouldRunAutoBackup`.
- `selectionnerRendezVous` (l. 148) : consentement, `is_active`, canal et
  destinataire dans le **`WHERE`** ; « demain » calculé **par PostgreSQL** en
  `Europe/Paris` ; `NOT EXISTS` sur la trace ; et le **type d'entretien n'est pas
  sélectionné** — ce qu'on ne lit pas ne peut pas fuir par une substitution oubliée.
- `masquerDestinataire` (l. 101) : `06 ** ** ** 78`, `j***@gmail.com`.
- Trace écrite **après** l'appel : une ligne « en cours » qu'un crash laisserait en
  place bloquerait définitivement le rappel (l'unicité porte sur l'entretien). Le
  doublon, lui, est impossible par la contrainte — un `23505` vaut « déjà envoyé ».
- Journal `INSERTION_RAPPEL_ENVOI` par envoi, `user_id` NULL (job planifié),
  destinataire masqué.

### 1.4 API — `backend/src/routes/insertion/salarie.js` (476 l.)

`router.use(authorize('ADMIN', 'RH'))` en **première ligne du routeur** (l. 51) :
le refus tombe avant tout validateur, donc avant la première requête. Les 10 routes
du § 5.6 sont livrées à l'identique (aperçu, génération, liste, consultation,
remise, consentement en lecture et écriture, historique des rappels).

Points de doctrine appliqués :
- `pool.connect()` **dans** le `try`, `release()` dans le `finally` (les deux
  transactions) — défaut corrigé deux fois, PR A et PR B ;
- journal **bloquant** dans la transaction pour la génération et la remise (si la
  trace échoue, `ROLLBACK` et 500 : le document n'existe pas) ; **tolérant** pour
  les consultations ;
- remise **une seule fois** (409 `REMISE_DEJA_TRACEE`, `FOR UPDATE`), jamais dans
  le futur (jour civil de Paris) ;
- consentement : colonnes `employees` **et** `rgpd_consents` écrits dans la même
  transaction que le journal — un consentement présent d'un côté et absent de
  l'autre serait pire que pas de consentement ; retrait = `{ consent: false }` seul,
  qui **efface** le contact ;
- destinataire validé (téléphone FR ou E.164, e-mail) **avant** toute écriture ;
- base non migrée : 503 motivé à l'écriture, liste vide à la lecture.

### 1.5 Front (3 fichiers, 755 l.)

- `DocumentsSalariePanel.jsx` — aperçu (n'enregistre rien) → « Générer et
  imprimer » (snapshot + PDF depuis le snapshot) → « Réimprimer » (relit le
  document enregistré : deux exemplaires ne peuvent pas diverger) → « Tracer la
  remise ». `Modal`/`useToast`, **zéro `alert()`**.
- `RappelsConsentement.jsx` — les trois états distingués à l'écran (« Jamais
  demandé » n'est pas un refus), la **phrase FALC à lire à la personne** affichée en
  toutes lettres, contacts connus proposés **masqués**, `ConfirmDialog` sur le
  retrait, historique des rappels.
- `pdf-salarie.js` — `openPrintWindow(..., { large: true })` (corps ≥ 14 px),
  vouvoiement, un champ absent s'écrit « pas encore renseigné ». **Aucun filtrage**
  à l'impression, délibérément : un filtre ici serait le dernier rempart,
  c'est-à-dire celui qu'on oublie.

### 1.6 Branchements partagés

| Fichier | Ligne | Effet |
|---|---|---|
| `services/scheduler.js` | 1863-1869 | Job dans le tick horaire, sur l'heure **murale** de Paris |
| `services/scheduler.js` | 2146 | `purgeRappelsRdv` dans `runAllJobs` |
| `routes/monitoring.js` | 183, 156 | `JOB_SCHEDULE` : le job et sa purge |
| `services/rgpd-purges.js` | 789, 953 | **10ᵉ purge**, forme identique aux neuf autres |
| `services/anonymization.js` | 336, 344, 353, 361, 387 | Documents, rappels, reports d'échéance (lot 5), jeton ETI, consentement |
| `routes/rgpd.js` | 273-276, 336-342 | Règle de rétention dans `GET /rgpd/politique`, seuil lu au même endroit que la purge |

---

## 2. Écarts au contrat, et pourquoi

1. **`frontend/src/utils/rgpd-libelles.js` modifié** (interdit § 1.4). La 10ᵉ purge
   émet deux codes d'audit (`AUTO_PURGE_RAPPELS_RDV`, `PURGE_RAPPELS_RDV`) que le
   § 7 n'énumérait pas — il ne listait que les 10 codes fonctionnels. La **garde
   anti-dérive** `tests/unit/rgpd-audit-libelles.test.js` a fait tomber la suite
   tant que les libellés manquaient. Deux issues possibles : signaler et laisser
   la suite rouge, ou ajouter deux lignes. J'ai ajouté les deux entrées (additives,
   au milieu des huit autres paires de purge) pour tenir la preuve n° 1. Le lot 5
   ne touche pas ce fichier : aucun conflit attendu.
2. **`backend/tests/unit/services/rgpd-purges.test.js` modifié** (hors liste § 1.3).
   Ce test fige la liste ordonnée des clés de purge ; ajouter la 10ᵉ le rendait
   rouge par construction. Modification minimale : le compte et la liste, plus un
   commentaire disant pourquoi `rappels_rdv` se range avant `refresh_tokens`.
3. **Les deux entrées « Mon parcours » / « Mon Récap » du menu « Fiche PDF ▾ »
   n'existent pas** dans `InsertionParcours.jsx`. Le pré-câblage a posé les imports
   et les deux ancrages de composants, pas ces entrées de menu (vérifié :
   `grep "Mon Récap" InsertionParcours.jsx` = 0). Je n'ai pas touché ce fichier
   (interdit). **Sans conséquence fonctionnelle** : les deux boutons vivent dans
   `DocumentsSalariePanel`, qui est bien monté. À l'orchestrateur de trancher s'il
   veut le raccourci en plus.
4. **`services/anonymization.js` : `rgpd_consents` n'était PAS traité.** Le § 8
   disait « déjà traité par l'anonymisation existante (vérifier ; sinon DELETE de
   l'entrée `rappel_rdv`) ». Vérifié : le mot n'apparaissait nulle part dans le
   fichier. J'ai donc supprimé la seule entrée dont le lot est l'auteur. **Les
   autres types de consentement survivent aujourd'hui à l'anonymisation d'un
   dossier** — hors périmètre, porté au § 5 « à arbitrer ».
5. **`journaliser` recopié et non importé.** `backend/src/utils/insertion-journal.js`
   n'existait pas au moment de l'écriture (le lot 5 l'extrait de `rsa.js`). La
   fonction est donc locale (`salarie.js` l. 76-100) avec un commentaire
   « NOTE D'INTÉGRATION — à dédoublonner » ; l'orchestrateur remplace les deux
   fonctions par l'import du helper partagé.

---

## 3. Décisions prises dans les marges du contrat

- **La dégradation d'une source n'est pas reportée dans le document** (contrairement
  à la fiche pour le référent, où `sources_indisponibles` est imprimé). Sur une page
  destinée à la personne, une mention « rubrique indisponible » n'a aucun
  destinataire capable d'agir dessus : elle reste au journal serveur, où la CIP et
  l'exploitant la trouvent.
- **Le type d'étape `formation` du § 5.6.2 n'a aucune source aujourd'hui.** Il reste
  dans la liste fermée, aucune ligne ne le produit : `formation_actions` est
  **non nominative** (aucun `employee_id` — c'est sa raison d'être) et rien d'autre
  ne date une formation individuelle. Inventer une étape aurait été pire que
  l'absence.
- **Gabarits seedés actifs** plutôt qu'inactifs (justifié en 1.1).
- **Un gabarit manquant pour le canal demandé ne pose AUCUNE trace** : le rappel
  reste dû et repartira au prochain passage. Poser une trace ici le perdrait
  définitivement, l'unicité portant sur l'entretien.
- **Contacts proposés masqués** dans l'écran de consentement : la conseillère
  vérifie de vive voix (« c'est bien le 06 qui finit par 12 ? »). Faire d'un écran
  de consentement un annuaire de plus n'apporterait rien.

---

## 4. Défaut trouvé par mes propres tests

`lireHeureEnvoi` faisait `Math.round(Number(v))` sans tester l'absence. Or
`Number(null)` vaut **0**, et 0 est ici une heure parfaitement valide (minuit) :
un réglage absent ou vidé aurait envoyé les rappels **à minuit**, en silence.
C'est la famille de pièges déjà payée trois fois par le dépôt (point de départ
dans le golfe de Guinée en 2.42.0, tolérance de rendez-vous à zéro minute en
2.38.0, `palierDepuisStockage` en 2.48.0). L'absence se teste **avant** la
conversion (`rappels-rdv.js` l. 88-90), et un test exerce les deux cas — `null`
rend 18, `0` rend bien 0.

---

## 5. Limites et points à arbitrer

1. **Un entretien REPROGRAMMÉ ne reçoit pas de second rappel.** `UNIQUE(milestone_id)`
   porte sur l'entretien, pas sur la date : si un rendez-vous est déplacé après
   l'envoi du rappel, aucun nouveau message ne part. C'est le prix assumé de la
   garantie « jamais deux messages ». Lever la contrainte au profit d'une clé
   `(milestone_id, date)` est possible — c'est un arbitrage de la CIP, pas une
   décision technique (déjà prévu au contrat § 5.7 pour la PR D).
2. **`rgpd_consents` n'est purgé que de l'entrée `rappel_rdv`** à l'anonymisation.
   Les autres types de consentement d'un salarié anonymisé subsistent. Défaut
   préexistant, hors périmètre — **à arbitrer avec le DPO**.
3. **Aucun envoi n'est prouvé de bout en bout** : `sendNotification` est simulé dans
   les tests, et la clé Brevo n'existe pas en développement (statut `dry_run`).
   La preuve réelle appartient à l'agent debug, puis à la production.
4. **La rétention de la trace (365 j) est plus longue que l'usage.** Rien n'exige
   de garder un an la preuve qu'un SMS de rappel est parti ; la valeur retenue est
   celle du contrat § 4 et reste paramétrable
   (`insertion.rappels_retention_jours`). À réduire si le DPO le souhaite.
5. **L'écran de consentement ne vérifie pas que le contact appartient à la
   personne.** Rien ne peut le vérifier techniquement : c'est une règle de conduite
   (la conseillère recueille le numéro de vive voix), rappelée par la phrase FALC
   affichée à l'écran.
6. **Le libellé d'une PMSMP porte le nom de l'entreprise d'accueil** dans « Mon
   Récap ». C'est voulu (le document sert à valoriser l'expérience) et c'est une
   donnée que la personne connaît, mais c'est le seul champ non issu d'un
   dictionnaire fermé dans ce document — signalé à la revue de sécurité.

---

## 6. Preuves

### 6.1 Jest

| | Suites | Tests |
|---|---|---|
| Avant (HEAD, lot 5 backend inclus) | 239 | 4 796 |
| Après | **243** | **4 898** |
| Delta lot 7 | +4 | **+102** |

`cd backend && npx jest` → **243 suites passées, 4 898 tests passés, 0 échec**
(8 suites / 224 tests `skipped` préexistants — bases réelles opt-in).

Répartition : `insertion-salarie-contract` 46, `rappels-rdv` 24,
`mon-parcours` 22, `migrations/insertion-salarie` 10.

### 6.2 Build et `require`

- `cd frontend && npm run build` → **vert** (`✓ built in 11.19s`).
- `JWT_SECRET=x PCM_ENCRYPTION_KEY=y node -e "require(…)"` → **vert** sur les 9
  modules touchés (4 créés, 5 modifiés).
- `grep -c "window.confirm\|alert("` sur mes 3 fichiers front → **0, 0, 0**.
- Gardes transverses re-jouées vertes : `source-syntaxe`, `activity-log-libelles`,
  `rgpd-audit-libelles`, `scheduler-instrumentation`, `scheduler` (288 tests).

### 6.3 Contre-épreuves par mutation (5, toutes restaurées)

| # | Mutation | Effet |
|---|---|---|
| 1 | `frein_sante: 4` ajouté au contenu de « Mon Récap » | **3 tests tombent** (unitaire liste blanche + contrat, aperçu et génération) |
| 2 | `AND e.rappel_rdv_consent = true` retiré du `WHERE` de sélection | **1 test tombe** (« le consentement est une condition de LECTURE ») |
| 3 | `UNIQUE(milestone_id)` retiré de la DDL | **1 test tombe** (migration, « un seul rappel par rendez-vous ») |
| 4 | Journal de génération rendu tolérant (`try/catch`) | **1 test tombe** (« journal en échec → ROLLBACK, 500 ») |
| 5 | `authorize('ADMIN','RH')` élargi à MANAGER | **10 tests tombent** (les 10 routes, refus avant toute requête) |

Restauration vérifiée : les 4 suites du lot repassent **102/102**, et les trois
motifs mutés sont de retour dans le code (`grep` : 3 / 2 / 1 occurrences).

---

## 7. Au déploiement

`deploy.sh update` — la migration est idempotente et appelée par `init-db` dans sa
transaction. **Aucun paramétrage requis** : les deux réglages ont leur défaut en
code (`insertion.rappel_rdv_heure_envoi` = 18, `insertion.rappels_retention_jours`
= 365), les gabarits sont seedés, et **aucun rappel ne peut partir tant qu'aucune
personne n'a donné son accord**. Sans clé Brevo, le job tourne et marque ses lignes
« simulé » — il ne prétend pas avoir envoyé.

**À dire aux CIP** : le consentement se recueille dans l'onglet « Dossier
administratif », il se retire d'un clic, et le message ne dit jamais de quoi il
s'agit. Les deux documents se produisent depuis l'onglet du parcours ; « Aperçu »
n'enregistre rien, « Générer » conserve une copie exacte de ce qui a été édité.
