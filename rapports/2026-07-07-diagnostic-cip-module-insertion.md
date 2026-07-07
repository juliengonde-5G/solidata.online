# Diagnostic du module « Suivi de l'insertion » — regard d'une CIP

> **Persona** : Aline, Conseillère en Insertion Professionnelle principale / référente chez Solidarité Textiles.
> Je suis 30 à 40 salariés en parcours (CDDI), je conduis les entretiens de diagnostic et les bilans M+3 / M+6 / M+10 / sortie, je monte les plans d'action, et je rends des comptes à la DREETS, à France Travail et à nos financeurs (FSE+, Département).
> **Date** : 7 juillet 2026 · **Périmètre** : `routes/insertion/*`, `services/insertion-ai.js`, page `InsertionParcours.jsx`, tables `insertion_diagnostics` / `insertion_milestones` / `cip_action_plans` / `insertion_interview_alerts`.
> **Objectif** : dire ce qui me fait gagner du temps, ce qui m'en fait perdre, et par quoi commencer pour être plus efficace.

---

> **Mise à jour (V2.3.0, même jour) — feuille de route implémentée.** Ce diagnostic a été suivi d'une livraison immédiate. Sont **faits** : tableau de bord CIP (QW1/S1) avec taux de sorties dynamiques (S2), jalons calés sur le contrat réel (QW3), auto-initialisation du parcours (QW2) + auto-statut à l'import (QW7), freins non faussés (QW4), modèle IA à jour (QW5), erreurs remontées (QW6), export PDF fiche + bilan (S3), prescripteur affiché (S5), assistant IA clarifié + sorties IA masquées affichées (S6), pré-remplissage du bilan. Déjà présents côté serveur : alertes de jalons J-7/J-1/retard + notification Brevo (S4, jobs `scheduler.js`). **Restent en vision** : pré-remplissage IA complet du bilan et suivi post-sortie M+6. Les sections ci-dessous décrivent l'état AVANT correctif (elles documentent le pourquoi).

## 1. En une page (pour la direction)

Le module est **riche et bien pensé sur le fond** : le référentiel des 7 freins, les questionnaires d'entretien en langage simple, la timeline, le radar d'évolution et l'analyse IA couvrent le vrai métier de CIP. **Ce n'est pas un outil vide.**

Mais au quotidien, **il me fait travailler pour lui au lieu de travailler pour moi**. Trois problèmes structurels :

1. **Il ne m'alerte pas.** Je dois me souvenir toute seule de qui a un bilan en retard. La fonction existe pourtant déjà côté serveur (`bilanCohorte`), mais **aucun bouton ne la branche** — elle est écrite et jamais utilisée.
2. **Il me fait ressaisir ce qu'il sait déjà.** Les échéances de jalons ne se calent pas sur la durée réelle du contrat, les freins repartent de « 1/5 » à chaque bilan sans reprendre l'évaluation précédente, et rien ne se pré-remplit.
3. **Il ne produit rien que je puisse sortir.** Pas d'export PDF pour un rendez-vous ou un dossier financeur, et surtout **aucun taux de sorties dynamiques agrégé** — alors que c'est *le* chiffre que la DREETS me demande.

**La bonne nouvelle** : la plupart des correctifs sont des **quick wins** (brancher une fonction déjà écrite, changer une valeur par défaut, caler une date sur le contrat). Avec l'import Malibou enrichi livré en parallèle (ancienneté, RQTH, dates de contrat, prescripteur), le module a maintenant les données pour **s'auto-piloter**.

Note globale d'usage CIP : **6 / 10** — bon socle métier, ergonomie et pilotage à muscler.

---

## 2. Ce qui fonctionne bien (à garder)

Je commence par le positif, parce qu'il est réel :

