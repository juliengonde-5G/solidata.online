# NOTE TECHNIQUE — Projet « Badgeuse SOLIDATA »

**Émetteur :** Chargé de développement projet — Pôle SI / Transformation numérique
**Destinataire :** Direction, Solidarité Textiles (ACI — Le Houlme, 76)
**Objet :** Faisabilité, architecture et plan de réalisation d'un poste de pointage RFID sur Raspberry Pi, connecté à SOLIDATA, avec affichage dynamique
**Version :** 1.2 — Août 2026
**Classement :** Interne

---

## 1. Objet et périmètre

Mise en place d'un **poste de pointage unique** (extensible à N postes) composé :

1. d'un **lecteur de badge RFID sans contact** ;
2. d'un **écran d'affichage** installé au point de passage ;
3. d'un **Raspberry Pi 5 (4 Go)** faisant office de contrôleur, le **Raspberry Pi 3 B+ déjà détenu** étant reversé au rôle de poste de secours préconfiguré ;
4. d'un **module « Temps & Présence » développé dans SOLIDATA** (back-office, API, restitutions paie / IAE).

L'écran a **deux états** :

- **État « veille » (par défaut)** : diffusion d'une playlist de contenus paramétrables depuis SOLIDATA (messages de direction, consignes sécurité, planning atelier, informations d'accompagnement socio-professionnel, événements) ;
- **État « badge » (transitoire, 4 à 6 secondes)** : incrustation d'un bandeau de confirmation avec les informations du salarié, puis retour automatique en veille.

Périmètre exclu de cette phase : contrôle d'accès physique (gâche, tourniquet), biométrie, géolocalisation, interfaçage direct avec un logiciel de paie tiers (export fichier uniquement en V1).

---

## 2. Verdict de compatibilité du matériel existant

### 2.1 Historique de la décision

La version 1.0 de cette note concluait à la compatibilité du **Raspberry Pi 3 B+** déjà détenu, sous trois réserves : absence d'horloge temps réel, fragilité de la carte microSD en fonctionnement continu, et contrainte de mémoire (1 Go) limitant l'interface d'affichage.

Après arbitrage, la cible retenue est le **Raspberry Pi 5 4 Go**. Ce n'est pas un choix de puissance : pour deux à quatre lectures de badge par personne et par jour et un diaporama HTML, le Pi 3 B+ n'aurait jamais saturé. **C'est un choix de robustesse et de durée de vie** : le Pi 5 fait disparaître deux des trois réserves par construction, et non par contournement logiciel.

### 2.2 Le Raspberry Pi 5 4 Go

| Caractéristique Pi 5 | Besoin projet | Verdict |
|---|---|---|
| CPU Cortex-A76 4 cœurs 2,4 GHz | Agent + navigateur kiosque | ✅ Très largement suffisant |
| 4 Go de RAM | Interface d'affichage | ✅ Contrainte de poids levée |
| **Horloge temps réel intégrée** (connecteur de pile dédié) | Horodatage de preuve | ✅ **Réserve n°1 levée** |
| **Port PCIe 2.0** → démarrage sur SSD NVMe | Fonctionnement 24/7 | ✅ **Réserve n°2 levée à la racine** |
| 2 × micro-HDMI 4Kp60 | Écran 24" Full HD | ✅ Suffisant — *adaptateur micro-HDMI requis* |
| 2 × USB 3.0 + 2 × USB 2.0 | Lecteur RFID, onduleur | ✅ Suffisant |
| Ethernet gigabit + Wi-Fi 5 | Sync | ✅ Suffisant |
| Bouton d'alimentation, arrêt propre | Exploitation | ✅ Confort réel en atelier |
| **Support constructeur annoncé jusqu'en 2036** | Équipement mural durable | ✅ *(Pi 3 B+ : janvier 2028)* |
| Alimentation 5 V / 5 A USB-C + refroidissement actif | — | ⚠️ Obligatoires, non optionnels |
| **Pas de décodage matériel H.264** (HEVC seul) | Vidéo dans la playlist | ⚠️ Décodage logiciel — sans difficulté en 1080p |

### 2.3 Ce que le changement de cible modifie

**Réserve n°1 — Horodatage : levée.** Le Pi 5 embarque une horloge temps réel avec connecteur de pile. Le module externe DS3231 et son câblage I²C disparaissent de la nomenclature ; il suffit d'une **pile RTC officielle**. Le principe reste inchangé : NTP en source primaire, RTC en repli, journalisation de toute dérive supérieure à 2 secondes.

