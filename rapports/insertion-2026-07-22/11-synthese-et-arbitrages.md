# Synthèse de mission & arbitrages — Extension Insertion + Label RSEi

- **Date** : 23 juillet 2026 — rédigé par l'orchestrateur
- **Objet** : consolider les 10 livrables de la mission d'étude, acter les révisions issues des deux revues (06 UX/CIP, 07 auditeur), et soumettre à la direction les décisions restantes **avant tout développement** (aucune PR ne sera ouverte sans validation).

---

## 1. Livrables produits (tous sur la branche `claude/insertion-module-entretiens-ehli4m`)

| # | Livrable | Contenu |
|---|----------|---------|
| 00 | Cahier des charges | Demande verbatim + manifeste des 20 documents + notes de lecture |
| 01 | Cadrage conformité | 48 exigences EXG sourcées, RGPD art. 9/10, lecture prudente de l'annexe financière |
| 02 | Étude recrutement | 12 propositions PROP (Pass IAE, continuité candidat→collaborateur, période d'essai…) |
| 03 | État des lieux technique | Schéma/API/frontend complets + table des écarts (23 colonnes d'export mappées) |
| 04 | Plan d'action fonctionnel | 8 lots, 13 décisions de conception, phasage 3 PR |
| 05 | Plan de codage | Migrations, tables, endpoints, composants, RGPD, tests, séquencement |
| 06 | Revue UX + CIP | Favorable sous conditions — 19 REC-UX (2 bloquantes, 8 majeures) |
| 07 | Revue auditeur DDETS/Convergence | Conforme sous réserves — 6 RES majeures, liste de contrôle « jour J » |
| 08-09-10 | Documentation (drafts) | Guide CIP, note certificateurs, référentiel de performance de la pratique |
| rsei/01-02-03 | Volet RSEi | Étude de labellisation (27 critères), méthodologie du référent, plan d'action (21 actions, module Pilotage RSE) |

## 2. Révisions ACTÉES des plans 04/05 (réponses de l'orchestrateur aux revues)

Toutes les recommandations **bloquantes et majeures** des deux revues sont intégrées au périmètre. Détail :

| Origine | Révision intégrée | Où |
|---|---|---|
| REC-UX-01 (bloquant) | Le diagnostic d'accueil devient un **stepper rubrique par rubrique avec sauvegarde automatique**, statut « en cours », reprise en 2 séances | Lot 2 (`DiagnosticForm`) |
| REC-UX-06 (bloquant) | Le **formulaire de renouvellement ETI** (écran unique, gros contrôles, « Transmettre à la CIP ») est **avancé en PR 2** (au lieu de la phase 2) avec accès MANAGER restreint | Lot 4 |
| REC-UX-02 | Séparation **Enregistrer (brouillon) / Clôturer (contrôles)** + check-list de clôture visible ; sections dans l'ordre de la trame papier | Lot 1 (`POST /close`) |
| REC-UX-03 | Évaluation du bilan précédent **en 1 geste par élément** (Fait / En partie / Non fait), respect d'échéance **calculé** | Lot 1 (`previous_review`) |
| REC-UX-04 | Bouton « **+ Action** » global sur toutes les vues, 2 champs obligatoires, **geste ≤ 30 s chronométré en recette** | Lot 3 |
| REC-UX-05 | Frise en **couloirs** (Contrats / Entretiens / Objectifs / PMSMP) + filtres ; la liste chronologique verticale reste la vue de référence | Lot 5 |
| REC-UX-07 | Bloc « **Aujourd'hui / Cette semaine** » en tête de l'espace CIP ; préparation IA J-7 **activée par défaut** + synthèse factuelle sans IA | Lots 6-7 |
| REC-UX-08 | **Anti-inondation d'alertes** : regroupement par salarié, 3 niveaux (rouge = réglementaire), acquittement/report | Lot 6 |
| REC-UX-09 | Deux gabarits PDF : « **exemplaire salarié** » (FALC, sans champs internes/sensibles) et « exemplaire dossier » | Lots 1-4 (PDF) |
| REC-UX-14 | Export 23 colonnes : **indicateur de complétude** avant génération + filtres (année, présents/sortis, CIP) | Lot 6 |
| RES-01 (majeure) | **AIPD** (analyse d'impact RGPD) engagée **avant codage** (traitement liste CNIL : accompagnement social + art. 9/10 + IA), validée par le DPO avant production — trame à préparer avec la direction | Prérequis PR 1 |
| RES-02 (majeure) | **Intégrité probante** : verrouillage de l'entretien à la clôture, table d'historique des modifications (pattern `refashion_dpav_history`), réouverture tracée avec caducité des validations | Lot 1 (schéma + `POST /close`) |
| RES-03 (majeure) | **Preuve de co-construction** : remise du PDF au salarié **tracée** (date + mode, pattern `recruitment_documents`), possibilité de **rattacher l'exemplaire signé scanné**, signature « en présence » horodatée — EXG-29 rattachée aux lots 1 et 4 | Lots 1/4 |
| RES-04 (majeure) | **Durée des actions** d'accompagnement (art. 5 « nature, objet, durée ») : champ durée sur les actions + agrégats annuels | Lot 3 |
| RES-05 (majeure) | **Unicité scopée par parcours dès le Lot 1** : colonne `parcours_num` (défaut 1) sur diagnostics/entretiens/satisfaction ; une réembauche ouvre le parcours n° 2 sans écraser l'historique — la décision D2 (pas d'entité parcours) est **amendée** en ce sens | Lot 1 (schéma) |
| RES-06 (majeure) | Les arbitrages n° 1, 3, 7, 10 sont posés à la direction **avant la PR 1** (voir § 3) | § 3 |
| Réserves mineures 07 | Intégrées : assiette PMSMP 60 j glissants tous employeurs (champ « autres PMSMP connues »), motif de dérogation CDDI contrôlé aussi à l'import paie, dénominateur des taux de sorties documenté à l'écran (sorties constatées de l'année), tests d'habilitation **par endpoint** | Lots 4/6 + tests |

Les 9 recommandations mineures UX (vocabulaire, radar limité à 3 séries affichées, boutons plutôt que sliders pour les freins, états vides…) sont retenues comme règles de réalisation, arbitrables au fil de l'eau.

## 3. Décisions demandées à la direction (avant PR 1)

**Décisions structurantes (posées via le questionnaire de validation) :**
1. **Validation des plans 04/05 révisés** (avec les intégrations du § 2).
2. **Référentiel des freins** : radar 9 axes / export 7 freins CDC (recommandé) — ou strictement 7.
3. **Modalités de lancement du développement** (PR 1 : lots 1-3).
4. **Prochaine étape RSEi** : vérifier la **recevabilité ACI** auprès du labellisateur avant tout investissement (recommandé).

**Décisions secondaires — défauts recommandés appliqués sauf contre-ordre :**
| # | Question | Défaut appliqué si pas de contre-ordre |
|---|---|---|
| a | Objectifs conventionnels chiffrés (annexe : 82,60 = 54,30 + 17,40 + 10,90, base 46) | Saisis en settings **seulement après confirmation** sur le PDF original ; d'ici là « objectif non paramétré ». **Fournir si possible l'annexe 2 « Objectifs négociés »** (absente du corpus) |
| b | Cofinancement FSE+ ? | Supposé **non** tant que non confirmé ; si oui, le recueil participant doit entrer en PR 1 (non rattrapable à l'entrée) |
| c | « Convergence » = réseau Convergence France (PHC/CVG) ou autre ? | Persona générique retenu ; indicateurs spécifiques ajoutés si programme confirmé |
| d | Avantages ST dans le questionnaire (mutuelle d'entreprise, PEE ?) | Champs prévus, **libellés à confirmer** avant recette |
| e | ID France Travail stocké ? | **Oui** (utile aux démarches) ; ID CAF non ; NIR jamais |
| f | Frein judiciaire dans l'export nominatif | **Exclu par défaut**, variante « colonnes sensibles » ADMIN/RH journalisée |
| g | « NOM Prénom » : 1 ou 2 colonnes | **2 colonnes** (comme l'export existant) |
| h | Vue salarié « Mon parcours » | **Reportée** (phase 3) |
| i | Signature | **Validation par compte + PDF signé papier scanné** (pas de signature tactile en v1) |
| j | Diagnostic : délai cible | **30 jours** après l'embauche (aligné moteur M+1) |

## 4. Ordre de marche proposé après validation

1. **Préalables direction** (parallèles au début du dev) : AIPD avec le DPO ; confirmation annexe financière + annexe 2 ; liste des avantages ST ; recevabilité RSEi (courrier au labellisateur).
2. **PR 1** — lots 1-3 révisés (socle entretiens + verrouillage probant, diagnostic stepper, objectifs/actions/partenaires). Ouverture de la PR **après ta validation**, revue ensemble avant merge.
3. **PR 2** — lots 4-7 révisés (conformité IAE + formulaire ETI, frise/fiche unifiée, tableau de bord/exports, IA) + documentation finalisée (08/09/10 promus dans `docs/`).
4. **PR 3 (phase 2)** — lot 8 (espace ETI complet, portefeuille de compétences, période d'essai, checklist embauche) + premiers éléments RSEi logiciels si validés (RSEI-10 module Pilotage RSE).
5. CLAUDE.md et DOCUMENTATION_APPLICATIVE seront mis à jour dans chaque PR de code (pas dans la présente mission d'étude).

## 5. Validation reçue de la direction (23 juillet 2026)

Réponse de Julien Gondé : « OK » + trois décisions complémentaires. Conséquences actées :

| Décision | Conséquence |
|---|---|
| **Plans validés** (option recommandée) | Plans 04/05 **révisés** (§ 2) validés ; défauts secondaires du § 3 applicables sauf contre-ordre ; radar **9 axes / export 7 freins** ; développement **PR 1 lancé**, PR ouverte en fin de réalisation pour relecture commune avant merge |
| **« ACI compatible label RSEi »** | RSEI-00 (recevabilité) levé — la feuille de route rsei/03 s'applique ; référent + quick wins côté direction ; module Pilotage RSE maintenu en PR 3 |
| **« ST est bien certifié Convergence CVG »** | L'arbitrage c est tranché : indicateurs du programme CVG (Convergence France) à intégrer au tableau de bord (Lot 6) — **trame de reporting CVG à fournir par la direction** |
| **« Co-financement FSE+ en cours »** | EXG-12 devient **obligatoire dès la PR 1** (réserve RES-06 de l'auditeur : recueil participant à l'entrée non rattrapable) — voir addendum du plan 05 |

## 6. Points d'attention restants

- **Charge CIP** : la réussite dépend du respect strict des exigences de vitesse de saisie (REC-UX-04 chronométrée en recette, pré-remplissages systématiques).
- **Migration** : la levée des contraintes d'unicité et la reclassification des sorties sont les deux opérations les plus délicates — tests sur copie de base de production avant déploiement.
- **Annexe 2 « Objectifs négociés »** manquante au corpus : c'est elle qui fixe les cibles opposables — merci de la fournir si disponible.
- **RSEi** : aucun développement logiciel RSEi n'est engagé tant que la recevabilité ACI n'est pas confirmée (RSEI-00).
