# ADR 0002 — Règles de gestion RH : paramètres en base, défauts = recommandations RH écrites

**Statut :** Accepté — Août 2026 — **soumis à arbitrage Direction avant le pilote**
**Contexte :** `SPEC_TECHNIQUE.md` §5.4, `NOTE_RH.md` §3, `PROMPTS_MULTI_AGENTS.md` (règle absolue :
« Tu ne devines JAMAIS une règle de gestion RH »)

## Problème

Le dossier de prompts exige de **bloquer** tout lot dont une règle de gestion RH (arrondis,
tolérances, pauses, seuils) n'est pas arbitrée par l'humain. Le développement est conduit en mode
autonome : l'arbitrage de la Direction (NOTE_RH §3, colonne « Décision » ☐) n'est pas encore signé.

## Décision

1. **Aucune règle de gestion n'est codée en dur.** Toutes les valeurs du §5.4 de la spec vivent
   dans la table `settings` (clés `badgeuse.*`) et sont éditables depuis le back-office
   (onglet Paramètres, ADMIN/RH).
2. **Les valeurs par défaut seedées sont exactement les recommandations écrites du RH**
   (NOTE_RH §3, colonne « Recommandation RH ») — il ne s'agit donc pas de règles inventées par
   un agent, mais de la reprise d'une préconisation documentée, datée et signée :

   | Clé `settings` | Défaut seedé | Source |
   |---|---|---|
   | `badgeuse.pointages_par_jour` | `4` | NOTE_RH §3 « 4 — permet de justifier la pause » |
   | `badgeuse.arrondi_minutes` | `5` | NOTE_RH §3 « 5 min à l'avantage du salarié » |
   | `badgeuse.arrondi_sens` | `avantage_salarie` | NOTE_RH §3 (entrée en avance → heure planifiée ; sortie au réel) |
   | `badgeuse.tolerance_retard_minutes` | `5` | NOTE_RH §3 « 5 min sans effet paie » |
   | `badgeuse.badge_avant_heure_compte` | `false` | NOTE_RH §3 « Non compté » |
   | `badgeuse.pause_deduite_minutes` | `45` | NOTE_RH §3 « Oui, 45 min si journée > 6 h sans pointage intermédiaire » |
   | `badgeuse.pause_deduite_seuil_heures` | `6` | NOTE_RH §3 |
   | `badgeuse.journee_max_heures` | `10` | NOTE_RH §3 « 10 h (alerte automatique) » |
   | `badgeuse.plage_acceptation` | `05:00-21:00` | NOTE_RH §3 (la spec §5.4 disait 05:00–22:00 ; la note RH, plus récente et plus restrictive, fait foi) |
   | `badgeuse.affichage_cumul_hebdo` | `false` | NOTE_RH §3 + AFF-02 + note juridique §3.5 (« recommandation : interdire ») |
   | `badgeuse.overlay_duree_sec` | `5` | AFF-01 (plafonné 3–8 s, plafond 8 s **codé en dur** car exigence juridique, pas règle de gestion) |
   | `badgeuse.anti_rebond_sec` | `8` | PST-02 |
   | `badgeuse.regularisation_delai_jours` | `5` | NOTE_RH §5.1 (signalement sous 5 jours ouvrés) |

3. **Le back-office affiche un bandeau « Règles par défaut — à faire arbitrer par la Direction »**
   tant qu'un ADMIN/RH n'a pas enregistré explicitement la grille (marqueur
   `badgeuse.regles_validees_le`). Le module fonctionne (pilote à blanc), mais l'état
   « non arbitré » est visible, jamais silencieux.
4. Les durées de conservation (note juridique §3.7) ne sont **pas** des règles de gestion
   arbitrables : ce sont des exigences de conformité. Elles sont paramétrées aussi
   (`badgeuse.retention_*`) mais préremplies aux valeurs de la note juridique, et la purge
   automatique les applique (BO-10).

## Conséquences

- Le pilote à blanc peut démarrer sans re-livraison de code : l'arbitrage Direction est une
  saisie d'écran, pas un déploiement.
- La grille de décision de NOTE_RH §3 devient un écran (Paramètres) : la « règle non écrite »
  redoutée par le RH ne peut structurellement pas exister.
- Un test de contrat vérifie qu'aucune de ces valeurs n'apparaît en dur dans le moteur de calcul.
