# Recommandations matériel — Système de pointage par badge

## Contexte

- **~40 collaborateurs** (managers + bénéficiaires) au centre de tri + logistique
- **1 seul point de badgeage** (entrée du bâtiment, intérieur)
- Connexion **Ethernet** vers le VPS Scaleway
- Alimentation secteur disponible
- Badges **à acquérir** (pas de matériel existant)

---

## Option recommandée : Lecteur NFC USB/Ethernet + Raspberry Pi

### Architecture

```
[Badge MIFARE 13.56MHz] → [Lecteur NFC USB] → [Raspberry Pi 4] → [Ethernet] → [VPS Scaleway / Solidata API]
```

### Matériel

| Composant | Modèle recommandé | Prix unitaire HT | Qté | Total HT |
|---|---|---|---|---|
| **Raspberry Pi 4 Model B 4Go** | Raspberry Pi 4B (boîtier + alim) | ~80 € | 1 | 80 € |
| **Lecteur NFC USB** | ACR122U (ACS) — NFC 13.56MHz ISO 14443 | ~35 € | 1 | 35 € |
| **Carte microSD 32Go** | SanDisk Endurance | ~12 € | 1 | 12 € |
| **Badges MIFARE Classic 1K** | Cartes PVC ISO 14443A | ~0,80 € | 50 | 40 € |
| **Porte-badges + cordons** | Porte-badge vertical + cordon | ~1,50 € | 50 | 75 € |
| **Onduleur mini** | APC Back-UPS 400VA (optionnel) | ~60 € | 1 | 60 € |
| **Écran LCD 7" (optionnel)** | Écran tactile Raspberry Pi 7" | ~70 € | 1 | 70 € |
| | | | **TOTAL** | **~372 €** |

> **Note** : L'écran tactile est optionnel mais recommandé pour afficher un retour visuel lors du badgeage (nom, heure, "Bonjour X !").

### Variante économique (sans écran)

| Composant | Total |
|---|---|
| Raspberry Pi 4 + boîtier + alim | 80 € |
| Lecteur ACR122U | 35 € |
| MicroSD 32Go | 12 € |
| 50 badges MIFARE | 40 € |
| 50 porte-badges + cordons | 75 € |
| **TOTAL** | **~242 €** |

Le retour visuel se fait alors par un buzzer + LED (vert = OK, rouge = erreur).

---

## Option alternative : Lecteur autonome Ethernet

### Matériel

| Composant | Modèle | Prix HT |
|---|---|---|
| **Lecteur RFID Ethernet** | ZKTeco SF300 ou Suprema BioLite N2 | 200-400 € |
| **Badges MIFARE** | 50 × cartes 13.56MHz | 40 € |

**Avantage** : Pas de Raspberry Pi à maintenir.
**Inconvénient** : API propriétaire, intégration plus complexe, coût plus élevé.

---

## Recommandation finale

**L'option Raspberry Pi + ACR122U est recommandée** pour les raisons suivantes :

1. **Coût maîtrisé** (~250-370 € tout compris)
2. **100% compatible Solidata** — le script Python/Node sur le Pi appelle directement l'API REST
3. **Personnalisable** — affichage, sons, messages adaptés
4. **Maintenable** — code open source, pas de licence logicielle
5. **Robuste** — Linux embarqué, redémarrage automatique, watchdog
6. **Évolutif** — ajout d'un 2e lecteur possible (boutique, etc.)

### Logiciel embarqué sur le Raspberry Pi

Le Raspberry Pi exécute un script Node.js qui :
1. Écoute le lecteur NFC en continu (via `nfc-pcsc`)
2. Lit l'UID du badge MIFARE présenté
3. Envoie une requête `POST /api/pointage/badge` à Solidata
4. Reçoit la réponse (accepté/refusé/doublon)
5. Affiche le résultat (écran/LED/buzzer)
6. Stocke localement les événements en cas de perte réseau (mode offline)

### Fournisseurs recommandés

- **Raspberry Pi** : Kubii.fr, Melopero, Amazon
- **ACR122U** : Amazon, ACS direct, LDLC
- **Badges MIFARE** : Amazon (lot de 50), BadgePass, RapidPOS
- **Porte-badges** : Amazon, Bureau Vallée (lot pro)

---

## Spécifications techniques des badges

| Paramètre | Valeur |
|---|---|
| **Technologie** | MIFARE Classic 1K (NXP) |
| **Fréquence** | 13.56 MHz (ISO 14443A) |
| **UID** | 4 ou 7 octets, unique par carte |
| **Distance lecture** | 2-5 cm |
| **Format** | Carte PVC ISO CR80 (format CB) |
| **Durée de vie** | 100 000 lectures minimum |
| **Personnalisation** | Impression logo Solidarité Textiles possible |

---

## Installation physique

1. **Emplacement** : Mur à l'entrée du centre de tri, hauteur ~1,20m
2. **Fixation** : Boîtier mural pour Raspberry Pi + lecteur NFC
3. **Câblage** : Câble Ethernet vers la prise murale + alimentation secteur
4. **Signalétique** : Autocollant "Badgez ici" avec pictogramme NFC
5. **Protection** : Boîtier IP20 (intérieur) avec ventilation passive
