# Audit fonctionnel — Module Stock & Inventaires (moderne + original Refashion)

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/stock.js`, `backend/src/routes/stock-original.js` ; pages `Stock`, `AdminStockOriginal`, `InventaireOriginal`, `SortieCartons`
**Utilisateurs visés** : Managers, QHSE, auditeurs Refashion

---

## 1. Couverture fonctionnelle réelle

Le module recouvre en réalité **deux ledgers distincts** qui portent tous deux le nom « stock » mais représentent des stades différents du flux matière :

- **`stock.js` / `Stock.jsx`** — stock « moderne », classé par `categories_sortantes` (catégories de sortie de tri) : liste des mouvements filtrable, résumé par catégorie et totaux (`GET /summary`), saisie manuelle entrée/sortie, référentiel `matieres` (CRUD), et un module d'**inventaire physique** (`inventory_batches`/`inventory_items`) qui pré-remplit le stock théorique par catégorie, reçoit la saisie du compte physique, calcule l'écart kg/% puis se valide (ADMIN).
- **`stock-original.js` / `AdminStockOriginal.jsx` + `InventaireOriginal.jsx`** — stock « brut » pré-tri, orienté déclaration Refashion : pesées authentifiées et pesées **publiques via une balance de bascule sans authentification** (`POST /balance-entree`, `/balance-sortie`, net = brut − tare avec référentiel serveur de tares par contenant), un **grand livre** (`GET /ledger`) à solde cumulé et export CSV, une **régularisation** motivée (ADMIN), une **modification à piste d'audit champ par champ** (`stock_original_audit`), et un **verrouillage trimestriel** (`stock_period_locks`) qui bloque toute modification une fois la période déclarée.
- **`SortieCartons.jsx`** consomme en réalité une **troisième** structure (`produits_finis`, via `backend/src/routes/etiquettes.js`, hors périmètre officiel) : scan douchette d'un carton étiqueté pour le sortir vers une commande boutique ou en sortie libre. Il ne touche ni `stock_movements` ni `stock_original_movements`.

Point notable et bien conçu : les deux ledgers en périmètre sont **alimentés automatiquement par de nombreux autres modules**. Une tournée qui passe à `completed` (`backend/src/routes/tours/execution.js`) crée simultanément une entrée dans les deux tables ; un lot de tri (`backend/src/routes/tri.js`) crée une sortie de stock original puis, à la complétion, une entrée par catégorie côté moderne ; expéditions, préparations et commandes boutique (`expeditions.js`, `preparations.js`, `boutique-commandes.js`) créent les sorties correspondantes. Architecture de ledger central saine qui évite la ressaisie — mais qui rend le module dépendant de code situé hors du périmètre audité.

## 2. Adéquation aux besoins des parties prenantes

**Terrain / publics éloignés du numérique** : le point fort du module est la page de bascule (`frontend/src/pages/BalancePage.jsx`, alimentée par les routes publiques de `stock-original.js`). Assistant pas-à-pas en 4 étapes, gros boutons tactiles, pictogrammes, calcul automatique brut−tare, écran de confirmation qui se referme seul après 3,5 s : c'est un vrai kiosque adapté à un usage sans formation. `SortieCartons.jsx` suit la même logique (scan → bip sonore → flash plein écran vert/rouge/orange), bien calibrée pour un collaborateur en insertion (rôle COLLABORATEUR autorisé, cf. `frontend/src/App.jsx` ligne 173).

**Managers / pilotage** : `Stock.jsx` et `InventaireOriginal.jsx` offrent des vues de synthèse (totaux, graphique d'évolution `ComposedChart`), correctes pour un pilotage courant.

**QHSE et auditeurs Refashion** : c'est ici que l'adéquation est la plus faible. Le modèle de rôles de l'application (`ADMIN, MANAGER, RH, COLLABORATEUR, AUTORITE, RESP_BTQ` — `backend/src/middleware/auth.js`, `Layout.jsx`) ne comporte **aucun rôle QHSE**, et aucune des quatre pages n'est ouverte au rôle `AUTORITE` (pourtant utilisé pour la Métropole de Rouen sur les pages de reporting). Un auditeur Refashion n'a donc aucun accès self-service, même en lecture seule : seule échappatoire, l'export CSV du grand livre (`AdminStockOriginal.jsx`, onglet Journal), réservé ADMIN, qui doit l'extraire pour le tiers. Le verrouillage trimestriel — la fonctionnalité la plus directement liée à Refashion — colle bien au rythme réel des déclarations DPAV, mais aucune étape d'**inventaire physique du stock original** n'est requise ni même possible avant de verrouiller : le module de comptage théorique/physique n'existe que côté stock « moderne » (`stock.js`). On peut donc figer un trimestre dont le solde n'a jamais été confronté à un comptage physique.

## 3. Benchmark marché

Les recherches menées confirment que la cadence de déclaration Refashion est bien trimestrielle et que la traçabilité y est demandée à la maille de l'établissement (SIRET) — le verrouillage par année/trimestre de SOLIDATA colle donc à l'exigence réelle. Les acteurs du secteur (Emmaüs, Le Relais) mettent en avant une traçabilité **au poids, à chaque étape** : l'approche de SOLIDATA (brut/tare/net systématiques, y compris au poste de bascule) est cohérente avec cette pratique de référence.

Face aux standards WMS/PME généralistes (Odoo Inventaire, Archipelia, etc.), plusieurs briques usuelles manquent : la **gestion d'emplacements/zones** (aucun champ de localisation physique — le stock est connu en quantité globale, pas en position), la **régularisation automatique post-inventaire** (un WMS standard transforme un écart de comptage en écriture de stock ; ici il est calculé et affiché mais jamais reversé, cf. §4), et une **séparation des tâches** sur les opérations sensibles (un même rôle ADMIN saisit, modifie, régularise, verrouille et déverrouille). L'inventaire tournant par catégorie (mode « partiel »), lui, correspond bien à la pratique recommandée de comptage fractionné plutôt qu'un inventaire annuel unique. Globalement, le module se situe au-dessus d'un suivi tableur mais en retrait d'un WMS mature sur les garanties d'intégrité et de clôture.

## 4. Forces / faiblesses / manques / irritants UX

**Forces** : calcul net systématique avec référentiel de tares serveur ; piste d'audit champ par champ et verrouillage trimestriel réel sur le stock original ; kiosques bascule et scan très adaptés au terrain ; ledger central alimenté automatiquement par les modules amont ; inventaire tournant par catégorie déjà en place.

**Faiblesses / manques constatés dans le code** :
- **Aucune correction possible sur `stock_movements`** (stock « moderne ») : `stock.js` n'expose ni PUT ni DELETE ni régularisation, contrairement à `stock-original.js` qui a les trois. Une erreur de saisie (poids, catégorie) reste définitive.
- **L'écart d'inventaire n'est jamais reversé dans le stock** : `POST /stock/inventories/:id/validate` fige le statut sans créer d'écriture correctrice. Le stock théorique diverge donc indéfiniment après chaque inventaire, même quand un écart réel est détecté.
- **Catégorisation `matiere_id` incohérente selon la source** : correctement renseignée quand le tri complète une opération (`tri.js`), mais laissée `NULL` sur l'entrée automatique de tournée et sur les sorties boutique/exutoire (`tours/execution.js`, `boutique-commandes.js`, `preparations.js`). Tout retombe dans le seau « Non classé » de `Stock.jsx`, qui mélange matière brute jamais décrémentée et sorties de produit fini sans rapport — ce total n'a plus de sens physique.
- **Endpoints morts** : `GET/POST /stock/matieres` sans appelant front (le formulaire de `Stock.jsx` utilise `/tri/categories`) et pointant vers une table vidée par la migration A1 (`init-db.js`) ; `GET /stock/reconciliation`, jamais appelé côté web, compare une valeur à celle qui l'a générée automatiquement.
- **Vocabulaire d'origine incohérent** : la balance publique enregistre `origine = 'retour'` (`stock-original.js`, `/balance-entree`) quand le formulaire authentifié utilise `retour_vak`/`retour_magasin` (`/pesee`) ; `ORIGINES_LABELS` (front) ignore `'retour'`, absent du filtre déroulant.
- **Pas d'attribution d'opérateur sur la balance publique** : le champ `operateur` existe côté API mais `BalancePage.jsx` ne le collecte jamais — les écritures du poste de pesée restent anonymes dans un grand livre censé servir de preuve d'audit.
- **Test de non-régression cassé pour ce module** : `scripts/tests/api-smoke.js` (T-STO-03) interroge `/api/stock-original/grand-livre`, route inexistante (la vraie est `/ledger`). Câblé dans `deploy.sh` étape 7/7 comme porte de blocage, il échoue en 404 dès que `API_USER`/`API_PASSWORD` sont configurés, ou révèle que ce test tourne en mode dégradé en production.
- **Pas de pagination** sur l'historique des mouvements (`GET /stock`, `GET /stock-original`) : limite fixe (100-200 lignes) sans offset ni « charger plus » ; au-delà, seul un filtrage par date atteint les anciennes lignes.
- **Dérive front non corrigée** : `SortieCartons.jsx` garde les couleurs de gamme sur les anciennes valeurs (`BTQ STAND`, `BTQ EXTRA`, `CHIF`, `Pvak`), supprimées depuis la refonte du 10 mai 2026 au profit de `EXTRA/STANDARD/VAK/EXPORT` (`init-db.js`) : tout carton actuel affiche un badge gris par défaut.

**Irritants UX** : validation d'inventaire en un clic sans confirmation (alors que le verrouillage trimestriel, lui, a une modale de confirmation) ; saisie ligne par ligne sans import/collage groupé sur l'inventaire ; pas de recherche libre (référence, notes) sur les listes de mouvements, seulement des filtres date/type/origine.

## 5. Recommandations priorisées

| Priorité | Recommandation | Effort |
|---|---|---|
| P0 | Poser une écriture de régularisation automatique (ou obliger une régularisation liée) à la validation d'un inventaire, pour que le stock théorique se recale sur le comptage | M |
| P0 | Corriger la référence cassée du smoke test (`grand-livre` → `ledger`) et vérifier que `API_USER`/`API_PASSWORD` sont bien positionnés en production pour que la porte de déploiement soit réellement active | S |
| P1 | Ajouter modification/régularisation avec piste d'audit sur `stock_movements`, symétrique à l'existant sur `stock-original` | M |
| P1 | Fiabiliser `matiere_id` sur tous les points d'écriture (entrée tournée, sorties boutique/exutoire) ou scinder « brut en attente de tri » de « produit fini expédié » | M |
| P1 | Étendre l'inventaire physique (théorique vs compté) au stock original avant d'autoriser le verrouillage trimestriel | M |
| P1 | Rendre l'opérateur identifiable sur la balance publique (sélecteur de nom/badge), même sans authentification complète | S |
| P2 | Ouvrir un accès en lecture (rôle QHSE dédié ou réutilisation d'`AUTORITE`) aux auditeurs Refashion sur le grand livre | S |
| P2 | Ajouter une pagination sur les historiques de mouvements ; harmoniser le vocabulaire d'origine kiosque/formulaire ; mettre à jour `GAMME_COLORS` de `SortieCartons.jsx` ; nettoyer les endpoints morts (`/stock/matieres`, `/stock/reconciliation`) | S |

---

*Rapport rédigé à partir de la lecture du code de `backend/src/routes/stock.js`, `backend/src/routes/stock-original.js`, `backend/src/routes/etiquettes.js`, `backend/src/routes/tours/execution.js`, `backend/src/routes/tri.js`, `backend/src/routes/preparations.js`, `backend/src/routes/boutique-commandes.js`, `backend/src/scripts/init-db.js`, `frontend/src/pages/Stock.jsx`, `AdminStockOriginal.jsx`, `InventaireOriginal.jsx`, `SortieCartons.jsx`, `BalancePage.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx` et `scripts/tests/api-smoke.js`.*
