# Revue UX / utilisatrice finale — Extension du module Insertion

- **Date** : 22 juillet 2026
- **Mission** : s'assurer de l'adaptation des fonctionnalités et des visuels aux besoins de l'utilisatrice finale AVANT développement (exigence explicite du CDC, section A).
- **Méthode** : revue croisée en double persona — **UX** (chef·fe de projet UX/fonctionnel, logiciels métier B2B) et **CIP** (conseillère en insertion professionnelle en ACI, ~46 salariés suivis pour 0,86 ETP, outillage actuel : classeurs Excel + formulaires Word, à l'aise mais non experte en informatique). Passage en revue de 8 parcours d'usage réels.
- **Entrées** : `00-cahier-des-charges.md`, `04-plan-action-fonctionnel.md` (lots 1-8, D1-D13), `05-plan-codage.md`, `01-cadrage-conformite.md` (§3, §4, §8), trames actuelles (formulaire de bilan, fiche diagnostique 9 rubriques, classeur de suivi de la structure sœur — structure seulement), `frontend/src/pages/InsertionParcours.jsx` (conventions existantes).
- **Statut** : livrable de revue — n'engage aucun code ; alimente la validation des plans 04/05.

---

## 0. Le cadre de réalité qui gouverne toute la revue

Avant les parcours, trois chiffres que le plan doit regarder en face :

| Réalité terrain | Conséquence UX |
|---|---|
| **46 salariés pour 0,86 ETP de CIP** (~30 h/sem, pas tous les jours) | ≈ 1,5 jour de CIP par salarié et par an, entretiens compris. Chaque minute de saisie compte : **5 min de saisie en plus par bilan ≈ 30 min perdues par semaine**. |
| Contrats CDDI renouvelés par 2/4/6 mois | ≈ **90-120 renouvellements/an** (~2/semaine) : le renouvellement n'est pas un cas rare, c'est une chaîne de production. |
| Bilans à fréquence individualisée (souvent bimestrielle) | ≈ **250-280 bilans/an** (5-6/semaine). Le formulaire de bilan est l'écran le plus utilisé du module — il doit être plus rapide que le Word actuel, sinon la CIP réimprimera le Word. |

**Étalon de comparaison** : aujourd'hui la CIP remplit un formulaire Word de 2 pages en ~10 min et tient son journal d'actions dans Excel en quelques secondes par ligne. Le module ne sera adopté que s'il fait **aussi vite, en apportant en plus** le pré-remplissage, l'historique et les exports.

---

## 1. Synthèse — verdict global

**Le plan fonctionnel (04) et le plan de codage (05) répondent sur le fond aux besoins de l'utilisatrice finale** : le modèle « entretiens historisés à fréquence libre », l'évaluation du bilan précédent, le journal d'actions avec partenaires, les pré-remplissages systématiques et le « null honnête » sur les freins collent aux pratiques documentées (trames internes, classeur de la structure sœur). Le risque n° 3 du plan 04 (« si l'outil est plus lourd qu'Excel, il ne sera pas adopté ») est correctement identifié.

**Mais deux points sont bloquants en l'état, et huit majeurs** :

1. **BLOQUANT — Aucun mécanisme de brouillon/sauvegarde continue n'est prévu** alors que le diagnostic d'accueil refondu représente 45-90 min de face-à-face (9 rubriques, ~40 questions). Le pattern actuel (état local + un bouton « Enregistrer » + `window.confirm`) fait courir le risque de perdre une heure d'entretien sur un onglet fermé ou une coupure réseau. L'accordéon unique de 9 rubriques est par ailleurs intenable en situation d'entretien (REC-UX-01).
2. **BLOQUANT — Le maillon encadrant technique n'a pas d'écran avant la phase 2**, alors que le renouvellement (Lot 4, PR 2) exige un formulaire « rempli par l'encadrant → transmis à la CIP ». Sans écran ETI ultra-simple dès la PR 2, la chaîne la plus fréquente du module (~2 renouvellements/semaine) reste sur papier et la CIP fait de la double saisie (REC-UX-06).

**Conditions de validation** : intégrer REC-UX-01 et REC-UX-06 aux plans 04/05 avant codage ; traiter les 8 recommandations majeures (REC-UX-02, 03, 04, 05, 07, 08, 09, 14) au plus tard dans la PR qui livre l'écran concerné. Les recommandations mineures peuvent être arbitrées au fil de l'eau. Sous ces conditions, **avis favorable**.

---

## 2. Revue par parcours d'usage

### a. « Je prépare mon entretien de 14 h » (10 minutes entre deux RDV)

> **UX** — Le plan prévoit « Préparer cet entretien » sur chaque entretien, avec génération IA à la demande ou anticipée J-7 *optionnelle*. Où retrouvez-vous votre RDV de 14 h ?
> **CIP** — Aujourd'hui ? Dans mon agenda Outlook et mon classeur. Si je dois d'abord retrouver le salarié dans une liste de 46, ouvrir sa fiche, ouvrir l'onglet, cliquer « préparer » et attendre… L'analyse IA met parfois plus d'une minute, non ?
> **UX** — Jusqu'à 2 minutes (timeout 120 s côté front). Sur une fenêtre de 10 minutes, une génération à la demande qui échoue ou traîne consomme le créneau.
> **CIP** — Ce qu'il me faut à 13 h 50 : la liste de **mes entretiens du jour**, et pour celui de 14 h : ce qu'on s'était dit la dernière fois, ce qu'il devait faire, ce que MOI je devais faire, et ce qui est en retard. Si l'IA me le résume, très bien — mais je dois pouvoir le lire d'un coup d'œil même sans IA.

**Verdict : acceptable, fluide sous conditions.**
**Frictions** : pas de point d'entrée « aujourd'hui / cette semaine » dans l'espace CIP (le bloc agenda 30 j existe côté backend depuis v2.8.0 mais le plan 05 ne le met pas en tête de `/insertion`) ; préparation IA J-7 seulement *optionnelle* ; pas de solution de repli lisible sans IA.
**Recommandations** : REC-UX-07 (bloc « Mes entretiens » en tête + IA pré-générée par défaut + synthèse factuelle sans IA).

---

### b. « Je conduis le diagnostic d'accueil en face à face » (9 rubriques + freins)

> **UX** — La trame papier fait 6 pages, ~40 questions, 9 commentaires, plus la valorisation des freins. Durée réaliste en face à face ?
> **CIP** — Une bonne heure, souvent plus avec un salarié allophone ou en confiance difficile. Et je ne le fais **jamais** d'une traite : il m'arrive de couper en deux rendez-vous, surtout la partie budget et santé qui demandent de la confiance. Sur papier, je pose la feuille entre nous, on la remplit ensemble.
> **UX** — Le plan prévoit un accordéon de 9 rubriques sur une page. À l'écran, ça donne un très long défilement, toutes rubriques ouvertes ou à rouvrir sans arrêt, et un seul « Enregistrer » à la fin.
> **CIP** — Si je perds une heure de saisie parce que l'ordinateur a redémarré, je reviens au papier définitivement. Et pendant l'entretien, je ne veux pas *chercher* dans l'écran : je veux la rubrique en cours, en gros, et rien d'autre. L'écran ne doit pas devenir un mur entre nous — parfois je préfère cocher sur papier et ressaisir au calme.
> **UX** — Donc il faut trois choses : une navigation **rubrique par rubrique** (pas un accordéon), une **sauvegarde continue** avec reprise (« diagnostic en cours — repris là où vous étiez »), et une saisie **à froid** aussi rapide que la recopie du papier (tout au clavier, cases à cocher massives).

**Verdict : à risque** (le formulaire le plus long du module avec le pattern de persistance le plus fragile).
**Frictions** : accordéon 9 rubriques intenable en entretien ; aucune notion de brouillon/reprise ; saisie perdue possible ; pré-calcul du niveau de frein bienvenu mais à afficher comme suggestion discrète en fin de rubrique (la CIP décide — le plan le dit, l'écran doit le montrer) ; sliders 1-5 ambigus (le curseur affiche « 3 » même non évalué) ; durée à annoncer honnêtement (possibilité de faire le diagnostic en 2 séances dans la fenêtre réglementaire de 30 j).
**Recommandations** : REC-UX-01 (bloquant), REC-UX-17, REC-UX-19.

---

### c. « Je clôture mon bilan et je planifie le suivant »

> **UX** — Le plan crée un `POST /close` exigeant : freins évalués (ou « non évalué » assumé), évaluation du bilan précédent renseignée, prochain entretien planifié. C'est fidèle à votre formulaire papier (« Date du prochain point » + double signature).
> **CIP** — Sur le papier, je remplis dans l'ordre : situation, objectifs, démarches faites/non faites avec raisons, freins, progression/autonomie, vigilance, actions, date du prochain point, signatures. Si l'écran suit un autre ordre, je vais chercher mes cases.
> **UX** — Point dur : « l'évaluation du bilan précédent » reprend chaque objectif et chaque action avec verdict, échéance respectée oui/non, commentaire. Avec 5 objectifs et 6 actions, ça fait 11 lignes × 3 saisies.
> **CIP** — Sur Excel je mets une couleur, point. Un clic par ligne : fait / en partie / pas fait. C'est tout ce dont j'ai besoin — et l'outil **sait déjà** si l'échéance est passée, pourquoi me le demander ?
> **UX** — Exact : `echeance_respectee` doit être calculé, pas saisi. Autre point : il faut distinguer « Enregistrer » (je peux poser un bilan incomplet et y revenir) de « Clôturer » (les contrôles se déclenchent), avec une check-list visible avant de cliquer — sinon des bilans resteront éternellement ni clos ni planifiés.

**Verdict : acceptable sous conditions.**
**Frictions** : ordre des sections à aligner sur la trame papier ; évaluation du précédent trop coûteuse en saisie unitaire ; frontière brouillon/clôture à matérialiser (check-list de clôture, refus expliqué champ par champ) ; date du prochain RDV à proposer par défaut selon le rythme individualisé du salarié.
**Recommandations** : REC-UX-02, REC-UX-03, REC-UX-18.

---

### d. « Je saisis une action au vol entre deux portes » (< 1 minute)

> **UX** — Le CDC exige la saisie < 1 min. Le plan la prévoit « depuis la fiche ET depuis le tableau transversal ».
> **CIP** — Entre deux portes, je ne suis ni sur la fiche ni sur le tableau. Je reviens du hall, quelqu'un m'a dit « au fait, j'ai eu la CAF ». Il me faut UN bouton, toujours au même endroit, qui me demande : qui, quoi, et c'est tout.
> **UX** — Donc un « + Action » global dans l'en-tête du module (voire de la sidebar Insertion), ouvrant une mini-modale : salarié (autocomplétion, derniers consultés en premier), libellé, et des valeurs par défaut pour le reste (catégorie, criticité moyenne, échéance +14 j, sans rattachement). Deux champs obligatoires, Entrée pour valider.
> **CIP** — Et si je peux le faire depuis mon téléphone dans le couloir, c'est encore mieux — mais je peux attendre d'être à mon bureau si la saisie fait vraiment 30 secondes.

**Verdict : à risque en l'état du plan** (le point d'entrée global manque), fluide avec la recommandation.
**Frictions** : pas de bouton d'ajout global ; formulaire d'ajout actuel (BilanPanel) déjà proche du bon geste mais enfermé dans le bilan ; la modale doit confirmer sans naviguer (toast « Action ajoutée pour X »).
**Recommandations** : REC-UX-04 ; mineur : vérifier le rendu responsive de la modale (module web only assumé, plan 05 §7.8 — pas de refonte mobile demandée).

---

### e. « Je pilote ma cohorte du lundi matin »

> **UX** — Le plan garde le `CohortePanel` (vue par défaut de `/insertion`), enrichit `/insertion/audit`, et ajoute un bloc d'alertes sur fiche + tableau de bord. Trois endroits.
> **CIP** — Le lundi j'ouvre UNE page. Je veux : mes entretiens de la semaine, ce qui est en retard, les renouvellements à préparer (il y en a toujours), les Pass qui arrivent à échéance. Le reste — taux conventionnels, typologies — c'est pour la direction et le dialogue de gestion, pas pour mon lundi matin.
> **UX** — Attention aussi au volume : 7 types d'alertes × 46 salariés, avec ~10 renouvellements < 6 semaines en permanence et des Pass par vagues… on peut afficher 30-50 alertes actives en continu. Au bout de deux semaines, plus personne ne les lit.
> **CIP** — Sur mon Excel, le rouge veut dire « il faut agir cette semaine ». S'il y a du rouge partout, je ne vois plus rien.

**Verdict : acceptable sous conditions.**
**Frictions** : dispersion en 3 vues (assumer : `/insertion` = espace de travail CIP, `/insertion/audit` = pilotage direction — le nommer ainsi dans le menu) ; risque de sur-sollicitation d'alertes ; pas de regroupement par salarié ni d'acquittement prévu ; les listes horizon (« à faire sous 15 j ») valent mieux que des notifications datées pour une CIP à 0,86 ETP qui n'est pas là tous les jours.
**Recommandations** : REC-UX-07, REC-UX-08.

---

### f. « Je sors le tableau pour la DDETS / le renouvellement de Pass »

> **UX** — Export 23 colonnes XLSX/CSV (variante sans frein judiciaire par défaut), journalisé RGPD, plus un « bilan de prolongation Pass IAE » PDF généré depuis les bilans saisis. Conforme au CDC.
> **CIP** — Deux choses. Un : quand je prépare une prolongation de Pass, je pars du salarié — le bouton doit être sur sa fiche ET dans la liste « Pass à préparer », pas dans un menu d'exports. Deux : la pire situation, c'est de découvrir devant l'administration que la colonne « Logement » est vide pour 15 salariés parce que les diagnostics ne sont pas à jour.
> **UX** — Donc : indicateur de complétude AVANT l'export (« 39/46 fiches complètes — voir les 7 incomplètes »), et des filtres (année, présents/sortis, par CIP). L'export sans filtre ni contrôle, c'est un aller-retour Excel garanti — exactement ce qu'on veut supprimer.

**Verdict : acceptable.**
**Frictions** : filtres d'export non spécifiés dans le plan 05 (§2.2) ; complétude non vérifiable avant génération ; bilan de prolongation à exposer à 1 clic depuis la fiche et la liste des Pass.
**Recommandations** : REC-UX-14, REC-UX-15.

---

### g. « L'encadrant technique remplit son formulaire de renouvellement » (persona secondaire)

> **UX** — Le cadrage (§3.1) est formel : le parcours réel est un binôme CIP ↔ ETI, le formulaire de renouvellement est *rempli par l'encadrant* puis transmis à la CIP. Or le plan met le renouvellement en Lot 4 (PR 2) et **l'espace ETI en Lot 8 (PR 3, phase 2)**. Qui saisit le formulaire dans l'intervalle ?
> **CIP** — Si c'est moi qui ressaisis le papier de l'encadrant, on a numérisé ma double saisie. Et je connais mes encadrants : au clavier, c'est cases à cocher et trois mots, pas des pavés de texte. S'il faut naviguer dans le module, ils n'iront pas.
> **UX** — Il faut donc, dès la PR 2, un **écran unique dédié** : l'ETI arrive par un lien direct (« 2 renouvellements à remplir »), voit UN salarié, UNE page — les rubriques exactes de la trame papier (assiduité, motivation, autonomie, participation, projet, motifs) en boutons radio et cases larges, avis favorable / avec réserves / défavorable, durée 2/4/6 mois — et un seul bouton « Transmettre à la CIP ». Zéro navigation, zéro jargon, gros contrastes.
> **CIP** — Et moi je reçois le formulaire pré-rempli dans ma liste « renouvellements à préparer », je complète mon volet, et on passe aux validations. Là, on gagne vraiment du temps tous les deux.

**Verdict : à risque** (trou de séquencement entre Lot 4 et Lot 8).
**Frictions** : plan 05 §3.2 ne prévoit aucune vue ETI en PR 2 ; le rôle MANAGER a pourtant accès écriture au renouvellement dans le modèle ; sans écran adapté, la promesse « formulaire rempli par l'encadrant » reste sur papier.
**Recommandations** : REC-UX-06 (bloquant).

---

### h. « Le salarié voit / signe son bilan » (co-construction, FALC)

> **UX** — D7 : validations horodatées par compte + case « validé en présence du salarié » + PDF remis. La vue salarié « Mon parcours » est reportée (arbitrage n° 9) — assumé.
> **CIP** — Le papier que je remets doit pouvoir être compris par quelqu'un qui lit mal le français. Aujourd'hui je fais relire et signer la trame Word : c'est déjà dense. Si le PDF généré ressemble à un rapport d'audit, il ne sera pas lu.
> **UX** — Deux exigences : d'abord un bloc de tête type FALC — « Ce que nous avons décidé » en 3 puces courtes, l'évolution des freins en pictos (↗ ↘ =), gros corps de texte ; la toile d'araignée, elle, parle bien aux salariés. Ensuite, un point de confidentialité : le formulaire contient des champs *internes* (points de vigilance, détails santé chiffrés, judiciaire). Le plan 05 (§3.3) prévoit UN gabarit de bilan — il en faut DEUX : « exemplaire salarié » (sans champs internes/sensibles non nécessaires) et « exemplaire dossier ».
> **CIP** — Et pendant l'entretien, quand on relit ensemble à l'écran avant designer, il me faut du texte en grand et mes notes internes masquées — pas mon écran de saisie complet.

**Verdict : acceptable sous conditions.**
**Frictions** : gabarit PDF unique = risque de fuite de champs internes vers le salarié ou des tiers ; pas de bloc synthèse lisible ; pas de « mode relecture » à l'écran.
**Recommandations** : REC-UX-09, REC-UX-17.

---

## 3. Recommandations

> Sévérités : **BLOQUANT** = condition de validation des plans ; **MAJEUR** = à intégrer dans la PR qui livre l'écran concerné ; **mineur** = arbitrable au fil de l'eau.

| ID | Sévérité | Recommandation (résumé) | Impact plans 04/05 |
|---|---|---|---|
| REC-UX-01 | **BLOQUANT** | Diagnostic d'accueil : navigation **rubrique par rubrique** (stepper 1/9 avec sommaire latéral cliquable), **sauvegarde automatique par rubrique** (le `PUT /diagnostic` accepte déjà le partiel), statut **« diagnostic en cours »** avec reprise là où on s'était arrêté, saisie possible en 2 séances. Bandeau « Brouillon enregistré à HH:MM ». Abandonner l'accordéon unique et le pattern « tout en état local + un Enregistrer final ». | 04 Lot 2 ; 05 §3.1 `DiagnosticForm` (structure), §2.1 `PUT /diagnostic` (sauvegarde partielle explicite, horodatage brouillon) |
| REC-UX-02 | MAJEUR | Bilan : séparer clairement **« Enregistrer » (brouillon, toujours possible)** de **« Clôturer » (contrôles)**. Avant clôture : check-list visible en permanence (« Prêt à clôturer : 3/4 ») ; la modale de clôture regroupe le reste à faire (prochain RDV proposé par défaut, validation salarié). Refus de clôture toujours expliqué champ par champ. Sections du formulaire dans **l'ordre de la trame papier** (situation → évaluation du précédent → freins → objectifs/actions → clôture). Autosave comme REC-UX-01. | 04 Lot 1 ; 05 §2.1 `POST /close` (messages d'erreur structurés), §3.1 `EntretienForm` |
| REC-UX-03 | MAJEUR | Évaluation du bilan précédent : **un tap par élément** (Fait / En partie / Non fait), commentaire optionnel replié, `echeance_respectee` **calculée par le système** (jamais demandée), report automatique des non-atteints vers le nouveau bilan. | 04 Lot 1 ; 05 §1.1 `previous_review` (retirer la saisie du booléen), §3.1 `EntretienForm` |
| REC-UX-04 | MAJEUR | **« + Action » global** : bouton permanent dans l'en-tête du module Insertion (toutes vues), mini-modale 2 champs obligatoires (salarié en autocomplétion « récents d'abord », libellé), valeurs par défaut pour catégorie/criticité/échéance (+14 j paramétrable), rattachement facultatif, validation à la touche Entrée, toast de confirmation sans navigation. Chronométrer le geste en recette : **≤ 30 s**. | 04 Lot 3 (exigence CDC < 1 min) ; 05 §3.1 `ActionsPanel` + §3.2 (en-tête `InsertionParcours` et `ActionsCIP`) |
| REC-UX-05 | MAJEUR | Frise : rendu en **couloirs superposés** (Contrats / Entretiens / Objectifs / PMSMP) et non en piste unique ; **cases à cocher par couloir** (objectifs masqués par défaut) ; **regroupement automatique** des événements trop proches (pastille « ×3 » dépliable) ; la **liste chronologique verticale existante est conservée sous la frise** comme vue de référence lisible et accessible (mêmes données). Un parcours 24 mois réaliste porte 20-35 événements : la frise seule ne suffira jamais. | 04 Lot 5 ; 05 §3.1 `FriseParcours` (spécification du rendu) |
| REC-UX-06 | **BLOQUANT** | **Formulaire de renouvellement ETI livré dès la PR 2** (ne pas attendre le Lot 8) : route dédiée accessible par lien direct depuis une notification/liste « À remplir » (rôle MANAGER), **un écran, un salarié**, rubriques identiques à la trame papier en boutons radio/cases larges (cibles ≥ 44 px), textes courts facultatifs, un bouton « Transmettre à la CIP ». Aucune navigation dans le module requise. Le volet CIP et les validations restent dans l'espace CIP. | 04 Lot 4 (ajout explicite) + note de périmètre Lot 8 ; 05 §3.2 (nouvelle vue `RenouvellementETI`), §2.1 `/renouvellements` |
| REC-UX-07 | MAJEUR | Espace CIP : **bloc « Aujourd'hui / Cette semaine » en tête de `/insertion`** (entretiens planifiés avec heure, badge « préparation prête », lien direct fiche+formulaire) ; préparation IA J-7 **activée par défaut** (désactivable) ; sur chaque entretien planifié, une **synthèse factuelle sans IA** (dernier avis, objectifs en cours, actions en retard) affichée instantanément même si l'IA est indisponible. Renommer les entrées de menu : « Espace CIP » (`/insertion`) vs « Pilotage & indicateurs » (`/insertion/audit`). | 04 Lots 1+7 ; 05 §2.4 (défaut du job IA), §3.2 `InsertionParcours` (bloc agenda), `Layout.jsx` (libellés) |
| REC-UX-08 | MAJEUR | Alertes : **regroupement par salarié** (une ligne = un salarié, badges cumulés), **3 niveaux visuels seulement** (rouge = réglementaire/contractuel : Pass, CDDI ≥ 22 mois, diagnostic > 30 j ; ambre = process : bilan en retard, RDV non planifié ; gris = à venir), **acquittement/report** (« vu, me le rappeler dans 7 j ») journalisé, plafond d'affichage avec « voir tout ». Pas de rouge décoratif. Seuils réglables dans `AdminInsertion`. | 04 Lot 6 ; 05 §2.1 `/alertes` (état d'acquittement), §3.1 `AlertesBloc`, §3.2 `AdminInsertion` |
| REC-UX-09 | MAJEUR | PDF : **deux gabarits de bilan** — « exemplaire salarié » (bloc de tête « Ce que nous avons décidé » en 3 puces FALC, évolution des freins en pictos ↗↘=, toile d'araignée, gros corps, **sans** points de vigilance internes ni détails santé/judiciaire) et « exemplaire dossier » (complet, selon habilitation). Le diagnostic PDF suit la même logique. | 04 Lot 1 + transverse RGPD ; 05 §3.3 (dédoublement des gabarits) |
| REC-UX-10 | mineur | **Vocabulaire à l'écran = mots des trames CIP** : « Diagnostic d'accueil », « Bilan de suivi n° N », « Renouvellement », « Bilan de sortie », « Suivi post-sortie », « toile d'araignée » (au moins en sous-titre du radar), « Mes salariés » plutôt que « cohorte » dans l'espace CIP. Bannir à l'écran : « jalon » technique isolé (préférer « échéances du parcours »), « milestone », « resync » (« Mettre à jour les échéances »), identifiants EXG/PROP, « criticité » confirmé (déjà D6). | 05 §3 (tous composants), revue des libellés en recette |
| REC-UX-11 | mineur | Radar 9 axes : lisible **si limité à 2-3 séries max** (diagnostic initial + dernier bilan + avant-dernier, sélecteur pour le reste), libellés courts d'un mot, et **tableau des deltas en regard** (frein / niveau actuel / évolution ↗↘=) — le tableau est la vue de travail, le radar la vue de dialogue. | 05 §3.1 `RadarFreins` |
| REC-UX-12 | mineur | Double page assumée et outillée : l'onglet « Parcours insertion » de `/employees` est **en lecture** (consultation RH/direction, masquage D11) avec un bouton unique « Ouvrir dans l'espace CIP » ; aucune saisie de bilan depuis `/employees` (un seul chemin d'édition). | 04 Lot 5/D11 ; 05 §3.2 `Employees.jsx` |
| REC-UX-13 | mineur | États vides guidants : fiche sans diagnostic → carte unique « Commencer le diagnostic d'accueil (à faire avant le JJ/MM) » ; frise d'un nouvel entrant → échéances futures en « fantôme » ; objectifs vides → « Les objectifs exprimés par le salarié en rubrique IX apparaîtront ici » ; tableau d'actions vide → bouton + Action. | 05 §3.1/3.2 (spécification des empty states) |
| REC-UX-14 | MAJEUR | Export 23 colonnes : **indicateur de complétude avant génération** (« 39/46 fiches complètes — voir la liste ») avec lien vers chaque fiche incomplète (et la rubrique manquante), **filtres** (année, présents/sortis dans l'année, par CIP référent), rappel visuel de la variante choisie (avec/sans colonnes sensibles). | 04 Lot 6 ; 05 §2.2 (paramètres d'export), §3.2 (écran d'export) |
| REC-UX-15 | mineur | Bilan de prolongation Pass IAE accessible à **1 clic** depuis la fiche (badge Pass) ET depuis la liste « Pass à préparer » du tableau de bord — pas seulement depuis une zone d'exports. | 04 Lot 4 ; 05 §3.2/3.3 |
| REC-UX-16 | mineur | Objectifs : arborescence **limitée à 2 niveaux**, sous-objectifs optionnels (ajout inline « + sous-objectif »), jamais de sous-objectif exigé ; l'écran de bilan reprend les objectifs à plat avec indentation simple. | 04 Lot 3 ; 05 §1.3/`ObjectifsPanel` |
| REC-UX-17 | mineur | **« Mode relecture » (co-construction)** sur diagnostic et bilan : bascule qui agrandit la typographie, affiche uniquement les champs partagés avec le salarié (masque points de vigilance et notes internes), pour relire ensemble à l'écran avant validation. | 05 §3.1 `EntretienForm`/`DiagnosticForm` (toggle d'affichage) |
| REC-UX-18 | mineur | **Rythme de suivi par salarié** (mensuel / bimestriel / trimestriel, réglé sur la fiche, défaut en settings) alimentant la date proposée du prochain entretien à la clôture ; échéances d'actions par défaut paramétrables. | 04 Lots 1/3 ; 05 §1 (colonne `suivi_frequence_mois` ou setting), settings `insertion.*` |
| REC-UX-19 | mineur | Saisie des freins : remplacer les **sliders** par une rangée de **6 boutons** (Non évalué / 1 / 2 / 3 / 4 / 5) — non-ambigu (fin du curseur qui affiche 3 par défaut), plus rapide, compatible tactile ; la suggestion pré-calculée s'affiche en surbrillance sur le bouton proposé, la CIP confirme ou corrige d'un clic. | 05 §3.1 `DiagnosticForm`/`EntretienForm` (composant `FreinInput` partagé) |

---

## 4. Points validés tels quels (à ne pas casser)

1. **Le modèle « entretiens historisés à fréquence libre »** (D1, Lot 1) : colle exactement à la pratique (« les bilans sont d'une fréquence à définir par la CIP ») ; la fin du carcan M+1/M+3/M+6/M+10 est la correction la plus attendue.
2. **L'évaluation du bilan précédent intégrée au bilan** (Lot 1) : c'est la boucle réelle du formulaire papier (« démarches réalisées/non réalisées avec raisons ») — le pré-chargement automatique est le bon choix (à condition de REC-UX-03 sur le geste de saisie).
3. **Le journal d'actions avec partenaire mobilisé et résultat** (D6, Lot 3) : reproduit la structure du classeur Excel qui fait ses preuves (item / besoin / action+date / partenaire / résultat) ; le référentiel de partenaires administrable est juste.
4. **Les pré-remplissages systématiques** : freins repris du dernier bilan (existant conservé), diagnostic pré-rempli depuis le recrutement (PROP-01), rubrique IX alimentant les objectifs « origine salarié » — c'est ce qui rendra l'outil plus rapide que le Word.
5. **Le « null honnête » sur les freins** (« non évalué » non tracé, jamais 1 par défaut) : indispensable à la sincérité de la toile d'araignée et des moyennes de cohorte.
6. **La planification obligatoire du prochain entretien à la clôture** (sauf sortie) : conforme au papier (« Date du prochain point ») et clef de voûte des rappels.
7. **D7 (validations horodatées + PDF, pas de signature qualifiée)** : proportionné au terrain ; la case « validé en présence du salarié » correspond au geste réel.
8. **D11 (pas de 3ᵉ page ; onglet dans `/employees` construit sur les mêmes composants)** : évite la divergence — à sécuriser par REC-UX-12 (lecture seule côté `/employees`).
9. **D12 (aucun objectif conventionnel en dur, état « non paramétré »)** : cohérent avec la doctrine KPI honnêtes ; l'écran doit l'afficher sans culpabiliser l'utilisatrice.
10. **La conservation de la liste chronologique verticale existante** (`TimelineView`) comme socle : elle fonctionne, elle est lisible — la frise s'y ajoute (REC-UX-05), elle ne la remplace pas.
11. **Le tableau transversal des actions avec filtres et tri par échéance** (Lot 3) : répond au CDC et au besoin réel de la CIP « qu'est-ce que je dois faire cette semaine ».
12. **Dirty-tracking et bandeaux d'erreur existants** : le réflexe « • non enregistré » et les erreurs lisibles (pattern v2.4.3) sont bons — ils passent au niveau supérieur avec l'autosave (REC-UX-01/02) mais la philosophie est la bonne.

---

## 5. Maquettes textuelles des 2 écrans critiques

### 5.1 Formulaire de bilan de suivi (`EntretienForm`, type `bilan_intermediaire`)

Ordre des étapes = ordre de la trame papier. Rail d'étapes à gauche, autosave permanent, clôture séparée.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Retour fiche   BILAN DE SUIVI N° 3 — {Prénom N.}      💾 Brouillon enr. 14:32  │
│ Date entretien [22/07/2026 ▾]   Réalisé en présence du salarié ☑                 │
│                                              [Préparation IA ✓ voir] [PDF ▾]     │
├──────────────┬───────────────────────────────────────────────────────────────────┤
│ ÉTAPES       │ ÉTAPE 2/5 — DEPUIS LE DERNIER BILAN (bilan n° 2 du 12/05/2026)    │
│ 1 Situation ✓│                                                                   │
│ 2 Dernier    │  Objectifs repris automatiquement :                               │
│   bilan    ● │  ┌─────────────────────────────────────────────────────────────┐  │
│ 3 Freins     │  │ « S'inscrire au code de la route »   échéance 30/06 (passée)│  │
│   (toile)    │  │ [ Atteint ] [ En partie ] [ Non fait ]      + commentaire ▸ │  │
│ 4 Objectifs  │  ├─────────────────────────────────────────────────────────────┤  │
│   & actions  │  │ « Rendez-vous CPAM »                 échéance 15/06 (tenue) │  │
│ 5 Clôture    │  │ [ Atteint ] [ En partie ] [ Non fait ]      + commentaire ▸ │  │
│              │  └─────────────────────────────────────────────────────────────┘  │
│ Prêt à       │  Actions CIP de la période :                                      │
│ clôturer :   │  ┌─────────────────────────────────────────────────────────────┐  │
│ ▓▓▓░ 3/4     │  │ « Contacter l'auto-école sociale »  [ Faite ] [ Non faite ] │  │
│ ✓ situation  │  │    résultat : [___________________________] partenaire : ✓  │  │
│ ✓ dernier    │  └─────────────────────────────────────────────────────────────┘  │
│   bilan      │  (échéance respectée : calculée automatiquement — rien à saisir)  │
│ ✓ freins     │                                                                   │
│ ○ prochain   │  [◄ Étape précédente]                          [Étape suivante ►] │
│   RDV        │                                                                   │
├──────────────┴───────────────────────────────────────────────────────────────────┤
│ [Enregistrer le brouillon]                          [Clôturer le bilan…]         │
└──────────────────────────────────────────────────────────────────────────────────┘

Étape 1 — Situation du jour : 4 zones de texte (administrative / sociale /
          professionnelle / nouveaux éléments) — mêmes intitulés que le Word.
Étape 3 — Freins : 9 lignes [Non évalué|1|2|3|4|5] (boutons, REC-UX-19),
          toile d'araignée en regard (série précédente en pointillé, deltas ↗↘=).
Étape 4 — Objectifs (repris non atteints + nouveaux, origine salarié/CIP,
          échéance + butoir) ; actions CIP (ajout rapide 2 champs) ; motivations.
Étape 5 — Progression ◉bonne ○moyenne ○absente | Autonomie ◉ ○ ○ (trame papier),
          points de vigilance (interne — masqué en mode relecture et PDF salarié),
          avis global, puis clôture ↓

┌── Clôturer le bilan ─────────────────────────────────────────┐
│ ✓ Situation renseignée                                       │
│ ✓ Dernier bilan : 5/5 éléments statués                       │
│ ✓ Freins : 7 évalués, 2 « non évalués » assumés ☑            │
│ ● Prochain entretien : [Bilan de suivi ▾] le [22/09/2026]    │
│   (proposé : +2 mois — rythme de suivi de ce salarié)        │
│ ☑ Relu avec le salarié (validation en présence)              │
│ [Annuler]                        [Clôturer et planifier]     │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Fiche salarié avec frise (`/insertion`, onglet « Parcours »)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ {Prénom N.} — Agent de tri — Équipe Tri 1        CIP référent : {moi ▾}          │
│ CDDI : 9/24 mois (2 contrats) · Pass IAE ✓ jusqu'au 03/2027 · Prescripteur : FT  │
│ ⚠ 2 points d'attention : Renouvellement à préparer (< 6 sem) · 1 action en retard│
│ [Préparer l'entretien du 24/07 ✨ prête] [+ Action] [Nouveau bilan] [PDF ▾]      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FRISE DU PARCOURS      Couloirs : [☑ Contrats][☑ Entretiens][☐ Objectifs][☑PMSMP]│
│         2025 ────────────────────────── 2026 ──────────────────────── (fin prév.)│
│ Contrats   ▐████ CDDI 4 mois ████▌▐█████ CDDI 6 mois █████▌░░ à renouveler ░░    │
│ Entretiens    ◆Accueil   ●B1    ●B2   (×2)▾   ◇B3 planifié      ◆Renouv.         │
│ PMSMP                          ▂▂▂ découverte                                     │
│                    ● réalisé  ◇ planifié  ◆ obligatoire  (×2)▾ = regroupés       │
│ ── clic sur un élément → panneau de détail (date, avis, lien ouvrir) ──          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [Parcours][Diagnostic][Entretiens & bilans][Objectifs & actions][Freins][IA]     │
│                                                                                  │
│ Historique (liste chronologique — vue de référence) :                            │
│  ◇ 24/07/2026  Bilan de suivi n° 3 — planifié 14 h — préparation prête [Ouvrir]  │
│  ● 12/05/2026  Bilan de suivi n° 2 — réalisé — avis positif   [Ouvrir] [PDF]     │
│  ● 10/03/2026  Renouvellement — favorable, 6 mois — validé ✓✓✓ [Ouvrir]          │
│  ● 12/01/2026  Bilan de suivi n° 1 — réalisé — avis mitigé    [Ouvrir] [PDF]     │
│  ◆ 20/10/2025  Diagnostic d'accueil — réalisé                 [Ouvrir] [PDF]     │
│  ● 01/10/2025  Embauche — CDDI 4 mois (recrutement : entretien + PCM ✓)          │
└──────────────────────────────────────────────────────────────────────────────────┘

État vide (nouvel entrant) : la frise n'affiche que le contrat + les échéances
futures en fantôme, et une carte unique « Commencer le diagnostic d'accueil —
à réaliser avant le {date d'entrée + 30 j} » remplace l'historique.
```

---

*Fin de la revue. Prochaine étape : arbitrage direction sur REC-UX-01 → 19 (les deux bloquantes conditionnent la validation des plans 04/05), puis mise à jour des plans avant la PR 1.*
