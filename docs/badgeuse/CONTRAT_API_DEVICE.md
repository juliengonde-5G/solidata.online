# Contrat d'API Device v1 — Poste de pointage ↔ SOLIDATA

**Consommateur :** `badgeuse/agent` (Python, Raspberry Pi). **Producteur :** module
« Temps & Présence » (`backend/src/routes/badgeuse.js`). Ce document est le contrat qui permet
aux deux développements d'avancer en parallèle (rôle de l'OpenAPI d'A1, cf. ADR-0001).

## 1. Généralités

- Base : `https://solidata.online/api/badgeuse/device/v1`
- **Surface publique** montée AVANT le middleware `authenticate` (pattern webhook SumUp /
  enquêtes publiques), authentifiée par en-tête **`X-Device-Key`**.
- La clé device (256 bits hex) est générée par le serveur à l'appairage ; en base n'est stocké
  que son **hash SHA-256** ; la comparaison est à **temps constant** (`crypto.timingSafeEqual`).
- Le `:code` d'URL identifie le poste (ex. `LH-P1`). Clé inconnue/poste inactif → `401`
  (générique, sans détail). Limitation de débit par device (`express-rate-limit`).
- Toutes les réponses sont JSON UTF-8 ; horodatages **UTC ISO 8601**.
- **Aucun UID en clair, aucun nom complet** ne transite : uniquement `uid_hmac`, `prenom`,
  `initiale_nom`.

## 2. Endpoints

### 2.1 `POST /devices/:code/pointages` — dépôt d'un lot (idempotent)

Corps :
```json
{
  "pointages": [
    {
      "uuid": "0193a1c2-7e11-7cc3-9df0-5b2f7c9e0a11",
      "sequence_device": 42,
      "uid_hmac": "a1e0…f2a",
      "horodatage_utc": "2026-08-17T06:58:12.031Z",
      "horodatage_local": "2026-08-17T08:58:12",
      "fuseau": "Europe/Paris",
      "sens": "entree",
      "source": "badge",
      "hash_precedent": "…64hex…",
      "hash_courant": "…64hex…"
    }
  ]
}
```
Contraintes : lot ≤ 100, ordonné par `sequence_device` croissant. `sens` ∈
`entree|sortie|inconnu`, `source` ∈ `badge|manuel|import`.

Réponse `200` — **toujours par élément**, jamais d'échec silencieux (PST-04/05) :
```json
{
  "resultats": [
    { "uuid": "0193…0a11", "status": "ok" },
    { "uuid": "0193…0a12", "status": "duplicate" },
    { "uuid": "0193…0a13", "status": "orphan",       "raison": "badge_inconnu" },
    { "uuid": "0193…0a14", "status": "ok", "avertissement": "chain_broken" },
    { "uuid": "0193…0a15", "status": "orphan",       "raison": "hors_plage" }
  ],
  "server_time_utc": "2026-08-17T06:58:13.412Z"
}
```
- `ok` / `duplicate` / `orphan` sont tous des **accusés de réception** : le poste purge
  l'élément de sa file (PST-05). Un pointage `orphan` est stocké côté serveur en statut
  `orphelin` pour traitement RH (BO-05) — jamais rejeté.
- `400` uniquement pour un lot syntaxiquement invalide (le poste conserve alors sa file et
  lève une alerte heartbeat).
- `server_time_utc` sert au poste à mesurer sa dérive d'horloge (PST-07).

### 2.2 `GET /devices/:code/badges` — cache des badges actifs (ETag)

En-tête requête : `If-None-Match: "<etag>"` → `304` sans corps si inchangé.
Réponse `200` :
```json
{
  "etag": "W/\"b7-1755264000\"",
  "badges": [
    { "uid_hmac": "a1e0…f2a", "salarie_id": 123, "prenom": "Karim", "initiale_nom": "B" }
  ]
}
```
**Rien d'autre** ne figure dans ce cache (exigence A5 : ni nom complet, ni statut, ni équipe).
Seuls les badges `statut='actif'` sont servis.

### 2.3 `GET /devices/:code/config` — paramètres d'affichage et de capture (ETag)

```json
{
  "etag": "…",
  "config": {
    "overlay_duree_sec": 5,
    "anti_rebond_sec": 8,
    "affichage_cumul_hebdo": false,
    "plage_acceptation": { "debut": "05:00", "fin": "21:00" },
    "dpms": { "extinction": "21:30", "allumage": "05:30" },
    "heartbeat_interval_sec": 60,
    "sync_badges_interval_sec": 300,
    "sync_playlist_interval_sec": 900
  }
}
```
`overlay_duree_sec` est borné 3–8 **côté serveur** (le poste re-borne aussi : double plafond,
exigence juridique §3.5). La plage d'acceptation est appliquée par le **serveur** (statut
`orphelin` hors plage) — le poste enregistre tout ; elle est transmise à titre informatif.

### 2.4 `GET /devices/:code/playlist` — contenus de veille (ETag)

```json
{
  "etag": "…",
  "elements": [
    {
      "id": 7, "type": "message", "titre": "Consigne sécurité",
      "corps": "Port des gants obligatoire zone tri", "media_url": null,
      "duree_sec": 12, "ordre": 1
    }
  ]
}
```
`type` ∈ `message|image|planning|compte_a_rebours|meteo` (AFF-05). Seuls les éléments actifs,
dans leur fenêtre de validité, ciblant le site du poste, sont servis. La dernière playlist
reçue est rejouée hors ligne (AFF-07). Aucune donnée personnelle dans ces contenus
(NOTE_JURIDIQUE §3.2 : finalité communication interne dissociée).

### 2.5 `POST /devices/:code/heartbeat`

```json
{
  "version": "1.0.0",
  "horloge_utc": "2026-08-17T06:58:12Z",
  "derive_estimee_sec": 0.4,
  "taille_file": 0,
  "temperature_cpu": 52.1,
  "disque_libre_mo": 180432,
  "cible": "pi5",
  "reader_mode": "hex",
  "throttled": false
}
```
Réponse : `{ "status": "ok", "server_time_utc": "…" }`. Le serveur met à jour
`dernier_heartbeat`, `version_logicielle`, journalise les anomalies (dérive > 2 s, throttling,
file qui gonfle) et alimente la supervision BO-09 (alerte si silence > 15 min).

## 3. Codes d'erreur

| Code | Cas |
|---|---|
| `401 {"error":"unauthorized"}` | Clé absente/incorrecte/poste inactif — message générique |
| `400 {"error":"invalid_payload","detail":"…"}` | Lot malformé (jamais pour un badge inconnu) |
| `429` | Débit dépassé |
| `503` | Maintenance — le poste garde sa file et réessaie (backoff expo plafonné 5 min) |

## 4. Matrice de couverture (exigences → endpoint)

| Exigence | Couverte par |
|---|---|
| PST-04 (orphelin, jamais silencieux) | §2.1 `status:"orphan"` stocké serveur |
| PST-05 (purge sur accusé uniquement) | §2.1 statuts par élément |
| PST-06 (sync 5/15 min, ETag) | §2.2, §2.3, §2.4 |
| PST-07 (heartbeat 60 s) | §2.5 |
| AFF-02 (cumul hebdo désactivé par défaut) | §2.3 `affichage_cumul_hebdo` |
| AFF-05/07 (playlist, hors ligne) | §2.4 |
| BO-09 (supervision, alerte silence) | §2.5 |
| Idempotence / chaîne d'intégrité | §2.1 + CONTRAT_INTEGRITE.md |
| Minimisation (prénom + initiale) | §2.2 |
