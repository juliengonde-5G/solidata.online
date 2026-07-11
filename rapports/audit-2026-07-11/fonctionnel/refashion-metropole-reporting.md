# Audit fonctionnel — Module « Refashion, Métropole & reporting réglementaire »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{refashion,metropole,communes,historique,reporting,exports}.js` ; pages `Refashion`, `AdminRefashionExports`, `AdminRefashionConfig`, `AdminCommunes`, `Reporting`, `ReportingCollecte`, `ReportingProduction`, `ReportingRH`, `ReportingMetropole`
**Méthode** : lecture intégrale du code (routes, `init-db.js`, pages React, `App.jsx`, `Layout.jsx`), vérification croisée des contrats de données front/back, recherches web ciblées pour le benchmark

---

## 1. Résumé exécutif

Le module dispose d'un **back-end riche** (~44 endpoints sur 6 fichiers) et d'un **modèle de données fin**, aligné sur la nomenclature réelle de Refashion (5 familles officielles, taux de subvention versionné). Le volet « Reporting Métropole » est le plus abouti et a nettement progressé depuis les audits internes de mai 2026 (référentiel INSEE, taux de sortie dynamique, mix CO2 observé — tous livrés). En revanche, le volet « Refashion » proprement dit souffre d'un écart récurrent entre un back-end capable et un front-end qui n'exploite qu'une fraction de cette capacité : **aucune page ne permet de saisir une déclaration DPAV, une commune ou une subvention** ; l'export CSV de conformité est **cassé silencieusement** ; et plusieurs capacités déjà codées (auto-sourcing DPAV, export FSE+ pour la DREETS, historique pluriannuel) sont **invisibles pour l'utilisateur final**. Ces constats sont fondés sur le code et vérifiés (absence de tout appel `POST`/`PUT` correspondant côté front, tests de correspondance des clés de réponse).

---

## 2. Couverture fonctionnelle réelle

**Ce qui fonctionne et est utilisable aujourd'hui :**
- `backend/src/routes/metropole.js` : tableau de bord mensuel complet (tonnage, CO2 évité avec mix « observé » recalculé depuis les colisages scellés et repli sur un mix moyen documenté, effectifs, CAV actifs), carte des CAV avec détail par point (historique 12 mois, remplissage, scans QR), et trois KPI ajoutés récemment — taux de sortie dynamique, taux de service CAV, captation par commune kg/hab — exposés et consommés par `ReportingMetropole.jsx`.
- `backend/src/routes/communes.js` : référentiel INSEE (`referentiel_communes`) synchronisable en un clic depuis `geo.api.gouv.fr` (`AdminCommunes.jsx`), avec deux voies de repli (ajout unitaire, import JSON en masse).
- `backend/src/routes/refashion.js` : configuration versionnée du taux de subvention (`refashion_taux_subvention`), avec historique et clôture automatique de l'ancien taux à l'ajout d'un avenant (`AdminRefashionConfig.jsx`) — seul écran d'écriture réellement opérationnel du module.
- 3 des 5 vues SQL « Dashboard 2026 » exposées par `GET /refashion/exports/:slug` (`vw_tonnage_annuel_tournee`, `vw_dpav_communes`, `vw_subvention_refashion_mensuelle`) reposent sur des tables réellement alimentées en exploitation (`tours`, `production_daily`) et produisent des données exploitables.

