# Persona Responsable Boutique — Audit opérationnel réassort

**Date** : 2026-05-10
**Persona** : Responsable Boutique (RESP_BTQ) — boutique St-Sever ou L'Hôpital
**Périmètre** : 2 missions — justifier la prochaine commande, commander les cartons

## Synthèse exécutive

| Mission | Couverture | Friction quotidienne |
|---|---|---|
| **1 — Justifier la commande** | KPI ventes complets, météo corrélée, comparaison vs N-1 | ⚠️ Pas d'alerte rupture auto, pas de filtre saison |
| **2 — Commander les cartons** | Workflow 5 statuts + ajustement | ⚠️ Pas de vue inventaire produits finis, pas de pré-sélection carton |
| **Import données ventes LogicS** | Auto (anti-doublon SHA-256), 2 formats reconnus | ✅ Fonctionnel |
| **Suivi performance** | Dashboard 3 niveaux + objectifs mensuels | ✅ Bon |

**Note** : **6,5 / 10**. L'outil couvre 80 % du flux. Les 20 % restants coûtent 3 h/semaine en appels au centre de tri.

## Mission 1 — Justifier la commande

**Routine hebdo (lundi 9h)** : Boutiques → Analyse des ventes → 30 derniers jours par boutique.

**KPI disponibles** :
- CA HT (sommé), nb tickets, nb articles, panier moyen, IPT
- Segment CA : courantes/promo/consommables (pie chart)
- CA par rayon : FEMME, ENFANTS, LAYETTES, KINTSU, BRADERIE, OPÉRATION, SAC KRAFT
- Articles top 15 (CA TTC)

**Corrélations** :
- ✅ Météo × CA : codes WMO Open-Meteo + temp/précip via `boutique_meteo_quotidien`
- ✅ Vs N-1 : endpoint `/boutique-ventes/analytics/evolution` avec badges Δ vert/rouge
- ✅ Objectifs : page Boutiques → Objectifs (CA HT mensuel + nb_tickets + panier)

**Frictions** :
- ❌ Pas de tag saison (été/automne/hiver/printemps) sur articles → impossible de filtrer "FEMME été" vs "FEMME automne"
- ❌ Pas de calcul auto corrélation météo (rain_code ≥ 61 → impact CA) — analyse manuelle
- ❌ Pas de taux de rotation → impossible de savoir si carton P1ABCD stocké il y a 3 sem se vend encore
- ❌ Pas de lien boutiques ↔ produits finis → impossible de tracer quel carton a fourni les articles vendus
- ❌ Objectifs en HT, réalisé en TTC → pas de correspondance exacte (TVA moyenne inconnue)

## Mission 2 — Commander les cartons

**Workflow** :
```
Brouillon (poids par catégorie) → Envoyée → Ajustée (tri ajuste réel dispo) → En préparation → Expédiée
```

**État machine** côté boutique :
- Création commande : catégorie + poids total demandé (pas de gamme à la création)
- Envoi : statut `envoyee`
- Le centre de tri reçoit, ajuste les poids selon dispo, statue `ajustee`
- Préparation : statut `en_preparation`
- Expédition : statut `expediee`, créé sortie stock `produits_finis`

**Frictions critiques** :

1. ❌ **Aucune visibilité sur les cartons préparés** : la responsable dit « 200 kg FEMME, 50 kg CHAUSSURES ». Le tri répond « OK, 208 kg FEMME = 4 cartons P1ABCD, P1CDEF, P1GHIJ, P1KLMN ». Mais la resp boutique **ne voit pas ces codes-barres avant la livraison physique**. Zéro traçabilité produit fini → commande.

2. ❌ **Pas de filtre gamme à la création** : la resp ne peut pas demander explicitement EXTRA, STANDARD, VAK ou EXPORT au moment de la commande. Le tri devine, ou rappelle pour clarifier (délai +24 h).

3. ❌ **Ajustement non-proactif** : si le tri n'a que 150 kg FEMME EXTRA pour 200 demandés, le statut passe `ajustee` à 150 kg mais aucune notification push. La resp doit cliquer la modale détail pour le voir.

4. ❌ **Scan entrée stock non implémenté** : à réception, la resp doit scanner les cartons mais aucune page boutique dédiée (pas de `BoutiquesEntreeStock`). Le scan se fait côté tri.

## Top 5 améliorations

| # | Action | Effort | ROI |
|---|---|---|---|
| **P1** | Filtre gamme (EXTRA / STANDARD / VAK / EXPORT) dans formulaire commande brouillon + contrôle budgétaire au passage | 3 h | Très haut — supprime 50 % des appels téléphoniques au tri |
| **P2** | Lien visuel commande ↔ cartons : modale « Cartons sélectionnés par tri » accessible depuis la fiche commande (lecture seule, après ajustement) | 6 h | Très haut — confiance client, réduction hésitations |
| **P3** | Alerte push automatique si ajustement > 10 % de la demande (toast + e-mail) | 1 h | Moyen — détection ruptures sans relire l'interface |
| **P4** | Tag saison sur articles + recommandation auto « Catégories en rupture saisonnière » (top 5 qui s'épuisent vite) | 9 h | Moyen — anticipation saisonnière |
| **P5** | Page `Inventaire boutique` avec scan HID douchette (réutiliser le composant `SortieCartons` adapté) → entrée stock boutique auto, traçabilité réception | 9 h | Bas individuellement, mais clôt la boucle bout en bout |

**Total** : ~28 h de dev. La P1 + P2 + P3 (~10 h) suffisent à faire passer le score de 6,5 / 10 à 8,5 / 10.

## Verdict opérationnel — ressenti

> « L'outil existe et fonctionne pour 80 % du flux, mais les 20 % qui restent me coûtent 3 h/semaine en appels téléphoniques + Excel. Pas bloquant mais pénible. »

L'architecture data est saine (`boutique_commandes` + `boutique_commande_lignes` + state machine + audit trail). Le backend a les endpoints. C'est essentiellement un **gap UX/visibilité**, pas un problème data.
