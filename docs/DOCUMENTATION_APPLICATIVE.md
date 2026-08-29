# Documentation Applicative — SOLIDATA ERP v1.4.0

> **Version** : 1.4.0 | **Date** : 2026-04-16
> **Éditeur** : Solidarité Textile — Rouen, Normandie
> **URL** : https://solidata.online | **Mobile** : https://m.solidata.online

---

## 1. Présentation Générale

### 1.1 Qu'est-ce que SOLIDATA ?

SOLIDATA est un ERP (Enterprise Resource Planning) web conçu spécifiquement pour **Solidarité Textile**, structure d'insertion par l'activité économique (SIAE) spécialisée dans la collecte, le tri, le réemploi et le recyclage de textiles en Normandie.

L'application couvre l'ensemble de la chaîne de valeur :

```
Collecte → Tri → Production → Stock → Exutoires → Facturation
    ↕           ↕                           ↕
Recrutement   Insertion CDDI         Reporting / Subventions
```

### 1.2 Architecture Technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Frontend Web | React 18 + Vite + TailwindCSS | 18.3.x |
| Frontend Mobile | React PWA + Vite + html5-qrcode | 18.3.x |
| Backend API | Node.js + Express | 20.x LTS |
| Base de données | PostgreSQL + PostGIS | 15.x |
| Cache | Redis | 7.x |
| Reverse Proxy | Nginx + Let's Encrypt | 1.25.x |
| Conteneurisation | Docker Compose | 2.x |
| Cartographie | Leaflet.js | 1.9.x |
| Graphiques | Recharts | 2.x |
| Temps réel | Socket.IO | 4.x |
| SMS/Email | Brevo API | v3 |
| OCR | Tesseract.js | 5.x |
| PDF parsing | pdf-parse | 1.x |

### 1.3 Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                    Scaleway DEV1-S                       │
│              2 vCPU · 2 Go RAM · 20 Go SSD              │
│                                                         │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐ │
│  │  Nginx  │──▶│ Frontend │   │  Mobile  │   │Certbot│ │
│  │  :443   │   │  :3000   │   │  :3002   │   │ SSL   │ │
│  └────┬────┘   └──────────┘   └──────────┘   └──────┘ │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ Backend  │──▶│PostgreSQL│   │  Redis   │            │
│  │  :3001   │   │  :5432   │   │  :6379   │            │
│  └──────────┘   └──────────┘   └──────────┘            │
└─────────────────────────────────────────────────────────┘

Domaines :
  solidata.online      → Frontend web
  www.solidata.online   → Frontend web (redirect)
  m.solidata.online     → PWA mobile
  solidata.online/api   → Backend API
