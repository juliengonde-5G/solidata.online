# ADR 0003 — Coexistence avec le module « Pointage » existant et avec les heures RH

**Statut :** Accepté — Août 2026
**Contexte :** le dépôt contient déjà un module « Pointage / Badgeage » (module 25) :
`backend/src/routes/pointage.js`, tables `pointage_terminals` / `badges` / `pointage_events`,
page `frontend/src/pages/Pointage.jsx`. Il stocke le `badge_uid` **en clair**, authentifie les
bornes par clé API en clair comparée en SQL, n'a ni chaîne d'intégrité, ni corrections
additives, ni feuilles de temps, ni exports paie/IAE — il est incompatible avec les exigences
de la note technique (§4.1) et de la note juridique (§4).

## Décision

1. **Le module « Temps & Présence » (badgeuse) est un module NEUF et distinct**, préfixe
   `badgeuse_` pour toutes ses tables, routes `/api/badgeuse/*` — le module 25 existant n'est
   **pas modifié** (principe CLAUDE.md n°1 : pas de régression). Aucune table existante n'est
   altérée ni supprimée.
2. **Le module 25 est déclaré legacy** dans la documentation : il reste fonctionnel pour ses
   usages actuels, mais tout nouveau déploiement physique (poste Raspberry du Houlme) se fait
   sur le module badgeuse. Sa dépose éventuelle est un chantier ultérieur, arbitré par la
   Direction après le pilote (comme `ai-agent/` en son temps, arbitrage A3 de l'audit).
3. **Le module badgeuse n'écrit PAS dans `work_hours`** (contrairement au module 25 qui y fait
   un upsert automatique) ni dans `employee_week_hours` (réservée à l'import paie Malibou —
   « répartir des heures hebdo sur des jours inventerait de la donnée »). Motifs :
   - éviter tout double comptage avec le module 25 et l'import paie pendant la coexistence ;
   - la spec V1 exclut l'interfaçage paie direct : **l'export fichier est le seul livrable
     paie** (SPEC §1, périmètre exclu) ;
   - les KPI RH existants (formation, absentéisme) reposent sur la sémantique actuelle de
     `work_hours` : y injecter des heures badgées changerait silencieusement des indicateurs.
   Les données badgeuse vivent dans `badgeuse_pointages` / `badgeuse_feuilles_temps`, et en
   sortent par les exports paie (BO-06) et IAE (BO-07).
4. La table `badges` existante (module 25) et la table `badgeuse_badges` sont étanches :
   la nouvelle stocke exclusivement `uid_hmac` (jamais d'UID en clair), l'ancienne n'est pas
   touchée.

## Conséquences

- Pendant le pilote, les deux modules peuvent coexister sans interférence de données.
- La page legacy `/pointage` reste au menu (inchangée) ; la nouvelle section « Temps &
  Présence » a sa propre entrée et sa propre clé d'habilitation (`badgeuse`).
- Un chantier de décommissionnement du module 25 (migration de l'historique
  `pointage_events` → import `badgeuse_pointages` `source='import'`) est documenté comme
  piste, non réalisé en V1.
