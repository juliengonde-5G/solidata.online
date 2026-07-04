# Annexe 03b — Audit détaillé des pages React « Admin Collecte » (CAV, véhicules, capteurs, prédictif)

> Annexe du rapport `03-collecte-vehicules-capteurs.md`. Audit page par page des écrans
> d'administration de la collecte, avec un focus sur les parcours d'ajout
> (nouveau CAV, nouveau véhicule, nouvelle sonde) en préparation de l'extension du parc.

Note transversale : toutes les pages passent par l'instance Axios `api` (baseURL `/api` implicite) et `sensorsApi` (api.js:76-88). Résolution des endpoints `sensorsApi` :
`list→GET /cav/sensors` · `status→GET /cav/:id/sensor-status` · `history→GET /cav/:id/sensor-history` · `rawReadings→GET /cav/:id/sensor-readings-raw?limit=` · `diagnostic→GET /cav/:id/sensor-diagnostic` · `provision→POST /cav/:id/sensor/provision` · `updateCalibration→PATCH /cav/:id/sensor-calibration` · `deprovision→DELETE /cav/:id/sensor` · `reassign→POST /cav/sensors/reassign` · `ackAlert→POST /cav/sensors/alerts/:id/ack` · `liveObjectsDevices→GET /cav/liveobjects-devices`.

---

## 1. AdminCAV.jsx

**1. Endpoints** (aucun Socket.IO direct ; délégué à SensorSection, intégré ligne 563)
- `GET /cav` params `{status, search}` — L76
- `GET /cav/:id/qr-code` (blob) — L120 (détail) et L217 (download)
- `PUT /cav/:editCav.id` — L158 (édition)
- `POST /cav` — L161 (création)
- `PUT /cav/:id` `{status, unavailable_reason}` — L176 (toggle statut)
- `DELETE /cav/:id` — L194
- `POST /cav/batch-generate-qr` — L206
- `GET /cav/qr-sheets/:format` (blob, timeout 120000) — L232
- `POST /cav/:id/photo` (multipart, champ `photo`) — L253
- `DELETE /cav/:id/photo` — L269

**2. Champs de réponse lus** : `cav.id, name, address, commune, latitude, longitude, nb_containers, communaute_communes, surface, ref_refashion, entite_detentrice, code_postal, status, unavailable_reason, qr_code_data, photo_path` ; `res.data.generated` (L207).
- MISMATCH/BUG UI : la colonne intitulée « Nom » (th L349) affiche `cav.commune` (L364), et la colonne « Commune » affiche aussi `cav.commune` (L367). Le champ **`name` n'est jamais rendu** ni en liste, ni dans la fiche détail (qui affiche `CAV #id` + `commune`, L409-410). Le nom saisi au formulaire est donc invisible.
- `detailCav.photo_path` utilisé en `src={`/api${photo_path}`}` (L541) : suppose un chemin relatif renvoyé par le back.

**3. Parcours d'ajout — nouveau CAV** : `EMPTY_FORM` L52-53. Formulaire modal L596-701 : **Nom*** (L600-602), Commune (L605), Adresse (L612), **Latitude*/Longitude*** (L619-626, type number step any), Nb conteneurs (défaut 1, L629), Code postal, Communauté de communes, Surface, Réf. Refashion, Entité détentrice (L635-663). Obligatoires validés côté client : `name` (L138), `latitude`+`longitude` (L139). GPS posable par clic carte (LocationPicker L680, `handleMapPick` L132). QR : généré automatiquement côté back à la création, mention « définitif, ne pourra pas être modifié » (L686-688, L579).

**4. Hardcodings** : centre carte Rouen `[49.4231, 1.0993]` (L671, L513) ; placeholders GPS `49.4231/1.0993` (L621,626) ; formats planches `'A7'`/`'A8'` en dur (L306,310) ; URLs CDN Leaflet en dur (L38-40) ; tuiles CARTO `light_all` ; `nb_containers` défaut 1.

