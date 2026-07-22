# Étude d'évolution — Module Recrutement au service de la continuité du parcours d'insertion

- **Date** : 22 juillet 2026
- **Auteur** : agent d'étude (persona : product manager RH/ATS, spécialité recrutement en SIAE/ACI)
- **Commanditaire** : direction (cf. `00-cahier-des-charges.md`, §A : « la partie embauche est plutôt bien documentée dans l'application ; étudie les évolutions possibles pour répondre à la promesse d'un logiciel de recrutement intégré dans une optique de suivi du parcours d'insertion des collaborateurs recrutés »)
- **Statut** : étude — aucun code modifié. Livrable à valider avant tout plan de codage.
- **Périmètre** : module Recrutement (candidates, entretiens, mises en situation, PCM, documents, plan de recrutement) et sa **jonction** avec le module Insertion. La refonte du diagnostic d'accueil, des jalons et de la frise est traitée par l'étude sœur (extension Insertion) ; les dépendances croisées sont signalées.

---

## 1. Cadrage : que veut dire « recrutement intégré » pour une ACI ?

Dans un ATS généraliste, le recrutement se termine à la signature du contrat. Dans une ACI, c'est l'inverse : **l'embauche est le premier acte du parcours d'insertion**. L'entretien d'embauche est déjà un pré-diagnostic (freins, projet, motivation), le test de personnalité PCM éclairera la relation d'accompagnement pendant 24 mois, la prescription (PASS IAE) borne légalement le parcours, et l'entretien de période d'essai — présent dans la procédure interne — est le point de bascule officiel vers l'accompagnement socio-professionnel (`Proce_dure_recrutement.pdf`, p. 1 : « Réussite de l'évaluation de la période d'essai → Début de l'accompagnement socio-professionnel »).

La promesse « logiciel de recrutement intégré » se mesure donc à un critère simple : **combien d'informations recueillies pendant le recrutement le CIP doit-il ressaisir (ou perdre) après l'embauche ?** L'analyse ci-dessous montre que la collecte amont est riche (c'est la force du module), mais que la transmission aval est quasi nulle : au moment de la liaison candidat→collaborateur, seuls le PCM, le permis B et le CACES traversent la frontière.

---

## 2. Analyse de l'existant

### 2.1 Forces factuelles

| Capacité | Où | Constat |
|---|---|---|
| Pipeline kanban 4 colonnes (Reçus / Entretien / Recrutés / Refusés), drag & drop, KPIs, recherche, filtres vue/poste | `frontend/src/pages/Candidates.jsx:9-44`, `backend/src/routes/candidates/crud.js:49-78` | Fluide et adapté à une petite structure ; contrainte SQL alignée sur les 4 statuts (migration `init-db.js:2592-2604`) |
| Import CV avec parsing + OCR (tesseract) et détection de compétences par mots-clés paramétrables | `candidates/cv-engine.js:10-26`, `crud.js:159-233`, table `skill_keywords` (`init-db.js:200-210`) | Création de fiche en un glisser-déposer, compétences pré-détectées (permis, CACES, tri textile, manutention…) |
| **Trame d'entretien structurée en 7 sections** : présentation, situation, **freins à l'emploi**, motivation, savoir-être, organisation, **projet professionnel** + évaluation globale | table `recruitment_interviews` (`init-db.js:3349-3396`), UI `Candidates.jsx:918-1127` | Rare dans un ATS : la trame est déjà orientée insertion (freins, structure d'accompagnement, attentes, idée de métier) |
| **3 mises en situation métier** (collecte/manutention, craquage, qualité), 8 critères notés 1-5, résultat conforme/à améliorer/non conforme | table `mise_en_situation` (`init-db.js:3399-3423`), UI `Candidates.jsx:1132-1266` | Fidèle au « test technique » de la procédure, adapté aux postes textiles de ST |
| Test PCM par lien autonome, rapport chiffré AES-256, visible sur la fiche candidat | `pcm_sessions` (`init-db.js:216-227`), `Candidates.jsx:216-230` | Le « test de personnalité » du CDC est couvert |
| Traçabilité des changements de statut avec auteur et commentaire | `candidate_history` (`init-db.js:175-184`), `individual.js:98-101` | Embryon d'historique de la personne |
| Remise de documents tracée (livret d'accueil, charte d'insertion, fiches), auto-délivrance livret+charte au passage « Recrutés » | `recruitment_documents` (`init-db.js:3426-3438`), `individual.js:104-113` | Début d'outillage de la phase administrative |
| **Liaison candidat↔collaborateur** avec gardes d'unicité, recopie permis/CACES (OR logique), squelette `insertion_diagnostics`, suggestions par proximité de nom | `candidates/conversion.js:80-157`, modale `LinkEmployeeModal` | Le passage technique est traité (prérequis acquis, cf. demande client) |
| Rappel automatique de convocation J-1 (SMS/email Brevo, si trigger configuré) | `services/scheduler.js:163-205` | Brique notifications déjà branchée sur les candidats |
| Purge RGPD automatique : anonymisation des candidats non recrutés > 24 mois (fiche + PCM + entretiens + mises en situation + documents) | `scheduler.js:606-647`, `services/anonymization.js:88-113` | Conformité minimisation déjà sérieuse |
| Plan de recrutement mensuel par poste (besoins vs embauches) | `recruitment_plan` (`init-db.js:2813-2822`), `conversion.js:339-393` | Base de pilotage des volumes |
| Ce que l'Insertion consomme déjà du recrutement | `insertion-ai.js:98-113` (PCM, `interview_comment`, `practical_test_result`, `cv_raw_text`), `insertion/routes.js:1028-1062` | La tuyauterie `employees.candidate_id` fonctionne — mais transporte peu de choses |

**Conclusion intermédiaire** : le jugement du client (« plutôt bien documentée ») est fondé pour la **collecte**. Le module fait mieux qu'un mini-ATS sur la dimension insertion de l'entretien. Les manques sont concentrés sur (a) la **transmission** vers le parcours, (b) la **conformité IAE** de l'entrée en parcours, (c) le **workflow interne** post-décision d'embauche.

### 2.2 Limites factuelles — ce qui se perd au moment de l'embauche

Cartographie de la déperdition, constat par constat (références vérifiées dans le code) :

**L1 — Les freins détectés en entretien ne pré-remplissent pas le diagnostic d'accueil.**
`recruitment_interviews.freins_emploi` (TEXT[], `init-db.js:3365`), `contraintes_horaires`, `difficultes_recherche` sont saisis en entretien puis **jamais relus** : `link-employee` crée un squelette `insertion_diagnostics` **vide** (`conversion.js:128-133` — seul `created_by` est renseigné), et aucun endpoint insertion ne joint `recruitment_interviews`. Le CIP ré-interroge le salarié de zéro au diagnostic M+1. Seul le champ court `candidates.interview_comment` (fiche, pas la trame) est passé à l'IA (`insertion-ai.js:108`).

**L2 — Référentiels de freins désalignés entre les trois étages.**
- Entretien d'embauche : `Transport, Santé, Logement, Administratif, Langue` + libre (`Candidates.jsx:1039`).
- Radar insertion : `mobilité, santé, finances, famille, linguistique, administratif, numérique` (`insertion/engine.js:230+`, `init-db.js:2844-2860`).
- CDC (§A, tableau d'export) : `linguistique, santé, logement, administratif, financier, judiciaire, mobilité`.
Conséquence piquante : **« Logement » n'est structuré aujourd'hui qu'à l'entretien d'embauche** — précisément là où il ne remonte pas — et n'a aucune case dans le radar. « Judiciaire » n'existe nulle part. La table de correspondance cible est un point de conception commun avec l'extension Insertion (cf. note C.9 du CDC).

**L3 — Le projet professionnel exprimé au recrutement est perdu.**
`idee_metier`, `idee_metier_detail`, `amelioration_souhaitee`, `attentes` (`init-db.js:3374-3389`) ne remontent nulle part, alors que la procédure d'accompagnement fait du projet professionnel la première bifurcation (« Le salarié a-t-il déjà un projet professionnel ? » — `Proce_dure_accompagnement_socioprofessionnel.pdf`, p. 1) et que le CDC exige « Projet de formation / Emploi visé » dans le tableau d'export des freins.

**L4 — Le prescripteur n'est pas capté à la source.**
La table `candidates` ne comporte **aucun champ prescripteur/orienteur** (`init-db.js:145-171`) ; `structure_accompagnement` (« Mission locale, France Travail, Travailleur social, Aucune », `Candidates.jsx:1053`) est un proxy non structuré et non relié au référentiel `prescripteur_orgas` pourtant existant (`routes/prescripteurs.js`, types PE/FT/ML/CD/CCAS/CAP_EMPLOI/AUTRE_ASSO/DIRECT). Le prescripteur est saisi **après coup** sur `employees` (`prescripteur_id`, `date_prescription` — `init-db.js:2710-2722`), donc ressaisi, tardivement, parfois jamais — alors que c'est une donnée connue **dès la candidature** (et obligatoire pour le reporting FSE+/ASP).

**L5 — Éligibilité IAE et PASS IAE totalement absents.**
Aucune occurrence de `pass_iae`, PMSMP ou éligibilité dans le code applicatif (grep sur `*.js/jsx` : seulement 2 faux positifs). Or c'est **la condition légale de l'embauche en ACI** : candidature orientée via la plateforme de l'inclusion (les emplois de l'inclusion), PASS IAE dont la **date de fin borne les 24 mois** du parcours. Le CDC demande explicitement « Fin PASS IAE » dans le tableau d'export. Rien non plus sur les critères de publics prioritaires (RSA, ASS, DETLD, QPV/ZRR, RQTH…) ni sur les PMSMP antérieures. Aujourd'hui, l'app ne peut pas prouver qu'une embauche était éligible, ni alerter sur un pass qui expire.

**L6 — La période d'essai et son entretien n'existent pas dans l'app.**
La procédure interne en fait une étape formelle avec formulaire (« Suivi des formulaires d'entretien de période d'essai », rôles CIP/Encadrant) conditionnant le **début de l'accompagnement**. Le livret d'accueil affiché par l'app mentionne « 1 mois de période d'essai » (`candidates/documents.js:50`). Côté code : aucun jalon, aucun formulaire, aucun statut. `insertion_milestones.milestone_type` n'admet que Diagnostic accueil / M+3 / M+6 / M+10 / Sortie (`init-db.js:2965`) et le parcours démarre au Diagnostic M+1 (`engine.js:1410`) **que la période d'essai soit validée ou non**. Corollaire : une rupture en période d'essai (fréquente en ACI) n'a aucun traitement propre — le parcours reste `en_parcours` jusqu'à intervention manuelle.

**L7 — Promesse d'embauche, documents administratifs et formation au poste non outillés.**
Le workflow interne (vérification budget par le Directeur → promesse d'embauche → rédaction des documents (contrat, adhésion mutuelle, charte d'insertion) par l'Assistante → formation au poste par l'Encadrant) n'a pas de support applicatif : `recruitment_documents` ne trace que la remise de 6 documents **informatifs** (`init-db.js:3429-3433`) ; le passage en « Recrutés » ne déclenche que l'auto-remise livret+charte (`individual.js:104-113`). Pas de checklist, pas de date de promesse, pas de responsable par étape.

**L8 — La frise du collaborateur ignore le recrutement.**
`buildTimeline` (`engine.js:1302-1350`) démarre à « Embauche » : l'entretien d'embauche, les mises en situation, le PCM n'y figurent pas, alors que le CDC définit le parcours comme commençant par « une embauche (test technique, test de personnalité, entretien d'embauche) » et exige une frise chronologique complète dans la fiche salarié.

