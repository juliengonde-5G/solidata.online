# AUDIT COMPLET SOLIDATA — Synthèse exécutive

**Date** : 11 juillet 2026
**Périmètre** : l'intégralité de l'application (backend, web, mobile, agent IA, base de données, déploiement), version `main` au commit `92af267`.
**Nature** : diagnostic uniquement — aucun code modifié. Le plan d'action associé est dans [`01-plan-action.md`](01-plan-action.md).

---

## 1. Méthode

L'audit a été conduit par **43 agents d'analyse spécialisés**, orchestrés en 4 volets, chacun fondé sur la lecture du code réel (pas seulement de la documentation) :

| Volet | Agents | Modèle | Contenu |
|---|---|---|---|
| **Fonctionnel** | 14 | Sonnet | Couverture réelle, adéquation aux besoins métier SIAE, benchmark marché |
| **Technique** | 14 | Opus | Qualité de code, dette, sécurité, robustesse, testabilité |
| **Structurel** | 4 + 1 | Opus / Fable | Traçage bout-en-bout de 4 flux (matière, personne, euro, temps réel) + audit dédié des moteurs d'optimisation IA |
| **Personas** | 10 | Sonnet | Promesse attendue, parcours d'opérations vérifié dans le code, remontées |

Chaque agent a produit un rapport détaillé (46 fichiers dans ce dossier) et une remontée structurée (score, constats P0/P1/P2, recommandations avec effort S/M/L). La présente synthèse et le plan d'action consolident et dédupliquent ces remontées.

**Limite de méthode** : audit statique du code. Les constats « cassé / vide / faux » sont vérifiés dans le code (contrat front/back, colonnes inexistantes, routes absentes), mais n'ont pas été rejoués sur l'environnement de production.

---

## 2. Verdict global

> **Note d'ensemble : ≈ 5,9 / 10** — fonctionnel 6,1 · technique 6,4 · structurel 5,4 · personas 5,5.

SOLIDATA est un ERP **remarquablement ambitieux et largement au-dessus de ce qu'on trouve habituellement dans une structure de cette taille** : 27 modules, un moteur PCM accessible (FALC, audio), une PWA chauffeur offline-first avec authentification « 1 URL = 1 véhicule », des capteurs LoRaWAN avec diagnostic 4 couches, une intégration Pennylane pull propre, une ingestion SumUp idempotente, un vrai P&L analytique. Plusieurs briques sont au niveau — ou au-delà — des solutions du marché pour le secteur.

Le problème dominant n'est **pas le manque de fonctionnalités : c'est la rupture des chaînes**. L'application a été construite vite, par vagues, avec un backend souvent en avance sur le frontend ; il en résulte trois pathologies systémiques :

1. **Du backend riche jamais câblé à l'écran** — des pans entiers de valeur codés côté serveur sont invisibles pour l'utilisateur : exécutions d'opérations de tri, colisage/scellement, saisie DPAV, prescripteurs, export FSE+, dashboard exécutif orphelin du menu, rattachement CAV↔commune, clôture d'incidents.
2. **Des contrats front/back désalignés qui échouent en silence** — une douzaine d'écrans affichent des données structurellement vides ou fausses sans aucun message d'erreur (FinanceOperations, trésorerie par catégorie, KPI commandes exutoires, mix paiement VAK, subvention Refashion du dashboard, exports DPAV, sortie dynamique Métropole…). Les `catch` muets et l'absence de tests de contrat rendent ces ruptures invisibles ; le smoke test de déploiement, censé les attraper, teste lui-même des routes inexistantes.
3. **Des données de pilotage faussées à la source** — heures RH « congé/maladie » silencieusement écrasées en « normal » (absentéisme et formation faux), volumes R3/R4 codés en dur à zéro, objectifs boutiques HT comparés à du réalisé TTC, tonnage par commune surcompté par une jointure sans clé, inventaires validés sans écriture de régularisation, clôture de tournée non idempotente (double-clic = double stock).

La conséquence la plus grave est **externe** : l'auditeur Refashion — persona le plus critique — juge la promesse **rompue (2/10)** : le rôle AUTORITE n'a accès à rien du module Refashion, et les deux vues conçues pour prouver la cohérence tri↔filière sont vides en production car la table `colisages` n'est jamais alimentée. En l'état, un audit externe de l'éco-organisme se préparerait au tableur, hors outil.

