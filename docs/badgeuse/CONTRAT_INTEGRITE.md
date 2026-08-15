# Contrat d'intégrité — Chaînage cryptographique des pointages

**Référence :** SPEC_TECHNIQUE §4.1 (« Inaltérabilité »), NOTE_JURIDIQUE §4 (caractère « fiable »
au sens CJUE *CCOO*, force probatoire).

## 1. Principe

Chaque pointage porte un hash qui chaîne l'enregistrement au précédent **du même poste** :

```
hash_courant = SHA256( hash_precedent || canonical(pointage) )    → hex minuscule, 64 car.
```

La chaîne est **par device** (un poste = une chaîne), ordonnée par `sequence_device`
(entier monotone strictement croissant, généré par le poste, jamais réutilisé).

## 2. Charge utile canonique

`canonical(pointage)` est la concaténation, séparateur `|`, dans CET ordre, sans espaces :

```
uuid | device_code | sequence_device | uid_hmac | horodatage_utc_iso | sens | source
```

- `uuid` : UUID v4 généré par le poste (idempotence) ;
- `device_code` : code du poste (ex. `LH-P1`) ;
- `sequence_device` : entier en base 10, sans zéros de tête ;
- `uid_hmac` : hex minuscule 64 car. (`-` littéral pour un pointage manuel sans badge) ;
- `horodatage_utc_iso` : `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC, millisecondes, `Z` littéral) ;
- `sens` : `entree` | `sortie` | `inconnu` (badge orphelin : le sens n'est pas déterminable) ;
- `source` : `badge` | `manuel` | `import`.

Exemple :
```
canonical = "0193a1c2-...-...|LH-P1|42|a1e0d1a9...f2a|2026-08-17T06:58:12.031Z|entree|badge"
```

## 3. Initialisation et calcul

- **Genèse** : pour le premier pointage d'un device, `hash_precedent = SHA256("genesis:" + device_code)`.
- Le **poste** calcule `hash_courant` au moment de l'enregistrement local (avant mise en file) :
  la chaîne est donc formée dès la capture, hors ligne compris.
- Le **serveur**, à la réception :
  1. vérifie `hash_courant` recalculé = `hash_courant` reçu (payload non altéré en transit) ;
  2. vérifie `hash_precedent` reçu = `hash_courant` du dernier pointage stocké pour ce device
     (`sequence_device` max < séquence reçue) — les lots étant ordonnés par séquence ;
  3. en cas de rupture : le pointage est **stocké quand même** (aucune heure ne se perd),
     marqué `chaine_valide = false`, et une alerte `chain_broken` est journalisée + visible
     en supervision (BO-09). On n'efface jamais une preuve, même imparfaite.

## 4. Vérification a posteriori

Endpoint back-office `GET /api/badgeuse/devices/:id/verify-chain?du=&au=` (ADMIN/RH) :
re-parcourt la chaîne stockée et rend `{ ok, total, ruptures: [{sequence, attendu, trouve}] }`.
Un test automatisé prouve qu'une modification directe en base (UPDATE d'un horodatage) est
détectée par cette vérification (exigence A4/A5).

## 5. Corrections

Les corrections (`badgeuse_pointage_corrections`) ne participent **pas** à la chaîne des
pointages bruts : elles forment leur propre piste d'audit (auteur, date, motif, enregistrement
d'origine intact). La chaîne prouve l'intégrité de la **capture** ; la table de corrections
prouve la traçabilité du **traitement**. Aucune suppression physique n'existe sur la table des
pointages (ni endpoint, ni requête DELETE dans le code).

## 6. Idempotence

Le rejeu d'un pointage (même `uuid`) répond `200` avec `{status:"duplicate"}` sans insertion.
Contrainte d'unicité en base sur `uuid` ET sur `(device_id, sequence_device)`.