```

### 1.4 Sécurité

| Couche | Mesure |
|--------|--------|
| Transport | TLS 1.2/1.3, HSTS 2 ans, HTTP/2 |
| Authentification | JWT (8h) + Refresh Token (7j) |
| Mots de passe | bcrypt 10 rounds |
| Autorisation | RBAC 5 rôles (ADMIN, MANAGER, RH, COLLABORATEUR, AUTORITE) |
| API | Rate limiting (1000 req/15 min global, 30 req/15 min auth) |
| SQL | Requêtes paramétrées 100 % ($1, $2, $3) |
| Headers | Helmet (X-Frame-Options, X-Content-Type-Options, HSTS) |
| CORS | Whitelist domaines (solidata.online uniquement) |
| Firewall | UFW + Fail2ban |
| Chiffrement tokens | crypto.randomBytes(64) |

---

## 2. Modules Fonctionnels

### 2.1 Tableau de Bord (Dashboard)

**Route** : `/` | **Rôles** : Tous
**Fichier** : `frontend/src/pages/Dashboard.jsx`

Le dashboard centralise les indicateurs clés :
- Tonnage collecté (jour/semaine/mois)
- Nombre de tournées actives
- État des stocks par catégorie
- Alertes (stocks bas, retards livraisons, maintenances)
- Fil d'actualité interne (`/news`)

### 2.2 Recrutement

#### 2.2.1 Candidats (Kanban)
**Route** : `/candidates` | **Rôles** : ADMIN, RH, MANAGER
**Fichier** : `frontend/src/pages/Candidates.jsx` (67 Ko)
**API** : `backend/src/routes/candidates.js` (55 Ko)

**Fonctionnalités** :
- **Kanban Board** : 4 colonnes (Reçus → Entretien → Recrutés → Refusés) avec drag & drop
- **Upload CV** : PDF/DOC/DOCX, 10 Mo max, extraction texte automatique
- **Parsing compétences** : Détection automatique des compétences depuis le CV (skill_keywords)
- **Historique** : Traçabilité de chaque changement de statut avec date et utilisateur
- **Conversion employé** : Bouton "Créer un employé" disponible sur les candidats recrutés (statut hired)
- **Onglets conditionnels par statut** :
  - Reçu : Fiche, Historique
  - Entretien : + Entretien structuré, Mise en situation, PCM, Documents
  - Recruté : + Entretien structuré, Mise en situation, PCM, Documents
  - Refusé : Fiche, Historique uniquement
- **Recherche/filtre** : Par statut, compétences, date, poste

#### 2.2.2 Plan de Recrutement
**Route** : `/candidates` (onglet "Plan de recrutement")
**API** : `GET/POST /api/candidates/recruitment-plan`

**Fonctionnalités** :
- Tableau croisé Postes × Mois (6 mois glissants)
- Définition des besoins par poste et par mois
- Compteur automatique : recrutés vs objectif
- Taux de remplissage visuel

#### 2.2.3 Matrice PCM (Process Communication Model)
**Route** : `/pcm` | **Rôles** : ADMIN, RH
**Fichier** : `frontend/src/pages/PersonalityMatrix.jsx`
**Test** : `frontend/src/pages/PCMTest.jsx`
**API** : `backend/src/routes/pcm.js` (40 Ko)

> **Corrigé en 2.43.0** — un audit du module (`rapports/pcm-insertion-2026-08-29/01-audit-module-pcm.md`) a établi que la description ci-dessous était fausse sur presque tous les points chiffrés (nombre d'options, catégories, poids, endpoints inexistants). Les chiffres qui suivent sont mesurés sur le moteur réel (`backend/src/routes/pcm.js`).

**Fonctionnalités** :
- Test interactif de personnalité (**20 questions**, **6 options** chacune — une par type, choix unique), passation en mode **autonome** (lien candidat envoyé hors application, hors authentification) ou **accompagnée** par le praticien PCM
- **6 types** : Analyseur, Persévérant, Empathique, Imagineur, Énergiseur, Promoteur (nomenclature 2024 ; anciens noms conservés en repère — Travaillomane, Persévérant, Empathique, Rêveur, Rebelle, Promoteur)
- **Scoring pondéré sur 8 catégories** (et non 5), réparties en **deux jeux de questions disjoints** :
  - **Base** (fondation, stable) : perception (Q1-3), points forts (Q4), relation (Q5), communication (Q11-13) — **7 questions, 23 points maximum**
  - **Phase** (état motivationnel du moment) : motivation (Q6, Q9), stress (Q7-8, Q10), besoin (Q14-17), situation (Q18-20) — **13 questions, 34,5 points maximum**
- **Immeuble PCM** : visualisation en bâtiment (barres horizontales), Base toujours à l'étage 1 (fondation) — **il n'existe pas de représentation en radar**
- **Indicateur de cohérence des réponses** (2.43.0 — remplace l'ancien libellé « Alerte Risques Psychosociaux ») : signale que les réponses de la catégorie *stress* désignent fortement le type de Phase. C'est une **mesure de cohérence interne du questionnaire, pas un indicateur de santé ni de risque psychosocial** — une mise en garde l'accompagne systématiquement, à l'écran comme sur les deux exports PDF.
- **Encart de méthode obligatoire** (2.43.0), affiché avant la passation (écran candidat), sur la fiche profil et sur les deux PDF : rappelle que le questionnaire est un outil interne d'aide au dialogue inspiré du Process Communication Model, **non validé scientifiquement**, et qu'il ne doit **jamais fonder seul une décision de recrutement ou d'orientation**.
- **Guide Manager** : comportements recommandés (DO) et à éviter (DON'T), issus de la Base
- **Accessibilité FALC** : descriptions en Facile à Lire et à Comprendre pour chaque type
- **Export PDF A4** : deux exports depuis la fiche profil, tous deux enrichis de l'encart de méthode :
  - *Export résultats* : synthèse avec immeuble, base/phase, comportements, guide manager, niveaux de stress
  - *Fiche technique* : tableau des scores bruts + détail des 20 réponses groupées par catégorie
- **Chiffrement** : le rapport d'analyse est chiffré AES-256-GCM en base (`pcm_reports.encrypted_report`) ; les 20 réponses brutes (`pcm_answers`), elles, **ne sont volontairement pas chiffrées** — elles permettent de recalculer un rapport si la clé de chiffrement venait à changer.
- **Journalisation** (2.43.0) : la création d'une session, la soumission des réponses et **chaque consultation d'un rapport** sont désormais tracées (journal d'activité + `rgpd_audit_log`, action `PCM_RAPPORT_CONSULTATION`) — ce module était jusqu'ici le seul du domaine RH à ne rien journaliser. Une entrée dédiée du registre RGPD (« Recrutement — évaluation de personnalité (PCM) ») couvre ce traitement.
- **Double authentification obligatoire** (2.43.0) pour accéder à ce module — voir § « Double authentification (2FA/TOTP) ».

**Rôles** : ADMIN, RH et **PCM** (rôle dédié au praticien qui fait passer les tests, **sans accès au reste du dossier de recrutement** — la liste de candidats qui lui est ouverte ne renvoie ni CV, ni compte rendu d'entretien, ni coordonnées) créent des sessions et consultent les profils ; MANAGER a un accès en lecture au seul référentiel (questionnaire, types de personnalité) mais jamais aux profils individuels.

**API PCM** (`backend/src/routes/pcm.js`) :
| Méthode | Endpoint | Rôles | Description |
|---------|----------|-------|-------------|
| GET | `/api/pcm/questionnaire` | ADMIN, RH, MANAGER, PCM | Les 20 questions (options mélangées par question) |
| GET | `/api/pcm/types` | ADMIN, RH, MANAGER, PCM | Référentiel des 6 types |
| GET | `/api/pcm/types/:typeKey` | ADMIN, RH, MANAGER, PCM | Détail d'un type |
| POST | `/api/pcm/sessions` | ADMIN, RH, PCM | Créer une session de test pour un candidat |
| GET | `/api/pcm/candidats` | ADMIN, RH, PCM | Liste minimale des candidats (identité, poste visé, état du test) |
| GET | `/api/pcm/sessions/:token` | public (jeton de session) | Accès du candidat en mode autonome |
| POST | `/api/pcm/submit` | jeton de session, ou ADMIN/RH/MANAGER/PCM | Soumission des réponses (18 minimum sur 20) et calcul du profil |
| GET | `/api/pcm/profiles` | ADMIN, RH, PCM | Liste de tous les profils |
| GET | `/api/pcm/profiles/:candidateId` | ADMIN, RH, PCM | Profil déchiffré d'un candidat (consultation journalisée) |
| GET | `/api/pcm/profiles/:candidateId/answers` | ADMIN, RH, PCM | Réponses brutes enrichies |

Il n'existe **aucune route `POST /api/pcm/evaluate`** ni **`DELETE /api/pcm/:candidateId`** (contrairement à ce qu'indiquait cette page) — un profil PCM n'est supprimé qu'à l'anonymisation du candidat, ou du salarié auquel il est lié (purge intégrale des tables `pcm_*` correspondantes).

### 2.3 Gestion d'Équipe

#### 2.3.1 Collaborateurs
**Route** : `/employees` | **Rôles** : ADMIN, RH, MANAGER
**API** : `backend/src/routes/employees.js`

- Fiche collaborateur complète (photo, infos, contrat, compétences)
- Types de contrat : CDI, CDD, CDDI (insertion), Stage, Alternance
- Upload photo (5 Mo max)
- Historique des modifications

#### 2.3.2 Heures de Travail
**Route** : `/work-hours` | **Rôles** : ADMIN, RH
**API** : `backend/src/routes/work-hours.js`

- Saisie hebdomadaire par collaborateur
- Calcul automatique total et heures supplémentaires
- Export Excel

#### 2.3.3 Compétences
**Route** : `/skills` | **Rôles** : ADMIN, RH
**API** : `backend/src/routes/skills.js`

- Référentiel de compétences (tri, collecte, mécanique, bureautique, etc.)
- Affectation niveaux par collaborateur
- Matrice compétences × collaborateurs

#### 2.3.4 Parcours Insertion
**Routes** : `/insertion` (Espace CIP), `/insertion/actions`, `/insertion/audit` (Pilotage & indicateurs), `/insertion/renouvellement/:milestoneId` (écran encadrant), `/admin/insertion` (réglages, ADMIN) | **Rôles** : ADMIN, RH, MANAGER (masquage des données sensibles pour MANAGER)
**API** : `backend/src/routes/insertion/` (routes.js, engine.js, freins-registry.js, masking.js, pmsmp-rules.js) + `backend/src/routes/exports.js` (insertion-freins 23 col., insertion-synthese)

- **Entretiens historisés** (table unique `insertion_milestones` élargie) : 6 types techniques — diagnostic d'accueil, bilans intermédiaires illimités (« Bilan n° N », créables à toute date), renouvellement de contrat (lié au contrat, avis + durée), bilan de sortie (nomenclature à 4 catégories : emploi durable / emploi de transition / sortie positive / autre + check-list des documents remis), suivi post-sortie, **entretien de période d'essai** (lot 8). Numéro de parcours (`parcours_num`) pour les personnes revenues en parcours.
- **Enregistrer ≠ Clôturer** : le brouillon se sauvegarde librement (PUT partiel, autosave) ; la clôture (`POST /milestones/:id/close`) contrôle la trame (freins évalués ou non-évaluation assumée, évaluation du bilan précédent, prochain entretien planifié, catégorie + documents de sortie), verrouille l'entretien (état probant, `locked_at`) et l'historise (`insertion_milestones_history`) ; réouverture ADMIN/RH avec motif obligatoire (validations rendues caduques, trace conservée).
- **Diagnostic d'accueil refondu** : stepper 12 rubriques (parcours/famille, logement, droits, santé, budget, mobilité, linguistique CECRL, situation pro, projet pro, expression du salarié, FSE+ entrée, freins) avec sauvegarde automatique (brouillon repris en 2 séances), mode relecture avec le salarié, suggestions de niveau de frein calculées côté serveur depuis les réponses structurées (jamais imposées).
- **Co-construction au diagnostic** (lot 8, EXG-28/32) : rubriques supplémentaires du `DiagnosticForm` — **portefeuille de compétences** (centres d'intérêt, compétences par 6 domaines, savoir-faire/savoir-être ; `portefeuille_interets`/`portefeuille_competences` JSONB), **AFOM/SWOT** d'entrée + besoins exprimés + **COA** (choix d'orientation), **style d'apprentissage Kolb** (`style_apprentissage_reponses` 24 items → profil `adaptateur`/`divergeur`/`assimilateur`/`convergeur` calculé côté serveur, jamais partiel), CECRL déjà en place ; composants `PortefeuilleCompetences` et `StyleApprentissage` ; données **non sensibles** visibles de l'encadrant technique.
- **Grilles de compétences métier** (lot 8, EXG-26/27) : référentiel **administrable par filière** (`insertion_competence_referentiels` — tri/collecte/logistique/boutique/transverse, seed 34 items, `GET/POST/PUT/DELETE /competence-referentiels` ADMIN, éditable dans AdminInsertion) ; évaluations périodiques notées /10 par item ou **« N/E » exclu de la moyenne** (`insertion_competence_evaluations` + `insertion_competence_scores`, snapshot rubrique/item, statut brouillon/validé, **triple validation salarié/ETI/CIP** horodatée JSONB) via `GET/POST/PUT /competences[/:id]` (saisie ADMIN/RH/MANAGER, suppression ADMIN/RH) ; composant `CompetencesETI` (onglet « Compétences », gros boutons 0-10, moyenne live, historique + delta). **Accès non cloisonné par équipe** (données non sensibles) — documenté.
- **Entretien de période d'essai** (lot 8, EXG-30/PROP-03) : type `periode_essai` (6e type de `milestone_type`), `periode_essai_form` JSONB + `periode_essai_decision` (`confirme`/`rompu`/`a_revoir`), **auto-créé à la liaison candidat→collaborateur** (échéance = début de contrat + `insertion.periode_essai_jours`, défaut 30 ; idempotent, un par parcours ; création manuelle possible sans verrou d'unicité) ; `EntretienForm` dédié (décision + avis, hors freins/objectifs) ; décision « rompu » → parcours clos (statut `abandon` + date de sortie).
- **Check-list d'embauche** (lot 8, EXG-30/PROP-05, `insertion_checklist_embauche`) : une par salarié, 7 étapes JSONB (promesse, contrat, mutuelle, charte, livret, règlement, formation ; fait/date/responsable) via `GET/PUT /checklist-embauche/:employeeId` (upsert fusion, écriture ADMIN/RH) ; **pré-cochée depuis `recruitment_documents`** à la liaison ; composant `ChecklistEmbauche` (bloc « Accueil / intégration » de l'onglet Synthèse, barre de complétude).
- **Note de profil initial** (2.43.0, `insertion_notes_profil`) : analyse IA **systématique** du dossier de recrutement (CV, entretien structuré, mises en situation, profil PCM le cas échéant), générée automatiquement **à la liaison candidat→collaborateur** (setting `insertion.note_profil_auto`, activé par défaut ; régénérable à la demande) et remise à la CIP **en préambule du diagnostic d'accueil** — onglet Synthèse, entre la check-list d'embauche et le bandeau « Commencer le diagnostic » — ainsi qu'en lecture sur la fiche salarié. Le dossier est **pseudonymisé** avant l'appel au sous-traitant IA (textes libres nettoyés, date de naissance réduite à une tranche d'âge, aucun détail judiciaire transmis). **ADMIN/RH strictement** (jamais l'encadrement technique — la note croise le profil PCM). Contenu : synthèse, **expression de la personne** (verbatims en ses mots, affichés en tout premier après la synthèse — la seule section où elle est sujet et non objet d'analyse), freins pressentis avec leur **provenance** (CV / entretien / mise en situation / PCM) et un niveau **suggéré, jamais imposé** (rien n'est écrit automatiquement dans le diagnostic — le CIP confirme ou corrige), compétences observées, points de vigilance formulés comme des questions à poser, questions suggérées pour le premier entretien, et un bloc **« Repères de communication (PCM) »** placé en dernier, encadré, doublement chapeauté (« ce que ce bloc est / n'est pas ») et clos par un rappel que ce sont des hypothèses de travail que l'expérience peut contredire — jamais de vocabulaire clinique, jamais de pronostic. Les sources manquantes sont **nommées explicitement**, jamais comblées. Bouton « J'en ai pris connaissance — préparer le diagnostic » (idempotent, journalisé) et export PDF A4. La génération et **chaque lecture sont journalisées** dans `rgpd_audit_log` ; le contenu est **chiffré** en base et purgé intégralement à l'anonymisation. Filet de rattrapage : job planifié `genererNotesProfilManquantes` (salariés liés depuis moins de 30 jours sans note, 5 par passage).
- **9 freins périphériques** (registre unique `freins-registry.js`) : mobilité, santé (art. 9 — commentaires chiffrés AES-256), finances, famille, linguistique, administratif, numérique, **logement**, **judiciaire** (art. 10 — niveau + impact organisationnel factuel uniquement, chiffré, jamais visible d'un MANAGER, jamais suggéré automatiquement) — « non évalué » honnête (jamais compté à 1), radar 9 axes.
- **Objectifs individualisés** (`insertion_objectifs`) : objectifs + sous-objectifs (1 niveau), origine salarié/CIP, échéance + date butoir, 6 statuts.
- **Actions CIP** : rattachables à un entretien, un objectif et/ou un **partenaire** (référentiel `insertion_partenaires`, 16 seedés : CAF, France Travail, SPIP…), criticité, durée passée ; bouton « + Action » global (saisie ≤ 30 s, échéance par défaut paramétrée) ; tableau transversal `/insertion/actions` (filtres, retards, export).
- **Pass IAE** : n° + période sur la fiche salarié (recopiés depuis le recrutement à la liaison candidat→collaborateur), alertes à l'approche de l'échéance (seuil paramétrable + 2 mois), jobs scheduler dédiés ; **bilan de prolongation** en PDF (`GET /pass-iae/bilan/:employeeId`) assemblé depuis les bilans saisis, pour le prescripteur habilité.
- **Renouvellements de CDDI** : entretien à part entière lié au contrat ; l'encadrant technique renseigne son volet sur un **écran dédié** `RenouvellementETI` (accessible par lien direct copiable, « 1 écran = 1 salarié » : assiduité, motivation, autonomie, participation, motifs + avis favorable/réserves/défavorable + durée 2/4/6 mois), la CIP complète le sien, **triple validation** encadrant/CIP/directeur horodatée ; `GET /renouvellements` (fins de contrat < 6 semaines + état du formulaire), alerte cumul CDDI 22/24 mois + motif de dérogation exigé au-delà.
- **PMSMP** (`insertion_pmsmp`, `GET/POST/PUT/DELETE /pmsmp`) : immersions en entreprise avec objet légal (découvrir un métier / confirmer un projet / initier un recrutement), tuteur, bilan ; **bornes légales contrôlées** (`pmsmp-rules.js` : ≤ 31 j/convention, cumul ≤ 60 j sur 12 mois glissants **par organisme d'accueil**, ≤ 2 conventions/objets distincts — refus 409 documenté), case « saisie dans Immersion Facilitée » (art. 3.3).
- **Satisfaction de sortie** (`insertion_satisfaction_sortie`, `POST/GET /satisfaction/:employeeId`) : questionnaire interne (accueil, accompagnement, compétences, conditions de travail, bilan personnel, situation, satisfaction globale, suggestions), restitution **agrégée non nominative** (`GET /satisfaction-stats`).
- **Frise du parcours** (`FriseParcours`) : rendu horizontal en **couloirs superposés** (Contrats en bandeaux, Entretiens en points plein=réalisé/creux=planifié, Objectifs, PMSMP), couloirs masquables, regroupement des événements proches (pastille « ×N » dépliable), sur `GET /timeline/:employeeId` enrichi ; la liste chronologique reste la vue de référence.
- **Alertes de la fiche** (`GET /alertes/:employeeId`) : jalons en retard, entretien à planifier, Pass IAE, cumul CDDI ≥ 22/24 mois, diagnostic en retard, actions critiques — acquittement « Vu » **journalisé en base** (`insertion_alert_acks`, partagé entre CIP, 7 jours).
- **Tableau de bord CIP** : bloc « Aujourd'hui / Cette semaine » (heure de rendez-vous, badge « Préparation IA prête »), agenda 30 j, retards groupés par salarié, fins de contrat < 60 j, freins moyens, taux de sorties dynamiques vs objectif conventionné DREETS (settings) ; filtre « mes salariés » (CIP référent).
- **Pilotage & indicateurs** (`/insertion/audit`) : bloc **indicateurs conventionnels** en tête — 3 taux de sorties par catégorie comparés aux **cibles conventionnelles paramétrées** (`GET/PUT /cibles`, doctrine « objectif non paramétré » tant que non confirmées), **ETP réalisés « contrôle ERP »** (la saisie ASP fait foi), typologies publics non nominatives, délai moyen diagnostic ; puis réalisation des jalons par échéance, cartographie 9 freins, sorties par catégorie, plans d'action, satisfaction/post-sortie + rapport IA direction (verbatims anonymisés), export PDF A4.
- **Préparation IA d'entretien** : par entretien (`?milestoneId=`), note persistée et historisée (`ia_preparation`), pseudonymisation systématique avant appel Anthropic.
- **Exports** : Excel 5 feuilles / CSV par jeu (ADMIN/RH) ; **tableau des freins 23 colonnes** (`GET /exports/insertion-freins?format=xlsx|csv&sensibles=0|1`, valorisation « dernière évaluation » par LATERAL, frein judiciaire exclu par défaut, **chaque génération journalisée dans `rgpd_audit_log`**, complétude `/insertion-freins/completude`) ; **synthèse comité** agrégée non nominative (`/insertion-synthese`) ; export FSE+ trimestriel (bénéficiaires CDDI).
- **Réglages** (`/admin/insertion`, ADMIN) : référentiel partenaires, seuils d'alerte, option IA automatique J-7.
- **RGPD** : chiffrement AES-256 des textes santé/judiciaire, masquage par rôle, journalisation des exports nominatifs, anonymisation étendue aux tables du parcours (objectifs, PMSMP, satisfaction, **évaluations de compétences** — synthèses/observations effacées, notes conservées en agrégat, **check-list d'embauche** vidée, **verbatims de co-construction du diagnostic** — SWOT/besoins/COA/portefeuille effacés, style d'apprentissage catégoriel conservé, purge des snapshots `insertion_milestones_history`) — les données FSE+ (`fse_entree`/`fse_sortie`) sont conservées en piste d'audit ≥ 5 ans (exclues de l'anonymisation à 2 ans).
- **Réglages** (`GET /insertion/parametres`, préfixe `insertion.*` dans settings) : délai diagnostic (30 j), seuil Pass IAE (7 mois), échéance d'action par défaut (14 j), rythme des bilans (2 mois), IA automatique J-7 (off).

#### 2.3.5 Planning Hebdomadaire
**Route** : `/planning-hebdo` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/planning-hebdo.js`

