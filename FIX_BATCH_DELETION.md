# Fix: Batch Suppression Boutiques

**Date** : 2026-05-01  
**Problème** : Le batch de suppression des imports ne marche plus  
**Cause** : Violation de contrainte FK due à l'ordre de suppression

---

## 🔴 Problème identifié

### Schéma des relations FK

```
boutique_import_batches (id)
  ├─ boutique_ventes.batch_id → ON DELETE CASCADE ✓
  └─ boutique_tickets.batch_id → (pas de CASCADE, mais migré)

boutique_tickets (id)
  ├─ boutique_ventes.ticket_id → (FK normal, pas de CASCADE)
  └─ (référencée par boutique_ventes)
```

### Scénario d'erreur (ancien code)

```sql
1. DELETE FROM boutique_tickets WHERE batch_id = $1;  ← Supprime les tickets
2. DELETE FROM boutique_import_batches WHERE id = $1; ← BOOM ! FK violation

Pourquoi ? Parce que :
- boutique_ventes.batch_id → boutique_import_batches(id) ON DELETE CASCADE
- Quand on supprime le batch, CASCADE delete les ventes
- Mais les ventes référencent toujours boutique_tickets(id)
- Les tickets ont déjà été supprimés → FK orpheline
```

---

## ✅ Solution implémentée

### Ordre correct de suppression

```sql
1. DELETE FROM boutique_ventes WHERE batch_id = $1;    ← Ventes d'abord
2. DELETE FROM boutique_tickets WHERE batch_id = $1;   ← Puis tickets
3. DELETE FROM boutique_import_batches WHERE id = $1;  ← Enfin batch
```

### Fichiers modifiés

**`backend/src/routes/boutique-ventes.js`** (DELETE /batches/:id)

```javascript
// Avant (ERREUR)
await client.query('DELETE FROM boutique_tickets WHERE batch_id = $1');
await client.query('DELETE FROM boutique_import_batches WHERE id = $1');

// Après (CORRECT)
await client.query('DELETE FROM boutique_ventes WHERE batch_id = $1');
await client.query('DELETE FROM boutique_tickets WHERE batch_id = $1');
await client.query('DELETE FROM boutique_import_batches WHERE id = $1');
```

---

## 🔒 Robustesse additionnelle

La migration existante (init-db.js:3050-3064) ajoute déjà `ON DELETE CASCADE` à `boutique_tickets.batch_id` :

```sql
ALTER TABLE boutique_tickets
  ADD CONSTRAINT boutique_tickets_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES boutique_import_batches(id) ON DELETE CASCADE;
```

Cela signifie que même avec l'ancien code, si cette migration a été exécutée, ça devrait fonctionner. Mais l'ordre explicite dans le code est plus sûr.

---

## 🧪 Test de vérification

Pour vérifier que la suppression fonctionne :

```bash
# 1. Via l'interface web
# - Aller sur /boutiques/import
# - Sélectionner une boutique
# - Cliquer sur le bouton "Supprimer" d'un batch
# - Doit afficher "Batch supprimé" sans erreur

# 2. Via API
curl -X DELETE http://localhost:3001/api/boutique-ventes/batches/[BATCH_ID] \
  -H "Authorization: Bearer $TOKEN"
# Doit retourner : {"success": true, "message": "Batch supprimé avec toutes ses données"}
```

---

## 📝 Notes pour la base de données

Si vous avez une ancienne base sans la migration CASCADE :
- La suppression peut encore échouer
- Solution : Exécuter init-db.js qui ajoutera le CASCADE
- Ou : Appliquer manuellement l'ALTER TABLE

---

**Commit** : `ace97fa`  
**Status** : ✅ Corrigé et testé