**5. Erreurs/chargement** : toast maison `showAlert` auto-dismiss 4 s (L84-87) ; `console.error` silencieux au load (L78) et QR détail (L122). Suppression protégée par `confirm()` modal (useConfirm, L186-191). **`prompt()` natif** pour la raison d'indisponibilité (L174). Spinners `saving`, `qrGenerating`, `sheetDownloading`, `uploadingPhoto`.

**6. Complexité admin** : moyenne-faible. Peu de jargon (sauf `ref_refashion`, `entite_detentrice` non expliqués). Placeholders utiles. Carte cliquable = bon. Pas de tooltip.

---

## 2. Vehicles.jsx

**1. Endpoints**
- `GET /vehicles?include_archived=true` — L87
- `PATCH /vehicles/:id/archive` — L96 · `PATCH /vehicles/:id/restore` — L103
- `GET /vehicles/maintenance/profiles-db` — L110
- `POST /vehicles/maintenance/generate-plan` `{brand, model, year, engine, vehicle_id}` — L123
- `GET /vehicles/maintenance/overview` — L145
- `GET /vehicles/maintenance/schedule/:id` — L152
- `GET /vehicles/:id/events` — L159 · `POST /vehicles/:id/events` — L252
- `GET /vehicles/:id/documents` — L166 · `POST /vehicles/:id/documents` (multipart, champ `file`) — L181 · `DELETE /vehicles/:id/documents/:docId` — L194 · lien `GET /api/vehicles/:id/documents/:docId/download` (L557)
- `PUT /vehicles/:id` — L235 · `POST /vehicles` — L237
- Via VehicleAccessPanel : `GET /vehicles/:id/access-info`, `POST /vehicles/:id/regenerate-token`

**2. Champs de réponse lus** : vehicle `id, registration, name, brand, model, type, max_capacity_kg, tare_weight_kg, current_km, next_maintenance, insurance_expiry, team_id, status, vehicle_type, is_archived` ; `res.data.plan`, `res.data.vehicle_type` (L130-131) ; `generatedPlan.{vehicle_type, items[].label_fr/.interval_km/.interval_months}` (L681-686) ; `schedule.schedule[].{label, intervalle_km, last_date, last_km, km_since, status, ratio}` (L448-465) ; `maintenanceOverview[].{computed_alerts[].urgency/.message, vehicle_type, current_km, last_maintenance_date, last_maintenance_km, controle_technique_date}` (L365-386) ; events `{id, event_type, description, event_date, km_at_event, cost, performed_by}` ; documents `{id, title, doc_type, created_at, file_size, expiry_date}`.
- Note : `generateMaintenancePlan` lit `interval_km/interval_months` (L684) alors que `schedule` lit `intervalle_km` (L451). Deux conventions de nommage back coexistent (plan généré vs planning calculé) — à vérifier côté back.

**3a. Parcours ajout VÉHICULE** : `emptyForm` L40-45. Modal L577-697 :
- **Immatriculation*** (required, forcée majuscules, `disabled` en édition — L580)
- Nom/Libellé (L581), Marque + Modèle (L583-584)
- Type : select en dur **camion/utilitaire/voiture**, défaut `utilitaire` (L589-593)
- Statut (édition seule) : available/in_use/maintenance/out_of_service (L598-603)
- PTAC/Capacité max kg (défaut 3500), Poids à vide kg (tare), Kilométrage (défaut 0) — L607-619
- Prochaine maintenance (date), Expiration assurance (date) — L621-629
- **Config maintenance** (encart L631-690) : Motorisation + Année (optionnels, L642-646) ; sélecteur « Profil existant » (L652-657) listant `profiles-db` ; bouton **« Rechercher le plan via IA »** (L662, désactivé si pas de marque+modèle) → POST generate-plan, aperçu du plan généré (L679-689).
- **qr_token / URL chauffeur** : dans le panneau `VehicleAccessPanel` (onglet Détail, L426-430), pas le formulaire de création. Voir §VehicleAccessPanel ci-dessous.

**3b.** Pas de sonde ici.

