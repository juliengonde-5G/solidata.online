# Configuration PowerAutomate - Webhook Boutiques

**Problème** : PowerAutomate retourne erreur `Unauthorized` (401)  
**Cause** : Variable d'environnement `BOUTIQUE_WEBHOOK_SECRET` non définie  
**Status** : ✅ Corrigé

---

## 🔴 Problème identifié

Le webhook PowerAutomate n'est pas configuré. Le endpoint `/api/boutique-ventes/webhook-email` attend :

```
Header: X-Webhook-Secret: <BOUTIQUE_WEBHOOK_SECRET>
```

Mais la variable d'environnement côté serveur est **vide**.

---

## ✅ Solution - Configuration requise

### 1️⃣ Générer le secret (une fois)

```bash
# Sur le serveur ou en local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Résultat attendu : chaîne hex de 64 caractères
# Exemple : c03a8d3128847f02d90ec0e0c5fe5c896040fee33789c196443caced8cfb24e2
```

### 2️⃣ Configurer le serveur

**Fichier** : `/opt/solidata.online/.env` (production) ou `backend/.env` (dev)

```bash
# Ajouter cette ligne :
BOUTIQUE_WEBHOOK_SECRET=c03a8d3128847f02d90ec0e0c5fe5c896040fee33789c196443caced8cfb24e2

# (Remplacer par la valeur générée à l'étape 1)
```

**Puis redémarrer** :

```bash
# Production
docker compose -f docker-compose.prod.yml restart solidata-api

# Développement
npm restart  # ou `npm run dev`
```

### 3️⃣ Configurer PowerAutomate

Dans l'action HTTP Power Automate, **vérifier/mettre à jour** :

```json
{
  "type": "Http",
  "inputs": {
    "uri": "https://solidata.online/api/boutique-ventes/webhook-email",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "X-Webhook-Secret": "c03a8d3128847f02d90ec0e0c5fe5c896040fee33789c196443caced8cfb24e2"
    },
    "body": {
      "boutique_code": "st_sever",
      "attachments": "@{triggerOutputs()?['body/attachments']}"
    }
  }
}
```

**Important** : Le secret PowerAutomate (header) **DOIT correspondre exactement** au secret serveur.

---

## 🧪 Test du webhook

### Via curl (debug)

```bash
# Tester avec le bon secret
curl -X POST https://solidata.online/api/boutique-ventes/webhook-email \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: c03a8d3128847f02d90ec0e0c5fe5c896040fee33789c196443caced8cfb24e2" \
  -d '{
    "boutique_code": "st_sever",
    "filename": "test.csv",
    "content": "Rayon;Date;...\nFEMME;01/05/2026 10:00:00;..."
  }'

# Résultat attendu :
# {"status":"ok"} ou {"status":"duplicate"} (pas 401 Unauthorized)
```

### Via PowerAutomate

1. Exécuter le flow
2. Vérifier le résultat dans l'historique des exécutions
3. Le webhook doit retourner `200 OK` avec status `"ok"` ou `"duplicate"`

---

## 🔒 Sécurité

✅ **Bonnes pratiques appliquées** :

1. **Secret long** : 64 caractères (256 bits d'aléa)
2. **Transmission HTTPS** : Endpoint HTTPS only
3. **Header sécurisé** : X-Webhook-Secret (pas en URL)
4. **Matching strict** : Le secret serveur DOIT égaler le secret PowerAutomate
5. **Pas de JWT** : Le webhook n'a pas besoin d'authentification JWT (secret suffit)

---

## 📝 Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `backend/.env.example` | Ajout var `BOUTIQUE_WEBHOOK_SECRET` |
| `docker-compose.yml` | Déjà référencé |
| `docker-compose.prod.yml` | Déjà référencé |

---

## 🚀 Déploiement

**Production** :

```bash
# 1. SSH serveur
ssh root@51.159.144.100

# 2. Générer le secret (une fois)
cd /opt/solidata.online
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > secret.txt
cat secret.txt  # Copier la valeur

# 3. Ajouter à .env
echo "BOUTIQUE_WEBHOOK_SECRET=<VALEUR_COPIEE>" >> .env

# 4. Redémarrer
docker compose -f docker-compose.prod.yml restart solidata-api

# 5. Vérifier logs
docker compose -f docker-compose.prod.yml logs solidata-api -f
```

**Développement** :

```bash
# Dans backend/.env, ajouter :
BOUTIQUE_WEBHOOK_SECRET=c03a8d3128847f02d90ec0e0c5fe5c896040fee33789c196443caced8cfb24e2

# Redémarrer le serveur
npm run dev
```

---

## 🆘 Dépannage

| Erreur | Cause | Solution |
|--------|-------|----------|
| `503 Service Unavailable` | `BOUTIQUE_WEBHOOK_SECRET` vide | Définir la variable .env |
| `401 Unauthorized` | Secret non-matchant | Vérifier PowerAutomate = serveur |
| `400 Bad Request` | Pas d'attachement CSV | Vérifier format Power Automate |
| `404 Not Found` | Boutique non trouvée | Vérifier `boutique_code` valide |

---

**Commit** : Ajout `BOUTIQUE_WEBHOOK_SECRET` à `.env.example`  
**Status** : ✅ Prêt pour configuration

---

### Rappel : Valeurs possibles pour PowerAutomate

PowerAutomate peut utiliser 4 formats de payload :

1. **CSV en base64** :
   ```json
   { "boutique_code": "st_sever", "content_base64": "..." }
   ```

2. **Attachement Outlook** :
   ```json
   { "boutique_code": "st_sever", "attachment": { "name": "file.csv", "contentBytes": "..." } }
   ```

3. **Liste d'attachements** :
   ```json
   { "boutique_code": "st_sever", "attachments": [ { "name": "file.csv", "contentBytes": "..." } ] }
   ```

4. **Contenu en clair** :
   ```json
   { "boutique_code": "st_sever", "filename": "file.csv", "content": "..." }
   ```

Le webhook détecte automatiquement le format.
