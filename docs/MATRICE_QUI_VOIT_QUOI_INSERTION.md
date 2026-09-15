# Matrice « qui voit quoi » — module Insertion

**Une page. Version 2.55.0 — 14 septembre 2026.**

> Ce que le tableau montre : ce qui apparaît **réellement à l'écran** de chaque profil. Une case
> **absente** (∅) ne veut pas dire « masquée » ou « grisée » : le serveur **retire la donnée avant de
> répondre**, elle n'existe nulle part dans ce que le navigateur reçoit. Une case **refusée** (—) veut
> dire que le rôle n'atteint même pas la route : le serveur répond 403 avant toute lecture en base. Ce
> tableau décrit le module **Insertion** uniquement ; les autres modules de l'ERP (finance, collecte,
> RGPD…) ont leurs propres règles, résumées dans `PRESENTATION_AUTORITE_INSERTION.md` § 3.

## Légende

| Symbole | Signification |
|---|---|
| ✓ | Accès complet au contenu réel |
| ✓ (soi) | Uniquement sa propre ligne (sa feuille, son dossier) |
| ✓ (co) | Voit et co-valide en présence de la personne, sans accès en ligne autonome |
| ∅ | **Absent** de la réponse du serveur — retiré avant l'envoi, pas simplement caché à l'écran |
| — | **Refusé** — la route renvoie 403 avant toute lecture |
| 📄 (remis) | Aucun accès en ligne : reçoit un exemplaire papier ou PDF **remis** par la CIP/RH |

## Le tableau