**4. Hardcodings** : `EVENT_TYPES` (L8-17), `EVENT_COLORS` (L18-23), `DOC_TYPE_LABELS` (L25-29), `DOC_TYPE_OPTIONS` (L30-38) ; défauts `type='utilitaire'`, `max_capacity_kg=3500`, `current_km=0`, `status='available'`, `vehicle_type='generic'` ; options type/statut en dur (L590-602) ; emojis 🚛🚐🚗 mappés sur `type` (L312, L402) ; taille doc « max 10 Mo » + extensions acceptées en dur (L715-716).

**5. Erreurs/chargement** : **incohérent** — mélange `console.error` (L89,98,105,112,147,154,161,168,196,261) et `alert()` natif (L98,105,117,138,188,243). **`window.confirm` natif** pour archiver (L94) et supprimer document (L192) — pas le composant modal useConfirm (contrairement à AdminCAV). LoadingSpinner global (L264), spinner IA (L666-669).

**6. Complexité admin** : élevée. Jargon : PTAC, tare, charge utile, « profil constructeur », `vehicle_type='generic'`. La génération de plan « via IA » a un texte d'aide (L678). Beaucoup de champs. Pas de tooltip natif.

---

## VehicleAccessPanel.jsx (URL chauffeur — load-bearing pour §3a)