**Réserve n°2 — Intégrité du stockage : levée à la racine.** Le port PCIe permet de démarrer sur un **SSD NVMe** via un HAT M.2. **La carte microSD disparaît complètement du chemin critique** — c'était le premier facteur de panne d'un poste allumé en permanence. C'est structurellement supérieur au palliatif logiciel (rootfs en lecture seule) prévu en v1.0.

Le rootfs en lecture seule reste néanmoins **conservé au titre de la défense en profondeur** : il protège l'intégrité du système lors des coupures brutales, quel que soit le support. Il n'y a aucune raison de renoncer à une mesure qui ne coûte rien.

**Réserve n°3 — Performance d'affichage : levée.** Avec 4 Go de RAM, la contrainte de poids de l'interface tombe. La discipline reste toutefois recommandée : **la playlist demeure en HTML/CSS et images optimisées**, et la vidéo, désormais possible, est limitée à du 1080p H.264 en décodage logiciel. Un appareil qui tourne sans surveillance a tout à gagner à rester frugal.

### 2.4 Points de vigilance propres au Pi 5

| Point | Conséquence |
|---|---|
| **Sortie micro-HDMI** | Câble ou adaptateur micro-HDMI → HDMI indispensable. Vérifier sa présence dans le kit. |
| **Alimentation 5 V / 5 A** | L'alimentation officielle 27 W est requise. Une alimentation de Pi 4 provoque un bridage des ports USB. |
| **Refroidissement actif obligatoire** | Ventilateur officiel ou boîtier ventilé. Sans lui, bridage thermique. **En atelier textile, prévoir un dépoussiérage semestriel du ventilateur** — l'environnement est chargé en fibres. |
| **Carte microSD du kit** | Les cartes fournies dans les kits ne sont pas des cartes haute endurance. À réserver au rôle de **carte de secours clonée**, jamais au fonctionnement continu. |
| **Démarrage NVMe** | Nécessite un paramétrage de l'EEPROM (ordre de démarrage, activation PCIe). À scripter dans la procédure d'installation, pas à faire à la main. |
| **PoE et M.2 simultanés** | L'empilement d'un HAT PoE et d'un HAT M.2 est mécaniquement contraint. **Choisir : soit PoE, soit NVMe.** Recommandation : NVMe + alimentation secteur. |

### 2.5 Le Pi 3 B+ n'est pas perdu

Le Pi 3 B+ déjà détenu devient le **poste de secours préconfiguré**, avec sa propre carte microSD clonée et son propre appairage à SOLIDATA. En cas de panne matérielle un lundi matin, on débranche, on rebranche, l'atelier pointe. C'est exactement ce que la procédure d'exploitation exigeait de toute façon — le changement de cible le finance sans surcoût.

**Conclusion :** cible **Raspberry Pi 5 4 Go avec démarrage NVMe**, complément d'équipement d'environ **440 à 520 € TTC** détaillé ci-après, soit un surcoût de l'ordre de **+ 120 à + 150 €** par rapport à la configuration v1.0 — pour la suppression de deux modes de panne et huit années de support supplémentaires.

---

## 3. Nomenclature du matériel (BOM) — cible Pi 5

Prix indicatifs TTC, sourcing Amazon.fr ou distributeur pro équivalent (Kubii, Lextronic, RS). Les ASIN sont donnés à titre de repère : ils évoluent, **valider la fiche produit avant commande**.

### 3.1 Cœur du poste

| # | Poste | Référence / caractéristique | Qté | € TTC |
|---|---|---|---|---|
| 1 | **Raspberry Pi 5 — kit de démarrage 4 Go** | Doit impérativement comprendre : alimentation officielle **5 V / 5 A USB-C 27 W**, **refroidissement actif**, boîtier, **câble micro-HDMI → HDMI**. Vérifier ces quatre points avant achat. | 1 | 120 |
| 2 | **Pile RTC officielle Raspberry Pi** | Connecteur JST-SH 2 broches — remplace le module DS3231 de la v1.0 | 1 | 7 |
| 3 | **HAT M.2 (PCIe → NVMe)** | HAT M.2 officiel ou équivalent, format 2230/2242 | 1 | 18 |
| 4 | **SSD NVMe 256 Go** | Format 2242, marque établie. Le poste démarre dessus ; **plus aucune carte SD en fonctionnement.** | 1 | 32 |
| | | | **Sous-total** | **≈ 177 €** |

### 3.2 Périphériques