- **Le référentiel des 7 freins** (mobilité, santé, finances, famille, linguistique, administratif, numérique) est le bon (`engine.js` `FREINS_DEFINITIONS`). Il colle au référentiel *Diagnostic socio-professionnel* de l'IAE.
- **Les questionnaires d'entretien sont excellents** (`CIP_QUESTIONNAIRES`). Les questions sont formulées en langage simple, tutoyantes, humaines (« Racontez-moi votre parcours avant d'arriver ici »). C'est exactement le ton d'un entretien réel, et ça aide beaucoup les collègues moins expérimentés.
- **La récupération automatique du PCM** depuis le recrutement (`GET /insertion/:id`, déchiffrement du rapport) : je n'ai pas à ressaisir la personnalité, l'IA l'exploite pour adapter la communication. Très bon.
- **Le radar d'évolution des freins** (diagnostic → jalons réalisés) est un support d'entretien parlant : le salarié *voit* sa progression.
- **L'analyse IA du profil et la préparation d'entretien** (`analyseProfilComplet`, `preparerEntretien`) sont branchées et utiles : la synthèse, le risque de décrochage et les questions-clés adaptées au PCM me font gagner du temps de préparation.

Le fond est là. Mes remarques portent sur **l'exploitation** de ce fond.

---

## 3. Diagnostic des frictions (ce qui me fait perdre du temps)

### 3.1 — Le parcours ne se met pas en route tout seul

- **Les jalons ne sont pas créés automatiquement.** Quand un salarié entre en parcours, je dois cliquer manuellement sur **« Initialiser jalons »** (`InsertionParcours.jsx:649`, `POST /milestones/:id/initialize`). Si j'oublie, l'onglet « Bilans » affiche « Aucun jalon » et le salarié sort des radars de suivi. Sur 35 personnes, on oublie.
- **Pire : le salarié n'apparaît en suivi que si `insertion_status = 'en_parcours'`** (`/milestones-overview` filtre là-dessus). Or l'import Malibou crée les fiches avec `insertion_status = 'none'`. **Un salarié fraîchement importé est donc invisible du suivi tant que je n'ai pas basculé son statut À LA MAIN**, un par un. C'est le premier trou dans la raquette.

### 3.2 — Les échéances de jalons ne correspondent pas aux contrats réels

L'initialisation pose des jalons fixes : Diagnostic **M+1**, Bilan **M+3 / M+6 / M+10**, Sortie **M+12** (`routes.js:393-399`), calculés depuis `insertion_start_date`.

Sauf que **nos CDDI ne durent pas tous 12 mois**. Dans l'export Malibou, je vois des contrats de 6 mois (ex. un contrat 23/03 → 30/09), renouvelés. Résultat :

- Pour un contrat de 6 mois, les jalons **M+10 et Sortie (M+12) tombent après la fin du contrat** → jalons fantômes, toujours « en retard », qui polluent mes indicateurs.
- Inversement, pour un parcours long (24 mois max en CDDI), je n'ai **aucun** jalon entre M+12 et la sortie.