À l'inverse, le socle est sain : SQL systématiquement paramétré, middleware d'auth homogène, state machine centralisée bien conçue, jobs avec verrou distribué, health checks, chiffrement des secrets. **La dette est concentrée et réparable** : l'essentiel du plan d'action consiste à recâbler, réconcilier et tester l'existant, pas à reconstruire.

---

## 3. Notes par module

| Module | Fonctionnel | Technique | Lecture rapide |
|---|:---:|:---:|---|
| Plateforme transverse | 7 | 6,5 | Socle solide (health, scheduler, push) ; dashboard exécutif orphelin, chatbot dupliqué |
| Tournées, véhicules & mobile | 7 | 6,5 | Meilleur module métier ; idempotence clôture et doubles voies public/authentifié à corriger |
| Recrutement & PCM | 6,5 | 6,5 | Moteur PCM exemplaire ; filtres PCM cassés, RGPD auto incomplet |
| Insertion | 6,5 | 6,5 | Très bon fond métier ; parcours jamais clôturé, prescripteurs non câblés |
| VAK & SumUp | 6,5 | 6,5 | Intégration propre ; mix paiement faux à l'écran, remboursements ignorés |
| Boutiques | 6,5 | 6 | KPI riches ; **HT vs TTC faux en permanence**, pas de cloisonnement par boutique |
| Auth, sécurité & admin | 6,5 | 7 | Base saine ; admin/admin123, révocation de session ineffective |
| Tri & production | 6 | 6,5 | Traçabilité par lot transactionnelle ; exécutions et colisage sans UI, R3/R4 à zéro |
| Finance & facturation | 6 | 6,5 | P&L/bilan/contrôles aboutis ; 4 écrans cassés par contrats front/back |
| Stock & inventaires | 5,5 | 6,5 | Bon ledger ; inventaire sans régularisation, endpoints publics balance |
| Logistique exutoires | 5,5 | 6 | Workflow réel ; KPI kanban vides, tarifs bloqués sur anciennes gammes |
| Refashion, Métropole & reporting | 5,5 | 6 | Dashboard Métropole riche ; **DPAV en lecture seule, 2 exports d'audit vides** |
| RH & personnel | 5,5 | 5,5 | Import Malibou robuste ; **types d'heures corrompus, PII exposée via /teams** |
| Collecte, CAV & capteurs | 5,5 | 6,5 | Capteurs excellents ; prédictif à 3 jeux de facteurs divergents, `estimated_fill_rate` toujours 0 |

**Flux structurels** : matière 5/10 · personne/insertion 4,5/10 · financier 5,5/10 · temps réel & jobs 6,5/10 · **agents IA 5,5/10**.

---

## 4. Verdict des 10 personas

| Persona | Verdict | Note | Point saillant |
|---|---|:---:|---|
| CIP | Partielle | 7 | Parcours réellement câblé de bout en bout ; export FSE+ inaccessible depuis l'UI |
| Chauffeur-collecteur | Partielle | 6,5 | Excellente ergonomie terrain offline ; pas de photo d'incident, pas de « sauter ce CAV » |
| Responsable logistique | Partielle | 6,5 | Planification et suivi live très bons ; **incidents jamais clôturables** |
| Directeur des opérations | Partielle | 6,5 | Dashboards riches ; l'écran exécutif est introuvable depuis le menu |
| Manager de chaîne de tri | Partielle | 5,5 | Étiquetage/scan très bons ; **cœur du tri (exécutions, colisage) sans interface** |
| Manager financier | Partielle | 5,5 | Contrôle facturation abouti ; FinanceOperations et Contrôles inutilisables, pas d'export CA |
| Auditeur Métropole | Partielle | 5,5 | KPI pensés pour lui ; captation/commune surcomptée et CAV non rattachés aux communes |
| Chargé RH | Partielle | 5 | Fiche salarié riche ; **l'import paie mensuel exige le rôle ADMIN**, KPI RH non fiables |
| Responsable QHSE | Partielle | 4,5 | Matière première présente (incidents, checklists) ; aucun cycle de traitement, aucun module AT/EPI/habilitations |
| **Auditeur Refashion** | **Rompue** | **2** | **Aucun accès AUTORITE au module Refashion ; preuves de cohérence tri↔filière vides en production** |

