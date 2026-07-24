# Réalisation — Module « Enquêtes » (RSEI-13)

- **Date** : 24 juillet 2026
- **Action** : RSEI-13 du plan `rapports/rsei-2026-07-22/03-plan-action-rsei.md` (§2.2)
- **Objet** : moteur générique de questionnaires **anonymes** — un seul outil d'écoute pour tous les besoins de la démarche RSEi. Sert les critères 2.5 (organisation/conditions de travail — QVCT tous salariés), 5.3 (satisfaction des parties prenantes), 3.2 (accueil/intégration — questionnaire M1), 4.4 (sensibilisation environnementale mesurée) ; réutilisable pour les enquêtes PP externes (RSEI-16).
- **Version** : 2.15.0 — 30e module de l'ERP.

## Périmètre livré

**Schéma (4 tables, `init-db.js` idempotent, prouvé sur PostgreSQL 16 réel)**
- `enquete_modeles` (6 catégories, `anonyme` défaut true).
- `enquete_questions` (6 types : échelle / choix unique / choix multiple / texte / oui-non / note 0-10, `options` JSONB).
- `enquete_campagnes` (`token` hex 32 UNIQUE pour le lien public, statut brouillon → ouverte → close, `modele_id` NO ACTION = une campagne archivée protège son modèle).
- `enquete_reponses` (**aucune FK vers users/employees — anonymat structurel** ; `jeton_unicite` + index UNIQUE partiel anti-doublon par campagne). Entrée au registre RGPD.

**Backend `/api/enquetes`** :
- **Surface publique** (montée AVANT `authenticate`, pattern webhook VAK) : `GET /public/:token` (404 si non ouverte), `POST /public/:token` (403 si close, 400 obligatoires manquants, 409 doublon) — **aucune donnée d'identité collectée**.
- **Admin** : CRUD `/modeles` (+ questions), `/campagnes` (POST génère le token, PUT transitions forward-only), `GET /campagnes/:id/resultats` avec **seuil d'anonymat n ≥ 5 strict** (sous 5 réponses : aucune distribution), export CSV agrégé.

**Frontend** : `Enquetes.jsx` (admin, 3 onglets) ; `EnqueteReponse.jsx` (`/enquete/:token`, **route publique hors ProtectedRoute**, axios sans Authorization, **kiosque FALC**) ; composants ModeleEditor / QuestionField / CampagnesList / ResultatsEnquete.

## Doctrines de conception

1. **Anonymat structurel** : les réponses n'ont aucune FK d'identité ; le seuil n≥5 s'applique à la restitution (jamais au stockage) ; les verbatims bruts ne sont exposés que si le modèle est anonyme ET n≥5.
2. **Seuil d'anonymat infranchissable des deux côtés** : le backend n'émet aucune donnée par question sous le seuil ; le front affiche « Résultats masqués — anonymat préservé » sans rien d'autre.
3. **Kiosque FALC** : la page de réponse est pensée pour un appareil partagé (gros contrôles, jeton d'unicité renouvelé à « Nouvelle réponse » pour ne pas verrouiller la tablette).

## Vérification

- **Jest 938/938** (68 suites, +30) ; **mobile 40/40** ; **build Vite OK**.
- Migration idempotente **prouvée sur PostgreSQL 16 réel** ; `enquete_reponses` sans colonne d'identité vérifié ; unicité du jeton par campagne ; route publique confirmée hors authentification.
- Contrats front↔back concordants ; aucun nom du corpus ; aucune nouvelle dépendance npm.

## Correctifs consolidés (revue Codex du module Pilotage RSE, PR#75)

Inclus dans le même lot : (1) preuve « fraîche » = récente ET non périmée ; (2) verrou d'écriture des items d'évaluation sur campagne clôturée (409) ; (3) KPI « actions soldées à l'échéance » sur une vraie `date_realisation` comparée à l'échéance ; (4) suppression de l'ancien fichier de preuve au remplacement.

## Reste du plan RSEi

Modules **Achats responsables** (RSEI-17), **générateurs avancés** (RSEI-18, rapport RSE annuel + dossier de candidature sur le module Pilotage RSE). Prérequis **direction** : recevabilité ACI (RSEI-00), nomination du référent, socles CSE/DUERP/formation, charte égalité.

## Déploiement

`bash deploy/scripts/deploy.sh update` — migration automatique et idempotente ; aucun paramétrage requis. Pour un cloisonnement fin, créer le module `enquetes` dans `/admin/permissions`.
