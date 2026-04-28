# Guide de configuration — Capteur Milesight EM400-MUD-868M via Orange Live Objects

> Public : poseur / responsable technique. À suivre une fois le CAV vidé et le capteur fixé.
> Dernière révision : avril 2026.

---

## 1. Matériel requis

- Capteur **Milesight EM400-MUD-868M** (ultrasonique, EU868, IP67, piles lithium ~10 ans).
- Smartphone Android ou iOS avec l'app **Milesight ToolBox** installée (interface NFC pour la configuration).
- Compte **Orange Live Objects** avec un rôle permettant la création de devices LoRa (`DEVICE_OWNER` minimum) + une API key (`BUS_READ` au minimum).
- Accès administrateur SOLIDATA (rôle `ADMIN` ou `MANAGER`) pour le provisioning côté ERP.
- Mètre ruban rigide ≥ 2,5 m (ou mètre laser type Bosch GLM) pour la calibration `Distance of Empty Bin`.
- Marqueur / étiqueteuse pour noter le DevEUI au dos du capteur après pose.

---

## 2. Configuration locale via ToolBox (NFC)

1. **Allumer** le capteur : appuyer 3 s sur le bouton physique. La LED clignote vert.
2. **Ouvrir** l'app ToolBox, approcher le smartphone NFC du dos du capteur pour synchroniser.
3. Onglet **LoRaWAN Settings** :
   - **Activation Mode** = `OTAA`
   - **Frequency Plan** = `EU868`
   - **Class Type** = `Class A`
   - **MAC Version** = `LoRaWAN V1.0.3`
   - **ADR** = `Enable`
   - **SF** initial = `SF9` (laisser ADR ajuster)
   - Relever et noter : **DevEUI**, **JoinEUI (AppEUI)**, **AppKey**
4. Onglet **General Settings** :
   - **Working Mode** = `Bin Mode` (le firmware calcule directement un pourcentage interne)
   - **Distance of Empty Bin** = valeur mesurée en cm selon la procédure §3
   - **Reporting Interval** = `360` minutes (6 h)
5. Onglet **Threshold & Alarm** :
   - Seuil 1 : **80 %** → alerte `threshold_80`
   - Seuil 2 : **95 %** → alerte `threshold_95`
   - **Tilt Alarm** = `Enable`
   - **Temperature Alarm** : min **-10 °C**, max **60 °C**
6. **Sauvegarder** (Save via NFC). La LED clignote brièvement en vert pour confirmer.

---

## 3. Procédure de mesure de la hauteur vide (`Distance of Empty Bin`)

Cette étape est **critique** : toute la précision du % de remplissage dépend d'elle.

**Principe :** la sonde mesure une distance (capteur → surface des textiles). SOLIDATA convertit en % via
`fill_percent = (1 − distance / sensor_height_cm) × 100`. Une erreur de 10 cm sur la hauteur = ~5 % d'erreur permanente sur toutes les futures lectures.

### Matériel
- Mètre ruban rigide ≥ 2,5 m (ou mètre laser).
- Torche.
- CAV **complètement vidé** juste après collecte.
- Capteur **déjà fixé** à sa position définitive (sous la trappe supérieure, face émettrice vers le fond).