| Surface | ADMIN | RH (CIP) | MANAGER (encadrant technique) | COMMUNICATION | AUTORITE / auditeur externe | DPO | Encadrant par lien public (`/eti/…`) | Personne accompagnée |
|---|---|---|---|---|---|---|---|---|
| Onglet **Situation** (freins radar, PMSMP, satisfaction, frise, note de profil) | ✓ | ✓ | ✓ *(sans la note de profil — voir ligne dédiée)* | — | — | — | — | 📄 (remis, exemplaire salarié) |
| Onglet **Suivi** (entretiens & bilans, objectifs, actions, journal) | ✓ | ✓ | ✓ *(sans les notes de suivi — voir ligne dédiée)* | — | — | — | — | 📄 (remis, exemplaire salarié) |
| Onglet **Dossier administratif** (éligibilité, Pass IAE, orienteur/prescripteur) | ✓ | ✓ | ✓ *(nombre de critères et date de vérification seulement, jamais lesquels — sauf les 2 champs ci-dessous)* | — | — | — | — | 📄 (sur demande, droit d'accès) |
| **BRSA** (bénéficiaire du RSA) | ✓ | ✓ | ∅ | — | — | — | — | 📄 (droit d'accès) |
| **Catégorie France Travail** | ✓ | ✓ | ∅ | — | — | — | — | 📄 (droit d'accès) |
| **Référent unique** (type, nom, contact) | ✓ | ✓ | ✓ *(seul champ social visible de l'encadrant — il doit savoir à qui parler)* | — | — | — | — | ✓ (nommé sur « Mon parcours en une page ») |
| Onglet **Diagnostic** (socle + approfondissements, hors FSE+ pour MANAGER) | ✓ | ✓ | ✓ *(rubrique FSE+ retirée)* | — | — | — | — | 📄 (droit d'accès) |
| **Détail santé** (commentaire, causes du frein — art. 9) | ✓ (déchiffré) | ✓ (déchiffré) | ∅ | — | — | — | — | ✓ (ses propres données — droit d'accès, jamais sur les documents qui circulent) |
| **Détail judiciaire** (frein, causes — art. 10) | ✓ (déchiffré) | ✓ (déchiffré) | ∅ | — | — | — | — | ✓ (idem, ses propres données uniquement) |
| **Commentaire budget** | ✓ | ✓ | ∅ | — | — | — | — | 📄 (droit d'accès) |
| **Notes de suivi** (journal de la CIP entre deux entretiens) | ✓ (déchiffré) | ✓ (déchiffré) | ∅ *(section non affichée, pas seulement vidée)* | — | — | — | — | 📄 (droit d'accès, sur demande) |
| **Note de profil initial** (analyse IA à l'arrivée) | ✓ (déchiffré) | ✓ (déchiffré) | ∅ *(jamais l'encadrement technique — croise le profil PCM)* | — | — | — | — | ∅ *(document interne CIP, non remis)* |
| **Grilles de compétences métier** | ✓ | ✓ | ✓ *(saisit lui-même, non cloisonné par atelier — limite documentée)* | — | — | — | — | ✓ (co) *(co-validation salarié/encadrant/CIP en présence)* |
| Écran **« Mes échéances »** (obligations + organisation du suivi) | ✓ | ✓ | ✓ *(4 des 9 familles d'obligations — les familles sociales ne sont ni filtrées ni calculées pour lui)* | — | — | — | — | — |
| **Fiche pour le référent** (génération et contenu, 9 rubriques) | ✓ | ✓ | ∅ | — | — | — | — | 📄 (remis, exemplaire à la personne systématique) |
| **« Mon parcours en une page »** | ✓ (génère) | ✓ (génère) | ∅ | — | — | — | — | 📄 (remis, lui reste, ne circule pas) |
| **« Mon Récap »** | ✓ (génère) | ✓ (génère) | ∅ | — | — | — | — | 📄 (remis, celui qu'elle peut montrer à un tiers) |
| **Feuille de temps** (accompagnement) | ✓ (tous intervenants) | ✓ (tous intervenants) | ✓ (soi) *(la sienne uniquement s'il mène des entretiens/actions)* | — | — | — | — | ∅ *(jamais son nom — identifiant interne uniquement)* |
| Export **(a) FSE+ participants** (nominatif, CSV trimestriel) | ✓ | ✓ | — | — | — | — | — | — |
| Export **(b) Bilan d'exécution FSE+** (agrégé, signé direction) | ✓ | ✓ | — | — | — | — | — | — |
| Export **(c) Feuille de temps** (identifiant interne, jamais le nom) | ✓ | ✓ | ✓ (soi) | — | — | — | — | — |
| Export **(d) Tableau des freins enrichi** (nominatif, 23+ colonnes) | ✓ | ✓ | — | — | — | — | — | — |
| Export **(e) Synthèse de dialogue de gestion** (agrégée, seuil k ≥ 5) | ✓ | ✓ | ✓ *(lecture agrégée seule — aucune projection nominative n'existe dans ce document)* | — | — | — | — | — |
| Export **(f) Fiche d'alimentation du référent externe** | ✓ | ✓ | — | — | — | — | — | 📄 (remis, exemplaire systématique) |
| **Rappels de rendez-vous** (consentement et contenu du message) | ✓ | ✓ | — | — | — | — | — | ✓ (reçoit le SMS/e-mail, jamais le type d'entretien) |
| **Formulaire de renouvellement** (assiduité/motivation/autonomie/participation, avis, durée) | — *(voie normale : onglet Suivi)* | — *(idem)* | ✓ (soi, salarié dont il est référent) | — | — | — | ✓ *(les 9 champs listés au § 5.3, rien d'autre — pas même `employee_id`)* | — |

## Trois lignes qu'un contrôleur retient

1. **Le module Insertion tout entier est fermé à trois profils** — COMMUNICATION, AUTORITE, DPO — le
   serveur refuse (`403`) **avant toute lecture en base**. Ce n'est pas une case du tableau à cocher
   « non » : ces trois lignes sont vides parce que la route elle-même n'existe pas pour eux. L'AUTORITE
   et le DPO ont leurs propres accès **hors de ce module** (agrégats Métropole/Refashion pour l'un,
   registre RGPD et journal pour l'autre — voir `PRESENTATION_AUTORITE_INSERTION.md` § 3).
2. **L'encadrant technique (MANAGER) voit un dossier professionnel amputé de tout ce qui est social ou
   sensible** — santé, judiciaire, budget, BRSA, catégorie France Travail, notes de suivi, note de
   profil — **et cependant le nom de son référent unique**, parce qu'il doit savoir à qui parler pour
   alimenter la personne qu'il encadre. Ce n'est pas une incohérence : c'est la seule information
   sociale dont son rôle a l'usage.
3. **La personne accompagnée n'a pas de compte SOLIDATA.** Ce qu'elle reçoit, elle le reçoit sur
   papier ou en PDF, remis en main propre ou par un canal tracé — jamais par une connexion en ligne à
   son propre dossier. C'est le choix assumé de cette version (voir
   `PIECES_HORS_LOGICIEL_INSERTION.md` pour ce qui, autour de ce choix, reste à faire par la direction).

---

*Document établi le 14 septembre 2026, lot 8 de la PR D « Reporting autorité et présentation »
(`rapports/cip-refonte-2026-09-12/25-contrats-techniques-PR-D.md`). Chaque case a été vérifiée dans le
code — gardes `authorize()`, `router.use()` de tête de routeur, et fonctions de projection
(`backend/src/routes/insertion/masking.js`, `cadre.js`, `echeances-cip.js`) — au 14 septembre 2026 ;
une évolution ultérieure du code doit se relire contre ce tableau, pas l'inverse.*
