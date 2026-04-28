# Benchmark KPIs retail — Boutiques Solidata vs pratiques secteur

> Positionne le module Boutiques de Solidata par rapport aux standards retail
> (textile 2nde main / friperie). Identifie les KPIs couverts, partiels ou
> manquants, et priorise les évolutions à faible coût-valeur élevée.
>
> Dernière mise à jour : 22 avril 2026

---

## 1. Contexte

Solidata exploite les données de caisse **LogicS** de 2 boutiques de 2nde main
à Rouen (St-Sever et L'Hôpital). L'import CSV quotidien alimente un dashboard
à 3 niveaux (jour / mois / année) plus un onglet « Avancement du CA de la
journée » avec météo horaire Open-Meteo en overlay.

**Spécificités métier** :
- **Stock unique par pièce** (pas de SKU partageable). Le prix change selon
  l'état, la marque, la saison.
- **Saisonnalité forte** : collections déclenchées par la température et la
  pluie, relayées par les rayons saisonniers (layettes, manteaux).
- **Mix tarifaire** : pièce à prix fixe (FEMME, ENFANTS, LAYETTES),
  **PRIX RONDS** (0,50/1/2 €), **OPERATION** (prix cassé, animation
  commerciale), **BRADERIE** (déstockage), **KINTSU** (friperie premium) et
  consommables **SAC KRAFT**.
- **Dépendance météo** documentée côté endpoint `/boutique-meteo/correlation`.

---

## 2. KPIs fondamentaux — état des lieux

| KPI standard retail | Formule | Statut Solidata | Endpoint / champ |
|---|---|:-:|---|
| CA TTC | Σ tickets | ✅ | `/boutique-ventes/analytics/kpis.ca_ttc` |
| CA HT | Σ HT | ✅ | `…kpis.ca_ht` |
| TVA collectée | Σ TVA | ✅ | `…kpis.tva_collectee` |
| Nb tickets | COUNT tickets | ✅ | `…kpis.nb_tickets` |
| Nb articles | Σ quantité | ✅ | `…kpis.nb_articles` |
| Panier moyen | CA / tickets | ✅ | `…kpis.panier_moyen` |
| IPT (Items per Ticket) | articles / tickets | ✅ | `…kpis.ipt` |
| Prix moyen article | CA / articles | ✅ | `…kpis.prix_moyen_article` |
| Part promo (CA) | CA promo / CA total | ✅ | `…kpis.taux_promo_ca` |
| Part promo (volume) | articles promo / articles | ✅ | `…kpis.taux_promo_volume` |
| Durée moyenne ticket | AVG(dernier − premier scan) | ✅ | `…kpis.duree_moy_ticket_sec` |
| Taux d'attache sac | tickets avec sac / tickets | ✅ | `…kpis.taux_attache_sac` |
| Mix rayons (CA & volume) | CA & qté par rayon | ✅ | `…analytics/rayons` |
| Top articles | Σ CA par article | ✅ | `…analytics/articles` |
| Évolution J/M vs N-1 | deltas % | ✅ | `…analytics/evolution` |
| CA par heure | Σ CA / heure | ✅ | `…analytics/hourly` |
| Heatmap affluence | tickets × (jour × heure) | ✅ | `…analytics/hourly.heatmap` |
| Avancement cumulé CA | running total intra-journée | ✅ | DayView front (calcul local) |

**Couverture** : 17/17 KPIs fondamentaux du retail sont disponibles.

---

## 3. KPIs avancés — écarts et priorités

Les KPIs suivants sont **standard en retail** mais manquent (ou sont partiels)
chez Solidata. Ils constituent la roadmap d'enrichissement.

| KPI | Formule | Statut | Pré-requis / action |
|---|---|:-:|---|
| Taux de transformation | tickets / visiteurs | ❌ | compteur d'entrées (capteur porte ou caméra) |
| CA / m² | CA / surface de vente | ❌ | ajouter `surface_m2` à `boutiques` |
| Rotation du stock | CA / stock moyen | ⚠️ | vue dédiée à croiser avec module `stock` |
| Durée de vie article | date_vente − date_entrée | ⚠️ | données présentes, vue manquante |
| Sell-through rate | vendu / entré sur période | ⚠️ | idem (croiser commandes ⇄ ventes) |
| Démarque inconnue | (stock théo − stock réel) / CA | ❌ | inventaires tournants boutique |
| Taux de retour | retours / ventes | ❌ | flux retour absent du CSV LogicS actuel |
| CA / heure d'ouverture | CA / heures ouvertes réelles | ✅* | `analytics/hourly` + champs `ouverture_*` |
| Pic d'affluence | max tickets/heure | ✅ | heatmap `analytics/hourly` |
| Taux de fidélisation | clients récurrents / clients | ❌ | pas de client_id dans LogicS |
| RFM (récence/fréquence/montant) | segmentation clients | ❌ | idem |
| Marge brute | (CA − coût revient) / CA | ❌ | coût d'acquisition article inexistant (don textile) |

\* Calculable en lisant les flags `ouverture_lundi…dimanche` sur la boutique.

---

## 4. KPIs spécifiques retail 2nde main / friperie

| KPI | Pertinence | Statut |
|---|---|:-:|
| Prix au kilo vs à la pièce | distinguer vente en vrac (BRADERIE lot) vs pièce triée | ⚠️ exploitable à partir de `rayon` + `quantite` |
| Taux de revalorisation matière | tonnes valorisées / tonnes collectées | ✅ module `refashion` (amont collecte) |
| Saisonnalité pondérée météo | corrélation pluie × CA, température × CA | ✅ `/boutique-meteo/correlation` |
| CA / kilo trié | CA boutique / kg entrée du centre de tri | ❌ nécessite jointure transverse modules |
| Panier type « chineur » | forte IPT, faible prix moyen | ⚠️ décomposable depuis les KPIs existants |
| Rotation par rayon saisonnier | ventes / entrée par rayon | ⚠️ idem |

---

## 5. KPIs staff / productivité

**Volontairement hors périmètre** du reporting horaire demandé. Ces KPIs
existeraient si l'on voulait suivre la performance vendeur / poste :

- CA / ETP, CA / heure travaillée
- Tickets / vendeur, IPT / vendeur
- Temps moyen d'encaissement par vendeur
- Ratio heures vendeur / heures d'ouverture

Le reporting horaire Solidata se concentre sur **l'activité commerciale** (CA
cumulé, affluence, météo) et pas sur l'allocation des équipes.