**L9 — Un seul entretien conservé par candidat.**
L'upsert de la trame est un DELETE + INSERT (`conversion.js:205-253`) : un second entretien **écrase** le premier. Impossible de tracer un rappel de candidat, un entretien complémentaire, ou de typer l'entretien de période d'essai côté recrutement.

**L10 — Refus non qualifiés, pas de vivier.**
Le passage en « Refusés » n'a ni motif structuré ni notion de vivier/re-candidature (commentaire libre uniquement, `individual.js:98-101`). Impossible de distinguer « non éligible IAE » / « indisponible » / « absent à l'entretien » / « a retrouvé un emploi » — donnée pourtant utile au dialogue avec les prescripteurs. La purge 24 mois anonymise ensuite tout (`scheduler.js:606-647`) sans étape intermédiaire de consentement à être recontacté.

**L11 — Identité candidat minimale au point de fragiliser la jonction.**
`candidates` = prénom/nom/email/téléphone/genre uniquement (`init-db.js:145-171`) : ni date de naissance ni commune de résidence. Conséquences : appariement candidat↔collaborateur **au nom seul** (scoring `conversion.js:56-67`, risque homonymes), fallback par nom dans l'insertion (`insertion/routes.js:1035-1041`), impossibilité de vérifier un critère QPV ou de produire des statistiques d'âge par prescripteur.

