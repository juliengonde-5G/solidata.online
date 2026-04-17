# Documentation mobile — SOLIDATA

> Présentation et fonctionnement de l'application mobile SOLIDATA (m.solidata.online), isolée du frontend web.
>
> **Objet** : décrire le comportement, la charte graphique et l'expérience utilisateur propres au mobile terrain, pour pouvoir le maintenir, le faire évoluer et le tester indépendamment du reste de l'ERP.
>
> Dernière mise à jour : 17 avril 2026

---

## Sommaire

1. [Identité et objectifs du mobile](#1-identité-et-objectifs-du-mobile)
2. [Architecture technique](#2-architecture-technique)
3. [Charte graphique mobile](#3-charte-graphique-mobile)
4. [Expérience utilisateur terrain](#4-expérience-utilisateur-terrain)
5. [Parcours chauffeur-collecteur](#5-parcours-chauffeur-collecteur)
6. [Pages et écrans](#6-pages-et-écrans)
7. [Composants partagés mobile](#7-composants-partagés-mobile)
8. [Services mobile](#8-services-mobile)
9. [GPS temps réel et Socket.IO](#9-gps-temps-réel-et-socketio)
10. [PWA et mode hors-ligne](#10-pwa-et-mode-hors-ligne)
11. [Authentification mobile](#11-authentification-mobile)
12. [Ce qui différencie le mobile du web](#12-ce-qui-différencie-le-mobile-du-web)
13. [Points d'extension](#13-points-dextension)

---

## 1. Identité et objectifs du mobile

### Cible

L'application mobile est destinée aux **chauffeurs-collecteurs** de Solidarité Textiles qui vident les Conteneurs d'Apport Volontaire (CAV) sur le terrain à Rouen et en Normandie. Elle est également utilisable par les responsables de tournée pour un suivi ponctuel.

Profil des utilisateurs :

- Personnes en **parcours d'insertion** (CDDI), parfois avec une faible littératie en français
- Usage **en extérieur**, par tout temps, parfois avec des **gants**
- Interruptions fréquentes : conduite, manutention, conditions de faible réseau
- Smartphone Android d'entrée / milieu de gamme fourni par l'entreprise

### Objectifs fonctionnels

| Besoin métier | Réponse mobile |
|---|---|
| Démarrer la journée de collecte | Choix véhicule + tournée du jour |
| Vérifier l'état du véhicule avant départ | Checklist 11 points obligatoires |
| Naviguer de CAV en CAV | Carte Leaflet + position GPS temps réel |
| Identifier un CAV | Scan QR code (caméra arrière) + fallback manuel |
| Déclarer le remplissage et les anomalies | Sélecteur visuel 5 niveaux + liste d'anomalies |
| Signaler un incident | Formulaire 5 types (panne, accident, CAV, environnement, autre) |
| Clôturer la tournée | Pesée brut/tare, poids net, résumé, CO₂ évité |
| Fonctionner hors ligne | IndexedDB + sync différée à la reconnexion |

### Périmètre

Le mobile couvre **uniquement** le parcours chauffeur-collecteur. Les autres modules de l'ERP (RH, finance, tri, facturation, boutiques, etc.) ne sont **pas** disponibles sur mobile et restent exclusifs au frontend web.

Le widget **SolidataBot** (agent conversationnel Claude) est également disponible sur mobile pour l'assistance terrain, mais uniquement pour les utilisateurs authentifiés.

### Domaine et infrastructure

- **URL de production** : https://m.solidata.online
- **Conteneur Docker** : `solidata-mobile` (Nginx Alpine servant le build Vite)
- **Reverse proxy** : Nginx SSL → port 80 interne
- **Répertoire source** : `mobile/` à la racine du dépôt

---

## 2. Architecture technique

### Stack

| Couche | Technologie | Version |
|---|---|---|
| Build | Vite | 6.0.7 |
| UI | React | 18.3.1 |
| Routage | React Router DOM | 7.1.1 |
| Styling | Tailwind CSS | 3.4.17 |
| HTTP | Axios | 1.7.9 (intercepteurs refresh token) |
| Temps réel | Socket.IO client | 4.8.1 |
| Cartographie | Leaflet / react-leaflet | 1.9.4 / 4.2.1 |
| Scanner QR | html5-qrcode | 2.3.8 |
| PWA | vite-plugin-pwa | 0.21.1 |
| Runtime build | Node.js | 20 Alpine |
| Runtime prod | Nginx | Alpine |

### Structure du code

```
mobile/
├── Dockerfile              # Build multi-étapes Node → Nginx
├── nginx.conf              # Config Nginx (cache assets 1 an, fallback SPA)
├── vite.config.js          # Vite + PWA manifest + proxy /api et /socket.io
├── tailwind.config.js      # Extensions couleurs / radius / touch
├── postcss.config.js       # PostCSS + Autoprefixer
├── index.html              # Viewport mobile, theme-color, lang="fr"
├── public/
│   ├── icon-192.png        # Icônes PWA
│   └── icon-512.png
└── src/
    ├── main.jsx            # Point d'entrée React
    ├── App.jsx             # Routeur + BatteryAlert + SolidataBot
    ├── index.css           # Variables CSS + classes mobile
    ├── contexts/
    │   └── AuthContext.jsx
    ├── services/
    │   ├── api.js          # Axios + refresh token
    │   ├── haptic.js       # Vibrations
    │   ├── db.js           # IndexedDB wrapper
    │   └── sync.js         # Synchro offline → online
    ├── components/
    │   ├── MobileShell.jsx # Wrapper page + TourStepBar
    │   ├── BatteryAlert.jsx
    │   └── SolidataBot.jsx
    └── pages/              # 11 pages du parcours chauffeur
```

### Configuration Vite

- **Port dev** : 3002
- **Proxy dev** : `/api` → `http://localhost:3001`, `/socket.io` → `ws://localhost:3001`
- **Mémoire build** : `NODE_OPTIONS="--max-old-space-size=512"` pour éviter l'OOM sur Scaleway DEV1-S
- **Stratégie SW** : `registerType: 'autoUpdate'` (mise à jour silencieuse du service worker au redémarrage de l'app)

### Meta HTML mobile

Définis dans `mobile/index.html` :

- `viewport` : `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`
- `theme-color` : `#8BC540` (vert Solidata, couleur de la barre Android)
- `lang="fr"`
- Pas de zoom utilisateur (décision assumée : champs en 60px min, zoom inutile)

---

## 3. Charte graphique mobile

La charte mobile partage la **palette primaire** du frontend web (bleu pétrole `#0D9488`) mais applique des règles propres à l'usage terrain : zones tactiles élargies, libellés courts, contraste renforcé, safe-area. Le fichier de référence est `mobile/src/index.css`.

### Palette

| Rôle | Couleur | Hex |
|---|---|---|
| Primaire | Bleu pétrole | `#0D9488` |
| Primaire foncé | Teal foncé | `#0F766E` |
| Primaire clair | Teal clair | `#14B8A6` |
| Surface | Blanc | `#FFFFFF` |
| Surface secondaire | Blanc cassé | `#FAFAF9` |
| Texte | Slate très foncé | `#0F172A` |
| Texte atténué | Slate moyen | `#64748B` |
| Bordure | Slate clair | `#E2E8F0` |
| Succès | Teal (= primaire) | `#0D9488` |
| Avertissement | Amber | `#F59E0B` |
| Erreur | Rouge | `#DC2626` |

Une **nuance spécifique mobile** : la couleur `theme-color` de la PWA (`#8BC540`, vert Solidata historique) est utilisée par le système Android pour la barre de statut et l'icône PWA, différente de la couleur primaire de l'interface (teal). C'est un choix assumé de cohérence marque globale.

### Variables CSS exposées

Définies dans `:root` de `mobile/src/index.css` :

```css
--color-primary / --color-primary-dark / --color-primary-light
--color-surface / --color-surface-2
--color-text / --color-text-muted / --color-border
--color-success / --color-warning / --color-error

--space-touch: 60px   /* hauteur min des zones tactiles */
--radius-sm: 12px
--radius-md: 16px
--radius-lg: 20px
--radius-xl: 24px

--shadow-card / --shadow-card-hover / --shadow-button

--safe-top / --safe-bottom / --safe-left / --safe-right
```

### Typographie

- **Police** : Plus Jakarta Sans (400, 500, 600, 700), chargée depuis Google Fonts, fallback `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto`.
- **Taille de base** : 16px (jamais en dessous de 12px pour la lisibilité extérieure).
- **Hiérarchie** : titres 18–32px `font-bold`, labels 12–14px `font-medium`, corps 14–16px.

### Composants CSS propres au mobile

Définis dans la couche `@layer components` :

| Classe | Rôle |
|---|---|
| `.card-mobile` | Carte blanche, `radius-lg`, ombre douce, ombre renforcée à `:active` |
| `.btn-primary-mobile` | Bouton pleine largeur teal, 60px min, `active:scale-[0.98]`, désactivation à 50% d'opacité |
| `.btn-secondary-mobile` | Bouton outline, bordure 2px teal, fond transparent |
| `.input-mobile` | Champ 60px min, bordure 2px slate, focus teal + anneau |
| `.screen-header` | Header dégradé 135° primaire → primaire foncé, texte blanc |
| `.touch-target` | Hauteur ET largeur min 60px (utilitaire pour icônes cliquables) |

### Zones tactiles et accessibilité

- **Cible minimale** : 60×60 px (au-delà du minimum Android 48dp et du WCAG 44px). Ce choix répond à l'usage avec gants et à la population utilisatrice en insertion.
- **Checkboxes** : cercles de 32px de rayon (zone de tap élargie au conteneur).
- **Boutons radio Remplissage** : cases de 72px min.
- **Inputs** : padding 16px horizontal, 12px vertical, font-size 16px (empêche le zoom iOS sur focus).

### Comportements tactiles

```css
html {
  -webkit-tap-highlight-color: transparent;  /* supprime le flash bleu iOS/Android */
  -webkit-touch-callout: none;               /* supprime le menu contextuel long-press */
}

body {
  overscroll-behavior: none;                 /* désactive le bounce pull-to-refresh */
  min-height: 100dvh;                        /* dynamic viewport (barre d'adresse) */
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
}
```

### Safe-area (notch, dynamic island, barre de navigation)

Le padding du `body` consomme les variables `env(safe-area-inset-*)` pour que le contenu ne passe jamais sous l'encoche iPhone ou la barre de navigation gestuelle Android. Les éléments ancrés en bas de l'écran (bottom-sheets, boutons d'action) reprennent `var(--safe-bottom)` en plus.

### Extensions Tailwind propres au mobile

Dans `mobile/tailwind.config.js` :

- Font family : `['Plus Jakarta Sans', ...]`
- `rounded-button` : 12px, `rounded-card` : 16px
- `min-h-touch` : 60px (utilitaire)
- Couleurs mappées `primary`, `primary-dark`, `primary-light`, `solidata-green`, `solidata-yellow`

---

## 4. Expérience utilisateur terrain

### Principes directeurs

1. **Un écran = une action.** Pas de modale, pas d'onglets, pas de multi-sélection. Chaque étape est une page dédiée, le retour en arrière est explicite.
2. **Texte court, fortement contrasté.** « Remplir », « Scan », « Check », « Suivant », « Retour ». Pas de jargon métier long.
3. **Icônes + texte systématiques.** Jamais d'icône seule pour une action critique.
4. **Feedback immédiat.** Chaque tap déclenche une réponse visuelle (`active:scale-[0.98]`) et, sur Android, une vibration (haptic).
5. **Progression visible.** La `TourStepBar` rappelle en permanence à quelle étape du parcours on se trouve et quelle est l'étape suivante.
6. **Tolérance aux erreurs.** Chaque action critique (collecte, pesée, incident) peut être réessayée ; un fallback manuel existe si le QR ne fonctionne pas.

### Patterns UI spécifiques au terrain

| Pattern | Implémentation |
|---|---|
| **Header dégradé** | `.screen-header`, gradient 135° primaire → primaire foncé, bouton retour + titre + sous-titre |
| **TourStepBar** | Barre de progression 8 étapes (Véhicule → Check → Carte → Scan → Remplir → Retour → Pesée → Résumé) avec indication « Suivant : … » |
| **Bottom-sheet collant** | Panneau d'action ancré en bas avec `safe-bottom` (ex : prochain CAV sur la carte) |
| **Boutons pleine largeur** | Toutes les CTA principales prennent 100% de la largeur |
| **Feedback chargement** | Texte sur le bouton (« Chargement… », « Enregistrement… ») + `animate-spin`, jamais de skeleton |
| **Pas de pull-to-refresh** | Désactivé au niveau CSS (`overscroll-behavior: none`) — conflit avec la carte Leaflet et avec la manipulation à une main |
| **Pas de modale** | Toutes les étapes sont des pages full-screen pour éviter le double-tap et la perte de contexte |

### Retours haptiques (vibrations)

Service `mobile/src/services/haptic.js`. Détection de `navigator.vibrate` avec dégradation silencieuse sur iOS Safari et desktop.

| Fonction | Motif (ms) | Cas d'usage |
|---|---|---|
| `vibrateSuccess()` | `[100]` | QR scanné, pesée enregistrée, collecte validée |
| `vibrateError()` | `[100, 50, 200]` | Validation de formulaire échouée, incident non envoyé |
| `vibrateTap()` | `[30]` | Toggle checkbox, sélection niveau remplissage, choix type d'incident |

### Alertes système

- **BatteryAlert** (`mobile/src/components/BatteryAlert.jsx`) : utilise la Battery Status API. Bandeau amber à ≤20%, rouge à ≤10%. Absent sur iOS (API non exposée) — dégradation silencieuse.
- **Erreurs réseau** : encarts rouges `bg-red-50 border-red-200 text-red-700` dans la page, avec bouton « Réessayer ».

### Lisibilité extérieure

- Contraste ≥ AA WCAG (4.5:1) sur tous les textes principaux.
- Jamais de texte sur photo ou dégradé à faible contraste.
- Pas de texte en dessous de 12px.
- Icônes des actions principales dimensionnées à 24px min.

---

## 5. Parcours chauffeur-collecteur

Le parcours linéaire typique d'une journée :

```
┌─────────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐
│   /start    │ → │ /vehicle │ → │ /checklist│ → │/tour-map │
│  (Login)    │   │  -select │   │           │   │          │
└─────────────┘   └──────────┘   └───────────┘   └────┬─────┘
                                                      │
                              ┌───────────────────────┤
                              │                       │ pour chaque CAV
                              │                       ▼
                              │                ┌──────────────┐
                              │                │ /qr-scanner  │
                              │                └──────┬───────┘
                              │                       │ (ou fallback)
                              │                       ▼
                              │                ┌──────────────┐
                              │                │/qr-unavailab │
                              │                └──────┬───────┘
                              │                       │
                              │                       ▼
                              │                ┌──────────────┐
                              │                │ /fill-level  │
                              │                └──────┬───────┘
                              │                       │
                              │         (si incident) │
                              │                       ▼
                              │                ┌──────────────┐
                              │                │  /incident   │
                              │                └──────┬───────┘
                              │                       │
                              └───────── retour carte ┘
                                                      │
                                             (fin de collecte)
                                                      ▼
                                               ┌──────────────┐
                                               │/return-centre│
                                               └──────┬───────┘
                                                      ▼
                                               ┌──────────────┐
                                               │  /weigh-in   │
                                               └──────┬───────┘
                                                      ▼
                                               ┌──────────────┐
                                               │/tour-summary │
                                               └──────────────┘
```

### Règles de parcours

- **Reprise automatique** : si une tournée est `in_progress`, l'app reprend automatiquement à l'étape en cours (via `current_tour_id` en localStorage).
- **Pesée intermédiaire** : un flag `intermediate_return` en localStorage permet de revenir au centre vider le véhicule puis reprendre la tournée sans la clôturer.
- **Pas de sortie forcée** : même hors ligne, le chauffeur peut parcourir toutes les étapes. Les données sont mises en file dans IndexedDB et synchronisées au retour réseau.

---

## 6. Pages et écrans

Toutes les pages se trouvent dans `mobile/src/pages/`. Chacune est un composant fonctionnel React autonome qui consomme les services `api.js`, `haptic.js`, `db.js` / `sync.js` au besoin.

### Login.jsx — `/start`

Écran d'entrée **sans authentification classique** : le chauffeur choisit un véhicule disponible dans la liste fournie par `GET /api/vehicles/available` (endpoint public). La sélection stocke `selected_vehicle_id` et `selected_vehicle_reg` en localStorage, puis l'app appelle `GET /api/tours/vehicle/{id}/today` pour déterminer la tournée du jour. Ce fonctionnement « pick vehicle → go » a été introduit en mars 2026 pour simplifier l'usage terrain.

### VehicleSelect.jsx — `/vehicle-select`

Variante **authentifiée** (consomme `useAuth()` du `AuthContext`). Affiche les tournées de l'utilisateur (`GET /api/tours/my`), pré-sélectionne le véhicule assigné, propose les véhicules libres, reprend automatiquement toute tournée `in_progress`. Intègre `TourStepBar` étape 1.

### Checklist.jsx — `/checklist`

11 points de contrôle obligatoires avant départ :

> papiers véhicule — permis de conduire — équipements de sécurité — feux — pneus — niveaux — propreté — matériel de transport — …

Chaque item est une large checkbox tactile qui déclenche `vibrateTap()`. Le bouton « Commencer la tournée » reste désactivé tant que les 11 items ne sont pas cochés. Enregistre `km_start` et les notes, puis `POST /api/tours/{id}/checklist-public` + `POST /api/tours/{id}/start-public`.

### TourMap.jsx — `/tour-map`

Cœur de l'expérience :

- Carte **Leaflet** + tuiles **OpenStreetMap**, zoom 13, sans contrôles de zoom (gestes natifs).
- Marqueur bleu 16×16px pour la position du chauffeur.
- Marqueurs CAV 28×28px : **rouge** = prochain à collecter, **vert** = déjà collecté, **gris** = en attente.
- Tracé vert pointillé reliant les CAV de la tournée.
- Bottom-sheet collant avec le prochain CAV, bouton « Naviguer » (ouvre Google Maps en externe), bouton « Scanner », bouton « Incident ».
- GPS : `navigator.geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 })`.
- Émission GPS via Socket.IO toutes les **10 secondes** sur l'événement `gps-update`.

### QRScanner.jsx — `/qr-scanner`

Scanner html5-qrcode, caméra arrière (`facingMode: 'environment'`), 10 FPS, zone de détection 250×250px. Fond `bg-gray-900` pour le contraste de la caméra, overlay SVG teal autour du viseur. `vibrateSuccess()` sur décodage réussi. Bouton « QR absent » vers `/qr-unavailable`.

### QRUnavailable.jsx — `/qr-unavailable`

Fallback si le QR est absent, illisible, endommagé, ou si la caméra ne démarre pas. L'utilisateur choisit un motif, sélectionne le CAV dans la liste des CAV restants de la tournée ou saisit un code manuel. Stocke `scanned_qr`, `selected_cav_id`, `qr_unavailable_reason` en localStorage.

### FillLevel.jsx — `/fill-level`

Sélecteur visuel 5 niveaux : **0% / 25% / 50% / 75% / 100%**, cases de 72px min. Liste d'anomalies (débordement, vandalisme, accès bloqué, conteneur endommagé, déchets non conformes, clé cassée, …). Zone de notes libre. `POST /api/tours/{id}/cav/{cavId}/collect-public`. Détecte automatiquement si la tournée est en mode association (collecte partenaire) ou CAV standard.

### Incident.jsx — `/incident`

Grille 2×3 de 5 types d'incidents avec icônes :

1. Panne véhicule
2. Accident
3. Problème CAV
4. Environnement
5. Autre

Zone de description obligatoire, `POST /api/tours/{id}/incident-public`. `vibrateSuccess()` ou `vibrateError()` selon la réponse.

### ReturnCentre.jsx — `/return-centre`

Fin de collecte. Saisie `km_end` et notes de tournée, passage du statut à `returning` via `POST /api/tours/{id}/status-public`. `TourStepBar` étape 6.

### WeighIn.jsx — `/weigh-in`

Pesée finale ou intermédiaire :

- **Poids brut** (kg) + **tare** (kg) → **poids net** calculé en temps réel et affiché en tonnes.
- `POST /api/tours/{id}/weigh-public`.
- Mode intermédiaire (flag `intermediate_return`) : permet un déchargement partiel en cours de tournée puis retour sur `/tour-map`.
- Mode final : passage à `/tour-summary`.

### TourSummary.jsx — `/tour-summary`

Bilan :

- Nombre de CAV collectés
- Poids total en kg / tonnes
- Distance parcourue (si GPS disponible)
- Durée de la tournée
- **CO₂ évité** : `poids_net × 1.493` kg CO₂
- Liste complète des CAV avec statut de collecte
- Récapitulatif des incidents

Bouton « Terminer la journée » vide le localStorage (hors tokens) et retourne à `/vehicle-select`.

---

## 7. Composants partagés mobile

Dans `mobile/src/components/`.

### MobileShell.jsx

Wrapper de page standard. Expose :

- Un **header dégradé** (classe `.screen-header`) avec bouton retour, titre, sous-titre, action optionnelle à droite.
- Un **contenu scrollable** avec padding safe-area gauche/droite.
- Sous-composant `TourStepBar` : barre de progression à 8 étapes qui s'affiche en haut des pages du parcours. Elle surligne l'étape courante et affiche le libellé « Suivant : … » pour orienter le chauffeur.

Les étapes visuelles : **Véhicule → Check → Carte → Scan → Remplir → Retour → Pesée → Résumé**.

### BatteryAlert.jsx

Bandeau global monté au niveau de `App.jsx`. Lit la `Battery Status API` (`navigator.getBattery()`), s'abonne aux événements `levelchange` et `chargingchange`. Affiche :

- Rien si batterie > 20% ou en charge
- Bandeau amber si ≤ 20%
- Bandeau rouge si ≤ 10%

Silencieux sur iOS (API non exposée) et desktop.

### SolidataBot.jsx

Widget chat flottant également monté au niveau de `App.jsx`, **visible uniquement si `mobile_token` existe**. Plein écran en mobile (pas de bulle overlay).

Fonctionnalités :

- **Speech-to-Text** via Web Speech API (langue `fr-FR`)
- **Text-to-Speech** via `speechSynthesis` pour lire les réponses
- Historique de la session
- Carrousel de suggestions
- Indicateur de frappe
- POST vers `/chat` (agent SolidataBot backend Flask + Claude API)
- Fallback local de suggestions si l'API est inaccessible
- Thème vert `#2D8C4E` (distinct du teal de l'app, aligné sur la marque historique)

---

## 8. Services mobile

Dans `mobile/src/services/`.

### api.js — client Axios

```
baseURL: '/api'
timeout: 15000 ms
withCredentials: true
```

**Intercepteur de requête** : injecte `Authorization: Bearer {mobile_token}` si présent en localStorage.

**Intercepteur de réponse** : en cas de 401 avec `code: 'TOKEN_EXPIRED'`, tente un refresh via `POST /api/auth/refresh` (avec `mobile_refresh_token` ou cookie `refreshToken`), stocke le nouveau token, rejoue la requête initiale. Si le refresh échoue, vide les tokens.

### haptic.js — retour haptique

Trois fonctions `vibrateSuccess`, `vibrateError`, `vibrateTap` (motifs détaillés § 4). Test de support via `'vibrate' in navigator`. Aucune erreur remontée sur plateformes non supportées.

### db.js — IndexedDB

Wrapper `IDBDatabase` orienté promesses.

- **Base** : `solidata-mobile`, **version** : `1`
- **Stores** :
  - `tours` (cache tournée active)
  - `cavs` (référentiel CAV)
  - `pendingScans` (scans QR en attente d'envoi)
  - `pendingWeights` (pesées en attente)
  - `gpsBuffer` (positions GPS hors ligne, batch 50)
  - `userData` (profil utilisateur)
- **Helpers** : `openDB`, `putItem`, `getItem`, `getAllItems`, `deleteItem`, `clearStore`, `countItems`, `addPendingScan`, `addPendingWeight`, `addGpsPosition`
- IDs auto-incrémentés pour les stores `pending*`

### sync.js — moteur de synchronisation

Démarrée au montage de l'app (`startAutoSync()` dans `App.jsx`). Stratégie :

1. **Écoute événements online/offline** : sync immédiate à la reconnexion
2. **Sync périodique** : toutes les **5 minutes** si online
3. **Cache référentiel** : CAV + profil user rechargés dans IndexedDB toutes les **30 minutes**

Fonctions exposées : `syncPendingScans()`, `syncPendingWeights()`, `syncGpsBuffer()` (par lots de 50), `syncAll()`. Chaque fonction retourne `{ synced, reason, results }`. Les erreurs **réseau** sont conservées pour retry, les erreurs **client** (4xx) suppriment l'élément de la file pour éviter une boucle.

---

## 9. GPS temps réel et Socket.IO

### Connexion

Dans `TourMap.jsx` :

```js
io(window.location.origin, {
  transports: ['websocket', 'polling'],
  auth: { token: localStorage.getItem('mobile_token') }
})
```

Le client essaie WebSocket puis retombe sur long-polling si le WS est bloqué (proxy, filtre, réseau cellulaire). Le token est injecté à la connexion pour que le backend puisse identifier le chauffeur.

### Événements

| Sens | Événement | Payload | Fréquence |
|---|---|---|---|
| Client → Serveur | `join-tour` | `tourId` | à l'ouverture de la carte |
| Client → Serveur | `gps-update` | `{ tourId, vehicleId, lat, lng, speed }` | toutes les **10 s** |
| Serveur → Client | `connect` | — | à la connexion |
| Serveur → Client | `connect_error` | erreur | en cas d'échec (non bloquant) |

### Géolocalisation

- API : `navigator.geolocation.watchPosition(cb, errCb, options)`
- Options : `enableHighAccuracy: true`, `maximumAge: 5000`, `timeout: 10000`
- La dernière position est stockée dans une ref React `positionRef` et émise périodiquement via `setInterval`. L'émission est découplée du `watchPosition` pour lisser la bande passante.
- Dégradation gracieuse : si le GPS n'est pas autorisé ou échoue, la carte s'affiche quand même et l'app continue.

### Côté backend (rappel)

Les événements `gps-update` sont traités par `backend/src/index.js` (Socket.IO server) et redistribués aux clients web abonnés (pages `LiveVehicles`, `TourMap` côté admin). Les positions sont également persistées dans la table `gps_positions`.

---

## 10. PWA et mode hors-ligne

### Manifest

Déclaré dans `vite.config.js` via `VitePWA` :

```js
{
  name: 'SOLIDATA Mobile',
  short_name: 'SOLIDATA',
  description: 'Application terrain - Collecte textile',
  theme_color: '#8BC540',
  background_color: '#ffffff',
  display: 'standalone',
  orientation: 'portrait',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
  ]
}
```

- `display: 'standalone'` : une fois installée, l'app s'ouvre sans barre d'adresse du navigateur.
- `orientation: 'portrait'` : verrouillée en portrait (compatible avec l'usage à une main en cabine).

### Service worker

- `registerType: 'autoUpdate'` : le SW se met à jour silencieusement au redémarrage.
- Stratégie cache-first pour les assets statiques (JS, CSS, icônes, polices).
- Shell applicatif disponible hors ligne après la première visite.

### Stockage local

| Support | Contenu |
|---|---|
| **localStorage** | Tokens (`mobile_token`, `mobile_refresh_token`), contexte de session (`selected_vehicle_id`, `selected_vehicle_reg`, `current_tour_id`, `selected_cav_id`, `scanned_qr`, `qr_unavailable_reason`, `intermediate_return`) |
| **IndexedDB** (`solidata-mobile`) | Données volumineuses : cache CAV, cache tournée, files `pendingScans`, `pendingWeights`, `gpsBuffer`, `userData` |

### Stratégie offline

1. Au login, les **CAV et le profil** sont mis en cache IndexedDB (`cacheReferenceData`).
2. Toute action critique (collecte, pesée, GPS) est d'abord écrite dans la file IndexedDB correspondante.
3. À chaque retour réseau (événement `online`) ou toutes les 5 minutes, `syncAll()` purge les files.
4. Les positions GPS sont envoyées par **lots de 50** pour limiter le nombre de requêtes.

---

## 11. Authentification mobile

### Flux simplifié (sans mot de passe)

Le parcours par défaut commence sur `/start` : le chauffeur choisit son véhicule et son nom dans une liste. Ce flux passe par des endpoints dits **« public »** (suffixe `-public` côté backend) qui vérifient un contexte de tournée plutôt qu'un JWT utilisateur. C'est la voie privilégiée pour le terrain : pas de saisie clavier, pas de mot de passe à retenir.

### Flux authentifié (manager / admin)

Un manager peut se connecter classiquement via `AuthContext.login(username, password)` → `POST /api/auth/login`. Les tokens sont stockés dans :

- `mobile_token` : JWT access (durée courte, typiquement 15 min à 8 h)
- `mobile_refresh_token` : refresh token (7 j)

Ce sont des **clés distinctes** de celles utilisées par le frontend web (`token`, `refreshToken`). Cette séparation permet de garder des sessions indépendantes sur un même appareil et évite les conflits d'interception Axios.

### `driverStart` — démarrage rapide chauffeur

`AuthContext.driverStart(vehicleId)` → `POST /api/auth/driver-start`. Retourne en une seule requête `{ token, refreshToken, user }`. Utilisé par certains déploiements comme variante authentifiée du flux `/start`.

### Rafraîchissement automatique

Piloté par l'intercepteur d'`api.js` (§ 8). Aucune page n'a à gérer le refresh : elle reçoit toujours la requête en succès ou en erreur finale.

### Cycle de vie

1. Au mount de `AuthProvider`, si `mobile_token` existe : `GET /api/auth/me` pour valider.
2. Si invalide : tokens vidés, redirection via les ProtectedRoute (ici il n'y en a pas formellement, les pages gèrent leurs propres redirections vers `/start`).
3. `logout()` : supprime `mobile_token`, `mobile_refresh_token` et vide `user`.

---

## 12. Ce qui différencie le mobile du web

Pour isoler le mobile du frontend web (`frontend/`), voici les points à garder à l'esprit lors de toute modification.

### Code source et dépendances

- **Dossier distinct** : `mobile/` est totalement séparé de `frontend/`. Pas d'import croisé, pas de monorepo.
- **Package.json propre** : les versions de React, Vite, Tailwind, Axios peuvent diverger du web si besoin, mais elles sont actuellement alignées.
- **Build indépendant** : `docker compose build solidata-mobile` ne touche pas au web.
- **Conteneur propre** : `solidata-mobile` sert `m.solidata.online`, `solidata-web` sert `solidata.online`.

### Charte graphique

| Élément | Mobile | Web |
|---|---|---|
| Touch target min | **60px** | 44px |
| Police | Plus Jakarta Sans | Plus Jakarta Sans |
| Primaire | `#0D9488` | `#0D9488` |
| Safe-area | **Gérée au `body`** et éléments fixes | Non pertinente |
| `overscroll-behavior` | **`none`** (désactivé) | Par défaut |
| Tap highlight | **Masqué** | Par défaut |
| Zoom utilisateur | **Désactivé** (viewport) | Autorisé |
| Theme-color | `#8BC540` (vert marque) | N/A |
| Header écran | Dégradé plein largeur | Sidebar latérale |
| Navigation | **Linéaire, full-screen** | Sidebar + onglets |

### Stockage et session

- Le mobile utilise **ses propres clés** localStorage (`mobile_token`, `mobile_refresh_token`) pour ne pas interférer avec une éventuelle session web sur le même domaine.
- Le mobile s'appuie en plus sur **IndexedDB** (`solidata-mobile`), absent du web.
- Le mobile a un contexte de session riche (véhicule, tournée, CAV) que le web n'a pas.

### Périmètre fonctionnel

- Le mobile **ne couvre qu'un parcours** : chauffeur-collecteur + SolidataBot + alerte batterie.
- Les 26 modules de l'ERP (RH, finance, tri, boutique, recrutement, PCM, Refashion, …) **ne sont pas portés** sur mobile.
- Les endpoints backend consommés sont principalement : `auth`, `vehicles`, `tours`, `cav`, `incidents`, `chat` — un sous-ensemble du backend.

### Endpoints « public » dédiés

Plusieurs routes du mobile utilisent des endpoints marqués `-public` côté backend (`/api/tours/{id}/checklist-public`, `/api/tours/{id}/start-public`, `/api/tours/{id}/cav/{cavId}/collect-public`, `/api/tours/{id}/weigh-public`, `/api/tours/{id}/status-public`, `/api/tours/{id}/incident-public`). Ces routes relâchent la contrainte JWT pour permettre le parcours chauffeur sans login, en échange d'un contrôle contextuel (tour actif, véhicule connu). Toute évolution du schéma d'auth doit **vérifier les deux contrats**.

### Temps réel

- **Socket.IO est utilisé côté mobile** uniquement pour émettre `gps-update` et `join-tour`. Aucune écoute d'événement entrant.
- Le web écoute en retour ces positions sur les pages `LiveVehicles` et `TourMap` admin.

---

## 13. Points d'extension

### Ajouter une page au parcours chauffeur

1. Créer `mobile/src/pages/MaNouvellePage.jsx` en suivant le pattern des pages existantes (MobileShell + TourStepBar).
2. Déclarer la route dans `mobile/src/App.jsx` (`<Route path="/ma-page" element={<MaNouvellePage />} />`).
3. Ajouter l'étape à `TourStepBar` dans `mobile/src/components/MobileShell.jsx` si elle fait partie du parcours linéaire.
4. Utiliser `api` depuis `services/api.js` pour les appels, `vibrateTap/Success/Error` depuis `services/haptic.js` pour le feedback.

### Ajouter un champ en file offline

1. Créer un store IndexedDB dans `mobile/src/services/db.js` (`pendingXxx`) avec auto-increment.
2. Ajouter `addPendingXxx()` et l'appel correspondant dans `services/sync.js` (`syncPendingXxx()`).
3. L'appeler depuis `syncAll()` pour qu'il soit traité à la reconnexion.

### Ajouter une vibration

Étendre `mobile/src/services/haptic.js` avec un nouveau motif (`vibrateLongPress()`, `vibrateWarning()`, …) et appeler la fonction dans la page concernée.

### Modifier la charte mobile

Les seuls fichiers à toucher :

- `mobile/src/index.css` : variables CSS + classes `.card-mobile`, `.btn-primary-mobile`, `.btn-secondary-mobile`, `.input-mobile`, `.screen-header`, `.touch-target`
- `mobile/tailwind.config.js` : palette, radius, min-h-touch, fonts

**Ne jamais** dupliquer ou importer `frontend/src/index.css` depuis le mobile : les deux charts doivent pouvoir diverger indépendamment.

### Ajouter une permission PWA

Mettre à jour le manifest dans `mobile/vite.config.js` (plugin `VitePWA`) et déposer les nouvelles icônes dans `mobile/public/`. Rebuild le conteneur pour que le service worker prenne en compte les changements.

---

## Références fichiers

| Sujet | Fichier |
|---|---|
| Point d'entrée | `mobile/src/main.jsx`, `mobile/src/App.jsx` |
| Routage | `mobile/src/App.jsx` |
| Auth | `mobile/src/contexts/AuthContext.jsx` |
| API client | `mobile/src/services/api.js` |
| Offline DB | `mobile/src/services/db.js` |
| Sync | `mobile/src/services/sync.js` |
| Haptic | `mobile/src/services/haptic.js` |
| Shell / step bar | `mobile/src/components/MobileShell.jsx` |
| Batterie | `mobile/src/components/BatteryAlert.jsx` |
| Chatbot | `mobile/src/components/SolidataBot.jsx` |
| Charte CSS | `mobile/src/index.css` |
| Tailwind | `mobile/tailwind.config.js` |
| Build / PWA | `mobile/vite.config.js` |
| HTML / meta | `mobile/index.html` |
| Docker | `mobile/Dockerfile`, `mobile/nginx.conf` |
| Pages parcours | `mobile/src/pages/` (Login, VehicleSelect, Checklist, TourMap, QRScanner, QRUnavailable, FillLevel, Incident, ReturnCentre, WeighIn, TourSummary) |

---

*Documentation maintenue en parallèle de `CHARTE_GRAPHIQUE.md` (palette commune) et `LOGIQUE_TOURNEES.md` (logique métier tournée, partagée backend / web / mobile).*