**Ce qui existe côté API mais n'est jamais atteint par une page** (vérifié par recherche exhaustive des appels `api.get/post` dans `frontend/src`) :
- `POST /refashion/dpav`, `POST /refashion/communes`, `POST /refashion/subventions` : aucun formulaire nulle part. `Refashion.jsx` ne fait que des `GET`.
- `GET /refashion/dpav-source` et `GET /refashion/reconciliation-jour` — le mécanisme « V2 — Auto-sourcing DPAV depuis l'ERP » documenté en commentaire dans `refashion.js` (lignes 390-429), censé pré-remplir la déclaration depuis les données réelles de collecte/tri avec classification de sévérité des écarts (`ok/attention/critique`) — n'a **aucun consommateur front**.
- `backend/src/routes/historique.js` : les 4 endpoints (tonnages, résumé annuel, produits, KPI pluriannuel) ne sont appelés par **aucune** page.
- `GET /reporting/cav-map` : jamais appelé (les cartes CAV utilisées ailleurs passent par d'autres routes).
- `backend/src/routes/exports.js` : sur 9 endpoints, seuls `/invoice/:id` (Billing) et `/insertion` (InsertionParcours) sont réellement déclenchés depuis l'UI. `/collecte`, `/production`, `/cav`, `/tonnages`, `/kpi-production`, `/stock` et surtout **`/fse-plus`** (export trimestriel obligatoire pour le cofinanceur FSE+/DREETS, avec en-tête réglementaire et pied de page « cofinancé par l'Union européenne ») sont **inaccessibles sans appel API manuel**.
- La page `frontend/src/pages/Reporting.jsx` existe dans le dépôt mais n'est **plus routée** (`App.jsx` redirige `/reporting` vers `/reporting-collecte`) : c'est du code mort, avec de surcroît un contrat de données obsolète (`dashboard.collecte_tonnage`, `dashboard.tours_by_status`… ne correspondent à aucun champ renvoyé par `GET /reporting/dashboard`, dont la forme réelle est `{collecte:{...}, tours:{...}, cav:{...}}`).

En synthèse : le module **couvre bien le pilotage Métropole** (lecture) et **la configuration d'un paramètre** (taux Refashion), mais ne couvre **pas le cycle de vie complet d'une déclaration Refashion** (saisie → validation → verrouillage), qui reste hors de l'ERP.

---

## 3. Adéquation aux besoins des parties prenantes

