# Contrat HMAC — Pseudonymisation de l'identifiant de badge

**Référence :** SPEC_TECHNIQUE §4.1 (« Minimisation à la source »), §7.3 ; NOTE_JURIDIQUE §3.4, §4.
**Exigence bloquante :** l'UID d'un badge n'est **jamais** stocké, journalisé ni transmis en clair
par le poste — ni sur disque, ni dans les logs, ni dans les réponses d'API, ni dans les traces
d'erreur. Seul le condensat `uid_hmac` circule.

## 1. Dérivation

```
uid_hmac = HMAC-SHA256(cle_site, uid_normalise)        → hex minuscule, 64 caractères
```

- `cle_site` : clé de 256 bits (32 octets) propre au **site** (pas au poste), générée par le
  serveur (`crypto.randomBytes(32)`), encodée hex.
- `uid_normalise` : voir §2.
- L'implémentation de référence est **identique côté poste (Python `hmac`/`hashlib`) et côté
  serveur (Node `crypto.createHmac`)** ; un vecteur de test partagé fige le contrat (§4).

## 2. Normalisation de l'UID

Les lecteurs USB HID livrent l'UID sous des formes variables (casse, séparateurs, ordre des
octets, sortie décimale). Normalisation appliquée **avant** tout calcul :

1. retirer tout caractère hors `[0-9A-Fa-f]` (espaces, `:`, `-`, retours chariot du mode clavier) ;
2. passer en **majuscules** ;
3. si la chaîne est purement décimale ET de longueur 10 (lecteur configuré en décimal),
   la convertir en hexadécimal sur 8 caractères, zéro-paddée à gauche —
   ce cas est signalé dans le heartbeat (`reader_mode: "decimal"`) car la spec §3.6 exige de
   reconfigurer le lecteur en hexadécimal ;
4. longueurs acceptées : 8, 14 ou 20 caractères hex (UID 4, 7 ou 10 octets ISO14443A).
   Toute autre longueur → lecture rejetée localement avec écran d'erreur (PST-04, badge illisible),
   **aucun enregistrement** (on ne met pas en file une lecture non conforme au contrat).

L'UID brut vit uniquement en mémoire vive le temps du calcul (variable locale, jamais loguée).

## 3. Cycle de vie de la clé de site

| Étape | Mécanisme |
|---|---|
| Génération | Serveur, à la création du site badgeuse (`crypto.randomBytes(32)`) |
| Stockage serveur | Table `settings`, clé `badgeuse.hmac_key_site_<site_id>`, **chiffrée AES-256-GCM** (même mécanisme que les secrets SumUp) |
| Distribution au poste | Une seule fois, à l'appairage : l'ADMIN copie la clé depuis le back-office (écran Supervision → Appairage) dans `/etc/badgeuse/badgeuse.conf` sur le poste (fichier `0600`, propriétaire `badgeuse`, hors dépôt Git) |
| Rotation | Annuelle ou sur compromission : nouvelle clé générée serveur, recalcul des `uid_hmac` de la table `badgeuse_badges` par re-présentation des badges (campagne), ou ré-encodage administratif badge par badge. La rotation invalide le cache poste : resynchronisation complète |
| Interdictions | Jamais dans Git, jamais dans les logs, jamais dans une réponse d'API device |

L'attribution d'un badge se fait côté serveur par **présentation du badge sur un poste appairé**
(mode « enrôlement » commandé depuis le back-office) ou par saisie du `uid_hmac` retourné par le
poste — le serveur ne connaît donc jamais l'UID en clair non plus. Défense en profondeur : même
la base serveur ne permet pas de cloner un badge.

## 4. Vecteur de test partagé (fige le contrat)

```
cle_site (hex) : 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
uid lu         : "04 A2 3B 1C"        → normalisé : "04A23B1C"
uid_hmac       : HMAC-SHA256(bytes(cle_hex), "04A23B1C") =
                 6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8
```

*(Valeur calculée par implémentation de référence Python `hmac`/`hashlib`. Les tests des deux
piles — `backend/tests/unit/utils/badgeuse-crypto.test.js` et `badgeuse/agent/tests/test_hmac.py` —
DOIVENT produire ce même condensat.)*

Vecteur de chaîne d'intégrité associé (cf. CONTRAT_INTEGRITE.md) :
```
genesis("LH-P1")        = SHA256("genesis:LH-P1")
                        = 07b7f5a016835efbc0fc3d021acfbae7a1e74f063531d133e2bab27b8207b1ab
canonical (exemple)     = "11111111-2222-4333-8444-555555555555|LH-P1|1|6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8|2026-08-17T06:58:12.031Z|entree|badge"
hash_courant            = SHA256(genesis || canonical)
                        = 07914d17bc6248178da6c6e859fc48b8d7dfa4d04e0b61f5a081ad4d3c8ff3ed
```

Points de contrat critiques : la clé est décodée **d'hex vers octets** avant HMAC ; le message
est la chaîne ASCII de l'UID normalisé (pas ses octets décodés).
