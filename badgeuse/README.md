# Badgeuse SOLIDATA — poste de pointage

Poste de pointage sur Raspberry Pi : un agent Python capte le lecteur RFID, une
interface kiosque affiche le résultat, une file d'attente locale garantit
qu'**aucune heure de travail ne se perd**, même sans réseau ni serveur.

Ce répertoire ne contient que l'embarqué. Le module « Temps & Présence » du
serveur (API device, back-office RH) vit dans `backend/` et `frontend/`.

Contrats de référence, à lire avant toute modification :
`docs/badgeuse/CONTRAT_API_DEVICE.md`, `CONTRAT_HMAC.md`,
`CONTRAT_INTEGRITE.md`, `SPEC_TECHNIQUE.md`, `adr/0002`.

---

## 1. Principes

**Le poste est un capteur.** Il lit, horodate, chaîne, met en file, transmet.
Toute règle de gestion RH (arrondis, pauses, seuils, sens définitif) est
appliquée côté SOLIDATA : elle peut évoluer sans toucher au matériel.

**Autonomie.** Capture, affichage et enregistrement ne dépendent ni du réseau
ni du serveur. Hors ligne, le poste fonctionne indéfiniment ; la file s'écoule
au retour du réseau. Une file qui grossit est un fonctionnement normal, pas une
panne.

**Minimisation à la source.** L'UID du badge est transformé en
`HMAC-SHA256(clé de site, UID)` **dès la lecture**, en mémoire vive. Il n'est
jamais écrit sur disque, jamais journalisé, jamais transmis. Le cache local ne
contient que `uid_hmac → identifiant technique + prénom + initiale`. Un poste
volé ne livre ni fichier du personnel, ni badge clonable.

**Inaltérabilité.** Chaque pointage porte
`hash = SHA256(hash_précédent + charge utile canonique)`, formant une chaîne
par poste, formée dès la capture — hors ligne compris. Toute modification
ultérieure devient détectable.

**Jamais de rejet silencieux.** Un badge inconnu produit un pointage
« orphelin » transmis au RH et un message d'erreur explicite à l'écran. Une
lecture non conforme au contrat n'est pas enregistrée, mais elle est affichée
et journalisée.

---

## 2. Architecture

```
   [Badge MIFARE]
         │ 13,56 MHz
   ┌─────▼──────┐  USB HID
   │ Lecteur    ├──────────────┐
   └────────────┘              │
                    ┌──────────▼─────────────────────────────────┐
                    │ badgeuse-agent (Python 3.11, systemd)      │
                    │                                            │
                    │  reader ─ normalize ─ hmac ─ debounce ─┐    │
                    │                                       │    │
                    │            store (SQLite) ◄─ chain ◄─ sens │
                    │              │        │                    │
                    │              │        └─► sync ──── HTTPS ─┼──► SOLIDATA
                    │              │                             │    (API device v1)
                    │              └─► ws_server ────────────────┤
                    └────────────────────┬───────────────────────┘
                            ws://127.0.0.1:8765
                            http://127.0.0.1:8766
                                         │
                    ┌────────────────────▼───────────────────────┐
                    │ badgeuse-kiosk : cage + Chromium --kiosk   │  → écran 24"
                    │  veille : playlist · badge : overlay 5 s   │
                    └────────────────────────────────────────────┘
```

Aucune écoute réseau entrante : les deux serveurs locaux sont liés à
`127.0.0.1`. Le poste n'ouvre que des connexions sortantes (443, 123, 53).

### Modules de l'agent

