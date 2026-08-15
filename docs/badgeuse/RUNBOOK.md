# RUNBOOK — Poste de pointage badgeuse SOLIDATA

**À qui s'adresse ce document.** À toute personne chargée d'installer, de dépanner ou de remplacer un poste de pointage — même sans compétence de développeur. Chaque procédure est écrite pour être suivie telle quelle : commande exacte à copier-coller, bouton exact à cliquer.

**Ce que ce document ne couvre pas.** Les règles RH (arrondis, corrections, validations, exports paie) sont dans `MANUEL_RH.md`. Le fonctionnement du back-office pour un profil technique (mise à jour, clés, purge RGPD) est dans `EXPLOITATION.md`.

**Contact d'urgence du site.** À compléter et afficher à côté du poste :

> Référent d'exploitation : ______________________ Téléphone : ______________________
> Suppléant : ______________________ Téléphone : ______________________

---

## 1. Mise en service d'un nouveau poste

### 1.1 Matériel nécessaire

La liste complète, avec références et prix, est dans `docs/badgeuse/SPEC_TECHNIQUE.md` §3. Résumé du strict nécessaire :

- Raspberry Pi 5 (4 Go) avec alimentation officielle 5 V / 5 A USB-C 27 W, boîtier, refroidissement actif, câble micro-HDMI → HDMI ;
- pile RTC officielle Raspberry Pi (connecteur JST-SH 2 broches) ;
- HAT M.2 (PCIe → NVMe) + SSD NVMe 256 Go ;
- lecteur RFID USB 13,56 MHz en émulation clavier (sortie UID hexadécimale) ;
- écran 24" Full HD avec haut-parleurs, support mural VESA ;
- câbles HDMI 3 m et Ethernet ;
- badges MIFARE Classic.

**Avant de commander en série : tester un badge sur une unité du lecteur.** Certains lecteurs sortent l'UID en décimal tronqué au lieu d'hexadécimal — SPEC_TECHNIQUE §3.6.

### 1.2 Préparer le support de démarrage (SSD NVMe)

Cette étape se fait **avant** l'assemblage, avec un ordinateur séparé et un adaptateur USB vers M.2/NVMe. Elle n'est pas scriptée dans ce dépôt — c'est l'usage standard de l'outil Raspberry Pi Imager, mentionné ici pour que la procédure soit complète.

1. Installer « Raspberry Pi Imager » sur un ordinateur (Windows/Mac/Linux).
2. Brancher le SSD NVMe sur l'ordinateur via l'adaptateur USB.
3. Dans Imager : Système d'exploitation → **Raspberry Pi OS Lite (64-bit)**. Stockage → le SSD NVMe branché.
4. Cliquer sur l'icône **engrenage** (options avancées) avant d'écrire :
   - activer SSH (avec mot de passe, ou une clé si vous en gérez une) ;
   - définir un nom d'hôte reconnaissable (ex. `lh-p1`) ;
   - définir un utilisateur et un mot de passe ;
   - configurer le réseau si le poste n'est pas raccordé en Ethernet.
5. Écrire l'image, puis retirer le SSD proprement.

### 1.3 Assembler le poste

1. Fixer le SSD NVMe dans le HAT M.2, fixer le HAT sur le Raspberry Pi 5.
2. Installer la pile RTC sur son connecteur.
3. Brancher : écran (micro-HDMI → HDMI), lecteur RFID (USB), Ethernet, alimentation officielle 27 W en dernier.
4. Le Pi démarre. Si l'écran reste noir plusieurs minutes au tout premier démarrage, c'est que l'EEPROM n'a pas encore été configurée pour donner la priorité au NVMe — voir §1.6 ci-dessous (`eeprom-nvme.sh`). Dans ce cas, démarrer une fois avec une carte microSD de secours flashée avec le même système (SSH activé) le temps d'exécuter ce script une première fois, puis basculer définitivement sur le SSD.

### 1.4 Récupérer les clés d'appairage dans SOLIDATA

**Ces clés ne s'affichent qu'une seule fois.** Préparez-vous à les copier immédiatement.

