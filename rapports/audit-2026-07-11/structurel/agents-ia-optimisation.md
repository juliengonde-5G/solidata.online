# Audit des agents d'optimisation IA — SOLIDATA

**Date** : 11 juillet 2026 · **Périmètre** : moteur prédictif CAV, optimisation de tournées, IA insertion, PCM, SolidataBot · **Méthode** : lecture exhaustive du code (backend/src, ai-agent), aucune modification.

---

## Synthèse

SOLIDATA embarque cinq « moteurs IA » de nature très différente : une heuristique de remplissage des CAV avec boucle d'apprentissage, une régression linéaire maison, trois familles d'appels LLM (analyse prédictive, insertion, chatbot) et un scoring PCM déterministe. L'ingénierie défensive est remarquable (fallbacks systématiques, humain dans la boucle partout, diagnosticabilité soignée). En revanche, **la chaîne de calibration du moteur prédictif est cassée à trois endroits** (formule cœur dimensionnellement incohérente, recommandations IA d'ajustement plantant sur un `require` erroné, facteurs recalibrés jamais persistés ni relus), le module ML linéaire est de facto du code mort, et le moteur insertion **envoie des données nominatives et sensibles à l'API Anthropic sans pseudonymisation**. Note globale : **5,5/10** — une architecture prometteuse dont la promesse « IA prédictive » n'est aujourd'hui que partiellement tenue.

---

## 1. Moteur prédictif de remplissage CAV & propositions de collecte

### Ce qu'il fait réellement

Le cœur est `predictFillRate()` (`backend/src/routes/tours/predictions.js`) : accumulation estimée = `joursDepuisCollecte × (poidsMoyen/7) / nb_conteneurs × 100`, multipliée par des facteurs saisonniers (12 mois, codés en dur `[0.88 … 0.75]`), jour de semaine (7 valeurs), jours fériés (+10 %), vacances scolaires (0,90 pendant / 1,05 avant-après), tendance 30 j vs 90 j, densité (≥3 conteneurs : ×1,1), météo Open-Meteo (`tours/context.js`, 0,90–1,08), beau temps le week-end (×1,15) et événements locaux (×1,2). Trois **corrections apprises** issues de `collection_learning_feedback` (par CAV pondérée par récence, par mois, par zone géographique) sont combinées 60/25/15 et bornées. Une **confiance bayésienne** (données, feedback, cohérence, fraîcheur) est calculée honnêtement. La sélection de tournée (`tours/smart-tour.js`) score chaque CAV (paliers de remplissage + 1,5×jours + 3×conteneurs, le tout × confiance), remplit le véhicule à 95 %, puis ordonne via OSRM Trip avec fallback TSP plus-proche-voisin + 2-opt (`tours/geo.js`).

### Constats critiques

**(a) Formule cœur dimensionnellement incohérente — saturation quasi certaine.** `rawFill = jours × kg/jour / nb_conteneurs × 100` traite des **kilogrammes comme un pourcentage** : avec le défaut de 50 kg par collecte hebdomadaire, on obtient ~5 000 « % » avant facteurs, écrêtés à 120. Les corrections apprises étant bornées (combinaison ≥ ~0,6), elles **ne peuvent mathématiquement pas** ramener la valeur sous le plafond : la prédiction sature à 100-120 % pour tout CAV ayant un historique normal. La preuve interne existe : l'endpoint `/api/cav/fill-rate` (`backend/src/routes/cav.js` l.158-164) applique, lui, la normalisation correcte par capacité (`nb_conteneurs × 150 kg`), mais le moteur de tournées ne l'a jamais reçue. Conséquence : le classement des CAV retombe sur « jours depuis collecte + taille du site », heuristique raisonnable mais qui vide de sens les MAE affichées (`tours/stats.js` `/predictive/accuracy` : à vérifier via `avg_predicted` vs `avg_observed`) et l'affichage « remplissage estimé 120 % » aux managers. `predictAssociationFillRate` a le même défaut, sans même la division par conteneurs.

