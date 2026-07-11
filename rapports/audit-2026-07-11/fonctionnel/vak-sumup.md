# Audit fonctionnel — Module Vente au Kilo (VAK) & intégration SumUp

**Périmètre analysé** : `backend/src/routes/vak.js`, `backend/src/services/sumup.js`, pages `VakPerformance`, `VakAnnuel`, `VakSessions`, `VakLive`, `VakJournee`, `VakSumupConfig`, schéma DB (`backend/src/scripts/init-db.js`), scheduler (`backend/src/services/scheduler.js`), câblage Socket.IO (`backend/src/index.js`).
**Méthode** : lecture intégrale du code (842 + 898 lignes backend, ~2 230 lignes de pages React), croisement avec le schéma DB et les routes/sidebar. Deux recherches web ciblées pour le benchmark marché.

## 1. Couverture fonctionnelle réelle

Le module couvre un événement de vente au détail (« une VAK = 2-3 jours/mois au siège ») encaissé sur une caisse SumUp, avec trois voies d'alimentation qui convergent vers les mêmes tables (`vak_tickets`, `vak_ventes`) : synchronisation OAuth incrémentale (`syncTransactionsFromApi`, `backend/src/services/sumup.js:598-678`), webhook temps réel signé HMAC (`vak.js:88-138`), et import CSV de secours (`importCSVContent`, `sumup.js:366-571`). L'ingestion est idempotente (UPSERT sur `(vak_id, ref_transaction)`, ré-suppression/ré-insertion des lignes de vente), ce qui rend les resynchronisations et ré-imports sûrs.

Côté analytics, les routes `/analytics/{kpis,hourly,segments,payments,comparison,by-day}` (`vak.js:257-525`) produisent un jeu d'indicateurs cohérent avec un commerce « au poids » : CA HT/TTC/TVA, poids vendu, prix moyen au kg, panier moyen, IPT, mix de paiement, part par segment (textile vrac/chaussures/consommables), comparaison N-1 et moyenne YTD. Les vues annuelles (`/annual/*`) consolident toutes les VAK de l'année (tendance segments, mix paiement, heatmap horaire). `VakLive` (kiosque TV) affiche des compteurs animés et un ticker en direct via Socket.IO (room `vak:live:<id>`, `backend/src/index.js:304-313`). `VakSumupConfig` centralise tout le cycle de vie SumUp (credentials chiffrés, OAuth, sync manuelle, rattrapage historique par date, ré-enregistrement webhook, journal des 20 dernières synchros). La météo (Open-Meteo) est capturée automatiquement par jour de VAK pour corrélation ultérieure.

Ce périmètre est large et cohérent ; il va au-delà d'un simple report CSV mensuel évoqué comme point de départ dans les commentaires du code.

## 2. Adéquation aux besoins et parties prenantes

**Terrain / publics éloignés du numérique** : point fort structurel — l'encaissement lui-même se fait entièrement sur l'application/le terminal SumUp, outil déjà pensé pour un usage simple ; SOLIDATA n'ajoute aucune saisie pour la personne qui tient la caisse. C'est un choix d'architecture adapté au public visé.

**Direction / pilotage** : les indicateurs (€/kg, poids vs objectif, IPT, mix paiement) sont bien alignés sur la réalité économique d'une vente au kilo, pas sur un générique panier/SKU. En revanche, deux angles morts limitent la vision consolidée de la direction : (a) aucune passerelle vers le module Finance — le CA VAK n'apparaît ni dans `FinancePL` ni dans `FinanceTresorerie` (aucune référence à `vak` dans `backend/src/routes/finance.js`/`pennylane.js`/`billing.js`), la direction doit donc croiser deux espaces pour une vue complète ; (b) aucun rapprochement entre le tonnage affecté à la VAK en sortie de tri (catégorie « 2nd choix (VAK) », `famille_refashion = reutilisation`, `init-db.js:1631-1633`) et le poids réellement vendu (`vak_tickets.poids_kg`) — le taux d'écoulement n'est pas calculé. Ce manque est d'ailleurs déjà identifié comme « indicateur roadmap » dans le CLAUDE.md, ce qui crédite l'équipe de lucidité sur le sujet mais confirme qu'il reste non traité.

**Réglementaire (Refashion/Métropole/DREETS)** : la VAK n'a pas d'obligation déclarative propre (ce n'est ni de la collecte ni un parcours d'insertion) ; l'absence de lien direct avec DPAV/DREETS est donc normale, pas un manque.

## 3. Benchmark marché

SumUp propose nativement un tableau de bord marchand (ventes par catégorie/heure/moyen de paiement, export CSV/Excel, alertes temps réel) — le module VAK n'est donc pas la seule source d'analytics disponible. Sa valeur ajoutée réelle tient à la spécialisation métier qu'un dashboard générique n'offre pas nativement : prix au kg, objectifs de poids, corrélation météo, comparaison N-1/YTD calée sur la cadence mensuelle de l'association. C'est un bon calcul de « build vs buy » pour une petite structure.

Sur le créneau des écrans TV temps réel, le marché propose des solutions dédiées (apps natives Apple TV/Fire TV type PingBell, Databox, Plecto, PLAYipp) qui évitent la fragilité d'un onglet navigateur connecté. `VakLive` reproduit l'essentiel de l'effet (gros compteurs animés, jauges, ticker) pour un coût marginal nul, mais hérite de la contrainte d'authentification web classique (voir §4) que ces produits dédiés n'ont pas. Par rapport aux standards retail, il manque un suivi par vendeur/caissier et un taux de conversion visiteurs — ce dernier est également déjà noté comme roadmap dans le CLAUDE.md.

## 4. Forces, faiblesses, manques et irritants UX

