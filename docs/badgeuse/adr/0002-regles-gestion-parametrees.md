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
   | `badgeuse.anti_rebond_sec` | `300` | PST-02 |
   | `badgeuse.regularisation_delai_jours` | `5` | NOTE_RH §5.1 (signalement sous 5 jours ouvrés) |

3. **Le back-office affiche un bandeau « Règles par défaut — à faire arbitrer par la Direction »**
   tant qu'un ADMIN/RH n'a pas enregistré explicitement la grille (marqueur
   `badgeuse.regles_validees_le`). Le module fonctionne (pilote à blanc), mais l'état
   « non arbitré » est visible, jamais silencieux.
4. Les durées de conservation (note juridique §3.7) ne sont **pas** des règles de gestion
   arbitrables : ce sont des exigences de conformité. Elles sont paramétrées aussi
   (`badgeuse.retention_*`) mais préremplies aux valeurs de la note juridique, et la purge
   automatique les applique (BO-10).

## Addendum — arbitrages de la boucle QA n°1 (rapport A4, défauts QA-03/05/06/10/11)

Corrections de **spécification** actées par l'Agent 0 après la revue adversariale, toujours
dans la limite « défauts = recommandations RH écrites, jamais de règle inventée » :

1. **QA-06 — déduction de pause rendue MONOTONE.** La lettre de NOTE_RH §3 (« 45 min si
   journée > 6 h sans pointage intermédiaire ») crée une falaise : 6 h 01 travaillées
   payées 5 h 16, quand 6 h 00 sont payées 6 h 00. Règle retenue :
   `déduction = min(pause_deduite, max(0, travaillé − seuil))` — la déduction ne fait
   jamais passer la journée sous le seuil. 6 h 00 → 6 h 00 ; 6 h 01 → 6 h 00 ;
   7 h 00 → 6 h 15. Strictement favorable au salarié par rapport à la lettre,
   monotone, à confirmer par la Direction avec le reste de la grille.
2. **QA-10 — la sortie est comptée AU RÉEL** (lettre exacte de NOTE_RH §3 : « sortie
   arrondie au réel »), jamais arrondie au pas supérieur. L'arrondi `arrondi_minutes`
   s'applique : à l'**entrée seule**, au pas inférieur (8 h 03 → 8 h 00, avantage
   salarié) ; et, quand une heure planifiée est fournie, arrivée en avance → heure
   planifiée, retard ≤ tolérance → heure planifiée (tolérance sans effet paie).
3. **QA-03 — heures théoriques de la feuille de temps** : heures hebdomadaires
   contractuelles effectives au 1ᵉʳ du mois (`employee_contracts`, repli
   `employees.weekly_hours`) × jours ouvrés du mois ÷ 5, arrondi 2 déc. ;
   **null si aucune heure contractuelle connue** (« jamais de valeur inventée »).
4. **QA-05 — consommation effective des paramètres arbitrés** :
   `badgeuse.pointages_par_jour` alimente l'anomalie `pointages_incomplets` et le taux
   de pointages complets (indicateur NOTE_RH §9) ; `badgeuse.regularisation_delai_jours`
   déclenche un avertissement **non bloquant** quand une correction est saisie au-delà du
   délai de signalement.
5. **QA-11 — seuil de silence de supervision paramétré** :
   `badgeuse.supervision_silence_minutes`, défaut `15` (BO-09).

## Addendum — anti-rebond porté à 5 minutes (retour d'exploitation, août 2026)

**Constat.** « Un utilisateur qui badge plusieurs fois n'a pas de message d'erreur. »
Reproduit : à 8 s de fenêtre, une seconde présentation 30 s plus tard était **acceptée**.
Il n'y avait donc aucun message parce qu'il n'y avait, du point de vue du poste, aucun
rebond — mais un second pointage bien réel partait au serveur. Le sens étant alterné, la
journée se refermait sur une paire de quelques secondes et le vrai départ du soir devenait
une entrée orpheline : plusieurs heures disparaissaient de la feuille de temps, à
régulariser à la main.

**Cause.** 8 s ne couvre que le rebond **matériel** du lecteur. Le geste qui pose problème
en atelier est **humain** : on doute que le badge ait été pris, on le représente.

**Décision.** `badgeuse.anti_rebond_sec` passe de `8` à `300` (5 min) — valeur demandée par
l'exploitation. Elle **reste une règle de gestion arbitrable** : elle vit dans `settings`,
s'édite dans l'écran Paramètres, descend au poste par `GET /config`, et son enregistrement
vaut arbitrage de la grille. Rien n'est codé en dur ; `DEFAULT_WINDOW_SEC` côté poste n'est
qu'un repli tant que la configuration n'est pas reçue.

**Contrepartie, assumée et rendue visible.** Un aller-retour réel plus court que la fenêtre
(sortir et revenir en 3 minutes) n'est pas compté. Deux garde-fous :

1. le refus n'est **jamais muet** — l'écran affiche « Badge déjà enregistré », l'ancienneté
   du pointage retenu (« il y a 3 minutes ») et « Ce passage ne compte pas une seconde
   fois » ; la personne sait immédiatement qu'elle doit voir son encadrant si c'était un
   vrai passage ;
2. la voie de rattrapage existe déjà : correction additive motivée (NOTE_RH §5.1).

La Direction peut abaisser la valeur si l'exploitation constate trop d'allers-retours
courts ; l'écran Paramètres expose le compromis en toutes lettres.

**Effet de bord traité.** L'oubli des badges en mémoire du poste était borné par l'ancienneté
(4 × la fenêtre) : à 300 s l'horizon passe à 20 minutes, insuffisant pour garantir la borne
si un exploitant règle une fenêtre très large. Un plafond dur de 512 entrées a été ajouté
(`debounce.py`), testé.

## Conséquences

- Le pilote à blanc peut démarrer sans re-livraison de code : l'arbitrage Direction est une
  saisie d'écran, pas un déploiement.
- La grille de décision de NOTE_RH §3 devient un écran (Paramètres) : la « règle non écrite »
  redoutée par le RH ne peut structurellement pas exister.
- Un test de contrat vérifie qu'aucune de ces valeurs n'apparaît en dur dans le moteur de calcul.