Les échéances devraient se **caler sur la durée réelle du contrat** (`contract_start` → `contract_end`, désormais fiables grâce à l'import Malibou), pas sur un gabarit fixe.

### 3.3 — Le module me fait ressaisir ce qu'il connaît déjà

- **Défaut « 1/5 » trompeur sur les freins.** Un curseur non touché renvoie `1` (« pas de frein ») — `InsertionParcours.jsx:277-281`, `698-701`. Un frein *non évalué* est donc enregistré et envoyé à l'IA comme *frein absent*. Mes radars sont faux et l'analyse de risque est biaisée. Un frein non renseigné doit rester **vide (null)**, pas « 1 ».
- **Les freins repartent de zéro à chaque bilan.** Le formulaire de bilan ne pré-remplit pas les notes du jalon précédent (`BilanPanel`, form initialisé depuis le seul `milestone`). Je réévalue 7 freins de mémoire à chaque fois, au lieu de partir de la dernière évaluation et d'ajuster.
- **Le travail qualitatif sur les freins est perdu en route.** Au diagnostic je saisis, pour chaque frein, un *détail* et des *causes* (`frein_X_detail`, `frein_X_causes`). Aux bilans, seule la **note** est reprise — tout le qualitatif disparaît de l'écran. Je réécris ou je perds le fil.
- **Blocs entiers à re-remplir intégralement à chaque jalon** : `bilan_professionnel`, `bilan_social`, `objectifs_realises`, `objectifs_prochaine_periode`, `observations`. Rien ne reporte « les objectifs de la période précédente » comme point de départ du bilan suivant.

**Ordre de grandeur de saisie** : ~21 champs pour un diagnostic (1 parcours + 7 freins × [note+détail] + 6 observations), **16 + N** champs pour un bilan (+6 pour la sortie). Multiplié par 35 salariés × 4 bilans/an, la charge de saisie est le premier poste de temps « administratif » qui me détourne du terrain.

### 3.4 — Aucune sauvegarde automatique, et des erreurs invisibles

- **Pas de brouillon, pas de sauvegarde auto** (`saveDiagnostic`, `handleSave` seulement au clic). Si je change d'onglet ou de salarié, **ma saisie non enregistrée est perdue sans avertissement**. En entretien, où je jongle entre onglets, ça arrive.
- **Des erreurs avalées en silence** : `catch {}` vides dans `selectEmployee` (`:552`) et dans les 3 chargements de `BilanPanel` (`:174-180`). Si un chargement échoue, l'écran reste **vide sans message** — je crois qu'il n'y a pas de données alors que c'est un bug réseau.
- **Les erreurs de l'IA s'affichent comme un résultat.** En cas d'échec API, le message d'erreur est injecté dans le bloc « synthèse » (`:879`, `:892`) : ça ressemble à une analyse, ça n'en est pas une.
- **Les messages passent par des `alert()` navigateur** bloquants (`:189, :204, :563, :574`), là où le reste de l'ERP utilise des toasts/`ErrorState`.

### 3.5 — L'outil ne me pilote pas (le plus gros manque)

- **Pas de vue cohorte, alors qu'elle est déjà codée.** `bilanCohorte()` (`insertion-ai.js:258`) calcule *déjà* : nombre d'actifs, nombre à risque, frein dominant, **taux de retard des jalons**, jalons en retard, actions en retard, alertes, recommandations. **Cette fonction n'est appelée nulle part** dans l'interface (l'état `iaCohorte` est même déclaré puis jamais utilisé — code mort, `:521`). La brique la plus utile pour une CIP dort dans le serveur.
- **Pas d'alerte de jalon en retard dans la page.** Il existe une table `insertion_interview_alerts` (planification / rappel J-7 / J-1 / retard) mais **rien ne la remplit ni ne l'affiche**. Le seul signal visuel est un badge d'urgence basé sur la *fin de contrat*, pas sur les *jalons*. Je surveille donc les échéances de bilan… dans ma tête et dans un tableur à côté.
- **Aucun taux de sorties dynamiques agrégé.** Je saisis bien la sortie par salarié (classification positive/négative, type, employeur, SIRET, durée — `:338-400`, colonnes `sortie_*`), mais **rien ne calcule le taux de sorties dynamiques / positives de la structure**. C'est pourtant l'indicateur central de notre conventionnement DREETS/ASP et de nos bilans FSE+. Je le recalcule à la main chaque trimestre.
- **Pas d'export.** Aucun bouton pour sortir en PDF une fiche parcours, un bilan, ou une synthèse — ni pour un rendez-vous avec le salarié, ni pour le dossier, ni pour un financeur.
- **Le prescripteur est absent de la page.** La base a tout ce qu'il faut (`prescripteur_orgas`, `employees.prescripteur_id`, `date_prescription`) et l'import Malibou peut l'alimenter, mais l'écran d'insertion n'affiche ni ne relie l'orienteur (France Travail, mission locale, CD…), pourtant exigé dans le reporting FSE+ et les bilans d'éligibilité.

### 3.6 — Détails qui comptent

- **Modèle IA figé et déprécié** : `insertion-ai.js:18` code en dur `claude-sonnet-4-20250514` (Sonnet 4, mai 2025, déprécié). C'est surchargeable par la variable d'environnement `CLAUDE_MODEL` — donc corrigeable **sans toucher au code**, en pointant vers un modèle courant (`claude-sonnet-5`, ou `claude-opus-4-8` pour les analyses les plus fines).
- **Deux onglets « IA » prêtent à confusion** : « Analyse IA » affiche en fait l'analyse *algorithmique* (`fiche_synthese`, `pistes_metiers`), tandis que « Recommandations IA » mélange l'algorithmique et le *Claude* (profil/entretien). Comme utilisatrice je ne sais jamais lequel me donne quoi.
- **Des résultats IA payés mais jamais affichés** : `freins_prioritaires`, `risque_decrochage.signaux_alerte`, `pcm_adaptation.vigilances`, `points_vigilance`, `freins_a_aborder` sont demandés au modèle puis **jamais rendus** à l'écran. On consomme des tokens pour rien et je perds de l'info utile.
- **Un seul indicateur de chargement partagé** pour les deux boutons IA (`iaLoading`) : lancer « Préparer entretien » grise aussi « Analyser le profil », et le bouton entretien n'affiche aucun libellé de chargement.

---

## 4. Voies d'amélioration & de simplification

Priorisées par **rapport effort / gain pour la CIP**. Je distingue ce qui est quasi gratuit (une fonction déjà écrite à brancher, une valeur par défaut à changer) de ce qui demande un vrai chantier.

### 4.1 — Quick wins (fort impact, faible effort)

| # | Amélioration | Pourquoi ça me change la vie | Où |
|---|--------------|------------------------------|-----|
| QW1 | **Brancher `bilanCohorte` sur un onglet « Cohorte »** | La vue d'ensemble (retards, à risque, frein dominant, alertes) existe déjà côté serveur. Un onglet + un fetch `GET /insertion/ia/cohorte` et j'ai mon tableau de bord. | `insertion-ai.js:258` déjà prêt ; supprimer le code mort `iaCohorte` `:521` |
| QW2 | **Auto-initialiser les jalons** au passage `en_parcours` (ou à l'entrée du salarié) | Supprime un clic manuel et surtout l'oubli. | déclencher `initialize` côté serveur au changement de statut |
| QW3 | **Caler les échéances de jalons sur `contract_end`** au lieu de M+1/3/6/10/12 fixes | Fini les jalons fantômes après la fin de contrat. Données désormais fiables via l'import Malibou. | `routes.js:388-399` |
| QW4 | **Frein non évalué = `null`, pas `1`** + pré-remplir chaque bilan avec l'évaluation précédente | Radars justes, analyse de risque fiable, et je pars de l'existant au lieu de zéro. | `InsertionParcours.jsx:277-281, 698-701` ; init du form de bilan |
| QW5 | **Mettre à jour `CLAUDE_MODEL`** (variable d'env) vers un modèle courant | Meilleures analyses, zéro ligne de code. | `.env` serveur |
| QW6 | **Remonter les erreurs** (remplacer `catch {}` + `alert()` par toasts/`ErrorState`) | Je vois quand ça casse, je ne crois plus à un écran « vide ». | `:552, :174-180, :189…` |
| QW7 | **Auto-bascule `insertion_status` à l'import** pour les contrats d'insertion (CDDI) | Les salariés importés apparaissent directement dans le suivi, sans bascule manuelle un-par-un. | service d'import + décision produit |

### 4.2 — Chantiers structurants (fort impact, effort moyen)

- **S1 — Tableau de bord CIP.** Une page d'atterrissage qui répond à « qu'est-ce que je dois faire cette semaine ? » : jalons en retard, jalons à veny (J-7), salariés à risque de décrochage, répartition des freins de la cohorte, **taux de sorties dynamiques en direct**. La moitié des données est déjà calculée par `bilanCohorte` ; il manque le taux de sorties.
- **S2 — Calcul et affichage du taux de sorties dynamiques / positives.** Agréger les `sortie_classification` et `sortie_type` sur une période (année civile / conventionnement) selon la nomenclature ASP (emploi durable / de transition / positive). C'est l'indicateur n°1 de mes bilans financeurs — aujourd'hui recalculé à la main.
- **S3 — Export PDF** de la fiche parcours et du bilan (support de rendez-vous, pièce du dossier, annexe financeur). L'ERP sait déjà générer des PDF A4 (module PCM) : réutiliser le même socle.
- **S4 — Alertes de jalons automatiques.** Alimenter `insertion_interview_alerts` via le scheduler (J-7 / J-1 / retard) et pousser une notification (l'infra e-mail/SMS Brevo et le `NotificationBell` existent déjà). La table est là, il ne manque que le remplissage + le déclencheur.
- **S5 — Rattacher le prescripteur** à la page insertion (affichage + lien), alimenté par l'import, pour le reporting FSE+/France Travail et le contrôle d'éligibilité.
- **S6 — Clarifier et exploiter l'IA** : fusionner/renommer les deux onglets « IA », et afficher les sorties déjà produites mais masquées (`points_vigilance`, `signaux_alerte`, `freins_prioritaires`).

### 4.3 — Réduire la charge de saisie (simplification)

- **Questionnaire progressif** plutôt qu'un mur de 21 champs : dérouler section par section, avec les champs peu utilisés repliés.
- **Report intelligent d'un jalon à l'autre** : pré-remplir « objectifs de la période » du bilan N avec les « objectifs prochaine période » du bilan N-1 ; reprendre notes de freins + détails.
- **Sauvegarde auto en brouillon** (ou au minimum un garde-fou « modifications non enregistrées » au changement d'onglet/salarié).
- **Valeurs par défaut issues des données déjà en base** (poste, équipe, ancienneté, RQTH via l'import) au lieu d'une ressaisie.

### 4.4 — Vision (à moyen terme)

- **Pré-remplissage IA du bilan** : à partir des observations de l'encadrant technique, du PCM et de l'historique des freins, l'IA propose un pré-bilan que je **corrige et valide** — je passe de « rédactrice » à « validatrice ». Les briques (`preparerEntretien`, `analyseProfilComplet`) sont déjà là.
- **Suivi post-sortie à 6 mois** (maintien en emploi), attendu par certains financeurs : un jalon « Suivi M+6 après sortie » et son alerte.
- **Bilan cohorte exportable** pour le comité de suivi / le CA et les dialogues de gestion avec la DREETS.

---

## 5. Ce que l'import Malibou enrichi apporte déjà à ce module

Le chantier d'import livré en parallèle n'est pas neutre pour l'insertion — il **débloque plusieurs des améliorations ci-dessus** :

- `contract_start` / `contract_end` fiables → **QW3** (échéances de jalons calées sur le contrat réel).
- `seniority_date` (ancienneté) → calcul correct de la durée de parcours et des jalons.
- `disability_status` (RQTH) → plans d'action et reporting tenant compte du handicap (public prioritaire IAE).
- `manager_id` / responsable → l'encadrant technique est identifié, base du pré-bilan IA (S/vision) et du croisement observations terrain.
- socle prêt pour le **prescripteur** (S5).

Autrement dit : le module insertion avait déjà le bon moteur, mais roulait sans carburant fiable côté données RH. L'import corrigé lui donne ce carburant.

---

## 6. Synthèse — par quoi commencer

Si je devais choisir **trois choses pour le prochain sprint**, en tant que CIP :

1. **QW1 — brancher la vue cohorte** (déjà codée) : je vois enfin mes retards et mes risques d'un coup d'œil.
2. **QW3 + QW4 — jalons calés sur le contrat + freins non faussés** : mes échéances et mes radars deviennent justes.
3. **S2 — taux de sorties dynamiques** : je rends mes comptes à la DREETS sans tableur parallèle.

Le reste (export PDF, alertes automatiques, pré-remplissage IA) viendra derrière, mais ces trois-là transforment déjà l'outil de « saisie qui me surveille » en « outil qui me pilote ».

---

*Rapport rédigé en persona CIP à partir de l'analyse du code (`routes/insertion/*`, `services/insertion-ai.js`, `InsertionParcours.jsx`) et du schéma de données. Les références `fichier:ligne` renvoient à l'état du dépôt au 7 juillet 2026. Aucune donnée nominative de salarié n'est reproduite ici.*