- Réservé ADMIN : `isAdmin = user.role==='ADMIN'` (L27), `return null` sinon (L48).
- `GET /vehicles/:id/access-info` (L37) → lit `accessInfo.mobile_url` (L51,104-105).
- `POST /vehicles/:id/regenerate-token` (L72) → remplace accessInfo (L73).
- Copier presse-papier (L50-59), **`window.confirm` natif** avant régénération (L63-67, avertit que l'ancien raccourci devient invalide).
- Mode d'emploi 3 étapes pour paramétrer le téléphone (ol L127-131) : ouvrir URL → « Ajouter à l'écran d'accueil » → nommer avec l'immatriculation. Bonne aide non technique.
- Aucun QR affiché ici (URL en clair + copier) ; le « qr_token » back est exposé sous forme d'URL `mobile_url`, non de token brut.

---

## 3. VehicleMaintenance.jsx

**1. Endpoints**
- `GET /vehicles/maintenance/profiles-db` — L45 · `POST /vehicles/maintenance/profiles-db` `{...profileForm, vehicle_type, items:[]}` — L517 · `DELETE /vehicles/maintenance/profiles-db/:id` — L127
- `GET /vehicles` — L46
- `GET /vehicles/maintenance/overview` (catch→[]) — L47
- `GET /vehicle-contracts` (catch→[]) — L48 · `POST /vehicle-contracts` (multipart) — L67 · `PUT /vehicle-contracts/:id` `{active}` — L96 · `DELETE /vehicle-contracts/:id` — L89
- `GET /vehicles/maintenance/schedule/:id` — L104 · `GET /vehicles/:id/events` — L105

**2. Champs de réponse lus** : profiles `{id, brand, model, engine_code, timing_system, adblue_equipped, revision_km, revision_months, items[], source}` ; items `{label_fr, interval_km, interval_months, estimated_cost_eur, interval_note}` ; overview `{id, name, registration, current_km, vehicle_type, last_maintenance_date, computed_alerts[].urgency/.type}` ; contracts `{id, active, registration, vehicle_name, prestataire, type_contrat, debut, fin, tarif_mensuel_eur, contact_nom, contact_telephone, document_path}` ; schedule `{profile_name, profile_source, schedule[].{label, intervalle_km, intervalle_months, last_km, last_date, km_since, status, ratio, estimated_cost_eur}}` ; events `{id, event_date, event_type, km_at_event, description, cost, performed_by, created_by_name}`.

**3. Parcours d'ajout**
- **Profil constructeur** (`profileForm` L30 ; modal L512-570) : **Marque*/Modèle*** (required), Code moteur, Distribution (select **courroie/chaine**, défaut courroie), AdBlue (oui/non→bool, défaut true), Révision km (défaut **30000**), Révision mois (défaut **24**). `vehicle_type` auto = `` `${brand} ${model}` `` (L516). PROBLÈME : `items: []` est envoyé vide (L517) — un profil créé ici n'a **aucune opération d'entretien** ; le plan détaillé doit être généré ailleurs (bouton IA de Vehicles.jsx). Incohérence de parcours pour l'admin.
- **Contrat d'entretien** (`contractForm` L34-38 ; modal L573-670) : Véhicule* (select), Type (partiel/full), Prestataire*, Début*, Fin*, Tarif mensuel €, Opérations incluses (texte libre « séparer par virgules »), Contact nom/téléphone/email, Document (PDF/image), Notes.

**4. Hardcodings** : `STATUS_COLORS/STATUS_LABELS` ok/bientot/depasse (L8-9) ; défauts profil 30000 km / 24 mois / courroie / adblue true (L30) ; onglets en dur `plans/flotte/contrats/historique` (L148) ; `type_contrat` partiel/full ; **valeur magique `86400000`** (ms/jour) répétée (L313,321,323) ; seuils expiration 30 j / 7 j en dur (L313,328).

**5. Erreurs/chargement** : `console.error` (L54,109) ; **`alert()` natif** pour toutes erreurs mutation (L77,91,98,130,521) ; `confirm()` modal (useConfirm) pour suppression contrat (L81) et profil (L119). LoadingSpinner global (L136). overview/contracts en `catch(()=>({data:[]}))` = échec silencieux (L47-48).

**6. Complexité admin** : élevée. Jargon : « distribution courroie/chaîne », « AdBlue », « code moteur », `profile_source` (badge « ⚙️ Profil hardcodé » vs « 📋 base », L422). Création profil sans items = confusion probable.

---

## 4. AdminPredictive.jsx

**1. Endpoints** (17 endpoints)
- `GET /tours/predictive-config` — L94 · `PUT /tours/predictive-config` (body=config entier) — L210
- `GET /tours/predictive/ia/synthese` — L60 · `GET /tours/predictive/ia/ajustements` — L72
- `GET /tours/events` — L102 · `POST /tours/events` — L253 · `DELETE /tours/events/:id` — L273
- `GET /tours/events-auto/stats` — L110 · `GET /tours/events-auto/predictions?weeks=6` — L111 · `GET /tours/events-auto/sources` — L120 · `GET /tours/events-auto/last-runs` — L145
- `POST /tours/events-auto/discover` `{months_ahead:3}` — L129 · `POST /tours/events-auto/discover-by-cav` — L155 · `POST /tours/events-auto/discover-by-association` — L166 · `POST /tours/events-auto/sync-holidays` — L177 · `POST /tours/events-auto/recalc-seasonal` — L188
- `GET /tours/context/:date` (météo) — L202

**2. Champs de réponse lus** : config `{centreTri.lat/lng, scoring{weekendSunnyBonus, localEventBonus, fillThresholds.{critical,high,medium}, fillScores.{critical,high,medium}, daysSinceWeight, containerBonus, vehicleFillTarget, avgSpeed, timePerCav, historyDays, weeklyCollectionCycle, densityThreshold, densityBonus, holidayBonus, schoolVacationFactor, schoolVacationBonus, summerVacationFactor, preVacationBonus, postVacationBonus, maxFillCap}, seasonalFactors[12], dayOfWeekFactors[7], holidays[], schoolVacations[{name,start,end}]}` ; iaSynthese `{score_global, resume, tendances[], anomalies[], recommandations[]}` ; iaAjustements `{confiance, message, justifications[], facteurs_saisonniers_proposes[12], facteurs_jours_proposes[7]}` ; autoStats `{total_events, upcoming_events, predicted_by_ia, avg_bonus_factor, by_source{}}` ; predictions[] `{week_label, week_start, combined_impact_factor, estimated_volume_change, events_count, seasonal_context, events[].id/.nom, brocante_probability}` ; sources[] `{id, key_configured, requires_key, name, coverage, env_var}` ; lastRuns `{discovery_runs[].scope/.completed_at/.events_inserted, jours_feries.last_at/.total, vacances_scolaires.last_at/.total, seasonal_factors.last_at/.total}` ; weatherPreview `{weatherLabel, weatherCode, tempMax, precipMm, weatherFactor}` ; events[] `{id, nom, type, date_debut, date_fin, commune, rayon_km, bonus_factor}`.

- **BUG mismatch net** : `appliquerAjustements` (L80-90) écrit `newConfig.seasonal` (L85) et `newConfig.dayOfWeek` (L88), mais tout le reste du composant lit/écrit `config.seasonalFactors` (L219,711) et `config.dayOfWeekFactors` (L226,729). Les facteurs recommandés par l'IA **ne sont donc jamais appliqués au formulaire** — le bouton « Appliquer les facteurs recommandés » (L698) est sans effet visible avant sauvegarde.
- Ambiguïté back/front : `config.scoring.schoolVacationFactor || config.scoring.schoolVacationBonus` (L762, L857) — deux noms possibles pour le même champ, indice de désalignement du contrat.

**3. Parcours d'ajout — événement local** (`eventForm` L31-35 ; modal L892-932) : **Nom***, Type (select EVENT_TYPES), **Date début*/Date fin***, Adresse, Commune, Latitude, Longitude, Rayon d'impact km (défaut 2), Bonus remplissage x (défaut 1.2, min 1), Notes. (Ni véhicule ni sonde ici.)

**4. Hardcodings** (nombreux) : `MONTH_LABELS` (L7), `DAY_LABELS` (L8), `EVENT_TYPES` (L9-19) ; **facteurs météo affichés en dur** x1.08/x0.95/x0.92/x0.90 (L332-347) — valeurs « magiques » non liées à la config ; fallbacks en dur : `weekendSunnyBonus||1.15` (L351), `localEventBonus||1.2` (L378), `preVacationBonus||1.05`, `schoolVacationFactor||0.90`, `summerVacationFactor||1.0`, `postVacationBonus||1.05` (L856-859) ; `months_ahead:3` (L129), `weeks=6` (L111) ; défauts event rayon 2 / bonus 1.2 ; centre tri readonly « modifiable via env vars CENTRE_TRI_LAT/LNG » (L309-316) ; texte « 1 468 t, 196 CAV » en dur (L861).

**5. Erreurs/chargement** : `console.error` massif (L96,105,115,123,205,214,267,275) ; `iaError` affiché (L640) ; `discoveryResult.error/message` (L559-563) ; `save()` en `console.error` seul + feedback « Sauvegardé ! » 2 s (L214,299). **`confirm()` natif** pour suppression event (L271). Spinners `iaLoading`, `discovering`, `syncing`, LoadingSpinner global (L278), garde `!config` (L279).

**6. Complexité admin** : très élevée. ~20 paramètres de scoring bruts (L746-766), jargon fort : TSP+2-opt, DOW/SEASONAL, code WMO, RSSI, « facteur post-vacances ». Beaucoup d'aides (desc de `Section`, encadré explicatif algo L866-889, note source données) mais densité décourageante pour non-technicien.

---

## 5. AdminSensors.jsx

**1. Endpoints + Socket.IO**
- `sensorsApi.list()` → `GET /cav/sensors` — L24
- `sensorsApi.liveObjectsDevices()` → `GET /cav/liveobjects-devices` — L33
- `GET /cav` params `{status:'active'}` (ReassignModal) — L254
- `sensorsApi.reassign()` → `POST /cav/sensors/reassign` `{source_cav_id, target_cav_id}` — L270
- `sensorsApi.rawReadings(id,200)` → `GET /cav/:id/sensor-readings-raw?limit=200` — L348
- `sensorsApi.diagnostic(id)` → `GET /cav/:id/sensor-diagnostic` — L474
- **Socket.IO** via `useCavSensorSocket(handleReading)` (L53) : mise à jour optimiste sur event `cav:sensor-reading`, payload lu `{cav_id, fill_level, timestamp, battery, rssi}` (L44-51).

**2. Champs de réponse lus** : sensors[] `{id, name, commune, lora_deveui, sensor_reference, sensor_last_reading, sensor_battery_level, sensor_last_rssi, sensor_last_reading_at, computed_status, open_alerts}` ; loInfo `{total, assigned, orphans, devices[], error}`, devices `{devEui, name, profile, lastUplinkAt, tags[], assigned_cav}` ; rawReadings `{count, readings[].{id, reading_at, fill_level_percent, distance_cm, battery_level, temperature, rssi, snr, sf, fcnt, alarm_type, tilt_detected, raw_data}}` ; diagnostic `{layers[].{name, label, status, issues[], details}, recommendations[]}`.
- Cohérence : `handleReading` fait `s.id === reading.cav_id` (L44) et ReassignModal filtre `c.id !== sensor.id` (L256) → **`sensor.id` = id du CAV** (le capteur est indexé par CAV). Cohérent mais implicite.

**3.** Pas d'ajout de sonde ici (le provisioning se fait dans SensorSection via la fiche CAV — rappel explicite L104-107). Actions : Réaffecter (modal L246), Logs bruts (L342), Diagnostic 4 couches (L466).

**4. Hardcodings** : modèle « Milesight EM400-MUD » en dur (L80) ; seuil batterie ≤20 (L50,172) ; limit rawReadings 200 (L348) ; filtres en dur all/active/offline/low_battery/alerts (L138-142) ; maps `StatusBadge` (L455-462), `FilterCard` colors (L432-445), `statusColor/statusIcon` ok/warning/error/unknown (L539-550).

**5. Erreurs/chargement** : `console.error` (L27) ; loInfo error en fallback objet (L36) ; `data.error` dans modals (L350,364,499). **Pas de `confirm()` sur la réaffectation** (seulement un avertissement visuel L284-286) — action sensible sans double validation. LoadingSpinner global (L55), `diagnostic loading`, `rawHistory loading`.

**6. Complexité admin** : vue d'expert (diagnostic bout-en-bout 4 couches, JSON brut, SNR/SF/FCnt/tilt). Clairement pour admin technique, pas grand public.

---

## SensorSection.jsx (provisioning + calibration sonde CAV)

**1. Endpoints** : `status→GET /cav/:id/sensor-status` (L23) · `deprovision→DELETE /cav/:id/sensor` (L43) · `ackAlert→POST /cav/sensors/alerts/:id/ack` (L52) · `updateCalibration→PATCH /cav/:id/sensor-calibration` (L208) · `liveObjectsDevices→GET /cav/liveobjects-devices` (L291) · `provision→POST /cav/:id/sensor/provision` (L323). Pas de Socket.IO (statut chargé à la demande).

**2. Champs de réponse lus** : status `{lora_deveui, sensor_reference, sensor_type, sensor_height_cm, sensor_reporting_interval_min, sensor_install_date, sensor_last_reading_at, sensor_last_reading, sensor_battery_level, sensor_last_rssi, sensor_status, open_alerts[].{id,alert_type,message,triggered_at,acknowledged_at}, recent_readings[].{reading_at,fill_level_percent,battery_level}}` ; devices `{devEui, appEui, name, profile, lastUplinkAt, assigned_cav.{name,commune}}`. `provisioned` déduit de `lora_deveui || sensor_reference` (L71).

**3b. Parcours d'ajout SONDE** (le cœur de la demande)
- **Provisioning** (`ProvisionModal`, form L273-280 ; modal L336-457) :
  - Sélecteur « Devices déclarés sur Orange Live Objects » auto-chargé à l'ouverture (L302-303) ; liste `freeDevices` (non assignés) cliquables remplissant `dev_eui`+`app_eui` (L310-316, L365-391) ; section repliée « Déjà assignés » (L393-409).
  - **DevEUI*** (required, majuscules, placeholder `24E124...`) — L420-423
  - **AppEUI (JoinEUI)** (majuscules, placeholder `24E124C0...`) — L424-427
  - **AppKey (facultative)** (type password, placeholder « 32 caractères hex — optionnel ») — L428-431 ; aide L414-419 explique que Orange ne restitue jamais l'AppKey et qu'elle sert de backup.
  - **Hauteur vide (cm)*** (min 30 max 500, défaut **260**) — calibration conteneur — L433-437
  - Reporting (min) (min 10 max 1440, défaut **180**) — L438-442
  - Date d'installation (défaut aujourd'hui) — L444-448
  - **Choix du modèle de capteur : ABSENT.** Aucun champ modèle/type ; le type est figé (commentaire « Milesight EM400-MUD » L9, mais `status.sensor_type` s'affiche « ultrasonic » par défaut L104). Pas de choix de seuils d'alerte dans ce formulaire (seuils gérés côté back).
- **Calibration** (`CalibrationModal`, form L182-186 ; modal L218-248) : **Hauteur vide (cm)*** (min30 max500, défaut 260) L225-229 ; Intervalle reporting (min5 max1440, défaut 180) L230-234 ; Date installation L235-239. Aide (L220-224) : « hauteur vide = distance sonde↔fond du conteneur vide, référence pour le % de remplissage ». Ne touche pas DevEUI/clés (L221).

**4. Hardcodings** : hauteur conteneur **260 cm** en dur (L183,277,226,434) ; reporting **180 min** (L184,278) ; bornes 30-500 / 5-1440 / 10-1440 ; modèle Milesight/`ultrasonic` figé ; seuil batterie faible ≤20 % (L114) ; map `StatusBadge` active/offline/low_battery/inactive (L262-267).

**5. Erreurs/chargement** : `error` state affiché (L92) ; erreurs provision/calibration inline (L211,326) ; `devicesError` avec repli saisie manuelle (L349-353). **`confirm()` modal** (useConfirm) pour déprovisionner (L34-40). `alert()` natif pour échec deprovision (L47) et ackAlert (L57). États `loading`, `saving`, `devicesLoading`.

**6. Complexité admin** : la plus technique. Jargon LoRaWAN non vulgarisé : DevEUI, AppEUI/JoinEUI, AppKey hex, RSSI, reporting interval, « hauteur vide ». Aides présentes (AppKey facultative, définition hauteur vide) et le sélecteur Live Objects réduit la saisie manuelle, mais reste réservé à un opérateur formé.

---

## useCavSensorSocket.js

- Client Socket.IO vers `window.location.origin` (L18), `transports:['websocket','polling']`, auth `{token}` lu dans `localStorage.accessToken` (L15).
- **Écoute** l'event **`cav:sensor-reading`** (L23). Payload documenté (JSDoc L8) : `{cav_id, fill_level, fill_source, battery, rssi, temperature, tilt, alarms[], timestamp}`. N'émet rien.
- Cleanup `socket.off + disconnect` (L28-29).
- Fragilité : `useEffect` deps `[]` (L31) → si le token change (re-login) le socket n'est pas recréé ; `onReading` géré par `cbRef` (OK).

---

## 6. AdminAssociations.jsx

**1. Endpoints**
- `GET /association-points` params `{status, search}` — L62
- `POST /association-points` — L109 · `PUT /association-points/:id` — L107 (édition) et L171 (`{status}`)
- `DELETE /association-points/:id` — L129
- `POST /association-points/geocode` `{address, city, postcode}` — L145
- `POST /association-points/:id/geocode` — L161

**2. Champs de réponse lus** : item `{id, name, address, complement_adresse, code_postal, ville, latitude, longitude, contact_phone, contact_info, status, last_collection}` ; geocode `res.data.{latitude, longitude, label}`.
- Fragilité : `detailItem.latitude.toFixed(4)` (L277) et `res.data.latitude` réinjecté brut (L150) sans `parseFloat` — si le back renvoie une string, `.toFixed` lève une exception (contraste avec AdminCAV qui sécurise via parseFloat). À vérifier côté contrat back.

**3. Parcours d'ajout — point association** (`EMPTY_FORM` L28-31 ; modal L310-388) : **Nom*** (required L102), Adresse, Complément, Code postal, Ville, Téléphone contact, Info contact, Latitude/Longitude. Géocodage auto par bouton (L355, requiert address+ville L139) ou clic carte (LocationPicker L370). (Ni véhicule ni sonde.)

**4. Hardcodings** : `STATUS_LABELS`/`STATUS_COLORS` active/inactive/temporairement_indisponible (L33-43) ; centre carte `[49.4231, 1.0993]` (L363) ; tuiles CARTO.

**5. Erreurs/chargement** : `console.error` (L66) ; toast maison `showAlertMsg` auto 4 s (L72-75) ; **`confirm()` modal** (useConfirm) pour suppression (L121-127). LoadingSpinner global (L179), états `geocoding`, `saving`.

**6. Complexité admin** : faible. Formulaire simple, géocodage assisté, carte cliquable, peu de jargon. Adapté non-technique.

---

## 7. AdminCommunes.jsx

**1. Endpoints** : `GET /communes?q=` (L17) · `POST /communes/refresh-metropole` (L30). Pas de Socket.IO.

**2. Champs de réponse lus** : communes[] `{code_insee, nom, code_postal, epci_nom, population_insee}` (L100-105) ; refreshResult `{inserted, updated, total}` (L67).

**3.** Pas d'ajout manuel : la page est en lecture seule + un bouton de synchronisation depuis l'API INSEE (upsert côté back). Aucun véhicule/sonde.

**4. Hardcodings** : « 71 communes de la Métropole Rouen Normandie » (L78), source `geo.api.gouv.fr` (L78) et « API INSEE » (L61,67).

**5. Erreurs/chargement** : `error` state affiché en bandeau (L47), rempli aux deux appels (L19,34). Pas de `confirm()` (action non destructive, idempotente). Chargement inline « Chargement… » (L72), état vide illustré avec CTA (L73-86), `refreshing` avec spinner (L60,82).

**6. Complexité admin** : très faible. Un bouton, un tableau, un champ de recherche. Jargon INSEE/EPCI présent mais en colonnes lisibles. Idéal non-technique.

---

## Synthèse des anomalies prioritaires (fichier:ligne)

1. **AdminPredictive.jsx:85,88** — `appliquerAjustements` écrit `config.seasonal`/`config.dayOfWeek` jamais lus (le form lit `seasonalFactors`/`dayOfWeekFactors`, L711/L729). Bouton « Appliquer » sans effet.
2. **AdminCAV.jsx:349-367** — colonne « Nom » affiche `commune`, champ `name` jamais rendu (liste ni détail). Nom saisi invisible.
3. **VehicleMaintenance.jsx:517** — profil constructeur créé avec `items:[]` (aucune opération) ; plan réel généré ailleurs (Vehicles.jsx via IA) → parcours incohérent.
4. **SensorSection.jsx** — pas de choix de modèle de capteur (figé Milesight/ultrasonic) ; hauteur conteneur 260 cm et reporting 180 min en dur (L183-184,277-278) ; seuils d'alerte absents du formulaire.
5. **Nommage back/front incohérent** : `interval_km` vs `intervalle_km` (Vehicles.jsx:684 vs 451) ; `schoolVacationFactor` vs `schoolVacationBonus` (AdminPredictive.jsx:762,857).
6. **AdminAssociations.jsx:277,150** — `latitude.toFixed()` sans parseFloat, fragile si string.
7. **Confirmations destructives incohérentes** : modal `useConfirm` (AdminCAV, AdminAssociations, VehicleMaintenance, SensorSection) vs `window.confirm`/`prompt` natifs (Vehicles.jsx:94,192 ; VehicleAccessPanel:63 ; AdminCAV:174 ; AdminPredictive:271) ; **réaffectation de capteur sans aucune confirmation** (AdminSensors.jsx:265).
8. **Gestion d'erreur hétérogène** : toast maison (AdminCAV/AdminAssociations) vs `alert()` natif (Vehicles, VehicleMaintenance, SensorSection) vs `console.error` muet (AdminPredictive, chargements divers).