| Module | Rôle | Pur |
|---|---|:-:|
| `normalize.py` | Normalisation de l'UID (séparateurs, casse, décimal) | ✔ |
| `hmac_uid.py` | Pseudonymisation `uid_hmac` | ✔ |
| `chain.py` | Charge utile canonique, genèse, chaînage | ✔ |
| `debounce.py` | Anti-rebond 8 s par badge | ✔ |
| `sens.py` | Entrée/sortie par alternance, jour civil Paris | ✔ |
| `store.py` | SQLite : file, chaîne, cache badges, caches | ✔ |
| `clock.py` | Dérive d'horloge vs `server_time_utc` | ✔ |
| `config.py` | Lecture et validation stricte du fichier INI | ✔ |
| `reader.py` | Capture evdev, `EVIOCGRAB`, reconnexion | ✔ (faux `evdev`) |
| `sync.py` | Client API device, ETag, backoff, télémétrie | ✔ (faux serveur) |
| `ws_server.py` | WebSocket + service des fichiers de l'UI | ✔ (faux serveur) |
| `app.py` | Orchestration asyncio, tâches périodiques, watchdog | ✔ (faux serveur) |

Les modules **purs** n'utilisent que la bibliothèque standard : leurs tests
tournent sans `evdev`, `httpx` ni `websockets`. Les quatre derniers sont
couverts par des tests « de la promesse » qui font tourner l'agent réel
(cf. §5) ; ils s'ignorent proprement si `httpx`/`websockets` manquent.

---

## 3. Cibles matérielles

| | Principale | Repli |
|---|---|---|
| Machine | Raspberry Pi 5, 4 Go | Raspberry Pi 3 B+, 1 Go |
| Stockage | SSD NVMe (HAT M.2) | microSD |
| Horloge | RTC intégrée + pile | NTP, DS3231 recommandé |
| Session | Wayland (`cage`) | idem, repli X11 possible |
| Budget mémoire | < 1,2 Go | < 600 Mo |

**Le même code applicatif tourne sur les deux.** Toute divergence est isolée
dans `deploy/install.sh` : paquets, options Chromium (`/etc/badgeuse/kiosk.env`)
et plafond mémoire de l'agent (`badgeuse-agent.service.d/cible.conf`).

Pas de Docker sur le poste : deux services `systemd` lisibles et un rootfs en
lecture seule se remettent en service en cinq minutes par une personne qui
n'est pas développeuse.

---

## 4. Démarrage rapide

### 4.1 Préparer la configuration

```bash
cp badgeuse/deploy/badgeuse.conf.example /root/badgeuse.conf
chmod 0600 /root/badgeuse.conf
$EDITOR /root/badgeuse.conf      # coller device_key et hmac_key (back-office)
```

Les deux clés viennent du back-office SOLIDATA : **Supervision → Appairage**.
Aucune n'a de valeur par défaut : l'agent refuse de démarrer si l'une manque.

### 4.2 Installer

```bash
sudo bash badgeuse/deploy/install.sh --target pi5 --config /root/badgeuse.conf
```

Le script est idempotent et journalisé (`/var/log/badgeuse-install.log`). Il
installe les paquets, crée l'utilisateur système `badgeuse`, déploie le code
dans `/opt/badgeuse`, monte l'environnement Python, valide la configuration,
puis active et démarre les services.

### 4.3 Durcir (dans cet ordre)

```bash
sudo RESEAU_ADMIN=192.168.1.0/24 bash /opt/badgeuse/deploy/firewall.sh
sudo bash /opt/badgeuse/deploy/eeprom-nvme.sh          # Pi 5 : démarrage NVMe
sudo mkfs.ext4 -L BADGEUSE_DATA /dev/<partition>       # partition de données
sudo bash /opt/badgeuse/deploy/overlayfs-setup.sh --data-only
sudo bash /opt/badgeuse/deploy/overlayfs-setup.sh      # rootfs en lecture seule
sudo reboot
```

`overlayfs-setup.sh` **refuse** d'activer l'overlay tant que
`/var/lib/badgeuse` n'est pas sur une partition dédiée : sous overlay, la file
d'attente vivrait en RAM et les pointages non transmis disparaîtraient au
redémarrage.

### 4.4 Vérifier