| # | Poste | Référence / caractéristique | ASIN repère | Qté | € TTC |
|---|---|---|---|---|---|
| 5 | Lecteur RFID USB 13,56 MHz | Émulation clavier HID, ISO14443A, MIFARE Classic/DESFire, **sortie UID hexadécimale paramétrable** — *Yarongtech USB 13,56 MHz*, *Promag PCR330M* ou *IC06* | `B078ST4S6Y` | 1 | 30 |
| 6 | Badges MIFARE Classic 1K | Cartes ISO format CB, imprimables, lot de 50 | — | 1 lot | 35 |
| 7 | Écran 24" Full HD | Entrée HDMI, dalle IPS, VESA 100×100, haut-parleurs intégrés (retour sonore) | — | 1 | 110 |
| 8 | Support mural VESA inclinable | Charge ≥ 15 kg, VESA 75/100 | — | 1 | 20 |
| 9 | Câble HDMI 3 m | Haute vitesse, gaine renforcée | — | 1 | 10 |
| 10 | Câble Ethernet Cat 6 | Longueur adaptée à l'implantation | — | 1 | 8 |
| | | | | **Sous-total** | **≈ 213 €** |

### 3.3 Exploitation et sécurisation

| # | Poste | Justification | € TTC |
|---|---|---|---|
| 11 | **microSD SanDisk MAX ENDURANCE 64 Go** — ASIN `B084CJ96GT` | Support de la **carte de secours clonée** destinée au Pi 3 B+ de repli. La carte fournie dans le kit n'est pas endurante : elle sert de second exemplaire de test, pas de support de production. | 20 |
| 12 | Onduleur 650 VA avec pilotage USB | Le NVMe supprime la vulnérabilité de la carte SD, mais **l'onduleur reste recommandé** : il évite les trous de pointage lors des micro-coupures et permet un arrêt propre. Priorité désormais « recommandé » et non plus « critique ». | 80 |
| 13 | Coffret métallique verrouillable | Le Pi, le SSD et le câblage ne doivent pas être accessibles aux passants ; seul le lecteur est déporté en façade. | 35 |
| | | **Sous-total** | **≈ 135 €** |

### 3.4 Synthèse budgétaire

| Configuration | Contenu | € TTC |
|---|---|---|
| **Minimum viable** | §3.1 + §3.2 | **≈ 390 €** |
| **Recommandée** | §3.1 + §3.2 + §3.3 | **≈ 525 €** |
| *Rappel v1.0 (Pi 3 B+)* | *matériel complémentaire seul* | *285 à 400 €* |

**Surcoût réel du passage au Pi 5 : + 120 à + 150 €.** Contrepartie : suppression du mode de panne « corruption de carte SD », suppression du module RTC externe et de son câblage, huit années de support constructeur supplémentaires, et un poste de secours matériel déjà financé.

### 3.5 Optionnel

| # | Poste | Condition |
|---|---|---|
| 14 | Badges MIFARE DESFire EV2 + lecteur compatible | Uniquement si l'analyse de risque impose l'authentification cryptographique du badge (voir §7.2). **Non recommandé en V1.** |
| 15 | Buzzer piézo + LED sur GPIO | Si l'environnement est bruyant et l'écran mal visible depuis le point de présentation du badge |
| 16 | HAT PoE+ pour Pi 5 | **Incompatible en pratique avec le HAT M.2.** À n'envisager que si l'on renonce au NVMe. |

### 3.6 Point d'attention sur le lecteur — inchangé

Le lecteur en **émulation clavier** reste le choix le plus robuste : aucun pilote, aucun logiciel propriétaire, indépendance vis-à-vis du fournisseur. Deux précautions :

- l'agent logiciel doit capturer le flux **au niveau `evdev`**, pas via le focus clavier, afin que la frappe ne « fuie » pas dans une autre fenêtre ;
- **exiger la sortie UID en hexadécimal 8 ou 10 caractères** (paramétrage par carte de configuration fournie avec le lecteur). Plusieurs retours clients signalent des lecteurs livrés en décimal tronqué, incohérents avec l'encodage réel du badge. **Commander une unité et tester un badge avant de commander la série.**

---

## 4. Architecture cible