---

## 5. Les 7 constats transverses majeurs

### T1 — La traçabilité matière s'interrompt au milieu de la chaîne (risque Refashion) 🔴
Collecte → stock → tri : solide et automatique (FK `tour_id`, exécutions transactionnelles avec conservation de masse). Mais ensuite : le **colisage n'a aucune UI** (0 référence frontend), donc `vw_dpav_sortants` et `vw_coherence_tri_filiere` sont **vides en production** ; la **DPAV est ressaisie à la main** alors qu'un endpoint d'auto-sourcing existe (`/refashion/dpav-source`, jamais appelé) ; la sortie carton ne décrémente pas le stock ; la triple pesée d'expédition n'est pas réconciliée. Résultat : les kilogrammes entrants ne se prouvent pas jusqu'aux sortants, précisément ce qu'un audit REP vérifie.

### T2 — Un pattern récurrent : backend riche, frontend absent 🟠
Au moins **15 capacités serveur complètes n'ont aucun point d'entrée utilisateur** : exécutions de tri, colisages, POST DPAV/communes/subventions, prescripteurs, export FSE+, `PATCH /communes/cav/:id`, dashboard exécutif (hors menu), seuils d'alerte, BoutiquesPlanning (page jamais routée), résolution d'incidents (schéma complet, aucune route d'update), notes de checklist (perdues à la réception)… C'est le gisement de valeur le plus rentable : la logique existe déjà, il manque l'écran ou l'entrée de menu.

### T3 — Contrats front/back désalignés + erreurs avalées = écrans faux en silence 🔴
Une douzaine d'écrans consomment des champs ou routes qui n'existent pas (ou plus) : FinanceOperations (structure de réponse et payload PUT), trésorerie par catégorie, boutons Actualiser/Exporter des Contrôles, bouton « Synchroniser factures » Pennylane (route supprimée le 03/05), KPI kanban exutoires, mix paiement VAK, export CSV Refashion (mauvaise clé de token), `/metropole/sortie-dynamique` (colonnes inexistantes → 500 avalé), KPI subvention du dashboard. Les erreurs sont systématiquement masquées (`catch` silencieux, `console.error`). **Le smoke test de déploiement lui-même teste 4 routes inexistantes.** Sans tests de contrat, chaque refactor backend casse des écrans sans que personne ne le voie.

### T4 — Des données de pilotage corrompues à la saisie 🔴
Heures « congé/maladie/heures sup » rabattues silencieusement sur « normal » (absentéisme sous-évalué, KPI formation structurellement à zéro) ; volumes R3/R4 envoyés en dur à 0 ; objectifs boutiques HT vs réalisé TTC (% d'atteinte faux en permanence) ; validation d'inventaire sans écriture de régularisation (le stock théorique diverge à jamais) ; clôture de tournée non idempotente (double-clic = stock et tonnage doublés) ; tonnage « captation par commune » mécaniquement gonflé (produit cartésien `tour_weights × tour_cav`). Ces chiffres alimentent la direction, la Métropole et Refashion.

### T5 — Sécurité et RGPD : bon socle, trous ciblés 🟠
Compte `admin/admin123` recréé à chaque init sans changement forcé ; le dernier ADMIN peut se désactiver lui-même ; la « déconnexion forcée » ne révoque rien (JWT valable 8 h) ; `GET /api/teams/:id` expose **salaires, RQTH, titres de séjour à tout rôle authentifié** (y compris AUTORITE) ; endpoints de balance publics sans authentification qui contournent le verrouillage trimestriel ; anonymisation RGPD incomplète sur les données les plus sensibles (santé/RQTH, diagnostics d'insertion, purge automatique candidats qui laisse entretiens et PCM) ; **données nominatives et sensibles envoyées à l'API Anthropic** sans pseudonymisation systématique.

### T6 — Les moteurs d'optimisation IA : bonne architecture, exécution défaillante 🟠
Le meilleur : dégradation gracieuse partout, humain dans la boucle (le manager valide les tournées), scoring PCM transparent et anti-biais, chatbot borné en lecture seule. Le problème : la **prédiction de remplissage additionne des kg à des %** (formule saturée, contrairement à `cav.js` qui normalise) ; l'endpoint d'ajustements IA plante en 500 (require d'un chemin inexistant) ; les calibrations vivent en mémoire et sont **perdues à chaque déploiement** ; la table de facteurs saisonniers recalculée chaque mois n'est **jamais lue par le moteur** ; 3 jeux de facteurs codés en dur divergent entre eux ; `estimated_fill_rate` vaut toujours 0 mais est présenté comme « prédit » au feedback capteur et à l'API partenaires. En l'état, une partie de l'« IA prédictive » affichée est décorative — l'écart entre promesse et réalité doit être résorbé dans un sens ou dans l'autre.

### T7 — Les parties prenantes externes et fonctions support n'ont pas leur place 🟠
Le rôle AUTORITE existe mais ne voit ni Refashion ni les KPI qui le concernent ; aucun rôle DPO (le registre RGPD exige les pleins droits ADMIN), aucun rôle Finance de consultation pour le CA, aucun rôle QHSE ; l'import de paie mensuel — geste fondateur du processus RH — est réservé à ADMIN ; RESP_BTQ voit les données de toutes les boutiques. Enfin le métier QHSE n'a pas de module : pas d'accidents du travail/presqu'accidents, pas d'EPI, pas d'habilitations avec dates d'expiration (CACES = simple booléen), pas de DUERP.

---

## 6. Forces à préserver

- **Terrain d'abord** : PWA chauffeur offline-first (file d'idempotence, backoff, mode conduite), pointage par badge, kiosques balance/scan tactiles, test PCM en FALC avec audio — l'application respecte réellement son public en insertion.
- **Traçabilité amont** : collecte → stock automatique par FK, exécution de tri transactionnelle avec conservation de masse, piste d'audit champ par champ et verrouillage trimestriel sur le stock original.
- **Intégrations propres** : Pennylane pull-only avec retry et transactions ; SumUp OAuth + webhooks HMAC + UPSERT idempotent ; capteurs à double canal (webhook signé + MQTT) dédupliqués par `fcnt`.
- **Socle technique** : SQL paramétré partout, `authenticate/authorize` homogène, state machine centralisée avec audit, scheduler à verrou distribué, health checks live/ready, CSP et durcissement uploads.
- **Pilotage métier déjà réel** : P&L analytique budget vs réalisé, audit insertion annuel avec radar des 7 freins et export PDF, dashboard Métropole (kg/hab/an vs 3,6, CO2 au mix observé), contrôle facturation avec scoring de rapprochement.

---

## 7. Risques principaux en cas d'inaction

1. **Échec d'un audit Refashion ou Métropole** : preuves de cohérence vides, DPAV non traçable de bout en bout, tonnage par commune surcompté — risque direct sur les subventions et la convention (T1, T3, T4).
2. **Décisions de direction prises sur des chiffres faux** : absentéisme, formation, % d'atteinte boutiques, rendement matière, trésorerie par catégorie (T4, T3).
3. **Incident RGPD qualifiable** : PII accessibles au-delà du besoin d'en connaître, données de santé non anonymisées, sous-traitance IA non maîtrisée — sur un public vulnérable (T5).
4. **Perte de confiance des utilisateurs internes** : chaque écran vide ou bouton mort érode l'adoption ; le QHSE et le financier retournent au tableur (T2, T7).
5. **Dette d'intégration auto-entretenue** : sans tests de contrat ni smoke test fiable, chaque évolution recasse silencieusement des écrans (T3).

---

## 8. Et maintenant

Le plan d'action détaillé ([`01-plan-action.md`](01-plan-action.md)) est organisé en **4 vagues** : sécuriser et arrêter les chiffres faux (vague 0, corrections courtes), réparer les chaînes de bout en bout (vague 1), ouvrir l'application à ses parties prenantes (vague 2), consolider le socle — tests, transactions, monitoring, RGPD (vague 3). Il commence par **5 arbitrages métier** qui conditionnent le codage — au premier rang desquels : *adopter le colisage dans l'atelier, ou simplifier la traçabilité sur `produits_finis`*.

**Aucune ligne de code applicatif n'a été modifiée durant cet audit**, conformément à la commande. Les 46 rapports détaillés de ce dossier constituent le référentiel des constats ; chaque affirmation y est référencée au fichier de code près.