- Affectation collaborateurs par jour/poste
- Détection de conflits horaires
- Vue calendrier hebdomadaire

### 2.4 Collecte

#### 2.4.1 Tournées
**Route** : `/tours` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tours.js`

- Planification de tournées (chauffeur + véhicule + liste CAVs)
- Suivi temps réel (statut : planifiée → en cours → terminée)
- Historique complet avec poids collecté

#### 2.4.2 Propositions IA
**Route** : `/collection-proposals` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/collection-proposals.js`

- Suggestions automatiques de tournées basées sur :
  - Taux de remplissage des CAVs
  - Historique de collecte
  - Proximité géographique (PostGIS)

#### 2.4.3 Carte CAV
**Route** : `/cav-map` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/cav.js`

- Carte Leaflet interactive avec tous les points de collecte
- Marqueurs colorés selon le taux de remplissage
- Clic sur marqueur = détails du CAV + historique

#### 2.4.4 Remplissage CAV
**Route** : `/fill-rate` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/cav.js` (intégré aux routes CAV)

- Tableau de bord taux de remplissage par CAV
- Historique graphique (Recharts)
- Alertes seuils (plein, quasi-plein)

#### 2.4.5 Suivi GPS
**Route** : `/live-vehicles` | **Rôles** : ADMIN, MANAGER
**API** : Socket.IO `/gps-update`