### Pas à pas
1. **Vidage total** : inspecter à la torche. Aucun sac résiduel, aucun amas textile.
2. **Alignement** : vérifier que le capteur est perpendiculaire au fond (±5°). Face émettrice (grille blanche) libre — aucun câble, aucune cornière ne doit masquer le faisceau.
3. **Mesure** : distance en cm entre la face émettrice du capteur et le fond intérieur du CAV. Prendre **3 mesures** (centre, ±20 cm de part et d'autre). Retenir la **plus petite** (la sonde retourne la distance au premier obstacle détecté).
4. **Garde 5 cm** : retrancher 5 cm de la mesure pour saturer à 100 % juste avant contact physique. Exemple : fond mesuré à 215 cm → `sensor_height_cm = 210`.
5. **Saisie** : arrondir à l'entier, entrer dans l'app ToolBox champ `Distance of Empty Bin`, puis dans SOLIDATA modal `Provisionner un capteur` champ `Hauteur vide (cm)`. Les deux valeurs doivent être identiques.
6. **Validation immédiate** : forcer un uplink (bouton physique EM400 appui court, ou via ToolBox `Test uplink`). Vérifier dans SOLIDATA `/admin/sensors` que la lecture retournée est proche de **0 %** (tolérance ±5 %). Si > 10 %, recontrôler l'alignement et recommencer à l'étape 2.
7. **Traçabilité** : noter dans le carnet d'installation — photo horodatée du mètre en place, DevEUI, date, opérateur.

### Cas particuliers
- **CAV à double compartiment** : un capteur par compartiment, chacun avec sa propre hauteur.
- **Fond non plat (trémie inclinée)** : mesurer au point le plus bas du cône. On peut accepter un "plein" à 90 % plutôt que 100 % en saisissant une valeur `sensor_height_cm` légèrement minorée (~5 % de moins).
- **Capteur déplacé ultérieurement** : refaire intégralement la procédure et éditer la fiche CAV. Les lectures antérieures restent dans l'historique mais perdent leur référentiel.

---

## 4. Provisioning côté Orange Live Objects

1. Console Live Objects → **Device Management** → **Add LoRaWAN device**.
2. Sélectionner / créer un **Device Profile** : `Milesight EM400-MUD — EU868 OTAA Class A MAC 1.0.3`.
3. Renseigner **DevEUI**, **JoinEUI (AppEUI)**, **AppKey** (relevés à l'étape 2).
4. **Tags** conseillés :
   - `solidata:cav` (tous les CAV de la flotte)
   - `solidata:cav_id=<id>` (optionnel, si on veut isoler un CAV précis)
5. **Assets → FIFO** → créer une FIFO `solidata-cav-uplinks` (QoS 1, rétention 24 h).
6. **Routing rule** :
   - Source : topic `router/~event/v1/data/new/urn/lora/#` filtré par tag `solidata:cav` et `fPort = 85`
   - Destination : FIFO `solidata-cav-uplinks`
7. Générer une **API Key** (rôle `BUS_READ`) dédiée à SOLIDATA, la recopier dans la variable d'env `LIVEOBJECTS_API_KEY`.

### (Alternative) Connector HTTP Push vers le webhook SOLIDATA

Si MQTT n'est pas envisageable (firewall, etc.) :

1. Console Live Objects → **Data & Config** → **Connectors** → **HTTP Push**.
2. URL cible : `https://solidata.online/api/webhooks/liveobjects/uplink`
3. Method `POST`, Content-Type `application/json`.
4. Header personnalisé : `X-Webhook-Secret: <LIVEOBJECTS_WEBHOOK_SECRET>` (même valeur que dans `.env` côté serveur).
5. Source : topic + tag `solidata:cav`.

---

## 5. Provisioning côté SOLIDATA

1. Se connecter avec un rôle **ADMIN** ou **MANAGER**.
2. Menu **Administration → Gestion CAV**, ouvrir la fiche du CAV concerné.
3. Dans le panneau droit, section **📡 Capteur LoRaWAN**, cliquer sur **Provisionner un capteur**.
4. Renseigner :
   - **DevEUI** (format hex sans séparateur)
   - **JoinEUI (AppEUI)**
   - **AppKey** (stockée chiffrée AES-256, jamais réaffichée en clair)
   - **Hauteur vide (cm)** — cf. §3
   - **Reporting (min)** — par défaut `360`
   - **Date d'installation**
5. **Valider**. Le CAV apparaît immédiatement dans **Administration → Capteurs CAV**.

---

## 6. Test de bout en bout

1. Forcer un uplink : bouton physique EM400 (appui court) ou ToolBox → `Send test uplink`.
2. Dans les **1 à 3 minutes** :
   - Vérifier la réception côté Live Objects (Device → `Last uplink`).
   - Vérifier côté SOLIDATA `/admin/sensors` : la ligne du CAV passe en statut **Actif**, la dernière lecture se met à jour, la carte CAV affiche l'icône 📡.
3. Script local de simulation sans matériel :
   ```bash
   docker exec -it solidata-api node src/scripts/simulate-sensor-reading.js \
     --cav-id=1 --fill=75 --battery=92
   # → attendu: HTTP 200 {"ok":true,"cav_id":1,"fill_level":75,"alerts":[]}
   ```

---

## 7. Variables d'environnement côté serveur

| Variable | Description | Exemple |
|----------|-------------|---------|
| `LIVEOBJECTS_ENABLED` | Flag d'activation du worker MQTT | `true` |
| `LIVEOBJECTS_MQTT_URL` | URL du broker Orange | `mqtts://liveobjects.orange-business.com:8883` |
| `LIVEOBJECTS_API_KEY` | API key Live Objects | `abc123…` |
| `LIVEOBJECTS_FIFO_NAME` | FIFO source | `solidata-cav-uplinks` |
| `LIVEOBJECTS_WEBHOOK_SECRET` | Secret partagé HTTP push (fallback) | `<32 chars>` |
| `LORA_APPKEY_ENCRYPTION_KEY` | Clé AES-256 pour chiffrer les AppKey | `<32 bytes base64>` |
| `SENSOR_FRESHNESS_HOURS` | Fenêtre de confiance capteur | `8` |

---

## 8. Dépannage

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| Aucun join LoRa après 10 min | Clé AppKey erronée, ou hors couverture | Revérifier les 3 clés via ToolBox. Tester à proximité d'une passerelle LoRa connue. |
| Join OK mais aucun uplink dans SOLIDATA | MQTT/webhook mal configuré | Vérifier `LIVEOBJECTS_ENABLED=true`, la FIFO, et les logs backend (`docker logs solidata-api \| grep LiveObjects`). |
| Uplink reçu mais statut "fill_not_computable" | `sensor_height_cm` non renseigné | Éditer la fiche CAV → section capteur → relancer un uplink. |
| Dérive de mesure (10-15 % d'écart constant) | Calibration erronée | Revider le CAV, refaire la procédure §3. |
| Batterie chute rapidement | Reporting trop fréquent, SF trop élevé (>SF10), tilt fréquent | Remettre `Reporting Interval = 360`, laisser ADR gérer, revérifier fixation. |
| Capteur en statut `offline` | Pas de lecture depuis 2 × reporting_interval | Vérifier présence physique + alimentation. Relancer un uplink manuel. |
| Alerte `tilt` récurrente | CAV vandalisé / renversé ou capteur mal fixé | Contrôler sur site, re-fixer si nécessaire puis acquitter l'alerte. |

---

## 9. Références

- [Milesight EM400-MUD — Datasheet](https://resource.milesight.com/milesight/iot/document/em400-mud-datasheet-en.pdf)
- [Milesight EM400-MUD — User Guide](https://resource.milesight.com/milesight/iot/document/em400-mud-user-guide-en.pdf)
- [Milesight SensorDecoders (GitHub)](https://github.com/Milesight-IoT/SensorDecoders)
- [Orange Live Objects — complete guide](https://liveobjects.orange-business.com/doc/html/lo_manual_v2.html)
- [Orange Live Objects — LPWA / LoRa manual](https://liveobjects.orange-business.com/doc/html/lo_lora_manual.html)