**L12 — Intégrité de la continuité non protégée.**
`DELETE /api/candidates/:id` (`individual.js:298-307`) supprime la fiche sans vérifier qu'un collaborateur y est lié : `employees.candidate_id` passe à NULL (`ON DELETE SET NULL`, `init-db.js:294`) et **tout l'historique de recrutement d'un salarié en parcours disparaît** (cascade sur PCM, entretiens, mises en situation — `init-db.js:219,3351,3401`). Par ailleurs, la liaison reste 100 % manuelle : l'import paie Malibou ne suggère jamais de rapprochement avec un candidat « Recrutés » homonyme.

**L13 — Détails de trame non adaptés à Solidarité Textiles.**
Les options « Expérience dans l'activité » proposent `Bâtiment, Espaces verts, Nettoyage, Recyclerie` (`Candidates.jsx:1073`) — trame générique ACI, aucune option tri textile / collecte / vente en boutique. Même origine « structure sœur » que la trame diagnostic signalée par le CDC (note C.1).

**L14 — Convocation initiale non outillée.**
`appointment_date` / `appointment_location` / `sms_response` se remplissent à la main (`individual.js:41-48`) ; seul le **rappel** J-1 est automatisé (`scheduler.js:163-205`). Pas d'envoi de convocation ni de courrier de refus depuis l'app, alors que `message_templates` + Brevo existent.