- Position en temps réel des véhicules en tournée
- Mise à jour toutes les 10 secondes via WebSocket
- Vitesse, direction, dernière position connue

### 2.5 Tri & Production

#### 2.5.1 Production
**Route** : `/production` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/production.js`

- Sessions de tri quotidiennes
- Saisie par catégorie textile et poids
- Bilan de production journalier/hebdo/mensuel
- Rendement par chaîne de tri

#### 2.5.2 Chaînes de Tri
**Route** : `/chaine-tri` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tri.js`

- Configuration des chaînes de tri
- Affectation collaborateurs par chaîne
- Suivi performance par chaîne

#### 2.5.3 Stocks
**Route** : `/stock` (matières premières), `/produits-finis` (produits finis)
**API** : `backend/src/routes/stock.js`, `backend/src/routes/produits-finis.js`

- Mouvements de stock (entrée/sortie) avec traçabilité
- Stock par catégorie et qualité
- Alertes stock bas
- Historique mouvements

#### 2.5.4 Expéditions
**Route** : `/expeditions` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/expeditions.js`

- Suivi des expéditions vers exutoires
- Traçabilité par lot

### 2.6 Exutoires (Logistique)

#### 2.6.1 Commandes
**Route** : `/exutoires-commandes` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/commandes-exutoires.js`

**Workflow complet** :
```
en_attente → confirmée → en_préparation → chargée → expédiée → pesée_reçue → facturée → clôturée
                                                                                    ↘ annulée
```

- Référence automatique CMD-YYYY-NNNN
- 7 types de produits textiles
- Tarification par tonne et par client
- Commandes récurrentes (unique, hebdomadaire, bi-mensuelle, mensuelle)
- Calcul CO₂ par type d'exutoire (ACV Refashion/ADEME)

#### 2.6.2 Préparation
**Route** : `/exutoires-preparation` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/preparations.js`

- Localisation : quai de chargement, garage remorque, cours
- Statut : planifiée → remorque livrée → en chargement → prête → expédiée
- Timeline : heure réception → début chargement → fin → départ
- Affectation d'équipe (collaborateurs)
- Pesée interne

#### 2.6.3 Gantt Chargement
**Route** : `/exutoires-gantt` | **Rôles** : ADMIN, MANAGER
**Fichier** : `frontend/src/pages/ExutoiresGantt.jsx`

- Planning visuel Gantt des chargements
- Vue hebdomadaire
- Détection de conflits quai

#### 2.6.4 Facturation Exutoires
**Route** : `/exutoires-facturation` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/factures-exutoires.js`