- **QHSE** : la page `/admin/refashion-exports` promet un tableau de bord permanent, mais sans UI de saisie DPAV ni CSV fiable (cf. §5), le QHSE doit continuer à préparer les déclarations trimestrielles hors outil (tableur), ce que l'ERP prétend pourtant résoudre.
- **Direction** : `ReportingMetropole.jsx` offre une vision consolidée pertinente (environnement + social sur un même écran, benchmarké à l'objectif Refashion 3,6 kg/hab/an). En revanche l'indicateur « Subvention Refashion » du tableau de bord d'accueil (`backend/src/routes/dashboard.js`, hors périmètre strict mais alimenté par la même table `refashion_subventions`) reste à 0 € par construction puisque rien ne peuple cette table via l'UI — un chiffre visible par la direction mais structurellement faux.
- **Auditeurs Refashion** : aucun accès dédié ; le rôle `AUTORITE` (créé pour les tiers externes) ne voit ni `/refashion` ni les pages d'export/config (réservées à ADMIN/MANAGER dans `Layout.jsx`). Le mapping des 17 catégories de tri vers les 5 familles officielles Refashion (`categories_sortantes.famille_refashion`, `init-db.js`) est en revanche fin et correctement structuré si un jour exposé.
- **Métropole de Rouen** : c'est le mieux servi. Carte CAV, historique 12 mois, taux de captation vs objectif, taux de service CAV — un ensemble cohérent et bien pensé pour une revue annuelle de convention.
- **DREETS** : le KPI de sortie dynamique est exposé sur `/reporting-metropole` ; l'export FSE+ (nominal, formaté DGEFP) existe et est bien conçu (BOM UTF-8, en-tête métadonnées, requête résiliente) mais reste, comme noté ci-dessus, invisible dans l'interface.
- **Usage terrain / numérique limité** : peu concerné directement (public visé = bureau), mais l'aperçu JSON brut « clé=valeur » de `AdminRefashionExports.jsx` reste un rendu technique pour un profil non-développeur.

---

## 4. Benchmark marché

Une vérification web confirme que le soutien réel de Refashion aux opérateurs de tri est un **taux unique €/tonne triée**, très volatil ces deux dernières années (125 € en 2023 → 156 € → 223 € → 228 € → **268 €/t en 2026**, revalorisé plusieurs fois face à la crise du secteur). Cela **valide a posteriori** le choix d'architecture de `refashion_taux_subvention` (taux versionné par convention/avenant, clôture automatique) — un design pertinent face à un paramètre qui change en moyenne deux fois par an. À l'inverse, cela **invalide** implicitement l'ancien mécanisme `refashion_subventions` (5 taux fixes par famille : 80/295/210/20/193 €/t) : ce n'est pas ainsi que Refashion rémunère réellement, et ces valeurs sont de toute façon obsolètes face aux ~268 €/t actuels.

Face aux outils BI généralistes (Metabase, Power BI), le module se positionne correctement comme outil **opérateur** (déclaratif + pilotage interne) plutôt que comme outil macro à la ADEME/Sinoe ou au tableau de bord national filière TLC (qui consolident les déclarations de tous les opérateurs à l'échelle pays). Les 5 vues SQL dédiées (`vw_tonnage_annuel_tournee`, etc.) constituent un embryon correct de « data mart », mais sans les fonctions attendues d'un vrai outil BI : pas de constructeur de requêtes ad hoc, pas de pivot/drill-down depuis un KPI vers le détail, pas de programmation d'envoi de rapport, pas d'alerting sur écart. Il manque également un **livrable « prêt à soumettre »** (PDF/Excel au format officiel Refashion) — le module ne produit que du CSV brut de vues internes.

---

## 5. Constats critiques

| # | Constat | Fichier(s) | Priorité |
|---|---|---|---|
| 1 | Aucune UI de saisie/validation du DPAV, des communes ou des subventions Refashion malgré une API d'écriture complète | `refashion.js`, `Refashion.jsx` | **P0** |
| 2 | Export CSV « Dashboard 2026 » cassé silencieusement : `AdminRefashionExports.jsx` lit `localStorage.getItem('token')`, une clé qui n'existe pas (`AuthContext.jsx`/`api.js` stockent `accessToken`) → l'en-tête devient `Bearer null`, le back renvoie 401, et le code télécharge quand même le corps JSON d'erreur en le renommant `.csv`, sans aucun `.catch` | `AdminRefashionExports.jsx:38-50` | **P0** |
| 3 | Le KPI « Subvention Refashion » du tableau de bord d'accueil (`dashboard.js`) lit `refashion_subventions`, une table que rien dans l'UI ne permet de peupler → un chiffre affiché à la direction, structurellement figé/faux | `refashion.js`, `dashboard.js` | **P0** |
| 4 | 2 des 5 exports « Dashboard 2026 » (`vw_dpav_sortants`, `vw_coherence_tri_filiere`) sont structurellement vides car adossés au workflow `colisages`, non adopté en exploitation — connu et documenté en interne depuis le 03/07/2026 mais toujours non résolu, sans bandeau d'avertissement à l'écran | `init-db.js:1688-1711`, `AdminRefashionExports.jsx` | **P1** |
| 5 | Capacités back-end non exposées : auto-sourcing DPAV (`dpav-source`, `reconciliation-jour`), `historique.js` (4 endpoints), export FSE+ pour la DREETS — zéro appel front recensé | `refashion.js`, `historique.js`, `exports.js` | **P1** |
| 6 | Le smoke test de déploiement (bloquant selon `CLAUDE.md`) vérifie `/api/reporting/production`, `/api/reporting/rh`, `/api/reporting/metropole`, trois routes qui n'existent pas dans `reporting.js` — le filet de sécurité de ce module ne teste pas ce qu'il prétend tester | `scripts/tests/api-smoke.js:191-194` | **P1** |

Autres observations : les cartes DPAV de `Refashion.jsx` affichent des taux (80/295/210/20/193 €/t) codés en dur dans le JSX, sans lien avec le calcul réel (`tri_t × taux unique paramétrable`) — source de confusion pour un lecteur qui croirait à un calcul par famille. Les champs `dpav.total_t` et `dpav.details`, lus par `Refashion.jsx`, ne sont jamais renvoyés par `GET /refashion/dpav` : le total tonnage affiché reste à 0,0 t et le tableau de détail ne s'affiche jamais. Enfin, deux référentiels « communes » coexistent (`refashion_communes`, déclaratif manuel jamais actionnable, et `referentiel_communes`, auto-synchronisé et utilisé par les vues récentes) — une dette à consolider.

---

## 6. Forces

- Mapping fin des 17 catégories de tri vers les 5 familles officielles Refashion, correctement ordonné (`init-db.js`).
- Taux de subvention versionné avec audit-trail complet — architecture confirmée pertinente par le benchmark (taux réel très volatil).
- Référentiel communes INSEE auto-synchronisable par 3 voies (API, saisie unitaire, import en masse) ; a permis de corriger un vrai bug de calcul cartésien sur `vw_dpav_communes`.
- Dashboard Métropole riche et cohérent : kg/hab/an vs objectif Refashion, sorties dynamiques, service CAV, CO2 à mix observé avec repli documenté.
- Code auto-documenté : les limites connues (colisages non adoptés, vues vides) sont commentées, datées, et renvoient vers des rapports de suivi internes.
- Progrès net et vérifiable depuis les audits internes de mai 2026 (référentiel INSEE, KPI sortie dynamique, mix CO2 observé : tous livrés depuis).

## 7. Faiblesses, manques et irritants UX

- Aucun formulaire de saisie DPAV/communes/subventions malgré une API d'écriture complète.
- Auto-sourcing DPAV jamais branché à une page, alors que la logique de sévérité des écarts est déjà prête.
- Export CSV de conformité cassé (bug de clé de token), sans retour d'erreur pour l'utilisateur.
- 2 exports sur 5 vides en permanence, sans message explicatif contextuel.
- `historique.js` et l'export FSE+ (DREETS) jamais consommés côté front.
- Page `Reporting.jsx` orpheline, contrat de données obsolète (dead code à risque si un jour recâblée).
- Taux de subvention par famille affichés en dur dans l'UI, déconnectés du calcul réel et obsolètes.
- Doublon de référentiel « communes » (table manuelle vs table auto-synchronisée).
- Pas de verrouillage du DPAV après déclaration (contrairement au module Stock qui a un verrouillage trimestriel Refashion) — un trimestre déjà soumis reste modifiable indéfiniment.
- Aperçu JSON « clé=valeur » peu lisible pour un profil non-développeur sur `AdminRefashionExports.jsx`.

---

## 8. Recommandations priorisées

| Priorité | Recommandation | Effort |
|---|---|---|
| P0 | Corriger le bug de token du téléchargement CSV (`AdminRefashionExports.jsx`) — réutiliser l'instance axios existante avec `responseType: 'blob'` | S |
| P0 | Construire un formulaire de saisie/validation du DPAV trimestriel, idéalement branché sur `dpav-source` (pré-remplissage → vérification → validation) | M |
| P0 | Masquer ou reconnecter le KPI « Subvention Refashion » du tableau de bord d'accueil tant que sa source n'est pas alimentée par un flux réel | S |
| P1 | Ajouter un bandeau explicite sur les 2 exports vides (« nécessite l'adoption du workflow de colisage ») et trancher leur avenir (adopter colisages ou repointer sur `produits_finis`) | M |
| P1 | Corriger les 3 chemins erronés du smoke test (`/api/reporting/production\|rh\|metropole` → routes réelles) | S |
| P1 | Retirer la page `Reporting.jsx` orpheline ; supprimer ou brancher les routes de `historique.js` et l'export FSE+ | S |
| P2 | Remplacer les taux DPAV codés en dur par la valeur réellement utilisée dans le calcul, ou les retirer | S |
| P2 | Consolider les deux référentiels « communes » en un seul | M |
| P2 | Ajouter un export « prêt à soumettre » (PDF/Excel au format officiel Refashion) | M |
| P2 | Revoir l'accès du rôle `AUTORITE` au module si la vocation est de le partager avec des tiers externes | S |

---

## 9. Conclusion

Le module a une base de données et une logique métier solides, et le volet Métropole a réellement progressé. Le point de blocage n'est pas la conception mais le **câblage** : une part significative et récurrente du travail déjà fait côté back-end (saisie DPAV, auto-sourcing, historique, FSE+) n'atteint jamais l'utilisateur final, et le seul point d'écriture qui fonctionne (export CSV) est cassé par un bug ponctuel et facile à corriger. Combler ces câblages — plus que réécrire quoi que ce soit — rapprocherait rapidement ce module du niveau attendu pour un audit Refashion ou une revue de convention Métropole formelle.