```
┌──────────────────────── POINT DE PASSAGE (Le Houlme) ─────────────────────────┐
│                                                                               │
│   [Badge MIFARE]                                                              │
│         │ 13,56 MHz                                                           │
│   ┌─────▼──────┐   USB        ┌──────────────────────────────────┐            │
│   │ Lecteur    ├─────────────►│  Raspberry Pi 5 — 4 Go           │ micro-HDMI │
│   │ RFID       │              │  démarrage NVMe · RTC intégrée   ├──────────► │ Écran 24"
│   └────────────┘              │  ┌────────────────────────────┐  │            │
│                               │  │ badgeuse-agent (Python)    │  │            │
│   ┌────────────┐   PCIe       │  │  · capture evdev           │  │            │
│   │ SSD NVMe   ├─────────────►│  │  · anti-rebond, sens E/S   │  │            │
│   │ (HAT M.2)  │              │  │  · SQLite file d'attente   │  │            │
│   └────────────┘              │  │                            │  │            │
│                               │  │  · WebSocket → UI          │  │            │
│   ┌────────────┐    USB       │  │  · client API SOLIDATA     │  │            │
│   │ Onduleur   ├─────────────►│  └────────────┬───────────────┘  │            │
│   └────────────┘   (nut)      │               │ ws://localhost   │            │
│                               │  ┌────────────▼───────────────┐  │            │
│                               │  │ Chromium --kiosk (UI)      │  │            │
│                               │  │  · veille : playlist       │  │            │
│                               │  │  · badge : overlay 5 s     │  │            │
│                               │  └────────────────────────────┘  │            │
│                               └───────────────┬──────────────────┘            │
└───────────────────────────────────────────────┼───────────────────────────────┘
                                                │ HTTPS (TLS 1.2+), clé device
                                                ▼
                    ┌───────────────────────────────────────────────┐
                    │  SOLIDATA — solidata.online (VPS OVH, France) │
                    │  Module « Temps & Présence »                  │
                    │   · API device v1                             │
                    │   · Back-office RH (badges, pointages,        │
                    │     corrections, feuilles de temps)           │
                    │   · Gestion de la playlist d'affichage        │
                    │   · Exports paie + heures IAE (ASP)           │
                    └───────────────────────────────────────────────┘
```

### 4.1 Principes structurants

**Autonomie du poste.** Le poste doit pointer **même sans réseau et même sans serveur**. Il embarque un cache local des badges actifs et une file d'attente persistante. Aucune coupure ne doit se traduire par une perte d'heures pour un salarié.

**Le serveur fait foi.** Le poste est un capteur : il horodate et transmet. Toute règle de gestion (arrondis, pauses, seuils, sens entrée/sortie définitif) est appliquée **côté SOLIDATA**, jamais sur le poste. Cela permet de faire évoluer les règles sans intervenir sur le matériel.

**Minimisation à la source.** L'UID du badge n'est **jamais stocké en clair** sur le poste : il est immédiatement transformé en HMAC-SHA256 avec une clé détenue par le serveur. Le cache local ne contient que : `hmac_uid → identifiant technique + prénom + initiale du nom`. Un vol du Raspberry ne livre ni fichier du personnel, ni badge clonable.

**Inaltérabilité.** Chaque pointage porte un `hash = SHA256(hash_précédent + charge utile)`, formant une chaîne par appareil. Toute suppression ou modification silencieuse devient détectable. Les corrections RH ne modifient jamais l'enregistrement brut : elles créent un enregistrement de correction lié, avec auteur, date et motif. C'est la condition pour que le dispositif soit opposable en cas de litige prud'homal ou de contrôle.

**Idempotence.** Chaque pointage porte un UUID généré par le poste. Un rejeu réseau ne crée pas de doublon côté serveur.

---

## 5. Spécification fonctionnelle

### 5.1 Poste (agent embarqué)

| Réf | Exigence |
|---|---|
| PST-01 | Capture du lecteur via `evdev`, en accès exclusif (`EVIOCGRAB`), indépendante de la fenêtre active |
| PST-02 | Anti-rebond : un même badge présenté deux fois en moins de 8 s ne génère qu'un pointage ; message « déjà enregistré » |
| PST-03 | Détermination du sens (entrée / sortie) par alternance depuis le dernier pointage connu du salarié dans la journée |
| PST-04 | Badge inconnu du cache : écran d'erreur explicite + pointage « orphelin » remonté pour traitement RH — **jamais de rejet silencieux** |
| PST-05 | File d'attente SQLite persistante, purge après accusé de réception serveur uniquement |
| PST-06 | Synchronisation du cache badges toutes les 5 min (ETag) ; playlist toutes les 15 min |
| PST-07 | Heartbeat toutes les 60 s : version applicative, dérive horloge, taille de la file, température, espace disque |
| PST-08 | Mode dégradé visible : bandeau discret « hors ligne — vos pointages sont enregistrés » |
| PST-09 | Watchdog matériel + redémarrage `systemd` automatique des services ; arrêt propre déclenché par le bouton d'alimentation du Pi 5 |
| PST-10 | Aucune saisie clavier possible pour l'utilisateur ; pas d'accès au bureau ; Chromium sans barre d'outils, curseur masqué |