- Upload facture PDF
- Extraction OCR automatique (Tesseract.js)
- Rapprochement pesée interne / facture client
- Suivi état : reçue → validée → payée

#### 2.6.5 Calendrier Logistique
**Route** : `/exutoires-calendrier` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/calendrier-logistique.js` (15 Ko)

- Vue prévisionnelle des commandes/expéditions
- Alertes : surcharge, préparation manquante, stock insuffisant
- Planification capacitaire

#### 2.6.6 Clients Exutoires
**Route** : `/exutoires-clients` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/clients-exutoires.js`

- Fiche client (recycleur, négociant, industriel, autre)
- Historique commandes
- Contacts et adresses

#### 2.6.7 Grille Tarifaire
**Route** : `/exutoires-tarifs` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tarifs-exutoires.js`

- Prix par tonne, par produit, par client
- Historique des tarifs
- Application automatique sur commandes

### 2.7 Reporting

5 tableaux de bord analytiques (Recharts) :

| Dashboard | Route | Données |
|-----------|-------|---------|
| Collecte | `/reporting-collecte` | Tonnages, nb tournées, rendement/tournée |
| RH | `/reporting-rh` | Effectif, turnover, heures, % insertion |
| Production | `/reporting-production` | Rendement tri, catégories, productivité |
| Refashion | `/reporting-refashion` | Données réglementaires éco-organisme |
| Métropole Rouen | `/reporting-metropole` | Reporting collectivité territoire |

Tous les reportings supportent :
- Filtres par période (jour/semaine/mois/année)
- Export Excel (ExcelJS)
- Graphiques interactifs (barres, lignes, camemberts)

### 2.8 Boutiques (Performance Retail)

Module complet de pilotage de la performance des boutiques de seconde main textile. Architecture multi-boutiques dès le départ (St-Sever active, L'Hopital à venir). Nouveau rôle **RESP_BTQ** (Responsable Boutique).

#### 2.8.1 Hub Boutiques

| Élément | Détail |
|---------|--------|
| Route | `/hub-boutiques` |
| Rôles | ADMIN, MANAGER, RESP_BTQ |
| Contenu | 4 KPI cards (boutiques actives, CA mois, commandes en cours, tickets jour), 6 liens de navigation vers les sous-pages |

#### 2.8.2 Dashboard 3 niveaux

| Élément | Détail |
|---------|--------|
| Route | `/boutiques` |
| Rôles | ADMIN, MANAGER, RESP_BTQ |

3 onglets de pilotage :

- **Jour** : CA du jour + météo (icône + label + temp + précipitations), nombre de tickets, panier moyen, timeline horaire (barres CA par heure), répartition par rayon
- **Mois** : CA vs objectif (jauge %), barres quotidiennes avec ligne précipitations superposée (ComposedChart), camembert segments (ventes courantes / promotions / consommables), top 10 articles
- **Année** : Budget annuel vs réalisé, 12 barres mensuelles avec ligne de référence budget/mois, projection fin d'année par régression linéaire, tableau détaillé 12 mois avec % atteinte

#### 2.8.3 Ventes

| Élément | Détail |
|---------|--------|
| Route | `/boutiques/ventes` |
| Rôles | ADMIN, MANAGER, RESP_BTQ |
| Contenu | Table ventes filtrable (boutique, période), 4 KPI cards (CA TTC, tickets, articles, panier moyen), graphique CA quotidien, camembert rayons, tableau segments, top 15 articles |

#### 2.8.4 Import CSV (LogicS)

| Élément | Détail |
|---------|--------|
| Route | `/boutiques/import` |
| Rôles | ADMIN, MANAGER |
| Format CSV | Séparateur `;`, date `DD/MM/YYYY HH:MM:SS`, colonnes : DATE_VENTE, RAYON, ID_ARTICLE, ARTICLE, QUANTITE, TOTAL_HT, TOTAL_TTC, MONTANT_TVA |

Fonctionnement :
- **Import manuel** : upload par drag-and-drop ou sélection fichier (max 20 Mo)
- **Import automatique** : scheduler scanne le dossier partagé (variable `BOUTIQUE_CSV_BASE_PATH`), hash SHA-256 anti-doublon
- **Segmentation automatique** : FEMME/ENFANTS/LAYETTES/KINTSU → `ventes_courantes`, BRADERIE/OPERATION/PRIX RONDS → `promotions`, SAC KRAFT → `consommables`
- **Reconstruction tickets** : regroupement par minute (YYYY-MM-DD HH:MM) car le CSV LogicS ne contient pas d'identifiant ticket
- Historique des imports avec statut (en_cours / termine / erreur / doublon)

#### 2.8.5 Commandes Boutique

| Élément | Détail |
|---------|--------|
| Route | `/boutiques/commandes` |
| Rôles | ADMIN, MANAGER, RESP_BTQ |

**Kanban 3 colonnes** :
1. **Nouvelles** (brouillon + envoyée) — créées par RESP_BTQ
2. **En préparation** (ajustée + en préparation) — gérées par logistique
3. **Expédiées** (expédiée + annulée) — terminales

**State machine (5 statuts)** :
```
brouillon → envoyee → ajustee → en_preparation → expediee
    ↓         ↓         ↓           ↓
annulee   annulee   annulee     annulee
```

- Commande par catégorie textile (FEMME, ENFANTS, LAYETTES, KINTSU, ACCESSOIRES, CHAUSSURES, AUTRE) avec poids demandé en kg
- Référence auto : `BTQ-YYYY-####`
- RESP_BTQ : créer, envoyer, annuler
- ADMIN/MANAGER : ajuster poids, préparer, expédier
- À l'expédition : création automatique d'un mouvement de stock sortie (`stock_movements` type=sortie)
- Historique complet des transitions de statut avec horodatage et auteur

#### 2.8.6 Objectifs de Vente

| Élément | Détail |
|---------|--------|
| Route | `/boutiques/objectifs` |
| Rôles | ADMIN, MANAGER |
| Contenu | Grille 12 mois éditable (CA objectif TTC, nb tickets, panier moyen), comparaison en temps réel avec le réalisé, % atteinte coloré (vert ≥100%, ambre ≥80%, rouge <80%), graphique barres objectif vs réalisé |

#### 2.8.7 Planning Boutiques

| Élément | Détail |
|---------|--------|
| Route | `/boutiques/planning` |
| Rôles | ADMIN, MANAGER, RESP_BTQ |
| Contenu | Vue en lecture seule du planning hebdo filtré sur les postes boutique (filiere='btq', code commençant par `BTQ_`), navigation par semaine, grille postes × jours × périodes (Matin/Après-midi), lien vers Planning Hebdo pour modification |

#### 2.8.8 Météo & Corrélation

- Collecte automatique quotidienne via Open-Meteo API (gratuit, sans clé)
- Données : code WMO, label français, temp min/max, précipitations mm, vent max, heures d'ensoleillement
- Corrélation pluie/CA via endpoint `/api/boutique-meteo/correlation`
- Coordonnées par boutique (St-Sever : 49.4331°N, 1.0856°E)

### 2.9 Administration

#### 2.9.1 Utilisateurs, rôles & référentiels