**(b) Boucle de calibration cassée de bout en bout.** (1) `recommanderAjustements()` (`services/predictive-ai.js` l.258) fait `require('./tours/predictions')` — chemin inexistant (`services/tours/` n'existe pas, le bon chemin est `../routes/tours/predictions`) : l'endpoint `/api/tours/predictive/ia/ajustements` et le bouton « Appliquer » d'AdminPredictive **échouent en 500 depuis leur écriture**. (2) Les facteurs sont des variables de module mutées par `PUT /predictive-config` (`tours/crud.js`) **sans aucune persistance** : chaque redéploiement (`deploy.sh update` = restart) réinitialise silencieusement toute calibration aux valeurs codées en dur. (3) `recalcSeasonalFactors()` (V1.8.4, planifié le 1ᵉʳ du mois) calcule de vrais facteurs depuis `tonnage_history` et les écrit dans `predictive_seasonal_factors`… **qu'aucun code de prédiction ne lit** (seul `events-auto.js` affiche la date du dernier calcul). L'apprentissage macro affiché est donc décoratif ; seules les micro-corrections par CAV fonctionnent réellement.

**(c) Le modèle ML linéaire est du code mort.** `services/ml-model.js` est une implémentation propre (descente de gradient, z-score, R², sérialisation), mais `routes/ml.js` : (1) entraîne sur une **cible en kg/conteneur** puis `predict()` écrête à 0-100 comme un pourcentage — même confusion d'unités ; (2) sérialise le modèle complet dans `ml_model_metadata.model_path`, colonne `VARCHAR(500)` (`scripts/init-db.js` l.1017) alors que le JSON dépasse ~800 caractères → `POST /api/ml/train` échoue vraisemblablement en insertion ; (3) `ml_fill_predictions` n'est **consommée par aucun autre module** — le moteur de tournées utilise exclusivement l'heuristique. La « confiance » renvoyée est le R² d'entraînement (non validé hors échantillon).

**(d) Feedback et données d'entrée.** Le feedback est réel : `tours/execution.js` enregistre prédit vs observé (échelle chauffeur 0-5, déclaratif) à la clôture, et `services/liveobjects-processor.js` insère la **vérité terrain capteur** (source `sensor`, 0-100) — excellente initiative, avec purge à 12 mois (`admin-db.js`). Faiblesses : l'observé 0-5 × 20 est grossier ; le cold start est doublement pénalisé (fill 50 × confiance 0,2 → un CAV jamais collecté est durablement dé-priorisé, risque de famine hors circuits standards) ; la découverte automatique d'événements (`services/event-discovery.js`) scrape vide-greniers.org/brocabrac par regex HTML fragiles, filtre par simple présence du numéro de département dans le libellé et, **faute de coordonnées, géolocalise l'événement sur le CAV lui-même**, garantissant un bonus ×1,2 possiblement fictif. Enfin `routes/cav.js` contient **deux heuristiques supplémentaires divergentes** (facteurs saisonniers `[0.8…]` différents de `predictions.js`) : trois vérités concurrentes du « remplissage » selon l'écran.

**(e) Analyses LLM prédictives** (`services/predictive-ai.js`) : prompts sérieux (statistiques compactées, consignes d'ajustement bornées ±0,15, priorité aux capteurs), parsing JSON tolérant. Mais le modèle par défaut est `claude-sonnet-4-20250514` (déprécié — incohérent avec `insertion-ai.js` qui défaut à `claude-sonnet-5`), et aucun timeout explicite n'est posé sur les appels SDK.

### Fiabilité & valeur

OSRM : serveur **démo public** (`router.project-osrm.org`, politique d'usage restrictive) avec timeout 4 s et fallback haversine ×1,3 — dégradation gracieuse exemplaire, mais la génération d'une proposition fait ~2 appels OSRM **par CAV sélectionné** plus `predictFillRate` (4-6 requêtes SQL + météo) pour **tous** les CAV actifs (~209) ; `proposals/daily` répète cela jusqu'à 5 véhicules, séquentiellement. Le dispatch automatique J-1 (`services/dispatch-optimizer.js`) crée de vraies tournées brouillon validées le matin — bonne intégration métier — mais son déclencheur (`services/scheduler.js` l.622 : `getHours()===18 && getMinutes()<30` sur un `setInterval` d'une heure **non aligné sur l'heure pleine**) ne fire **jamais** si le backend a démarré entre la minute 30 et 59 ; même défaut pour le recalcul saisonnier mensuel et le scan CSV 20 h.

---

## 2. Optimisation & routage de tournées

Points forts : contraintes métier réalistes et paramétrables (`SCORING_CONFIG` : 7 h/jour, retour au centre toutes les 2 t + 15 min de déchargement, pause déjeuner 30 min après 4 h avec déchargement mutualisé, temps par CAV **appris** depuis `cav_collection_times` dès 3 mesures) ; ré-optimisation en cours de tournée (`tours/reoptimize-service.js`) déclenchable sur incident/skip, avec seuil de gain ≥5 %, anti-doublon, **validation explicite du manager** (accept/reject, Socket.IO + push) et audit en table `tour_reoptimizations` — un vrai humain dans la boucle. Réserves : (1) `osrmRouteTotal` y utilise `fetch` **sans timeout** (contrairement à `geo.js`) — un OSRM public lent gèle la proposition ; (2) la sélection plafonne le poids total de la journée à la capacité du véhicule alors que les retours 2 t vident le camion — les deux contraintes se contredisent et sous-remplissent potentiellement la journée ; (3) la comparaison avant/après mélange parfois distance OSRM et haversine (gain % biaisé en fallback) ; (4) `planning.js` est un module d'affectation sans IA — correct et sobre. `TourService.js` (haversine null-safe, proximité GPS) est propre et testé.

---

## 3. IA insertion — décisions concernant des personnes

### Fonctionnement

`services/insertion-ai.js` expose 4 analyses Claude (profil, préparation d'entretien, cohorte, audit global), toutes **ADMIN/RH uniquement** (`routes/insertion/routes.js`, montage `authenticate + authorize` global l.210). Le prompt système cadre bien le rôle (SIAE, CDDI, 7 freins, PCM, « propose des actions concrètes ») ; les sorties sont des JSON structurés dont le CIP reste destinataire — **aucune décision automatisée**, conforme à l'esprit art. 22 RGPD. L'ingénierie d'erreur est exemplaire : requêtes secondaires dégradables (`soft()`), sonde `/ia/diagnostic` isolant clé/modèle/réseau, `handleIaError` avec hints ciblés 401/404/429, timeout front 120 s.

### Constats

**(a) Minimisation RGPD non appliquée aux prompts.** `analyseProfilComplet` et `bilanCohorte` envoient à Anthropic **prénom + nom** de chaque salarié, les scores **et détails textuels des 7 freins — dont santé** (donnée relevant potentiellement de l'art. 9), les observations CIP et le commentaire d'entretien de recrutement. La preuve que l'équipe sait faire mieux est dans le même fichier : `auditGlobalReport` exige « verbatims ANONYMISÉS… ne cite AUCUN nom » et `gatherAuditVerbatims` retire effectivement les identités. Les analyses individuelles n'ont **pas besoin** du patronyme réel (un pseudonyme suffit au LLM). À traiter : pseudonymisation, vérification du DPA/sous-traitance Anthropic, inscription au registre `rgpd_registre`, information explicite des salariés (le module RGPD existe, l'usage IA doit y figurer).

**(b) AI Act.** Un système IA qui profile des salariés, évalue un « risque de décrochage » et propose des plans d'action relève très probablement du **haut risque** (annexe III, emploi/gestion des travailleurs). Les fondations sont bonnes (supervision humaine, accès restreint, journalisation partielle via `autoLogActivity`), mais il manque : mention visible « recommandation générée par IA » dans les exports PDF, documentation des limites, et traçabilité des suites données (recommandation suivie/écartée). Les scores générés par le LLM (`score_progression` 0-100, `niveau` de risque) sont **non calibrés** — présentés chiffrés, ils créent une illusion de précision ; un encadré de prudence UI serait bienvenu.

**(c) Verbatims de cohorte nominatifs** : `bilanCohorte` demande au modèle de citer des salariés dans `alertes[].salarie` — cohérent pour l'usage CIP mais aggrave le point (a).

---

## 4. Analyse de personnalité PCM

`routes/pcm.js` est un moteur **déterministe et transparent** : 20 questions, pondérations par catégorie (perception 4, stress 4, motivation/besoin 3, situation 1,5) alignées sur la théorie Base/Phase, tie-breakers hiérarchisés avec rotation hashée anti-biais « Analyseur », options mélangées déterministiquement, minimum 18 réponses, **score de confiance et statut « indéterminé » explicites**, version FALC pour publics éloignés de l'écrit — c'est du travail soigné et honnête. Le rapport est chiffré AES avant stockage ; la soumission candidat passe par un token capacité 256 bits.

Réserves : (1) les **pondérations restent des choix d'expert non validés empiriquement**, et le PCM lui-même est une typologie commerciale sans validation scientifique robuste — acceptable comme outil de dialogue managérial, problématique si utilisé en **sélection** de candidats (le kanban recrutement l'affiche) ; recommander une charte d'usage écrite (« jamais un critère d'exclusion »). (2) `risk_alert` (inférence de risque psychosocial) et `base_type/phase_type` sont stockés **en clair** en colonnes alors que le rapport est chiffré — la donnée la plus sensible échappe au chiffrement. (3) Chiffrement `crypto-js` par passphrase (KDF EVP/MD5, non authentifié), clé retombant sur `JWT_SECRET` (couplage résiduel malgré la séparation v2.0.5). (4) Pas de durée de conservation spécifique des rapports PCM visible. (5) Consentement explicite du candidat non matérialisé dans le flux (`pcm_sessions`).

---

## 5. SolidataBot

Il existe **deux implémentations parallèles** : `ai-agent/app.py` (Flask, conteneur dédié) et `backend/src/routes/chat.js` (widget intégré) — mêmes prompts et outils dupliqués, déjà en dérive (garde RGPD formulée différemment). Les deux sont bien conçues sur le fond : connexion PostgreSQL **read-only** (`postgresql_readonly` côté Flask), requêtes paramétrées, tool-use borné (5 itérations, 512 tokens), rate-limit 20/min, nettoyage `bleach`, audit des appels d'outils, périmètre « n'invente jamais de données ».

Réserves : (1) la garde « un COLLABORATEUR ne voit que ses propres heures/planning » compare le **rôle brut du JWT** (`app.py` l.309, `chat.js` l.212) — les **rôles personnalisés** (v2.4.1) ne sont pas résolus vers leur `base_role`, donc un rôle dupliqué depuis COLLABORATEUR contourne la restriction et peut consulter les heures d'autrui ; (2) `app.py` accepte le JWT **en query-param** (`?token=`), exposable dans les logs ; (3) modèle par défaut déprécié `claude-sonnet-4-20250514` dans les deux implémentations ; (4) le prompt seul porte l'interdiction de révéler des données personnelles — la vraie barrière doit rester les outils (c'est le cas, mais tout nouvel outil devra reproduire les gardes).

---

## 6. Valeur métier réelle vs promesse

Ce qui apporte de la valeur **aujourd'hui** : la génération de tournées (contraintes réalistes, OSRM, dispatch J-1), la ré-optimisation validée par le manager, les capteurs LoRaWAN comme vérité terrain, les analyses LLM insertion (aide qualitative réelle au CIP), le PCM comme support d'entretien, le chatbot en lecture seule. Ce qui est **décoratif ou cassé** : la « prédiction de remplissage » différenciée (saturée par la formule), les recommandations IA d'ajustement (endpoint mort), le recalcul saisonnier mensuel (table non lue), le modèle ML linéaire (non branché, insertion en échec), une partie des bonus événements (géolocalisation fictive). La priorisation effective des CAV — ancienneté de collecte + taille + capteurs — reste opérationnellement sensée : la correction de la formule est donc un gain rapide, pas une refonte.

---

## 7. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P0** | S | Corriger `require('./tours/predictions')` → `../routes/tours/predictions` dans `services/predictive-ai.js` (réactive `/predictive/ia/ajustements`). |
| 2 | **P0** | M | Normaliser `predictFillRate` par capacité (aligner sur `cav.js /fill-rate` : `nb_conteneurs × 150 kg`), backtester sur `collection_learning_feedback`, vérifier `avg_predicted` vs `avg_observed`. |
| 3 | **P0** | M | Persister la config prédictive (facteurs, scoring) en base (table `settings` ou dédiée), la recharger au boot, et faire lire `predictive_seasonal_factors` par le moteur. |
| 4 | **P1** | S | Pseudonymiser les payloads IA insertion (retirer nom/prénom), formaliser DPA Anthropic, inscrire les traitements IA (insertion, PCM, chatbot) au registre RGPD + information salariés. |
| 5 | **P1** | S | Résoudre `base_role` dans les gardes du chatbot (`chat.js`, `app.py`) ; supprimer l'acceptation du JWT en query-param. |
| 6 | **P1** | M | Fiabiliser le scheduler : aligner le tick sur l'heure pleine ou supprimer les conditions `getMinutes()<30` ; ajouter un timeout à `osrmRouteTotal` ; prévoir OSRM auto-hébergé. |
| 7 | **P2** | S | Trancher le sort du module ML linéaire : réparer (cible en %, `model_path TEXT`, brancher sur les tournées) ou retirer routes + tables. |
| 8 | **P2** | M | Unifier les 3 heuristiques de remplissage et les 2 clients météo ; fusionner les deux SolidataBot ; aligner tous les défauts `CLAUDE_MODEL` sur un modèle supporté ; chiffrer ou justifier `risk_alert` PCM en clair et fixer une durée de conservation. |

---

*Rapport fondé exclusivement sur la lecture du code au 11/07/2026 ; les hypothèses dépendant des données de production (saturation effective des prédictions, échec de `POST /api/ml/train`) sont signalées comme telles et vérifiables en quelques minutes via `/api/tours/predictive/accuracy` et un essai d'entraînement.*
