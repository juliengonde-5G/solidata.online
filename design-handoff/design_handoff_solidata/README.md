# Handoff — Solidata refonte UX (desktop web + mobile chauffeur)

## Overview

This package bundles the design work done on **Solidata** — the ERP "Solidarité Textile" used to track textile collection: CAV (containers), tournées (collection rounds), production, finances, recruitment and admin.

Two distinct surfaces were designed:

1. **Desktop web app** (manager / office) — refactored IA with a 2-level collapsible sidebar, AI assistant panel, and 8 main screens: Dashboard, Collecte (with live map), Recrutement (Kanban), PCM test, Production, Finances, Reporting, Administration.
2. **Mobile app chauffeur** (field / in-cabin, during tournée) — a full clickable 8-step parcours: Connexion → Tournée → Check-list → Navigation GPS → Scan CAV → Remplissage → Pesée → (Incident side-flow).

The prototype also contains low-fi wireframes (7 screens × 3–5 variations) and a side-by-side comparison canvas of mobile variants, kept as design-history reference.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing the intended look, content and behaviour. They are **not** production code to copy verbatim.

The task is to recreate these designs **inside the existing Solidata codebase** — using its existing React stack, component library and design tokens (a Tailwind-style teal-based palette is already in use per the source's design guide). The HTML is a specification, not a starting point for the build.

Target stack recommendation:
- **Desktop**: React 18 + React Router + existing Solidata component library. Replace inline JSX/CSS with the existing design system.
- **Mobile**: Either a PWA (simpler, reuses the same React codebase) or React Native (better camera / QR / offline story). The prototype uses device-frame simulation only; real device features (camera, geolocation, offline sync) must be implemented natively.

## Fidelity

**Mid-to-high fidelity.** Colors, typography, spacing, copy and interactions are final intent. Components such as the sidebar, cards, buttons, bottom sheets and the 5-level CAV filling picker should be reproduced pixel-close. Map backgrounds are placeholder SVGs — real implementation uses Mapbox/Leaflet.

## Design system & tokens

The prototype reuses the existing Solidata tokens (see `mifi/app.css` for the full set). Key values:

**Palette**
- `--teal-50` `#F0FDFA` · `--teal-100` `#CCFBF1` · `--teal-400` `#2DD4BF` · `--teal-500` `#14B8A6` · `--teal-600` `#0D9488` · `--teal-700` `#0F766E` · `--teal-800` `#115E59` (primary brand)
- `--slate-50..900` neutral scale (Tailwind defaults)
- `--amber-100 #FEF3C7` · `--amber-700 #B45309` (warnings / "centre de tri" mode)
- `--red-200 #FECACA` · `--red-600 #DC2626` · `--red-700 #B91C1C` (incidents, destructive)
- `--green-500 #22C55E` · `--green-100 #DCFCE7` (success)

**Typography** — `Plus Jakarta Sans` (400/500/600/700/800). Sizes:
- Mobile body: 15 px · mobile H1: 22–32 px · mobile big CTA: 18–22 px (min-height 56–64 px)
- Desktop sidebar item: 14 px / 600 · topbar: 14 px · page title: 22 px / 800

**Radii** — 10 / 12 / 14 / 16 / 18 / 22 px. Cards commonly 14–18 px. Big CTAs 16 px.

**Shadows** — 3 tiers used throughout: `0 2px 8px rgba(0,0,0,0.04)` (card rest), `0 4px 12px rgba(0,0,0,0.1)` (hover / float), `0 8px 24px rgba(0,0,0,0.12)` (sticky ETA / modals).

**Mobile touch targets** — every interactive element ≥ 56 px (up to 84 px for primary CTAs). This is a hard constraint for field use (gloves, truck vibration).

---

## Desktop — Screens

### Shell (`mifi/app.css`, `mifi/app.js`)
- Left sidebar, 2 levels (parent sections "Exploitation", "Pilotage", "Admin" → children). Collapsible to icon-only rail. Brand logo acts as link to dashboard.
- Top bar: breadcrumb + search + notifications + AI-assistant button (opens right-side chatbot panel with overlay, Esc to close, suggestion chips, input).
- Screen registry in `window.SOLIDATA_APP.screens`; navigation via hash-style routing.

### 8 screens (`mifi/screens/*.js`)
Each file is a self-contained `window.SOLIDATA_APP.screens['<id>'] = () => <html>`:
- `dashboard.js` — greeting, grouped priorities, KPIs, activity feed
- `collecte.js` — full-bleed map, compact list left panel, IA "demain" banner top
- `recrutement.js` — Kanban columns (candidates / screening / PCM test / interview / hire)
- `pcm.js` — 1-screen easy-read PCM test with pictograms, audio assist, simple French
- `production.js` — stock + tri (sorting) tables and KPIs
- `finances.js` — revenue/cost cards, invoice list
- `reporting.js` — filter bar + chart placeholders
- `admin.js` — users / vehicles / contracts tables

Refer to the HTML for exact copy and column layouts.

---

## Mobile — Parcours chauffeur (primary deliverable)

8-step linear flow with a couple of side-branches. Implemented in `parcours/app.jsx` + `parcours/screens.jsx`. Device frame: iOS 390 × 810.

### Step 1 — Connexion (`StepLogin`)
Teal gradient background. Single giant CTA ("Démarrer ma tournée", 84 px height). One driver identity already bound to the assigned truck (RN-47, Rouen depot). No form. Rationale: equipe fixe, gants, pas de saisie.

### Step 2 — Tournée du jour (`StepJournee`)
Top: back + tournée label + "6 points · 14 km · ~3h20". Full-width **map** (grid SVG placeholder + dashed polyline + numbered pins + truck + tri icon). **Bottom sheet** (22 px radius, 48% max height): today's 6 stops with number circles, titles, distances. Primary CTA "Commencer la tournée".

### Step 3 — Check-list de départ (`StepChecklist`) — *added after iteration*
Teal-700 header with progress bar `{done}/{total}`. 8 items (each a tappable row, 72 px min-height): carburant, hayon, pneus, feux, propreté, EPI, téléphone, badge. Emoji picto + label + subtitle + checkbox (36 × 36, teal when checked). Optional photo CTA below. Bottom primary CTA disabled until all 8 checked ("Coche les N derniers points" → "▶ Démarrer la navigation"). Hard gate.

### Step 4 — Navigation GPS live (`StepNavigation`)
Full-screen map (blue-ish grid + route polyline teal, dimmed alt route, orange/red traffic segments, destination pin, user blue dot with pulse ring).

Top (z-index 10): back button + dark instruction card ("Dans 300 m · Tourne à gauche · rue Jeanne d'Arc"). Under it: **reroute notification** (appears after 1.2 s, amber, "Itinéraire recalculé · Bouchon rue de la République · +4 min").

Bottom: red-outlined "Déclarer un incident" button, then ETA card ("4 min · 1,2 km · Arrivée 09:18 · Place Foch") with teal "Je suis là ✓" CTA.

**Mode `toTri`**: when coming from step 6 "Camion plein", same screen renders amber (destination "🏭 Centre de tri Rouen-Quevilly", 12 min / 7,4 km, CTA "Au centre ✓"). Controlled by a boolean prop.

### Step 5 — Scan QR CAV (`StepScan`)
Black "camera" background. Status bar padding 50 px. 250 × 250 viewport with animated corner brackets and a scanning line (CSS `scanLine` keyframes). Auto-detect after 2.2 s (simulated) → brackets turn teal + ✓ + "CAV-014 · Place Foch · Contrat Rouen-Nord · textile".

Bottom: white "Continuer →" CTA (disabled until detected), then two secondary buttons side-by-side:
- "⌨ Saisir le code" (fallback manual entry)
- "⚠ QR indisponible" (red-tinted, opens same flow as continue — let chauffeur bypass)

### Step 6 — Remplissage CAV (`StepRemplissage`)
Top: back + CAV ID + point index + "✓ scannée" chip.

**Niveau de remplissage** — 6 buttons (3×2 grid, 120 px tall):
- 0% "vide" · 25% "un peu" · 50% "à moitié" · 75% "presque plein" · 100% "plein" · ++ "Au-delà ⚠"
- Each button renders a **custom SVG container icon**: lid + rectangle outline + a colored fill rising from the bottom at the matching %. Fill colors scale green→yellow→orange→red. "Au-delà" is dark red with overflow lines drawn above the lid.
- Selected state: filled background + 3 px dark border + box shadow.

Under the grid: confirmation chip when a level is chosen.

Then two secondary buttons (56 px):
- "⚠ Déclarer un incident" (red outline) → step 8
- "🚚 Camion plein → centre de tri" (amber outline) → triggers `toTri=true` and jumps back to step 4 (GPS)

Bottom: primary CTA "✓ Valider · point suivant" → loops to step 5 (next CAV).

### Step 7 — Pesée centre de tri (`StepPesee`)
Amber header. **Large weight readout** — 72 px font, "{weight} kg", with 4 stepper buttons (−5, −1, +1, +5, each 56 × 56 px). Teal chip below: "🔗 Bascule connectée · auto-lecture".

Recap card (tournée, points collectés, heure).

Bottom: primary "✓ Valider et reprendre la tournée" → clears `toTri`, returns to step 4. Secondary "Fin de journée (retour dépôt)".

### Step 8 — Déclaration d'incident (`StepIncident`)
Reachable from step 4 and step 6. Red header.

Context card (auto-filled lieu + CAV + heure).

Three sections:
1. **Type** — 2×3 grid of 6 buttons (96 px tall), each with emoji + label + 1-line description: CAV dégradée, CAV inaccessible, Débordement, Problème véhicule, Sécurité, Autre. Selected → dark inverted.
2. **Gravité** — 3 rows (60 px), left color dot + label + desc: Peu grave (green), Gênant (amber), Urgent (red). Selected → filled with that color.
3. **Ajouter (optionnel)** — photo + vocal tile + freeform textarea.

Bottom: "Annuler" (ghost) + "🚨 Envoyer l'incident" (red). Disabled until type + gravité both picked.

Success screen: teal ✓ disc + "Incident envoyé" + #INC-XXXX + "Reprendre la tournée" CTA.

### Navigation logic (`parcours/app.jsx`)
- `step` state (1–8) persisted in `localStorage['parcours-step']`
- `toTri` boolean controls step-4 dual mode
- `rerouted` triggered after 1.2 s each time step 4 is entered
- Top step-nav pill with clickable chips + "Étape suivante →" floating button

---

## Interactions & state to port

- **localStorage persistence** for resumable position — useful during the shift.
- **Timers**: `setTimeout` for reroute notif (1200 ms) and scan detection (2200 ms). In production these are events from the map SDK and the scanner library.
- **State gates**: step 3 requires all 8 checks; step 5 CTA requires `scanned`; step 6 CTA requires a fill level; step 8 CTA requires type + severity.
- **Hardware integrations to wire up**:
  - QR scanner (`html5-qrcode`, `zxing-js`, or native)
  - Mapbox / Leaflet + Directions API with live traffic + reroute events
  - Connected weighing scale (existing hardware; likely TCP/serial via a small gateway)
  - Camera capture (photos on incident + truck start)
  - Voice note (MediaRecorder)
- **Offline support** — marked as "useful, not blocking" in discovery. A service worker + IndexedDB queue for incident / fill / weight events is recommended for V2.

---

## Files in this bundle

- `Solidata Mi-fi.html` + `mifi/` — desktop app shell + 8 screens
- `Solidata Parcours Chauffeur.html` + `parcours/` — the 8-step mobile parcours (primary deliverable)
- `Solidata Mobile.html` + `mobile/` — comparison canvas of mobile variants (design history)
- `Wireframes Solidata.html` + `wireframes/` — low-fi exploration (design history)
- `SOLIDATA_DESIGN_GUIDE.md` — original migration guide shared by the team

A developer reading this README alone should have enough to implement the mobile parcours in the existing Solidata stack.