| Module | Route | Description |
|--------|-------|-------------|
| Utilisateurs | `/users` | CRUD comptes, reset mot de passe, réinitialisation de la double authentification |
| Habilitations | `/admin/permissions` | Matrice d'accès par module et par rôle ; création de rôles personnalisés par duplication |
| Véhicules | `/vehicles` | Flotte, maintenance, disponibilité |
| Configuration | `/settings` | Paramètres système |
| Référentiels | `/referentiels` | Données de base (postes, catégories, etc.) |
| Moteur Prédictif | `/predictive` | Configuration IA collecte |
| RGPD | `/rgpd` | Registre, export, anonymisation, audit |
| Gestion CAV | `/cav-management` | Administration containers |
| Base de données | `/database` | Outils maintenance DB |

#### 2.9.2 Double authentification (2FA / TOTP)

**Depuis la version 2.43.0**, les comptes dont le rôle donne accès à des données personnelles sensibles doivent activer une **double authentification** (TOTP, RFC 6238 — même principe qu'une application comme Google Authenticator, Microsoft Authenticator ou FreeOTP).

- **Qui est concerné** : la liste des rôles soumis est paramétrable (clé `securite.mfa_roles` dans `settings`), avec pour **défaut** `ADMIN`, `RH`, `DPO` et `PCM` (les CIP sont des comptes RH). Un rôle personnalisé (créé par duplication dans `/admin/permissions`) est soumis si son **rôle de base** l'est — dupliquer « RH » ne permet donc pas d'y échapper. **MANAGER n'est pas soumis** (ses surfaces sensibles restent masquées côté serveur, sans double authentification). Les chauffeurs (identité = véhicule) et les tâches planifiées ne sont jamais concernés.
- **Enrôlement, bloquant** : à sa première connexion (après, le cas échéant, l'écran de changement de mot de passe obligatoire), un compte soumis voit un écran plein cadre en trois temps :
  1. explication et liste des applications compatibles, bouton **Commencer** ;
  2. QR code à scanner avec l'application (ou saisie manuelle de la clé secrète affichée), puis saisie du code à 6 chiffres qu'elle produit, bouton **Activer la double authentification** ;
  3. affichage — **une seule fois** — de **8 codes de secours** au format `XXXXX-XXXXX` (boutons Copier / Imprimer), avec la case **« J'ai conservé ces codes en lieu sûr »** à cocher pour continuer.
- **À chaque connexion suivante** : identifiant et mot de passe, puis un second écran demande le code à 6 chiffres de l'application (ou, à défaut, un code de secours à usage unique). 8 échecs de code en 15 minutes verrouillent temporairement le compte pour 15 minutes (comme pour le mot de passe).
- **Téléphone perdu, changé ou codes de secours épuisés** : la personne prévient un administrateur, qui réinitialise sa double authentification depuis la fiche `/users` (bouton **Réinitialiser la double authentification**) — l'enrôlement repart de zéro à la connexion suivante.
- Le secret de l'application est **chiffré** en base (AES-256-GCM) et les codes de secours ne sont jamais conservés en clair (seule leur empreinte l'est) — voir `DOCUMENTATION_TECHNIQUE.md` pour le détail du flux et le chiffrement.

---

### 2.10 Pilotage RSE

**Route** : `/rse` — section sidebar « Pilotage RSE » (rôles ADMIN, MANAGER, RH ; et le rôle personnalisé **REF_RSE**).

Ce module **outille la démarche de labellisation RSEi** de la structure (référentiel RSEi 2026, évaluation AFNOR Certification). Point important : **c'est l'association Solidarité Textiles qui est labellisée, jamais le logiciel** — le module est un **outil de preuve et de pilotage** de la maturité RSE, il ne délivre aucune certification. Il ne manipule que des **agrégats non nominatifs** : aucune donnée individuelle de parcours d'insertion n'y entre (confidentialité du chapitre 3 du référentiel).

**6 onglets** :

| Onglet | Fonction |
|--------|----------|
| **Tableau de bord** | Cartographie (heatmap) des **27 critères** du référentiel : niveau visé / niveau auto-évalué, preuves fraîches ou périmées, actions en retard, par critère. KPI globaux : couverture « niveau 2 démontrable », taux d'actions soldées à l'échéance, preuves périmées. Cliquer un critère ouvre sa cotation (niveaux, pilote, commentaire). |
| **Plan d'action** | Plan d'action RSE : titre, critère(s) servi(s), responsable, indicateur, échéance, moyens, statut (à faire / en cours / réalisé / abandonné), priorité. Filtres + export CSV. |
| **Registre de preuves** | Preuves horodatées avec **référence automatique `P-AAAA-NNN`** (séquentielle par année), rattachées à un ou plusieurs critères, avec source, lien interne vers un écran ERP (référencer plutôt que dupliquer) ou pièce jointe uploadée, et une **échéance de fraîcheur** (une preuve trop ancienne devient « périmée »). |
| **Évaluations** | Campagnes d'**auto-évaluation** et d'**audit interne**, cotées critère par critère (niveau constaté, constat, écart, action corrective liée). |
| **Parties prenantes** | Matrice d'impact des parties prenantes (influence / intérêt / attentes) + **journal des interactions** (dialogues, demandes, réclamations) avec la réponse apportée. |
| **Documents** | Génération de deux PDF A4 : le **bilan RSE annuel** (état du plan d'action, répartition des niveaux, preuves, dernière évaluation interne) et le **dossier de préparation AFNOR** (par critère : niveau, pilote, preuves rattachées, dernier constat). Rappel affiché : la communication externe sur le label n'est autorisée qu'à partir du niveau 2. |

**Doctrine « non coté »** : un critère non encore évalué reste à `NULL` (« non coté ») — le module **n'affiche jamais un « 0 » ni un niveau inventé**. Le tableau de bord distingue explicitement « critères cotés » de la couverture réelle, pour ne pas donner une fausse impression de maturité.

**Rôle REF_RSE** : le référent RSE dispose d'un rôle personnalisé créé par **duplication de MANAGER** (`/admin/permissions`), auquel on accorde le module `rse`. L'écriture du module est ouverte à ADMIN / RH / MANAGER pour que le référent tienne lui-même le plan et le registre ; la visibilité fine (le référent oui, les autres MANAGER non) se règle dans la matrice d'habilitations par module.

---

## 3. Application Mobile (PWA)

### 3.1 Vue d'ensemble

L'application mobile est une **Progressive Web App** accessible à https://m.solidata.online, conçue pour les chauffeurs-collecteurs en intervention terrain.

**Installation** : Ajouter à l'écran d'accueil depuis Chrome/Safari → l'app s'installe comme une app native.

### 3.2 Workflow de Collecte

```
Login → Sélection Véhicule/Tournée → Checklist Sécurité → Carte GPS
  → Pour chaque CAV :
      Scan QR (ou saisie manuelle) → Remplissage (0-100%) → [Incident éventuel]
  → Retour Centre → Pesée → Résumé Tournée (poids, distance, CO₂)
```

### 3.3 Écrans

| Écran | Fonction | Fichier |
|-------|----------|---------|
| Login | Authentification chauffeur | `mobile/src/pages/Login.jsx` |
| VehicleSelect | Choix véhicule + tournée du jour | `mobile/src/pages/VehicleSelect.jsx` |
| Checklist | 10 items sécurité pré-départ (papiers, gilet, pneus, etc.) | `mobile/src/pages/Checklist.jsx` |
| TourMap | Carte Leaflet + GPS temps réel + marqueurs CAV | `mobile/src/pages/TourMap.jsx` |
| QRScanner | Scan QR container (caméra arrière, 10 fps) | `mobile/src/pages/QRScanner.jsx` |
| QRUnavailable | Fallback : saisie code manuelle ou sélection dropdown | `mobile/src/pages/QRUnavailable.jsx` |
| FillLevel | Taux de remplissage (0-100 % avec emojis) + anomalies | `mobile/src/pages/FillLevel.jsx` |
| Incident | Documentation incident (5 types : panne, accident, container, environnement, autre) | `mobile/src/pages/Incident.jsx` |
| ReturnCentre | Confirmation retour + kilométrage | `mobile/src/pages/ReturnCentre.jsx` |
| WeighIn | Pesée : tare, brut, net (auto-calculé) | `mobile/src/pages/WeighIn.jsx` |
| TourSummary | Bilan : poids, distance, durée, CO₂ économisé | `mobile/src/pages/TourSummary.jsx` |

### 3.4 Fonctionnalités Techniques

- **GPS** : `navigator.geolocation.watchPosition()` avec envoi Socket.IO toutes les 10 s
- **QR Code** : html5-qrcode, caméra arrière, 250×250 px scan box
- **Offline** : localStorage pour session et données en cours de tournée
- **PWA** : Service worker auto-update, mode standalone, portrait lock
- **Touch** : Touch targets ≥ 48 px, feedback visuel au tap
- **Safe area** : Support des encoches iPhone X+ via CSS `env(safe-area-inset-*)`

---

## 4. API Reference

### 4.1 Authentification

Toutes les requêtes API nécessitent un header `Authorization: Bearer <JWT>`.

```
POST /api/auth/login         → { token, refreshToken, user }
POST /api/auth/refresh       → { token }
POST /api/auth/logout        → { message }
```

### 4.2 Endpoints Principaux

| Module | Méthode | Endpoint | Description |
|--------|---------|----------|-------------|
| Candidats | GET | `/api/candidates` | Liste paginée + filtres |
| | POST | `/api/candidates` | Créer candidat |
| | PUT | `/api/candidates/:id` | Modifier candidat |
| | DELETE | `/api/candidates/:id` | Supprimer candidat |
| | POST | `/api/candidates/cv/upload` | Upload CV (PDF/DOC) |
| | GET | `/api/candidates/cv/download/:id` | Télécharger CV |
| | GET | `/api/candidates/recruitment-plan` | Plan recrutement |
| PCM | POST | `/api/pcm/sessions` | Nouvelle session test *(corrigé 2.43.0 — voir § 2.2.3 pour le détail réel des routes)* |
| | POST | `/api/pcm/submit` | Soumettre les réponses et calculer le profil |
| | GET | `/api/pcm/profiles/:candidateId` | Profil déchiffré d'un candidat (consultation journalisée) |
| Double authentification | POST | `/api/auth/mfa/verify`, `/api/auth/mfa/setup`, `/api/auth/mfa/activate` | Défi de connexion, enrôlement — voir § 2.9.2 |
| | PUT | `/api/users/:id/reset-mfa` | Réinitialisation par un administrateur |
| Employés | GET/POST/PUT/DELETE | `/api/employees` | CRUD collaborateurs |
| Insertion | GET/POST/PUT | `/api/insertion` | Parcours CDDI |
| Note de profil CIP | GET/POST | `/api/insertion/notes-profil/:employeeId`, `/api/insertion/ia/note-profil/:employeeId`, `/api/insertion/notes-profil/:employeeId/communiquer` | Lecture, génération et prise de connaissance de la note de profil initial — voir § 2.3.4 |
| Tournées | GET/POST/PUT | `/api/tours` | Gestion tournées |
| CAV | GET/POST/PUT | `/api/cav` | Containers |
| Stock | GET/POST | `/api/stock` | Mouvements stock |
| Production | GET/POST | `/api/production` | Sessions tri |
| Clients | GET/POST/PUT | `/api/clients-exutoires` | Clients exutoires |
| Commandes | GET/POST/PUT | `/api/commandes-exutoires` | Commandes |
| Préparations | GET/POST/PUT | `/api/preparations` | Expéditions |
| Pesées | GET/POST | `/api/controles-pesee` | Contrôles pesée |
| Factures | GET/POST/PUT | `/api/factures-exutoires` | Facturation |
| Tarifs | GET/POST/PUT | `/api/tarifs-exutoires` | Grille tarifaire |
| Calendrier | GET | `/api/calendrier-logistique` | Prévisions logistique |
| Reporting | GET | `/api/reporting/:type` | Données analytiques |
| RGPD | GET/POST | `/api/rgpd/*` | Registre/export/anonymisation |
| Utilisateurs | GET/POST/PUT | `/api/users` | Gestion comptes |
| Véhicules | GET/POST/PUT | `/api/vehicles` | Flotte |
| Boutiques | GET/POST/PUT/DELETE | `/api/boutiques` | Référentiel boutiques, budget |
| Ventes Boutique | GET/POST | `/api/boutique-ventes` | Import CSV, analytics (daily/monthly/rayons/segments/articles/panier-moyen), tickets |
| Commandes Boutique | GET/POST/PATCH | `/api/boutique-commandes` | CRUD + transitions (envoyer/ajuster/preparer/expedier/annuler) |
| Objectifs Boutique | GET/POST | `/api/boutique-objectifs` | CRUD + bulk UPSERT + compare (objectif vs réalisé) |
| Météo Boutique | GET/POST | `/api/boutique-meteo` | Données météo, corrélation pluie/CA, collecte manuelle |

### 4.3 Codes de Réponse

| Code | Signification |
|------|-------------|
| 200 | Succès |
| 201 | Créé |
| 400 | Requête invalide (champ manquant, référence invalide) |
| 401 | Non authentifié (token absent/expiré) |
| 403 | Non autorisé (rôle insuffisant) |
| 404 | Ressource non trouvée |
| 409 | Conflit (doublon) |
| 413 | Fichier trop volumineux |
| 429 | Trop de requêtes (rate limit) |
| 500 | Erreur serveur interne |

### 4.4 Pagination

Tous les endpoints de liste supportent :
```
?page=1&limit=20&sort=created_at&order=desc
```

---

## 5. Base de Données

### 5.1 Tables Principales

| Table | Description | Relations |
|-------|-------------|-----------|
| `users` | Comptes utilisateurs (6 rôles) | → employees |
| `candidates` | Candidats recrutement + CV | → candidate_skills, candidate_history |
| `candidate_skills` | Compétences détectées/confirmées | → candidates, skill_keywords |
| `candidate_history` | Historique statuts | → candidates, users |
| `pcm_sessions` | Sessions test PCM | → candidates |
| `pcm_answers` | Réponses questionnaire | → pcm_sessions |
| `pcm_reports` | Rapports profil | → pcm_sessions |
| `employees` | Collaborateurs | → users, positions |
| `positions` | Postes de travail | → recruitment_plan |
| `recruitment_plan` | Plan mensuel recrutement | → positions |
| `recruitment_interviews` | Entretiens structurés | → candidates |
| `recruitment_practical_tests` | Mises en situation | → candidates |
| `recruitment_documents` | Documents onboarding | → candidates |
| `work_hours` | Heures travail | → employees |
| `skills` | Référentiel compétences | → employee_skills |
| `insertion_parcours` | Parcours insertion CDDI | → employees |
| `tours` | Tournées collecte | → vehicles, employees |
| `tour_stops` | Arrêts par tournée | → tours, cav |
| `cav` | Containers (points collecte) | PostGIS geom |
| `vehicles` | Flotte véhicules | → tours |
| `stock_movements` | Mouvements stock | — |
| `production_sessions` | Sessions tri | → employees |
| `clients_exutoires` | Clients exutoires | → commandes, tarifs |
| `commandes_exutoires` | Commandes | → clients, preparations |
| `preparations_expedition` | Préparation expéditions | → commandes |
| `preparation_collaborateurs` | Équipe préparation | → preparations, employees |
| `controles_pesee` | Contrôles pesée | → commandes |
| `factures_exutoires` | Factures | → commandes |
| `tarifs_exutoires` | Grille tarifaire | → clients |
| `rgpd_registre` | Registre traitements RGPD | — |
| `rgpd_consent` | Consentements | — |
| `rgpd_audit` | Journal audit | → users |
| `refresh_tokens` | Tokens de refresh | → users |
| `news` | Fil d'actualité | → users |
| `settings` | Configuration système | — |
| `notifications` | Notifications internes | → users |
| `boutiques` | Référentiel boutiques (nom, adresse, lat/lng, budget) | → teams, users |
| `boutique_import_batches` | Traçabilité imports CSV (hash SHA-256) | → boutiques |
| `boutique_ventes` | Lignes de vente importées (rayon, segment, article) | → boutiques, boutique_import_batches, boutique_tickets |
| `boutique_tickets` | Tickets reconstitués par minute_key | → boutiques |
| `boutique_commandes` | Commandes boutique (référence, statut, poids) | → boutiques, users |
| `boutique_commande_lignes` | Lignes commande par catégorie/poids | → boutique_commandes |
| `boutique_commande_historique` | Historique transitions statut | → boutique_commandes, users |
| `boutique_objectifs` | Objectifs mensuels (CA, tickets, panier moyen) | → boutiques |
| `boutique_meteo_quotidien` | Météo quotidienne (WMO, temp, précip, vent) | → boutiques |

### 5.2 Extensions PostgreSQL

- **PostGIS** : Requêtes géospatiales (proximité CAV, rayon de recherche)
- **pgcrypto** : Fonctions cryptographiques (si chiffrement au repos activé)

---

## 6. Déploiement

### 6.1 Prérequis Serveur

- Ubuntu 22.04 LTS ou Debian 12
- Docker Engine 24+ et Docker Compose v2
- 2 vCPU, 2 Go RAM minimum (4 Go recommandé)
- 20 Go SSD minimum
- Ports : 80/TCP, 443/TCP ouverts
- Domaine DNS configuré (solidata.online, m.solidata.online)

### 6.2 Premier Déploiement

```bash
# 1. Initialiser le serveur
bash deploy/scripts/init-server.sh

# 2. Configurer les variables d'environnement
cp .env.example .env
nano .env  # Définir DB_PASSWORD, JWT_SECRET, BREVO_API_KEY

# 3. Premier déploiement (HTTP → HTTPS)
bash deploy/scripts/deploy.sh first

# 4. Vérifier
bash deploy/scripts/health-check.sh
```

### 6.3 Mise à Jour

```bash
bash deploy/scripts/deploy.sh update
# Séquence : backup → git pull → rebuild → restart → health check
```

### 6.4 Sauvegarde / Restauration

```bash
# Backup manuel
bash deploy/scripts/backup.sh

# Restauration
bash deploy/scripts/restore.sh /backups/daily/solidata_20260315_020000.dump.gz
```

### 6.5 Tâches Planifiées (Cron)

| Horaire | Tâche |
|---------|-------|
| `0 2 * * *` | Backup quotidien base de données |
| `*/5 * * * *` | Health check (containers + endpoints + disque) |
| `0 3,15 * * *` | Renouvellement certificat SSL |
| `0 4 * * 0` | Nettoyage images Docker orphelines |
| `0 5 1 * *` | Purge logs applicatifs > 30 jours |

### 6.6 Monitoring

**health-check.sh** vérifie toutes les 5 minutes :
- Statut des 7 containers (db, backend, frontend, mobile, nginx, redis, certbot)
- Réponses HTTP (frontend 200, API 401, mobile 200)
- Espace disque (alerte 80 %, critique 90 %)
- Mémoire utilisée
- Auto-restart des containers tombés

---

## 7. RGPD & Conformité

### 7.1 Traitements de Données

L'application traite des données personnelles de :
- **Candidats** : nom, email, téléphone, CV, compétences, profil PCM
- **Salariés CDDI** : données d'insertion (parcours social, évaluations, objectifs)
- **Collaborateurs** : informations contractuelles, heures, compétences

### 7.2 Fonctionnalités RGPD Implémentées

| Article | Droit | Endpoint | Implémenté |
|---------|-------|----------|-----------|
| Art. 15 | Droit d'accès | `GET /api/rgpd/export/:type/:id` | Oui |
| Art. 17 | Droit à l'effacement | `POST /api/rgpd/anonymize/:type/:id` | Oui |
| Art. 30 | Registre des traitements | `GET/POST /api/rgpd/registre` | Oui |
| — | Consentement | `GET/POST /api/rgpd/consent` | Oui |
| — | Purge automatique | `POST /api/rgpd/purge-expired` | Oui (24 mois) |
| — | Journal d'audit | `GET /api/rgpd/audit` | Oui |

### 7.3 Anonymisation

Le processus d'anonymisation (Art. 17) :
1. Noms → "ANONYME" + "CANDIDAT-{id}" ou "EMPLOYE-{id}"
2. Email, téléphone → NULL
3. CV fichier supprimé, texte brut → NULL
4. Commentaires entretien → NULL
5. Compétences détectées → supprimées
6. Profils PCM → supprimés
7. Photo employé → supprimée
8. Compte utilisateur associé → désactivé

Toutes les opérations sont effectuées dans une **transaction ACID** avec rollback en cas d'erreur.

---

## 8. Variables d'Environnement

| Variable | Description | Défaut | Obligatoire |
|----------|-------------|--------|------------|
| `DB_HOST` | Hôte PostgreSQL | localhost | Oui |
| `DB_PORT` | Port PostgreSQL | 5432 | Non |
| `DB_NAME` | Nom base | solidata | Oui |
| `DB_USER` | Utilisateur DB | solidata_user | Oui |
| `DB_PASSWORD` | Mot de passe DB | — | **Oui (prod)** |
| `JWT_SECRET` | Secret JWT | — | **Oui (prod)** |
| `JWT_EXPIRES_IN` | Durée token | 8h | Non |
| `JWT_REFRESH_EXPIRES_IN` | Durée refresh | 7d | Non |
| `PORT` | Port backend | 3001 | Non |
| `NODE_ENV` | Environnement | development | Oui |
| `BREVO_API_KEY` | Clé API Brevo | — | Oui (SMS/email) |
| `REDIS_HOST` | Hôte Redis | localhost | Non |
| `REDIS_PORT` | Port Redis | 6379 | Non |
| `ROUEN_LAT` | Latitude centre | 49.4432 | Non |
| `ROUEN_LNG` | Longitude centre | 1.0999 | Non |

---

*Documentation applicative SOLIDATA ERP v1.2.0 — Solidarité Textile, Rouen — 19 mars 2026.*