---

## 6. Recommandations priorisées

1. **(Livré par ce plan)** Météo horaire Rouen + avancement cumulé CA de la
   journée dans la vue Jour du dashboard.
2. **Ajouter `surface_m2`** à la table `boutiques` (1 migration idempotente
   dans `init-db.js`) pour débloquer le **CA / m²** et le CA / m² / heure.
3. **Compteur d'entrées** physique (capteur porte bas coût ou vidéo anonymisée
   IoT LoRaWAN — l'infra LoRaWAN `cav_sensor_readings` est déjà en place) pour
   le **taux de transformation** et la **courbe fréquentation vs achats**.
4. **Vue rotation & durée de vie article** : données déjà stockées
   (`boutique_commandes.poids_expedie_kg` + `boutique_ventes`), une vue
   SQL/matérialisée permettrait un endpoint `/boutique-ventes/analytics/rotation`.
5. **Exploitation systématique de `/boutique-meteo/correlation`** : intégrer
   l'indice météo (factor 0.9 → 1.08) dans les objectifs mensuels pondérés.
6. **Client_id optionnel côté LogicS** (carte de fidélité) : ouvrirait la
   segmentation RFM et le taux de fidélisation.
7. **Flux retour** dans l'export LogicS (nouvelle rubrique ou qté négative)
   pour suivre le **taux de retour**.

---

## 7. Couverture globale

- **Fondamentaux retail** : 17/17 ✅
- **Avancés** : 2/12 ✅ + 4/12 ⚠️ + 6/12 ❌
- **Spécifiques 2nde main** : 2/6 ✅ + 3/6 ⚠️ + 1/6 ❌
- **Staff / productivité** : hors périmètre (décision métier)

Solidata couvre **l'intégralité des KPIs fondamentaux** du retail. Les écarts
se concentrent sur les KPIs qui nécessitent des capteurs physiques (entrées),
un enrichissement référentiel (surface, client_id) ou des croisements entre
modules (stock, commandes). Le reporting horaire est désormais au niveau des
standards sectoriels avec l'ajout de la météo heure par heure et de la courbe
d'avancement cumulé CA.