```bash
systemctl status badgeuse-agent badgeuse-kiosk
journalctl -u badgeuse-agent -f
sudo -u badgeuse /opt/badgeuse/venv/bin/python -m badgeuse_agent --check
```

---

## 5. Développement et tests

```bash
python3 -m pytest badgeuse/agent/tests/ -q
bash badgeuse/deploy/tests/test_deploy.sh          # scripts d'installation
```

Trois niveaux, et c'est délibéré :

| Niveau | Fichiers | Ce qu'il prouve |
|---|---|---|
| Unitaire (modules purs) | `test_normalize`, `test_hmac`, `test_chain`, `test_sens`, `test_debounce`, `test_moments`, `test_store`… | Les règles, sans aucune dépendance |
| **Promesse** | `test_promesse_poste.py` + `faux_serveur.py`, `test_reader.py` + `faux_evdev.py` | **L'agent réel** (base SQLite, WebSocket, HTTP, client `httpx`) face à un faux serveur qui applique le CONTRAT_API_DEVICE, et la capture réelle face à un faux lecteur à deux interfaces |
| Déploiement | `deploy/tests/test_deploy.sh` (branché sur pytest) | Les scripts shell : relance depuis `/opt`, résolution du navigateur, cohérence compositeur ↔ options Chromium |

Le niveau « promesse » existe parce que 400 tests unitaires verts n'ont pas
empêché six défauts en production le même jour : ils ne testaient que des
pièces, jamais le fait que **le poste badge et affiche**.

Deux vecteurs partagés avec le backend Node y sont figés (toute
divergence casserait la vérification serveur) :

```
uid_hmac  HMAC-SHA256(clé, "04A23B1C") = 6af79677…551d8
genesis   SHA256("genesis:LH-P1")      = 07b7f5a0…07b1ab
chaîne    SHA256(genesis + canonical)  = 07914d17…8ff3ed
```

Point de contrat souvent mal implémenté : la clé de site est décodée **d'hex
vers octets** avant HMAC, alors que le message est la **chaîne ASCII** de l'UID
normalisé ; et le chaînage concatène le hash précédent sous sa forme
**hexadécimale**, pas ses octets.

L'interface (`ui/`) est volontairement sans framework, sans bundler et sans
police distante : trois fichiers, ~22 Ko, modifiables directement sur le poste.

---

## 6. Exploitation courante

| Situation | Conduite à tenir |
|---|---|
| Écran figé, agent vivant | `systemctl restart badgeuse-kiosk` |
| « Hors ligne » affiché | Normal si le réseau est coupé — les pointages sont enregistrés. Vérifier la file : `journalctl -u badgeuse-agent \| grep file` |
| « Badge non reconnu » | Badge non attribué ou cache pas encore synchronisé. Le pointage est parti en orphelin : traitement RH au back-office |
| « Lecteur non détecté » | Lecteur débranché — l'agent se reconnecte seul dès le rebranchement |
| Lecteur « connecté », mais aucun badge n'arrive | `sudo bash /opt/badgeuse/deploy/diagnostic.sh` (section 4 bis) ou `sudo -u badgeuse /opt/badgeuse/venv/bin/python -m badgeuse_agent --lecteurs` : la liste dit quelles interfaces sont saisies. Puis `journalctl -u badgeuse-agent -f` et passer un badge : la ligne « premiere frappe recue » doit apparaître. Absente, le lecteur n'émet rien vers le poste (câble, alimentation, mode du lecteur : il doit être en **émulation clavier**) |
| Mise à jour du code | Relancer `install.sh` (idempotent). Rootfs en lecture seule : `overlayfs-setup.sh --disable`, redémarrer, mettre à jour, réactiver |
| Changement de poste | Ne **jamais** modifier `device_code` sur un poste en service : la base locale refuse de s'ouvrir sous un autre code (la chaîne appartient au poste) |

Le journal de l'agent ne contient jamais d'UID ni de clé ; les condensats y
sont tronqués à 12 caractères.