**Forces** : service `sumup.js` unique et bien factorisé (chiffrement, OAuth, normalisation, ingestion partagés par les 3 voies) ; ingestion idempotente prouvée par construction (UPSERT + purge/réinsertion des lignes) ; secrets chiffrés AES-256-GCM, signature webhook vérifiée en `timingSafeEqual`, state OAuth anti-CSRF à durée de vie limitée ; code couleur cohérent (vert/ambre/rouge à 80 %/100 % de l'objectif) répété sur `VakSessions`, `VakAnnuel`, `VakPerformance` ; page CSV clairement positionnée comme secours, pas comme voie principale.

**Faiblesse confirmée (P0)** : sur `VakPerformance.jsx`, le graphique camembert « Mix moyens de paiement (CA) » classe mal les paiements carte. La fonction locale `getPaymentCategory()` (`VakPerformance.jsx:68-73`) ne reconnaît que les sous-chaînes `visa`/`mastercard`/`carte`, alors que la route backend `/analytics/payments` renvoie le libellé déjà normalisé `'CB'` (`payLabel`, `vak.js:42`, `vak.js:368`). `'cb'.includes('carte')` est faux : 100 % du CA carte tombe dans le seau « Autre ». La table « Détail moyens de paiement » juste en dessous, sur la même page, affiche le bon chiffre à partir des mêmes données — la page se contredit visuellement. La même fonction dupliquée dans `VakJournee.jsx:43-48` est heureusement du code mort (jamais lu dans le rendu de `DayCard`).

**Autres faiblesses (P1)** : (1) le chemin API/webhook ne traite aucun remboursement — seuls les statuts `SUCCESSFUL`/`PAID` sont ingérés (`sumup.js:648`), un événement `REFUNDED` est simplement ignoré sans écriture compensatoire, alors que l'import CSV gère explicitement le signe négatif des remboursements (`sumup.js:429-431`) : incohérence entre les deux voies, risque de CA surestimé. (2) Le compteur « skipped » du journal de synchro agrège trois situations très différentes (transaction déjà synchronisée/idempotente, statut inéligible, date hors toute VAK — `sumup.js:648-656`) sans les distinguer, ce qui brouille le diagnostic lors d'un rattrapage historique. (3) Le toast de succès après un import CSV (`VakSessions.jsx:284-289`) n'affiche que les lignes importées, pas `nb_lignes_erreur`/les rejets hors période — cette information n'existe que dans le tableau d'historique plus bas, un opérateur pressé peut donc rater un import partiel.

**Manques (P1/P2)** : pas de passerelle Finance (voir §2) ; pas de rapprochement tonnage-affecté/poids-vendu (roadmap déjà noté) ; mapping description→segment figé en dur dans le code (`DESCRIPTION_TO_SEGMENT`, `sumup.js:269-276`) sans table de configuration comme il en existe ailleurs (`categories_sortantes`) — un nouveau type d'article vendu nécessite un déploiement ; aucune contrainte d'exclusion sur les dates de deux VAK qui se chevauchent, ni d'outil pour réaffecter manuellement un ticket mal routé ; `nb_articles` compte des lignes de vente et non la somme des quantités (`sumup.js:503,750`), ce qui peut sous-estimer l'IPT sur des lignes à quantité multiple.

**Irritants UX probables** : aucune interface pour corriger un ticket/une ligne mal catégorisés (tables en lecture seule, `vak.js:691-713`) ; objectifs CA/poids ressaisis à la main à chaque nouvelle VAK sans suggestion basée sur l'historique ; `VakLive` s'appuie sur une session web ADMIN/MANAGER classique (token 8h + cookie refresh 7j, rafraîchissement silencieux via l'intercepteur axios `services/api.js:30-73`) — cela tient sur la durée d'une VAK, mais toute perte de session complète (redémarrage navigateur, cookie effacé) impose une reconnexion par mot de passe sur un écran de TV rarement équipé de clavier.

## 5. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|-----------------|----------|--------|
| 1 | Corriger `getPaymentCategory()` (VakPerformance) pour reconnaître les libellés canoniques `'CB'`/`'Espèces'`, ou faire renvoyer par le backend une catégorie déjà tranchée | P0 | S |
| 2 | Traiter les remboursements SumUp côté API/webhook (statut `REFUNDED`) avec écriture compensatoire, à l'image du CSV | P1 | M |
| 3 | Distinguer dans le journal de sync les motifs d'ignorance (déjà existant / statut inéligible / hors période VAK) | P1 | S/M |
| 4 | Afficher les lignes en erreur/rejets hors période dans le toast d'import CSV, pas seulement dans l'historique | P1 | S |
| 5 | Calculer un taux d'écoulement (tonnage « 2nd choix VAK » vs poids réellement vendu) et relier le CA VAK aux vues Finance | P1 | M |
| 6 | Sortir le mapping description→segment du code vers une table configurable | P2 | S/M |
| 7 | Garde-fou sur le chevauchement des dates de VAK + outil de réaffectation manuelle d'un ticket | P2 | S/M |
| 8 | Corriger `nb_articles` pour sommer les quantités plutôt que compter les lignes (fiabilise l'IPT) | P2 | S |

## Conclusion

Le module VAK est fonctionnellement riche et bien pensé pour le modèle économique « au kilo » d'une petite structure, avec une intégration SumUp techniquement soignée (idempotence, chiffrement, webhook signé). Il souffre cependant d'un bug d'affichage visible et trompeur sur un KPI de direction (mix de paiement), de deux zones d'incohérence entre voies d'ingestion (remboursements, journal de sync) et d'un déficit d'intégration avec le pilotage financier global — autant de points concrets et corrigeables sans remise en cause de l'architecture.