### 2.3 Synthèse : la « frontière de l'embauche » aujourd'hui

| Donnée recueillie au recrutement | Traverse la frontière ? | Mécanisme |
|---|---|---|
| Profil PCM | **Oui** | jointure `pcm_reports → candidates → employees.candidate_id` |
| Permis B / CACES | **Oui** | recopie OR au lien (`conversion.js:114-123`) + backfill init-db |
| Commentaire d'entretien (champ court fiche) | Partiel | lu par l'IA uniquement (`insertion-ai.js:108`) |
| Résultat test pratique, CV texte | Partiel | lus par l'IA uniquement |
| **Freins évoqués en entretien** | **Non** | — |
| **Projet professionnel / attentes** | **Non** | — |
| **Structure d'accompagnement / prescripteur** | **Non** | ressaisie manuelle sur `employees` |
| **Éligibilité / PASS IAE / PMSMP** | **Non** (jamais saisis) | — |
| **Entretien de période d'essai** | **Non** (n'existe pas) | — |
| Mises en situation (8 critères × 3 postes) | **Non** | pourtant première évaluation de compétences exploitable par l'encadrant |
| Historique kanban / documents remis | **Non** | invisible côté fiche salarié |

---

## 3. Propositions d'évolution priorisées

Échelle d'effort : **S** ≤ 1 jour-dev · **M** = 2 à 5 jours · **L** > 5 jours ou multi-modules. La valeur est évaluée du point de vue de la **continuité du parcours** (demande client), puis de la conformité et du confort.

---

### PROP-01 — « Dossier de continuité » : pré-remplissage du diagnostic d'accueil et initialisation du parcours à la liaison

**Contenu** : au `POST /candidates/:id/link-employee`, enrichir le squelette `insertion_diagnostics` créé (`conversion.js:128-133`) avec les données du recrutement, **en provenance affichée et sans fausser l'évaluation CIP** :
- freins cochés en entretien → renseigner les champs `frein_*_detail` avec un préfixe normalisé (« Signalé à l'embauche : … ») **sans poser de score 1-5** (la règle « null = non évalué » de la v2.3.0 est préservée ; le radar reste vierge tant que le CIP n'a pas évalué) ;
- `idee_metier_detail` + `amelioration_souhaitee` + `attentes` → pré-remplissage de la rubrique projet professionnel / attentes du nouveau diagnostic ;
- `parcours_professionnel`, `duree_sans_emploi`, `situation_actuelle` → `parcours_anterieur` ;
- `contraintes_horaires_detail`, `travail_physique` → contraintes ;
- synthèse mises en situation (moyennes par poste testé) → observations d'entrée pour l'encadrant.
En complément, conformément au CDC (« l'initialisation des jalons se fait automatiquement au moment du passage de candidat à collaborateur ») : si le contrat est un CDDI, la liaison déclenche l'initialisation du parcours (statut + `generateMilestones`, déjà factorisé `insertion/routes.js:25-55`) au lieu d'attendre la première ouverture de la fiche (`routes.js:1101-1103`) ou l'import paie.
**Valeur : forte** — c'est le cœur de la promesse « recrutement intégré » ; le CIP arrive au diagnostic M+1 avec un dossier pré-instruit au lieu d'une page blanche ; l'IA de préparation d'entretien (`preparerEntretien`) devient réellement pertinente dès le premier jalon.
**Effort : M**. **Dépendances** : structure cible du nouveau diagnostic (extension Insertion en conception) — la table de correspondance (annexe A) doit être validée contre le référentiel de freins cible ; PROP-02 pour le volet prescripteur.
**Risque** : faible techniquement ; risque métier de « biais d'ancrage » du CIP → mitigé par le marquage explicite de la provenance (« déclaré au recrutement », non modifiable a posteriori) et l'absence de score pré-posé.

---

### PROP-02 — Volet « Éligibilité IAE » de la fiche candidat (prescription, PASS IAE, publics prioritaires)

**Contenu** : nouvelles colonnes structurées sur `candidates` + bloc UI dédié dans la fiche (onglet Fiche, visible dès « Reçus ») :
- `prescripteur_id` (FK vers `prescripteur_orgas` existant — réutilisation, pas de nouvelle table), `date_prescription`, canal de candidature (plateforme de l'inclusion / spontanée / prescripteur direct) ;
- `pass_iae_numero`, `pass_iae_debut`, `pass_iae_fin` ;
- critères d'éligibilité cochables (référentiel plateforme de l'inclusion : RSA, ASS, AAH, DETLD, QPV/ZRR, RQTH, jeune suivi ML, réfugié/BPI…) — stockage TEXT[] ;
- PMSMP antérieures (structure, période, métier — table légère `candidate_pmsmp` ou JSONB) ;
- date de naissance et commune de résidence (nécessaires au contrôle QPV, aux statistiques prescripteurs, et à un appariement candidat↔collaborateur fiabilisé — cf. L11).
**Recopie automatique au lien** (même pattern que permis/CACES, `conversion.js:114-123`) : `prescripteur_id`, `date_prescription` → `employees` ; fin de PASS IAE → nouvelle colonne `employees.pass_iae_fin` consommée par le tableau CIP (« Fin PASS IAE » exigée par le CDC) et par une **alerte** dans `dashboard/alertes` + cohorte (pass expirant avant la fin de contrat = renouvellement à anticiper).
**Valeur : forte** — conformité réglementaire de l'entrée en parcours (aujourd'hui non prouvable), donnée exigée par le CDC pour l'export, préparation directe du suivi mensuel ASP et des réponses aux contrôles DDETS/Convergence ; en outre le blocage « embauche sans prescription » devient détectable.
**Effort : M** (colonnes additives idempotentes, un bloc UI, une recopie, une alerte). **Dépendances** : aucune bloquante ; alimente PROP-01 et le tableau d'export de l'extension Insertion.
**Risque : faible** — additif. Point RGPD : les critères d'éligibilité sont des données sensibles par ricochet (minima sociaux, RQTH) → à intégrer au registre `rgpd_registre` et au périmètre `anonymizeCandidate` (`anonymization.js:88`), accès ADMIN/RH.