---

## 7. Exigences couvertes

| Réf | Exigence | Où |
|---|---|---|
| PST-01 | Capture evdev en accès exclusif | `reader.py` |
| PST-02 | Anti-rebond 8 s, message « déjà enregistré » | `debounce.py`, `ws_server.badge_repeat` |
| PST-03 | Sens par alternance (jour civil Paris) | `sens.py` |
| PST-04 | Badge inconnu → orphelin, jamais silencieux | `app._process` |
| PST-05 | File SQLite, purge sur accusé uniquement | `store.ack` |
| PST-06 | Badges 5 min / playlist 15 min, ETag | `sync.py`, `app.py` |
| PST-07 | Heartbeat 60 s (dérive, file, température, disque) | `sync.send_heartbeat` |
| PST-08 | Bandeau hors ligne | `ui/app.js`, `ws_server.status` |
| PST-09 | Watchdog **logiciel** (service, `WatchdogSec=90` + `sd_notify`) **et watchdog matériel** (puce, `RuntimeWatchdogSec=15s`), arrêt propre | `app.sd_notify` + unités ; `/etc/systemd/system.conf.d/badgeuse-watchdog.conf` (écrit par `deploy/install.sh`) |
| PST-10 | Aucune saisie utilisateur, curseur masqué, DevTools verrouillés | `EVIOCGRAB`, `ui/style.css`, `deploy/chromium-policy.json` (politique Chromium gérée, installée par `deploy/install.sh`) |
| AFF-01 | Overlay 3–8 s, plafond re-vérifié | serveur → `ws_server.clamp_overlay` → `ui/app.js` |
| AFF-02 | Cumul hebdo seulement si activé | `app._cumul_hebdo` |
| AFF-03 | Contraste ≥ 7:1, police ≥ 48 px | `ui/style.css` |
| AFF-04 | Deux sons distincts (WebAudio) | `ui/app.js` |
| AFF-05/07 | Playlist typée, rejouée hors ligne | `ui/app.js`, `store` |
| AFF-06 | Fondus, aucun clignotement | `ui/style.css` |
| AFF-08 | Extinction hors plage d'ouverture | `deploy/dpms.sh` |

**PST-09 — deux chiens de garde, pas un seul.** `WatchdogSec=90` sur
`badgeuse-agent.service` ne surveille QUE ce service : si l'agent cesse
d'envoyer `WATCHDOG=1` (cf. `app._loop_watchdog`), systemd le redémarre. Cela
ne couvre pas un gel du noyau ou de systemd (PID1) lui-même. Le watchdog
**matériel** de la puce (`bcm2835_wdt`) comble ce trou : `deploy/install.sh`
écrit `/etc/systemd/system.conf.d/badgeuse-watchdog.conf`
(`RuntimeWatchdogSec=15s`, section `[Manager]`) — si PID1 gèle à son tour,
c'est le matériel qui redémarre le Pi.

**PST-10 — limite résiduelle du verrouillage kiosque.** La politique Chromium
gérée (`deploy/chromium-policy.json`, installée dans
`/etc/chromium/policies/managed/` **et** `/etc/chromium-browser/policies/managed/`
selon le paquet présent) verrouille les DevTools de façon non contournable
par un flag de ligne de commande. Cela ferme l'accès applicatif (page kiosque
**et** serveur local de l'agent, `127.0.0.1:8766`/`8765`), mais ne remplace
pas une protection physique : le **premier rideau** reste le boîtier fermé
(`cage`, aucun bureau exposé) et l'accès exclusif au lecteur (`EVIOCGRAB`,
`reader.py`), qui empêche un clavier USB branché en aval du lecteur
d'atteindre le système au-delà de Chromium. Un accès physique prolongé au
poste (ouverture du boîtier, autre vecteur que le clavier/souris) reste hors
du périmètre logiciel de ce document.