### 5.2 Affichage

| Réf | Exigence |
|---|---|
| AFF-01 | **Overlay de badge** : prénom + initiale du nom, sens, heure (HH:MM:SS), pictogramme vert/rouge, durée d'affichage paramétrable **3 à 8 s (défaut 5 s)** |
| AFF-02 | Le cumul d'heures de la semaine n'est affiché **que si l'option est activée** (paramètre serveur, désactivé par défaut — voir note juridique) |
| AFF-03 | Contraste ≥ 7:1, taille de police ≥ 48 px pour l'information principale, lisibilité à 3 m |
| AFF-04 | Retour sonore court et distinct : succès / erreur (haut-parleurs de l'écran) |
| AFF-05 | **Playlist de veille** : éléments typés `message`, `image`, `planning`, `compte_à_rebours`, `météo` ; ordre, durée unitaire, fenêtre de validité (date début/fin), ciblage par site, activation/désactivation |
| AFF-06 | Transition douce, aucune animation clignotante (accessibilité, épilepsie photosensible) |
| AFF-07 | Fonctionnement hors ligne : la dernière playlist reçue est conservée localement et rejouée |
| AFF-08 | Mise en veille de l'écran par DPMS en dehors des plages d'ouverture (économie + durée de vie dalle) |

### 5.3 Back-office SOLIDATA

| Réf | Exigence |
|---|---|
| BO-01 | **Gestion des badges** : attribution, restitution, perte/vol (invalidation immédiate), historique complet |
| BO-02 | **Journal des pointages** : filtres salarié / date / site / statut, indicateur d'anomalie |
| BO-03 | **Corrections** : ajout, modification, suppression logique — motif obligatoire, traçabilité de l'auteur, enregistrement brut conservé |
| BO-04 | **Feuille de temps mensuelle** par salarié : théorique / pointé / écart, avec circuit de validation encadrant → RH |
| BO-05 | **Détection d'anomalies** : oubli de sortie, journée > 10 h, pointage hors plage, badge orphelin, absence non justifiée |
| BO-06 | **Export paie** CSV paramétrable (colonnes, format d'heure décimale ou sexagésimale) |
| BO-07 | **Export heures IAE** au format attendu pour la saisie ASP / extranet IAE (heures travaillées mensuelles par salarié en parcours) |
| BO-08 | **Gestion de la playlist** : éditeur simple, prévisualisation au format 16:9, publication immédiate ou programmée |
| BO-09 | **Supervision des postes** : état en ligne/hors ligne, dernière remontée, version, alerte e-mail si silence > 15 min |
| BO-10 | **Purge automatique** conforme aux durées de conservation (voir note juridique) : tâche planifiée mensuelle, journalisée |
| BO-11 | **Droits** : rôles `salarié` (ses propres données), `encadrant technique` (son équipe), `RH`, `administrateur`. Journalisation des consultations RH. |

### 5.4 Règles de gestion à paramétrer (valeurs à arbitrer par la Direction)

- Arrondi des pointages : néant / 5 min / 15 min, et sens de l'arrondi ;
- Tolérance de retard sans effet paie ;
- Déduction automatique de la pause méridienne si absence de pointage intermédiaire ;
- Durée maximale d'une journée avant alerte ;
- Plage horaire d'acceptation des pointages (ex. 05:00 – 22:00).

---

## 6. Pile technique retenue

| Couche | Choix | Motif |
|---|---|---|
| OS du poste | Raspberry Pi OS Lite **64 bits** (Bookworm/Trixie) | Requis par le Pi 5 ; 4 Go de RAM lèvent la contrainte d'empreinte |
| Session graphique | `cage` (compositeur Wayland minimal) ou X11 + `openbox` | Pas d'environnement de bureau complet |
| Navigateur | Chromium `--kiosk --noerrdialogs --disable-features=Translate` | Standard, maintenu |
| Agent | **Python 3.11** — `evdev`, `httpx`, `sqlite3`, `websockets` | Cohérent avec la pile SOLIDATA/Vintiz (FastAPI) |
| Interface | HTML + CSS + **vanilla JS ou Preact**, aucun bundler lourd | Discipline de frugalité conservée pour un appareil sans surveillance |
| Stockage | **SSD NVMe via HAT M.2**, démarrage EEPROM paramétré | Suppression du mode de panne carte SD |
| Horloge | **RTC interne du Pi 5** + pile officielle, NTP prioritaire | Plus de module externe ni de câblage I²C |
| Supervision poste | `systemd` (Restart=always), watchdog matériel, `nut` pour l'onduleur | Natif, sans agent tiers |
| Backend | **FastAPI + PostgreSQL** (module de SOLIDATA) | Réutilisation de l'existant |
| Déploiement poste | Dépôt Git + `systemd` + script de bascule/rollback | Simple, auditable, sans orchestrateur |
| Journalisation | `journald` local (rotation 7 j) + remontée d'événements métier au serveur | Séparation logs techniques / données RH |

**Écart assumé :** on n'utilise **pas Docker sur le Raspberry**, alors même que les 4 Go du Pi 5 le permettraient désormais. Le motif n'est plus la mémoire mais l'**exploitabilité** : ce poste doit pouvoir être remis en service en cinq minutes par une personne qui n'est pas développeuse, avec un rootfs en lecture seule et deux services `systemd` lisibles. Ajouter une couche d'orchestration pour deux processus sur un appareil unique dégrade cet objectif sans rien apporter. Docker reste la norme côté serveur SOLIDATA.

---

## 7. Sécurité

### 7.1 Poste et flux

- Authentification du poste par **clé d'appareil** (256 bits) stockée hors dépôt Git, en `0600`, propriété d'un utilisateur système dédié non privilégié ; rotation annuelle.
- **HTTPS obligatoire**, TLS 1.2 minimum, vérification du certificat, épinglage de l'autorité recommandé.
- SSH par clé uniquement, mot de passe désactivé, accès restreint au réseau d'administration.
- Rootfs en lecture seule ; seule `/var/lib/badgeuse` est inscriptible.
- Pare-feu local : sortie 443 et 123 (NTP) uniquement, aucune écoute réseau entrante.
- VLAN dédié équipements si l'infrastructure le permet.

### 7.2 Le point de vigilance : le clonage de badge

Un lecteur qui se contente de lire l'UID d'une carte MIFARE Classic lit une donnée **copiable avec un matériel à 40 €**. C'est le mode de fonctionnement de l'immense majorité des badgeuses du marché sur ce segment de prix, et il est acceptable ici sous conditions :

1. le dispositif **n'ouvre aucune porte** — l'enjeu est un enregistrement d'heures, pas un accès physique ;
2. le pointage se fait **en zone visible**, sous supervision d'encadrement technique ;
3. la **détection d'anomalies** (§BO-05) et le contrôle hiérarchique restent les garde-fous réels ;
4. le règlement intérieur qualifie explicitement le badgeage pour autrui de faute.

#### Arbitrage formel — authentification cryptographique du badge

**Date de la décision :** août 2026. **Décideur :** Direction, sur proposition du chargé de développement projet.

L'option d'une authentification forte du badge a été **étudiée et écartée**. Elle est consignée ici afin que la décision soit datée, motivée et opposable en cas de contrôle ou de contentieux.

**Précision technique préalable, souvent mal comprise.** Un lecteur commercialisé comme « compatible DESFire EV1/EV2 » en émulation clavier ne fait que lire le **numéro de série** de la carte — une donnée en clair, clonable exactement comme un UID MIFARE Classic. Acheter un lecteur « DESFire » n'apporte donc **aucune** robustesse supplémentaire de la donnée. Une authentification réelle impose de sortir de l'émulation clavier pour un lecteur **PC/SC** dialoguant en APDU avec la carte.

**Options examinées :**

| Option | Matériel | Coût matériel (lecteur + 50 badges) | Charge de développement |
|---|---|---|---|
| **Retenue** — lecture d'UID | Lecteur USB HID 13,56 MHz | 65 € | incluse |
| Écartée — DESFire EV2 avec authentification mutuelle | Lecteur PC/SC à emplacement SAM (ACR1252U) + module SAM | ≈ 200 € | + 2 à 3 j/h |
| Écartée — NTAG424 DNA, vérification serveur (SUN/CMAC) | Lecteur PC/SC (ACR1252U) | ≈ 175 € | + 2 à 3 j/h |

*Remarque : parmi les deux options écartées, la seconde était techniquement préférable — le secret cryptographique reste sur SOLIDATA et le poste n'en détient aucun, ce qui est cohérent avec le principe « le serveur fait foi » du §4.1.*

**Motifs de la décision :**

1. **Le dispositif n'ouvre aucune porte.** L'enjeu est un enregistrement d'heures, non un accès physique. Une fraude ne procure pas d'accès à un local ni à une ressource.
2. **La fraude au pointage n'est pas un risque documenté** sur le site du Houlme : aucun incident constaté, effectif restreint, pointage en zone visible sous supervision d'encadrement technique.
3. **L'authentification cryptographique ne couvre pas le scénario réel.** Le cas de fraude vraisemblable n'est pas le clonage d'un badge, mais un salarié qui confie volontairement son badge à un collègue. Un badge authentifié se comporte alors exactement comme un badge légitime : la cryptographie n'y change rien.
4. **La parade retenue est organisationnelle et logicielle**, et couvre les deux scénarios : détection d'anomalies côté serveur (§BO-05), contrôle hiérarchique, et qualification expresse du badgeage pour autrui comme manquement dans le règlement intérieur (voir note juridique §6).
5. **Proportionnalité.** Un surcoût de 110 € et de 2 à 3 j/h, pour un risque non caractérisé, ne satisfait pas le test de proportionnalité que la structure s'applique par ailleurs à elle-même (§2.2 et note juridique §2.2).

**Conditions de réexamen.** Cette décision sera reprise si l'un des faits suivants survient : incident de fraude constaté ; exigence formulée par un financeur ou un organisme de contrôle ; extension du badge à un usage d'accès physique ; ou décision d'unifier le badge avec l'ouverture de session en caisse sur Vintiz. Le passage à l'option NTAG424 reste possible sans refonte : seuls le lecteur, l'encodage des badges et la fonction de lecture de l'agent sont concernés — le modèle de données et l'API n'évoluent pas.

### 7.3 Protection des données (renvoi)

Le détail figure dans la **note juridique**. Points contraignants pour le développement, à traiter comme des exigences bloquantes :

- pas de photo ni de nom complet à l'écran (§AFF-01) ;
- HMAC de l'UID, jamais l'UID en clair côté poste (§4.1) ;
- purge automatique aux échéances (§BO-10) ;
- journalisation des accès RH aux données de pointage (§BO-11) ;
- pas de fonction de « supervision temps réel » de qui est présent, en dehors du besoin de sécurité incendie.

---

## 8. Charge, planning, coûts

### 8.1 Charge de développement estimée

| Lot | Contenu | j/h |
|---|---|---|
| L0 | Cadrage, modèle de données, contrats d'API | 2 |
| L1 | API device + persistance + chaîne d'intégrité (SOLIDATA) | 4 |
| L2 | Back-office RH : badges, journal, corrections, feuilles de temps | 6 |
| L3 | Exports paie + IAE | 2 |
| L4 | Gestion de la playlist + éditeur | 3 |
| L5 | Agent embarqué Raspberry | 4 |
| L6 | Interface kiosque (veille + overlay) | 3 |
| L7 | Durcissement système : démarrage NVMe et EEPROM, overlayfs, RTC interne, onduleur, image d'installation | 2 |
| L8 | Recette, tests de charge et de coupure, correction | 3 |
| L9 | Documentation, procédure d'exploitation, formation | 2 |
| | **Total** | **31 j/h** |

En mode assisté (Claude Code, agents spécialisés, cf. document `05_PROMPTS_CLAUDE_CODE_MULTI_AGENTS.md`), la charge humaine de pilotage et de recette est estimée à **8 à 12 j/h**, l'essentiel du temps portant sur la recette métier et le paramétrage, non sur l'écriture du code.

### 8.2 Planning proposé

| Semaine | Jalon |
|---|---|
| S1 | Commande matériel · consultation du CSE lancée · cadrage des règles de gestion |
| S2 | L0–L1 · réception matériel · montage du poste sur établi |
| S3 | L2–L3 · tests API bout en bout |
| S4 | L4–L6 · maquette d'affichage validée par la Direction |
| S5 | L7–L8 · recette · **installation physique** |
| S6–S9 | **Pilote à blanc** : pointage réel, **sans effet sur la paie**, correction des règles |
| S10 | Bascule en production · note d'information diffusée · badges remis |

Le pilote à blanc de quatre semaines n'est pas négociable : c'est la période pendant laquelle on découvre les cas réels (oublis, temps partiels, chantiers extérieurs, arrivées groupées à 8 h avec file d'attente) et où l'on ajuste sans conséquence sur les bulletins.

### 8.3 Coût complet V1

| Poste | € |
|---|---|
| Matériel — Pi 5, configuration recommandée (§3.4) | 525 |
| Développement assisté (licences, temps interne) | interne |
| Hébergement additionnel SOLIDATA | 0 (VPS existant) |
| **Total investissement** | **≈ 525 €** |

Coût récurrent : négligeable (badges de remplacement ≈ 1 €/unité, pile RTC tous les 3 à 5 ans).

Amorti sur la durée de support annoncée du Pi 5 (2036), l'investissement matériel représente moins de 55 € par an — à comparer au temps RH actuellement consacré à la ressaisie des feuilles de présence papier.

---

## 9. Risques et parades

| Risque | P | I | Parade |
|---|---|---|---|
| Corruption du support de démarrage | **Faible** | Fort | Démarrage NVMe (plus de carte SD en production) + rootfs en lecture seule + onduleur — *risque fortement réduit par rapport à la cible v1.0* |
| Bridage thermique / ventilateur encrassé par les fibres textiles | Moyenne | Moyen | Refroidissement actif obligatoire, dépoussiérage semestriel inscrit au plan de maintenance, alerte sur température CPU via heartbeat |
| Alimentation sous-dimensionnée (bloc de Pi 4 réutilisé) | Moyenne | Moyen | Alimentation officielle 27 W exclusivement ; contrôle à la réception |
| File d'attente le matin à la prise de poste | Forte | Moyen | Lecteur à lecture rapide, overlay court (3 s en heure de pointe), affichage du sens sans confirmation à valider |
| Oublis de badgeage récurrents | Forte | Moyen | Détection d'anomalie + régularisation encadrée + accompagnement (cf. note RH) |
| Rejet social du dispositif | Moyenne | **Fort** | Consultation CSE en amont, pilote à blanc, note d'information adaptée, discours « fiabiliser vos heures » et non « vous surveiller » |
| Panne du poste un lundi matin | Faible | Fort | **Pi 3 B+ conservé en poste de secours préconfiguré et appairé** + procédure papier de repli affichée à côté de l'écran |
| Dérive de l'horloge | Faible | Fort | RTC + NTP + alerte si dérive > 2 s |
| Écran devenant un support de communication non maîtrisé | Moyenne | Faible | Circuit de validation de la playlist (un valideur unique désigné) |
| Extension non anticipée à la boutique Vernon | Moyenne | Faible | Modèle de données multi-sites dès la V1 (`site_id` partout) |

---

## 10. Décisions attendues de la Direction

1. **Valider le budget matériel** de 525 € TTC en configuration recommandée (Pi 5 + NVMe + onduleur + coffret), ou 390 € en configuration minimale.
2. **Arbitrer les règles de gestion** du §5.4 (arrondis, pauses, tolérances).
3. **Décider de l'affichage ou non du cumul hebdomadaire** à l'écran (§AFF-02) — recommandation technique : **désactivé**, un salarié doit pouvoir consulter ses heures sans qu'un tiers les lise par-dessus son épaule.
4. **Désigner** le valideur de la playlist et le référent d'exploitation du poste.
5. **Confirmer le calendrier** de consultation du CSE, préalable obligatoire à toute mise en service.
6. **Valider le principe du poste de secours** : le Pi 3 B+ est maintenu en configuration miroir, ce qui suppose une carte microSD haute endurance dédiée et un second appairage dans SOLIDATA.

---

## 11. Journal des révisions

| Version | Date | Objet |
|---|---|---|
| 1.0 | Août 2026 | Version initiale — cible Raspberry Pi 3 B+ |
| 1.2 | Août 2026 | Ajout au §7.2 de l'**arbitrage formel sur l'authentification cryptographique du badge** : option étudiée, écartée, motivée, avec conditions de réexamen. Aucune autre modification. |
| 1.1 | Août 2026 | **Changement de cible matérielle : Raspberry Pi 5 4 Go, démarrage NVMe, RTC intégrée.** Chapitres 2, 3, 4, 6, 8 et 9 révisés. Suppression du module DS3231. Le Pi 3 B+ est reversé au rôle de poste de secours. Aucune modification des spécifications fonctionnelles (§5) ni des exigences de conformité. |

---

*Documents liés : note administrative RH, note juridique RGPD, note d'information aux salariés et bénéficiaires, dossier de prompts de développement multi-agents.*
