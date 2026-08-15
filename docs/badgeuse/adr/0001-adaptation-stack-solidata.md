# ADR 0001 — Adaptation du projet Badgeuse à la pile réelle de SOLIDATA

**Statut :** Accepté — Août 2026
**Décideur :** Agent 0 (chef d'orchestre), sur constat de la base de code
**Contexte :** `docs/badgeuse/SPEC_TECHNIQUE.md` §6 et `PROMPTS_MULTI_AGENTS.md` (agents A1/A2)

## Problème

Le dossier de prompts (05) prescrit pour le backend « FastAPI + SQLAlchemy 2.x + Alembic + pytest »
en le motivant par la « cohérence avec la pile SOLIDATA/Vintiz (FastAPI) ». Or la base de code
réelle de SOLIDATA (`solidata.online`) est :

- **Backend** : Node.js 20+ / Express 4.21, PostgreSQL 15 via `pg` (`pool.query` paramétré),
  pas d'ORM, pas d'Alembic — les tables sont créées de façon **idempotente** dans
  `backend/src/scripts/init-db.js` (convention CLAUDE.md §8.4) ;
- **Frontend** : React 18 / Vite / Tailwind, pages dans `frontend/src/pages/` ;
- **Tests** : Jest (`backend/tests/unit` + `backend/tests/contract`), pas pytest côté serveur.

Le CLAUDE.md du dépôt impose de suivre les patterns existants (« Cohérence — Suivre les patterns
existants ») et fait autorité sur toute note projet.

## Décision

1. **Le module serveur « Temps & Présence » est développé dans la pile réelle de SOLIDATA** :
   routeur Express `backend/src/routes/badgeuse.js` (+ moteur pur
   `backend/src/services/badgeuse-engine.js`), tables idempotentes dans `init-db.js`,
   tests Jest (unit + contract). La spécification OpenAPI d'A1 est remplacée par un
   **contrat d'API en Markdown** (`docs/badgeuse/CONTRAT_API_DEVICE.md`) qui joue le même rôle :
   permettre au développement embarqué et au développement serveur d'avancer en parallèle.
2. **Le poste embarqué reste Python 3.11** (spec §6) : c'est un logiciel autonome sur
   Raspberry Pi, sans lien avec la pile serveur. Il vit dans `badgeuse/` à la racine du dépôt
   (`badgeuse/agent`, `badgeuse/ui`, `badgeuse/deploy`), testé avec pytest.
3. **Les exigences fonctionnelles et de conformité (PST-xx, AFF-xx, BO-xx, note juridique)
   sont inchangées.** Seule la technologie d'implémentation serveur diffère de la lettre du
   dossier de prompts ; l'esprit (contrats d'abord, serveur fait foi, minimisation,
   inaltérabilité, idempotence) est conservé à l'identique.

## Alternatives écartées

- **Créer un service FastAPI séparé à côté de l'ERP** : ajoute un conteneur, une pile, une
  chaîne de déploiement et une surface d'authentification de plus pour un module qui doit
  précisément s'intégrer au back-office, aux rôles et au RGPD existants de SOLIDATA.
  Contraire au principe « pas de librairie/pile externe sauf nécessité » du CLAUDE.md.
- **Suivre littéralement le dossier de prompts** : produirait un module étranger au dépôt,
  non maintenable par les conventions en place.

## Conséquences

- Les migrations « Alembic » deviennent des blocs `CREATE TABLE IF NOT EXISTS` + migrations
  idempotentes dans `init-db.js` (avec vérification sur base neuve ET base ancienne).
- La couverture pytest exigée par A2 devient une couverture Jest équivalente : le moteur de
  règles est un module **pur, sans DB**, testé exhaustivement (pattern `effectifs-engine`).
- L'authentification device (`X-Device-Key`) suit le pattern des surfaces publiques déjà
  présentes (webhook SumUp, enquêtes publiques) : montage AVANT le middleware `authenticate`.