---

### PROP-03 — Entretien de période d'essai : le chaînon manquant entre recrutement et accompagnement

**Contenu** : matérialiser l'étape de la procédure interne :
- nouveau type de jalon « Entretien période d'essai » (extension du CHECK `insertion_milestones.milestone_type`, `init-db.js:2965`), échéance = fin de période d'essai (durée saisie au contrat, défaut 1 mois conformément au livret), positionné par `computeMilestoneSchedule` (`engine.js:1400-1420`) avant le Diagnostic accueil ;
- formulaire calqué sur la procédure : étude des compétences et capacités (réutiliser les 8 critères des mises en situation pour mesurer la progression depuis le test d'embauche), avis Encadrant + avis CIP, décision (validée / prolongée / rompue) ;
- issue « rompue » → clôture propre du parcours (statut, date de sortie, motif « rupture période d'essai ») au lieu du parcours fantôme actuel (cf. L6) ;
- issue « validée » → l'événement marque le « Début de l'accompagnement socio-professionnel » sur la frise, comme dans la procédure.
**Valeur : forte** — obligation de la procédure interne aujourd'hui sans aucun support ; fiabilise les statistiques de sorties (les ruptures précoces polluent actuellement le taux de sorties dynamiques) ; donne à l'encadrant technique une place formelle dans le parcours (demande récurrente des trames R'PUR, cf. CDC note C.4).
**Effort : M**. **Dépendances : fortes** avec l'extension Insertion (nouveau moteur de jalons, frise) — à concevoir ensemble, implémentable dans la même vague.
**Risque** : articulation à clarifier avec le Diagnostic accueil (les deux tombent vers M+1) — recommandation : période d'essai = décision **emploi** (encadrant + CIP), diagnostic = démarrage **accompagnement social** ; l'un ne remplace pas l'autre, l'ordre procédural (essai validé → diagnostic) est porté par les échéances.

---

### PROP-04 — Les événements de recrutement dans la frise du collaborateur

**Contenu** : enrichir `buildTimeline` (`engine.js:1302`) — ou son successeur dans l'extension Insertion — d'événements sourcés via `employees.candidate_id` : dépôt de candidature (`candidates.created_at`), entretien d'embauche (`recruitment_interviews.interview_date` + évaluation), mises en situation (`mise_en_situation.evaluation_date` + résultat par poste), test PCM (`pcm_sessions.completed_at` + base/phase), passage « Recrutés » (`candidate_history`), remises de documents. Chaque événement ouvre le détail existant (trame d'entretien en lecture, rapport PCM…).
**Valeur : forte** — exigence explicite du CDC (« une embauche… cette partie est plutôt bien documentée » doit se **voir** dans la fiche du collaborateur) ; zéro ressaisie : toutes les données existent déjà.
**Effort : S** (agrégation en lecture ; l'UI frise est portée par l'extension Insertion).
**Dépendances** : la frise elle-même (extension Insertion) ; PROP-10 (sans liaison fiable, frise vide). **Risque : faible** — attention au droit d'accès (l'entretien d'embauche contient des évaluations : restreindre le détail à ADMIN/RH/CIP, pas aux rôles étendus de la fiche salarié).

---

### PROP-05 — Checklist d'embauche : outiller le workflow Encadrant / Directeur / CIP / Assistante

**Contenu** : sur un candidat « Recrutés », panneau « Embauche en cours » sous forme de **checklist typée** (pattern `recruitment_documents` étendu : `UNIQUE(candidate_id, step)`, fait par qui, quand) reprenant la procédure : ① budget vérifié (Directeur) — en amont, au niveau du poste/plan de recrutement ; ② promesse d'embauche rédigée + date ; ③ documents administratifs (contrat CDDI, adhésion mutuelle, charte d'insertion — Assistante) ; ④ formation au poste réalisée (Encadrant, date) ; ⑤ liaison au collaborateur faite (auto-cochée). Badge d'avancement sur la carte kanban ; l'étape ④ alimente la frise (PROP-04).
**Valeur : moyenne-forte** — c'est la partie de la procédure la plus « administrative », son absence crée des trous réels (promesse non tracée = risque juridique ; mutuelle oubliée = contentieux) ; pour une équipe de 3-4 permanents, une checklist partagée suffit — **pas de moteur BPM**, l'ERP reste léger par design.
**Effort : M** (une table, un panneau, pas de moteur d'état).
**Dépendances** : aucune. **Risque** : sur-outillage si on va au-delà de la checklist (validations bloquantes, notifications par étape) — à proscrire en V1.

---

### PROP-06 — Entretiens multiples et typés (fin du DELETE + INSERT)

**Contenu** : lever la contrainte « un seul enregistrement » de `recruitment_interviews` (`conversion.js:205-253`) : ajouter `interview_type` (initial / complémentaire) et conserver N enregistrements ; l'UI liste les entretiens datés et ouvre le dernier par défaut. (L'entretien de période d'essai reste côté jalons — PROP-03 — car il est réalisé après embauche.)
**Valeur : moyenne** — historique fidèle (candidats revus à 6 mois d'intervalle, doubles entretiens encadrant/CIP), prérequis propre pour la frise.
**Effort : S/M**. **Dépendances** : PROP-04 (affichage). **Risque : faible** (compat front : le GET actuel renvoie déjà « le dernier »).

---

### PROP-07 — Motif de refus structuré + vivier de candidatures

**Contenu** : au passage « Refusés », motif obligatoire (enum : non éligible IAE / poste pourvu / indisponible / absent à l'entretien / a retrouvé un emploi / inadéquation poste / autre) + case « à garder en vivier » avec mention du consentement recueilli. Vue « Vivier » filtrée (candidats refusés-vivier + éligibilité encore valide), bouton « ré-ouvrir la candidature » (nouveau cycle kanban, historique conservé). La purge RGPD 24 mois (`scheduler.js:606`) reste inchangée et vide naturellement le vivier.
**Valeur : moyenne** — en ACI le vivier est réel (candidats non retenus faute de place, re-prescrits 3 mois plus tard) ; les motifs alimentent le dialogue prescripteurs et les stats de PROP-11.
**Effort : S**. **Risque : faible** ; RGPD propre (consentement tracé, purge existante).

---

### PROP-08 — Convocations et courriers depuis l'application

**Contenu** : bouton « Envoyer la convocation » sur la fiche (email/SMS via `message_templates` + Brevo, variables date/heure/lieu déjà normalisées par le rappel J-1, `scheduler.js:186-193`), trace dans `candidate_history` ; modèle de courrier de refus (généré à partir du motif PROP-07, fenêtre d'impression A4 comme les exports existants). Le rappel J-1 existant devient le second maillon d'une chaîne cohérente.
**Valeur : moyenne** — gain de temps Assistante/CIP, image professionnelle vis-à-vis des candidats (enjeu « qualité » Convergence : information des bénéficiaires), zéro nouvelle dépendance.
**Effort : S**. **Dépendances** : PROP-07 pour le courrier de refus. **Risque : faible**.

---

### PROP-09 — Référentiels adaptés à Solidarité Textiles + alignement de la liste des freins

**Contenu** : (a) options « Expérience dans l'activité » remplacées par les métiers ST : tri textile, collecte/manutention, vente/caisse en boutique, couture/retouche, logistique (`Candidates.jsx:1073`) ; (b) la liste des freins de l'entretien (`Candidates.jsx:1039`) est alignée sur le **référentiel de freins cible** défini par l'extension Insertion (a minima : ajouter Mobilité≠Transport ? non — renommer Transport→Mobilité, ajouter Financier, Judiciaire (formulation prudente), Numérique, Famille/garde d'enfants), pour que la correspondance PROP-01 soit 1:1 et sans perte ; (c) libellés « structure d'accompagnement » branchés sur `prescripteur_orgas` (cohérence avec PROP-02).
**Valeur : moyenne** (mais **conditionne la qualité de PROP-01**). **Effort : S**. **Dépendances : fortes** — le référentiel cible appartient à l'extension Insertion ; ne pas figer avant elle. **Risque** : le frein « judiciaire » en entretien d'embauche est délicat (discrimination perçue) → le poser en case « à explorer » CIP plutôt qu'en question frontale, comme le font les `questions_indirectes` du moteur (`engine.js:234-237`).

---

### PROP-10 — Garde-fous d'intégrité de la continuité

**Contenu** : (a) refuser (409) la suppression d'un candidat lié à un collaborateur (`individual.js:298-307`), proposer l'anonymisation RGPD à la place ; (b) à l'import paie Malibou, **suggestion automatique de liaison** : nouvel employé CDDI sans `candidate_id` + candidat « Recrutés » non lié à nom normalisé identique (+ date de naissance si PROP-02) → file de rapprochements « à valider » pour la RH (pas d'auto-lien silencieux, on garde la validation humaine du pattern actuel) ; (c) bannière sur la fiche candidat « Recrutés » non lié depuis > 15 jours.
**Valeur : moyenne-forte** — sans jonction fiable et systématique, PROP-01/03/04 ne bénéficient qu'aux dossiers bien tenus ; le garde-fou (a) évite une perte irréversible d'historique (cascade PCM/entretiens, cf. L12).
**Effort : S/M**. **Dépendances** : améliore PROP-01/04 ; s'appuie sur PROP-02 (date de naissance). **Risque : faible**.

---

### PROP-11 — Indicateurs de pilotage recrutement → parcours

**Contenu** : enrichir `/candidates/stats` et le plan de recrutement : délai moyen candidature→embauche, taux de conversion par étape et **par prescripteur** (avec PROP-02), motifs de refus (PROP-07), couverture des postes conventionnés (rapprocher `recruitment_plan` des ~42-46 postes / ~24,8-26 ETP de l'annexe financière — chiffres à confirmer avec la direction, CDC note C.7), ancienneté moyenne des candidatures en attente. Exposé dans la page Recrutement et repris par le tableau de bord Insertion (indicateurs conventionnels).
**Valeur : moyenne** — pilotage direction et dialogue de gestion DDETS (l'occupation des postes conventionnés est un indicateur suivi) ; faible pour le CIP au quotidien.
**Effort : M**. **Dépendances** : PROP-02/07 pour les axes d'analyse ; paramétrage conventionnel (extension Insertion, tableau de bord). **Risque : faible**.

---

### PROP-12 — (Vision) Intégration « les emplois de l'inclusion »

**Contenu** : à terme, importer les candidatures orientées via la plateforme de l'inclusion (API employeur ITOU) : création automatique de la fiche avec prescripteur, critères d'éligibilité et PASS IAE pré-remplis — supprimant la saisie de PROP-02 pour le flux principal. À instruire seulement quand PROP-02 aura stabilisé le modèle de données local (même logique prudente que « Connexion Refashion API » du CLAUDE.md §10).
**Valeur : forte à terme, nulle à court terme**. **Effort : L** (API externe, authentification, rapprochements). **Risque** : dépendance à un service tiers et à son rythme d'évolution ; à traiter comme un connecteur optionnel.

---

## 4. Points de vigilance transverses (RGPD & habilitations)

1. **Nouvelle finalité de traitement** : le pré-remplissage du diagnostic depuis l'entretien d'embauche (PROP-01) et la collecte d'éligibilité (PROP-02) étendent la finalité « recrutement » vers « accompagnement socio-professionnel » — mettre à jour `rgpd_registre` et l'information candidat (la charte d'insertion remise peut porter la mention).
2. **Minimisation maintenue** : ne collecter au stade candidat que ce qui sert la décision et la continuité (pas de NIR — doctrine actée CDC note C.8 ; pas de détail santé au-delà du déclaratif de frein).
3. **Anonymisation à étendre** : chaque nouveau champ (PASS IAE, critères, PMSMP, naissance, commune) doit entrer dans `anonymizeCandidate` (`services/anonymization.js:88-113`) et, pour les embauchés, dans `anonymizeEmployee`.
4. **Provenance et non-répudiation** : les données « déclarées au recrutement » affichées dans le parcours doivent être marquées comme telles (lecture seule côté insertion), pour ne pas se substituer à l'évaluation contradictoire du CIP — c'est aussi une exigence qualité vis-à-vis de l'audit Convergence/DDETS.
5. **Habilitations** : la trame d'entretien et l'éligibilité restent ADMIN/RH (+ lecture MANAGER là où elle existe déjà) ; dans la frise du collaborateur, le détail recrutement ne doit pas s'ouvrir aux rôles étendus (AUTORITE, QHSE…).

---

## 5. Feuille de route recommandée

### Étape 1 — « La continuité » (à synchroniser avec la vague de conception de l'extension Insertion)
> PROP-02 (éligibilité IAE) → PROP-01 (dossier de continuité) → PROP-03 (période d'essai) → PROP-04 (frise) → PROP-10 (garde-fous) + volet freins de PROP-09.

C'est le paquet qui tient la promesse du CDC. Il doit être **conçu avec** l'extension Insertion (référentiel de freins cible, structure du nouveau diagnostic, moteur de jalons, frise) puis peut être implémenté dans la même vague. Effort cumulé estimé : ~2 semaines-dev. Résultat mesurable : au diagnostic M+1, le CIP dispose du PCM, des freins pressentis, du projet exprimé, du prescripteur et de la fin de PASS IAE **sans aucune ressaisie**.

### Étape 2 — « La procédure interne »
> PROP-05 (checklist d'embauche) → PROP-06 (entretiens multiples) → PROP-07 (refus + vivier) → PROP-08 (convocations/courriers).

Outille les rôles Encadrant/Directeur/CIP/Assistante sur la phase embauche et professionnalise la relation candidat. Indépendante de l'étape 1, peut être décalée ou parallélisée. Effort cumulé : ~1 semaine-dev.

### Étape 3 — « Le pilotage et l'ouverture »
> PROP-11 (indicateurs recrutement→parcours) → reste de PROP-09 (référentiels métier) → étude PROP-12 (plateforme de l'inclusion).

À caler après consolidation des données des étapes 1-2 (les indicateurs n'ont de sens que si prescripteur/motifs/pass sont saisis depuis quelques mois).

---

## Annexe A — Table de correspondance proposée (entretien d'embauche → diagnostic d'accueil)

> À valider contre le référentiel de freins **cible** de l'extension Insertion (dépendance PROP-01/PROP-09). Principe : jamais de score pré-posé, uniquement des mentions « Signalé à l'embauche » en champ détail.

| Champ `recruitment_interviews` | Cible diagnostic | Mode |
|---|---|---|
| `freins_emploi` ∋ « Transport » | `frein_mobilite_detail` | mention pressentie |
| `freins_emploi` ∋ « Santé » | `frein_sante_detail` | mention pressentie |
| `freins_emploi` ∋ « Langue » | `frein_linguistique_detail` | mention pressentie |
| `freins_emploi` ∋ « Administratif » | `frein_administratif_detail` | mention pressentie |
| `freins_emploi` ∋ « Logement » | frein Logement **si ajouté au référentiel cible**, sinon `autres_contraintes` | mention pressentie |
| `freins_emploi_autre` | `autres_contraintes` | texte |
| `contraintes_horaires(_detail)` | `contraintes_familiales` / rubrique contraintes | texte |
| `duree_sans_emploi`, `situation_actuelle`, `parcours_professionnel`, `experiences_marquantes` | `parcours_anterieur` | concaténation datée |
| `idee_metier(_detail)`, `amelioration_souhaitee` | rubrique VIII Projet professionnel (nouvelle trame) | texte |
| `attentes(+autre)`, `motivation_integration`, `motivation_reprise` | rubrique IX Attentes / réalisation de soi (nouvelle trame) | texte |
| `structure_accompagnement` | pré-sélection `prescripteur_id` (PROP-02) si non renseigné | suggestion |
| `comportement_equipe`, `reaction_consigne`, `travail_physique` | observations d'entrée (encadrant) | texte |
| Moyennes `mise_en_situation` par poste | observations compétences d'entrée | synthèse chiffrée |
| `evaluation_globale`, `commentaire_evaluateur` | note d'embauche (frise, PROP-04) | lecture seule |

## Annexe B — Données candidat proposées à la recopie vers `employees` au moment du lien

| Donnée | Existant | Proposé |
|---|---|---|
| `has_permis_b`, `has_caces` | ✔ recopiés (`conversion.js:114-123`) | inchangé |
| `prescripteur_id`, `date_prescription` | ✘ | PROP-02 (même pattern OR/COALESCE, jamais d'écrasement d'une saisie RH) |
| `pass_iae_fin` | ✘ | PROP-02 + alerte fin de pass |
| Critères d'éligibilité, PMSMP | ✘ | restent au niveau candidat, exposés en lecture via `candidate_id` (pas de duplication) |
| Squelette `insertion_diagnostics` | ✔ vide | PROP-01 : pré-rempli avec provenance |
| Jalons du parcours | ✘ (auto-init différée) | PROP-01 : initialisés au lien si CDDI |