1. Se connecter à SOLIDATA avec un compte **ADMIN**.
2. Aller dans **Temps & Présence → onglet Supervision**.
3. Cliquer sur **« Appairer un poste »**.
4. Renseigner :
   - **Code du poste** (ex. `LH-P1` — Le Houlme, poste 1) ;
   - **Cible matérielle** : Raspberry Pi 5 ou Raspberry Pi 3 B+ (secours) ;
   - **Libellé** (ex. « Entrée atelier — Le Houlme ») ;
   - **Site**.
5. Cliquer sur **« Appairer »**.
6. L'écran affiche la **clé du poste** (X-Device-Key) et, si c'est le premier poste du site, la **clé HMAC du site**. Copier les deux immédiatement (bouton « Copier » sur chaque ligne) dans un gestionnaire de mots de passe ou un document temporaire sécurisé — elles ne seront **plus jamais réaffichées**.
7. Cliquer sur **« J'ai noté les clés — Fermer »**.

Si un poste du même site a déjà été appairé auparavant, seule la clé du poste est redonnée : la clé HMAC du site est déjà connue et n'est pas régénérée (elle est partagée par tous les postes d'un même site).

### 1.5 Préparer le fichier de configuration

Le modèle est `badgeuse/deploy/badgeuse.conf.example`. Chaque clé expliquée :

| Section | Clé | Rôle | Où trouver la valeur |
|---|---|---|---|
| `[server]` | `url` | Adresse HTTPS de SOLIDATA | `https://solidata.online` (ne jamais mettre en http://, l'agent refuse) |
| `[server]` | `device_code` | Code du poste déclaré à l'appairage | Le code saisi en §1.4 (ex. `LH-P1`) — **ne jamais le modifier une fois le poste en service** |
| `[server]` | `device_key` | Clé du poste (en-tête `X-Device-Key`) | La clé copiée en §1.4, étape 6 |
| `[server]` | `api_path` | Chemin de l'API device | Laisser commenté (valeur par défaut), à ne changer que sur instruction |
| `[server]` | `verify_tls` | Vérification du certificat TLS | Laisser commenté (= activé). **Ne jamais désactiver en exploitation** |
| `[site]` | `hmac_key` | Clé HMAC du site (pseudonymise les badges) | La clé copiée en §1.4, étape 6 (partagée par tous les postes du site) |
| `[reader]` | `vendor_id`, `product_id` | Identifiants USB du lecteur (facultatif) | Commande `lsusb` sur le poste (format `ID 1234:5678`) — laisser vide si un seul clavier HID est branché, l'agent le détecte seul |
| `[reader]` | `name` | Filtre par nom de périphérique (facultatif) | Utile seulement si plusieurs claviers USB sont branchés |
| `[system]` | `data_dir` | Répertoire des données locales | Laisser `/var/lib/badgeuse` |
| `[system]` | `target` | Cible matérielle | `pi5` ou `pi3` selon le poste |
| `[ui]` | `ws_port`, `http_port`, `dir` | Ports et dossier de l'interface locale | Laisser commenté (valeurs par défaut) |
| `[dpms]` | `allumage`, `extinction` | Plage horaire d'allumage de l'écran | Format `HH:MM`, heure locale du poste (ex. `05:30` / `21:30`). Laisser vide pour un écran allumé en permanence |

Sur un ordinateur (pas nécessairement le poste), préparer le fichier :

```bash
cp badgeuse/deploy/badgeuse.conf.example badgeuse.conf
# éditer badgeuse.conf : coller device_code, device_key, hmac_key, target
```

Transférer ensuite ce fichier sur le poste (clé USB, ou `scp` si le poste est déjà accessible en SSH).

### 1.6 Installer

Se connecter en SSH sur le poste (ou brancher un clavier temporairement), puis :

```bash
sudo bash badgeuse/deploy/install.sh --target pi5 --config /chemin/vers/badgeuse.conf
```

(remplacer `pi5` par `pi3` pour le poste de secours). Le script :

- vérifie le modèle de machine et la version de Python ;
- installe les paquets système (Chromium, `cage`, `python3-evdev`, `nftables`…) ;
- crée l'utilisateur système `badgeuse` (sans droit de connexion) ;
- déploie le code dans `/opt/badgeuse` ;
- installe la configuration en `/etc/badgeuse/badgeuse.conf`, permissions `0600` ;
- **valide la configuration** — si une clé manque ou est restée à sa valeur d'exemple, le script s'arrête avec un message explicite et **les services ne démarrent pas** ;
- installe la politique Chromium (verrouillage des outils de développement) ;
- active et démarre les services `badgeuse-agent` et `badgeuse-kiosk`.

Le script est **idempotent** : le relancer ne casse rien (utile pour une mise à jour, voir `EXPLOITATION.md`). Tout est journalisé dans `/var/log/badgeuse-install.log`.

À la fin, le script imprime un résumé et la liste des étapes restantes — ce sont les étapes 1.7 à 1.9 ci-dessous, **dans l'ordre indiqué**.

### 1.7 Pare-feu

```bash
sudo RESEAU_ADMIN=192.168.1.0/24 bash /opt/badgeuse/deploy/firewall.sh
```

Remplacer `192.168.1.0/24` par le réseau depuis lequel l'administration SSH doit rester possible. Ce script ferme toute écoute entrante sur le poste (sauf SSH depuis ce réseau) et limite les connexions sortantes à HTTPS (443), NTP (123) et DNS (53).

### 1.8 Démarrage prioritaire sur NVMe (Pi 5 uniquement)

```bash
sudo bash /opt/badgeuse/deploy/eeprom-nvme.sh
sudo reboot
```

Ce script est **refusé sur un Pi 3 B+** (pas de port PCIe) — normal, à ignorer pour le poste de secours. Après redémarrage, vérifier que le système a bien démarré sur le SSD :

```bash
lsblk    # le rootfs doit être sur /dev/nvme0n1
```

### 1.9 Partition de données puis rootfs en lecture seule

D'abord créer une partition dédiée pour les données (file d'attente des pointages) — **remplacer `/dev/<partition>` par la partition réelle**, par exemple une seconde partition du SSD ou une clé USB dédiée :

