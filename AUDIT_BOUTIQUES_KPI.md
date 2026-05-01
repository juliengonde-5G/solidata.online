# Audit - Indicateurs de Performance Boutiques

**Date** : 2026-05-01  
**Fichier** : `backend/src/routes/boutique-ventes.js`

---

## ❌ Problèmes identifiés

### 1. KPIs calculés en TTC au lieu de HT

| Endpoint | Ligne | Problème | Impact |
|----------|-------|---------|--------|
| `/analytics/kpis` | 606 | `panier_moyen` = AVG(total_ttc) | Affiche TTC au lieu de HT |
| `/analytics/kpis` | 627 | `prix_moyen_article` = ca_ttc / nb_articles | Affiche TTC au lieu de HT |
| `/analytics/monthly` | 442 | `panier_moyen` = SUM(total_ttc) / tickets | Affiche TTC au lieu de HT |
| `/analytics/articles` | 513 | `prix_moyen` = SUM(total_ttc) / quantite | Affiche TTC au lieu de HT |
| `/analytics/evolution` | 715, 727 | `panier_moyen` et `prix_moyen_article` en TTC | Calculs erronés |

### 2. Dashboard affiche les valeurs erronées

| Page | Ligne | Affichage |
|------|-------|-----------|
| `BoutiquesDashboard.jsx` | 251, 399 | "Panier moyen" → TTC (devrait être HT) |
| `BoutiquesDashboard.jsx` | 257, 401 | "Prix moyen article" → TTC (devrait être HT) |

### 3. Distinction entre boutiques ✅

**Statut** : OK - Les requêtes filtrent correctement par `boutique_id`

---

## 📊 Exemple d'impact

Supposons un article vendu 100 € HT (120 € TTC avec 20% TVA) :

| Calcul | Actuellement | Attendu | Erreur |
|--------|-------------|---------|--------|
| Panier moyen | 120 € (TTC) | 100 € (HT) | **+20%** |
| Prix article | 120 € (TTC) | 100 € (HT) | **+20%** |

---

## ✅ Solution

Remplacer tous les `total_ttc` par `total_ht` dans les calculs de KPIs :

### À corriger :

**Ligne 606** :
```sql
-- AVANT :
COALESCE(AVG(tp.total_ttc),0)::FLOAT AS panier_moyen,

-- APRÈS :
COALESCE(AVG(tp.total_ht),0)::FLOAT AS panier_moyen,
```

**Ligne 627** :
```javascript
// AVANT :
prix_moyen_article: nbArticles > 0 ? v.ca_ttc / nbArticles : 0,

// APRÈS :
prix_moyen_article: nbArticles > 0 ? v.ca_ht / nbArticles : 0,
```

**Ligne 442** :
```sql
-- AVANT :
THEN (SUM(total_ttc) / COUNT(DISTINCT ticket_id))::FLOAT

-- APRÈS :
THEN (SUM(total_ht) / COUNT(DISTINCT ticket_id))::FLOAT
```

**Ligne 513** :
```sql
-- AVANT :
THEN (SUM(total_ttc) / SUM(quantite))::FLOAT

-- APRÈS :
THEN (SUM(total_ht) / SUM(quantite))::FLOAT
```

**Lignes 715, 727** :
```sql
-- AVANT (715) :
COALESCE(AVG(total_ttc),0)::FLOAT AS panier_moyen,

-- APRÈS :
COALESCE(AVG(total_ht),0)::FLOAT AS panier_moyen,
```

```javascript
// AVANT (727) :
prix_moyen_article: v.nb_articles > 0 ? v.ca_ttc / v.nb_articles : 0,

// APRÈS :
prix_moyen_article: v.nb_articles > 0 ? v.ca_ht / v.nb_articles : 0,
```

---

## Notes

- Les calculs de **CA HT/TTC** sont corrects (lignes 566-567)
- Les **CA par segment** sont en TTC (c'est correct pour le reporting de CA)
- Seuls les **KPIs de panier/prix moyen** doivent être en HT
- Les boutiques **sont bien isolées** (filtres `boutique_id` présents partout)

---

**Statut après correction** : Tous les KPIs seront en HT comme prévu