```bash
sudo mkfs.ext4 -L BADGEUSE_DATA /dev/<partition>
sudo bash /opt/badgeuse/deploy/overlayfs-setup.sh --data-only
```

**Garde de sécurité importante :** l'étape suivante (rootfs en lecture seule) est **refusée tant que cette partition dédiée n'est pas montée**. C'est volontaire : sous overlay, si `/var/lib/badgeuse` restait sur le système de fichiers temporaire, la file d'attente des pointages non transmis disparaîtrait à chaque redémarrage. Le script protège une heure de travail qui fait foi contre une erreur d'ordre des étapes.

Une fois la partition confirmée prête (le script l'indique), activer le rootfs en lecture seule :

```bash
sudo bash /opt/badgeuse/deploy/overlayfs-setup.sh
sudo reboot
```

Après redémarrage, vérifier :

```bash
findmnt /                  # doit indiquer "overlay"
findmnt /var/lib/badgeuse  # doit indiquer la partition BADGEUSE_DATA
systemctl is-active badgeuse-agent
```

**Note sur l'extinction de l'écran (`dpms.sh`).** Ce script n'a rien à lancer manuellement : il est déjà activé par `install.sh` via un minuteur système (`badgeuse-dpms.timer`) qui le déclenche toutes les 5 minutes. Il éteint/rallume l'écran selon la plage `[dpms] allumage` / `extinction` du fichier de configuration (§1.5). Si cette plage est vide, l'écran reste allumé en permanence — comportement normal, pas une panne.

### 1.10 Vérification finale

1. Sur le poste, présenter un **badge de test** devant le lecteur : l'écran doit afficher un bandeau vert avec un prénom, le sens (Entrée/Sortie) et l'heure, pendant quelques secondes, puis revenir à l'écran de veille.
2. Vérifier les services :
   ```bash
   systemctl status badgeuse-agent badgeuse-kiosk
   journalctl -u badgeuse-agent -f
   sudo -u badgeuse /opt/badgeuse/venv/bin/python -m badgeuse_agent --check
   ```
3. Dans SOLIDATA, aller sur **Temps & Présence → Supervision** : le poste doit apparaître avec le badge **« En ligne »** (vert), sa dernière remontée (« il y a quelques secondes »), sa version logicielle et sa cible matérielle.
4. Cliquer sur **« Vérifier la chaîne »** sur la carte du poste : le résultat doit être « Chaîne d'intégrité valide — aucune rupture détectée ».
5. Si le badge de test présenté n'est attribué à personne dans SOLIDATA, l'écran affiche « Badge non reconnu — va voir ton encadrant » : c'est normal, il faut attribuer un badge à un salarié pour ce test (voir `MANUEL_RH.md` §1). Le pointage part quand même en « orphelin » — rien n'est perdu.
6. **Avant la mise en service réelle**, dérouler le protocole de recette matérielle §7 ci-dessous. Aucun de ces tests n'est facultatif : ils conditionnent la valeur probante du dispositif en cas de litige ou de contrôle.

**Rappel sur les règles de gestion.** Tant qu'un ADMIN ou RH n'a pas ouvert **Temps & Présence → Paramètres** et cliqué sur **« Enregistrer et marquer comme arbitrées »**, un bandeau ambre « Règles par défaut — à faire arbitrer par la Direction » reste visible dans le back-office. Le poste fonctionne quand même avec les valeurs par défaut (recommandations RH). Voir `MANUEL_RH.md` §5.

---

## 2. Arbres de décision pannes

### 2.1 « L'écran est noir »

1. **Regarder l'heure.** Le poste est-il dans sa plage d'allumage (ex. 05:30–21:30, définie en §1.5) ? Si non → **c'est normal**, l'écran s'éteint automatiquement en dehors des horaires d'ouverture. Rien à faire, il se rallumera seul.
   → Si oui (on est dans la plage) : passer à l'étape 2.
2. **Vérifier le matériel physique.** L'écran est-il sous tension (voyant allumé) ? Le câble micro-HDMI → HDMI est-il bien enfoncé aux deux extrémités ?
   → Si un câble était débranché : le rebrancher, patienter 30 secondes.
   → Si toujours noir : étape 3.
3. **Vérifier le service d'affichage.** Se connecter en SSH (ou brancher un clavier) et taper :
   ```bash
   systemctl status badgeuse-kiosk
   ```
   Si le service est inactif :
   ```bash
   sudo systemctl restart badgeuse-kiosk
   ```
   Patienter 15 secondes.
   → Si toujours noir : étape 4.
4. **Vérifier que l'agent tourne** (le kiosque en dépend) :
   ```bash
   systemctl status badgeuse-agent
   ```
   Si inactif :
   ```bash
   sudo systemctl restart badgeuse-agent
   ```
   Attendre 5 secondes, puis relancer `badgeuse-kiosk` comme à l'étape 3.
   → Si toujours noir : étape 5.
5. **Redémarrer le poste** proprement :
   ```bash
   sudo reboot
   ```
   Attendre le retour à l'écran de veille (normalement moins de 2 minutes).
   → Si toujours noir après redémarrage : étape 6.
6. **Dernier recours.** Basculer sur le poste de secours (§3) pour ne pas interrompre le pointage de l'atelier, puis appeler le référent d'exploitation (coordonnées en tête de document).

### 2.2 « Le lecteur ne répond plus »

Signe à l'écran : le message **« Lecteur de badge non détecté — préviens ton encadrant »** s'affiche à la place de l'écran de veille habituel.

1. **Vérifier le câble USB du lecteur.** Bien enfoncé des deux côtés (lecteur et Raspberry Pi) ?
2. **Débrancher puis rebrancher** le câble USB du lecteur. L'agent se reconnecte **tout seul** dès qu'il détecte à nouveau le lecteur (pas besoin de redémarrer un service) — patienter jusqu'à 30 secondes.
3. **Tester** avec un badge : le message doit disparaître et l'écran de veille revenir.
   → Si le message persiste au-delà d'une minute : étape 4.
4. **Consulter le journal** pour confirmer :
   ```bash
   journalctl -u badgeuse-agent -f | grep -i lecteur
   ```
5. **Redémarrer le service agent** :
   ```bash
   sudo systemctl restart badgeuse-agent
   ```
   → Si toujours rien après 1 minute : étape 6.
6. **Redémarrer le poste** :
   ```bash
   sudo reboot
   ```
   → Si toujours rien : étape 7.
7. **Dernier recours.** Le lecteur est probablement défectueux (câble interne, connecteur). Basculer sur le poste de secours (§3) le temps de remplacer le lecteur, et appeler le référent d'exploitation.

### 2.3 « Le poste est hors ligne dans SOLIDATA »

**Rassurer d'abord : aucune heure n'est perdue.** Le poste enregistre les pointages localement même sans réseau ; ils partiront dès que la connexion reviendra. Un poste est déclaré « hors ligne » dans la Supervision après un silence supérieur au seuil paramétré (15 minutes par défaut) — ce n'est pas une alarme immédiate.

1. **Vérifier le réseau physique du poste.** Câble Ethernet bien branché ? Voyants du commutateur/routeur allumés ?
2. **Vérifier que l'agent tourne** :
   ```bash
   systemctl status badgeuse-agent
   ```
   Si inactif :
   ```bash
   sudo systemctl restart badgeuse-agent
   ```
3. **Regarder la file d'attente** dans le journal — une file qui grossit sans se vider signale un problème de réseau (pas un bug) :
   ```bash
   journalctl -u badgeuse-agent | grep -i file
   ```
4. **Vérifier qu'aucune erreur d'authentification n'apparaît** (clé du poste régénérée par erreur côté ADMIN, par exemple) :
   ```bash
   journalctl -u badgeuse-agent -n 100 --no-pager | grep -iE "401|clé|refus"
   ```
   Si une erreur d'authentification apparaît : la clé du poste (`device_key`) a probablement été régénérée dans SOLIDATA sans reconfigurer le poste (voir `EXPLOITATION.md` §2 « Rotation de la clé device »).
5. **Vérifier l'accès réseau au serveur** (si le poste répond en SSH) :
   ```bash
   curl -sSI https://solidata.online | head -1
   ```
   Une absence de réponse indique un problème réseau ou un pare-feu local trop restrictif (variable `RESEAU_ADMIN`/DNS de `firewall.sh`, §1.7).
6. **Dernier recours.** Si le réseau du site est en panne générale (coupure Internet, panne du commutateur), c'est une panne d'infrastructure — appeler le service informatique du réseau local. Si tout semble normal côté poste mais qu'il reste « hors ligne » plus de 15 minutes, appeler le référent d'exploitation.

### 2.4 « Un badge affiche ✗ rouge »

D'après la fiche mémo remise aux salariés : présenter le badge une deuxième fois. Si le rouge persiste, le salarié va voir son encadrant. Pour l'encadrant :

1. **Redemander au salarié de présenter le badge une nouvelle fois**, bien à plat devant le lecteur (mauvais contact = cause la plus fréquente).
2. **Si le rouge persiste malgré tout : rien n'est perdu.** Le pointage part quand même dans SOLIDATA comme « orphelin » — il sera rattaché après coup (voir `MANUEL_RH.md` §2).
3. **Vérifier le statut du badge du salarié** dans SOLIDATA : **Temps & Présence → Badges**. Le badge doit être **« Actif »**. S'il apparaît « Perdu », « Volé », « Désactivé » ou « Restitué » par erreur, c'est la cause : il faut le réactiver ou en attribuer un nouveau (`MANUEL_RH.md` §1-2).
4. **Si le badge est bien actif mais toujours refusé**, il s'agit probablement d'une empreinte de badge mal enregistrée à l'attribution. Contacter le référent technique — voir `EXPLOITATION.md` pour la procédure de vérification de l'empreinte d'un pointage orphelin.
5. **Si plusieurs badges différents produisent un rouge** au même moment, suspecter le lecteur (voir §2.2) plutôt que les badges eux-mêmes.

---

## 3. Mise en service du poste de secours Pi 3 B+ (objectif : 5 minutes)

Le Raspberry Pi 3 B+ est **déjà préconfiguré et déjà appairé** dans SOLIDATA (son propre `device_code`, sa propre clé). C'est une préparation à faire en amont, pas une improvisation le jour de la panne.

**Ce qui est déjà préparé avant l'incident :**
- le Pi 3 B+ a déjà reçu `install.sh --target pi3` avec sa propre configuration (`device_code` distinct du poste principal, ex. `LH-P1-SECOURS`) ;
- sa carte microSD haute endurance (SanDisk MAX ENDURANCE ou équivalent — SPEC §3.3) est déjà clonée et prête ;
- il est appairé dans SOLIDATA (visible dans Supervision, généralement affiché « hors ligne » tant qu'il n'est pas branché — c'est normal).

**Le jour de la panne :**

1. Débrancher le Raspberry Pi 5 en panne (alimentation, câbles).
2. Brancher le Raspberry Pi 3 B+ de secours **à la place** : écran (HDMI), lecteur RFID (USB — le débrancher du Pi 5 et le rebrancher sur le Pi 3 si un seul lecteur est disponible), Ethernet, alimentation.
3. Attendre le démarrage complet (jusqu'à 3 minutes sur Pi 3 B+, plus lent que le Pi 5).
4. **Vérifier** : l'écran de veille apparaît, et dans SOLIDATA → Supervision, le poste de secours passe « En ligne ».
5. Tester avec un badge.

**Ce qu'il faut vérifier ensuite (pas dans les 5 minutes, mais dans la journée) :**
- que la file d'attente du Pi 5 en panne n'a pas laissé de pointages non transmis avant la coupure (si le Pi 5 redevient accessible, laisser sa file s'écouler avant de le remettre en service, ou traiter manuellement via `EXPLOITATION.md`) ;
- que le Pi 3 B+ reste en service jusqu'à réparation du Pi 5, avec la même vigilance quotidienne.

---

## 4. Remplacement du SSD NVMe

1. Éteindre proprement le poste :
   ```bash
   sudo shutdown -h now
   ```
2. Débrancher l'alimentation, ouvrir le boîtier, retirer le HAT M.2 avec l'ancien SSD.
3. Installer le nouveau SSD, préparé au préalable selon §1.2 (flashé avec le même système, **ou** vierge si vous comptez restaurer une sauvegarde — voir `EXPLOITATION.md` §3 pour la restauration).
4. Remonter le HAT, rebrancher, démarrer le poste.
5. Si le SSD est neuf (non flashé au préalable) : reprendre l'installation depuis §1.5 (le fichier de configuration doit reprendre **le même `device_code`** que l'ancien poste — jamais un nouveau code sur un poste déjà en service, sinon la chaîne d'intégrité locale ne peut pas reprendre).
6. Refaire la vérification finale (§1.10).

## 5. Remplacement de la pile RTC

1. Éteindre proprement le poste (`sudo shutdown -h now`), débrancher l'alimentation.
2. Ouvrir le boîtier, repérer le connecteur JST-SH 2 broches de la pile RTC (à côté du connecteur USB-C sur le Pi 5).
3. Débrancher l'ancienne pile, brancher la neuve (référence officielle Raspberry Pi — SPEC §3.1).
4. Refermer, rebrancher, démarrer le poste.
5. **Vérifier que l'horloge est correcte** une fois le réseau rétabli (l'agent se resynchronise via NTP). Si le poste doit fonctionner un moment sans réseau juste après le remplacement, une dérive d'horloge peut apparaître temporairement — elle est remontée automatiquement (voir `EXPLOITATION.md` §4, champ « dérive »).

---

## 6. Procédure papier de repli et rattrapage des pointages

Si le poste principal **et** le poste de secours sont tous deux indisponibles (panne électrique générale, sinistre), utiliser une feuille papier de repli.

**Modèle de feuille (à imprimer et garder à portée de l'encadrant) :**

| Nom du salarié | Matricule | Heure d'arrivée | Heure de départ | Signature encadrant |
|---|---|---|---|---|
| | | | | |

**Règle de rattrapage.** Dès que SOLIDATA est de nouveau accessible (poste réparé ou secours en place), l'encadrant saisit **une correction pour chaque ligne** de la feuille papier :

1. Aller dans **Temps & Présence → Journal**.
2. Cliquer sur **« + Correction »**.
3. Type : **« Ajout d'un pointage manquant »**.
4. Motif : **« Badge défaillant »** (c'est le motif prévu pour ce cas dans la liste fermée).
5. Renseigner le salarié, le sens (Entrée/Sortie), la date et l'heure notées sur la feuille papier.
6. Répéter pour chaque ligne de la feuille.

Ces corrections sont soumises aux mêmes règles que toute correction (voir `MANUEL_RH.md` §2) : un encadrant ne corrige jamais ses propres pointages, et la correction reste possible tant que la période n'est pas verrouillée par la validation RH de fin de mois.

---

## 7. PROTOCOLE DE RECETTE MATÉRIELLE — préalable obligatoire avant mise en service réelle

Ces six tests (RP-1 à RP-6) sont issus de `RAPPORT_QA.md` §6. **Ils ne peuvent pas être remplacés par une vérification logicielle** : ils engagent l'alimentation, la thermique, l'horloge matérielle et le comportement réel sous charge. Aucune mise en service en production ne doit avoir lieu avant qu'ils soient tous passés avec succès. Consigner les résultats chiffrés (dates, mesures) à la suite de ce protocole ou en annexe.

### RP-1 — Coupures secteur × 20 (intégrité de la file et de la chaîne)

**Protocole.** Poste en service nominal, 5 pointages badgés déposés puis coupure brutale de l'alimentation (retrait secteur, jamais `shutdown`), 30 s hors tension, remise sous tension, attente du retour de l'écran de veille. Répéter **20 fois**. À chaque cycle, badger pendant l'écriture (dans les 2 s suivant un bip) sur au moins 5 des 20 cycles.

**Instrumentation.** Avant/après chaque cycle :
```bash
sqlite3 /var/lib/badgeuse/badgeuse.db "SELECT COUNT(*) FROM queue"
sqlite3 /var/lib/badgeuse/badgeuse.db "SELECT sequence, last_hash FROM chain_state"
```
Côté serveur : bouton « Vérifier la chaîne » sur la carte du poste (Temps & Présence → Supervision).

**Critères de succès (chiffrés).**
- 0 base SQLite corrompue (`PRAGMA integrity_check` = `ok` sur 20/20).
- 0 trou et 0 doublon dans la séquence des pointages (suite strictement +1).
- Vérification de chaîne : 0 maillon rompu sur les 20 cycles.
- Nombre de pointages en base serveur = nombre de badges présentés (perte = 0).
- Retour à l'écran opérationnel en ≤ 90 s sur 20/20.

### RP-2 — 24 heures hors ligne réelles

**Protocole.** Débrancher le réseau (câble ou coupure Wi-Fi côté point d'accès — **pas** une règle de pare-feu locale, qui ne reproduit pas les délais réels). Maintenir 24 h. Faire badger au moins 40 pointages répartis sur la période (dont 4 après 20 h d'isolement). Rebrancher, puis observer 30 min.

**Critères.**
- Bandeau « hors ligne » affiché en ≤ 120 s après la coupure, masqué en ≤ 120 s après rétablissement.
- Écran de veille (playlist) rejoué sans interruption pendant les 24 h.
- Après reconnexion : 100 % des pointages remontés en ≤ 10 min, file revenue à 0, 0 doublon côté serveur, 0 rupture de chaîne.
- Espace disque consommé par la file < 5 Mo pour 40 pointages.

### RP-3 — Ventilateur entravé (thermique)

**Protocole.** Obstruer physiquement le ventilateur/ailettes (adhésif sur la grille, poste en boîtier fermé, ambiante ≥ 25 °C). Charge : cycle de veille normal + 1 badge/minute pendant 2 h. Relever la température CPU et l'indicateur de bridage toutes les minutes (visibles dans Supervision, carte du poste).

**Critères.**
- La supervision remonte effectivement la montée en température.
- L'indicateur de bridage (« throttling ») apparaît en rouge dans Supervision dès que le seuil est atteint.
- Aucun redémarrage du service ni du poste sur les 2 h.
- 0 pointage perdu ; réactivité du poste conservée même à température élevée.
- Retour sous 70 °C en ≤ 10 min après désobstruction.

**Cette vérification est autant une preuve de supervision qu'un test matériel** : un bridage thermique invisible dans SOLIDATA serait le mode de panne le plus difficile à diagnostiquer à distance. Retenir aussi : **dépoussiérage semestriel du ventilateur inscrit au plan de maintenance** (l'environnement atelier textile est chargé en fibres — SPEC §2.4).

### RP-4 — Bascule sur Raspberry Pi 3 (cible dégradée)

**Protocole.** Installer via `install.sh --target pi3`. Exercice de 4 h : 200 pointages + playlist de 10 éléments dont 2 images.

**Critères.**
- Démarrage complet (secteur → écran de veille) ≤ 180 s.
- Empreinte mémoire de l'agent ≤ 128 Mo (`systemctl show -p MemoryCurrent badgeuse-agent`), aucun arrêt forcé pour manque de mémoire (`dmesg | grep -i oom` vide).
- Latence badge → confirmation à l'écran ≤ 1,5 s dans la grande majorité des cas (chronométrage vidéo, 30 mesures).
- 0 redémarrage du service d'affichage sur 4 h.
- Aucun accès au bureau ni au curseur possible.

### RP-5 — Charge 30 badges / 60 s (file d'attente réelle)

**Protocole.** 30 personnes (ou 30 présentations successives de badges distincts) en 60 s, cadence environ 1 badge toutes les 2 s, à l'heure d'embauche. Répéter 3 fois (matin, après pause, fin de poste). Inclure 2 présentations doubles volontaires (moins de 8 s d'écart) pour éprouver l'anti-rebond.

**Critères.**
- 30 pointages distincts enregistrés par salve (les doubles présentations en moins de 8 s comptent pour 1 et affichent « Déjà enregistré »).
- Latence badge → confirmation ≤ 1 s dans la grande majorité des cas ; aucune confirmation sautée.
- Sens (Entrée/Sortie) correct sur 30/30 (contrôle contre une feuille de présence papier tenue en parallèle).
- 0 collision de séquence, 0 rupture de chaîne.
- Retour sonore audible à 3 m sur 30/30 ; lisibilité de l'écran à 3 m validée par 3 observateurs différents, y compris une personne portant une correction visuelle.

**C'est le test le plus discriminant** : c'est le seul scénario qui met la base sous forte contention et qui vérifie donc réellement le mécanisme de reprise en cas d'incident transitoire côté serveur. À jouer avec **comptage contradictoire** (contre une feuille papier tenue en parallèle) pour confirmer qu'aucun pointage n'a disparu.

### RP-6 — Pile RTC vide (dérive d'horloge et valeur probante)

**Protocole.** Retirer la pile RTC. Couper le poste 12 h. Redémarrer sans réseau (donc sans synchronisation horaire). Badger 3 pointages. Rétablir le réseau après 15 min. Répéter avec une pile neuve pour comparaison.

**Critères.**
- Au démarrage sans pile ni réseau, le poste **ne doit pas horodater silencieusement avec une date fausse** : une dérive doit être remontée et visible dans Supervision (champ « Dérive horloge »).
- Après retour du réseau, la dérive se corrige et reste journalisée côté serveur (alerte au-delà de 2 secondes).
- Les 3 pointages horodatés hors réseau restent identifiables et peuvent être rattrapés par une correction — aucun n'est perdu.
- Avec une pile neuve : dérive ≤ 2 secondes après 12 h hors tension.

**Ce test est le plus important pour la valeur probante du dispositif** : un horodatage faux et non signalé ruinerait la fiabilité de tout le système en cas de litige.

**Matériel requis pour l'ensemble du protocole :** 2 postes (Pi 5 et Pi 3), 30 badges distincts, un moyen simple de couper/rétablir l'alimentation, un thermomètre d'ambiance, un chronomètre, un accès en ligne de commande (SSH) sur les postes.
