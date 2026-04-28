# SOLIDATA — Charte graphique, UX et design system

> Référence unique pour toute création d'écran ou de composant sur SOLIDATA
> (web manager, PWA mobile chauffeur, futurs écrans partenaires).
> Dernière mise à jour : avril 2026.

---

## 1. Principes

1. **Cohérence avant originalité** — toute nouvelle page réutilise les tokens,
   les composants et les patterns déjà posés. Pas de CSS inline ad-hoc, pas de
   nouvelle palette sans besoin explicite.
2. **Clarté opérationnelle** — les écrans servent des métiers (collecte, tri,
   insertion, compta, boutique). Un utilisateur doit comprendre l'état d'un
   process sans avoir à cliquer.
3. **Accessibilité concrète** — zones tactiles ≥ 60 px sur mobile, contrastes
   WCAG AA minimum, libellés en français clair, pas de signal uniquement à la
   couleur (toujours doublé par une icône ou un texte).
4. **Français partout dans l'UI** — les noms techniques en anglais restent
   possibles côté code, jamais côté libellés.
5. **Pas d'emoji par défaut** — sauf contexte explicite (SolidataBot,
   récapitulatif mobile chauffeur, bandeau IA).
6. **Responsive d'abord desktop manager** — la PWA mobile est un projet
   distinct avec ses propres contraintes (chauffeur, conduite, gants).

---

## 2. Identité visuelle

| Élément | Valeur | Usage |
|---------|--------|-------|
| Logo | `/logo.png` carré, fond transparent | IconSidebar, login, splash mobile |
| Logo texte | `/logo-text.png` | En-tête login, présentations |
| Nom produit | **SOLIDATA** (capitales) | Titres marketing, emails système |
| Baseline métier | ERP Solidarité Textiles | Footer, README |
| Police | **Plus Jakarta Sans** (Google Fonts, 400 / 500 / 600 / 700) | Toutes les surfaces |
| Fallbacks | `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `sans-serif` | Si la Google Font ne charge pas |
| Favicon | `/favicon.ico` + PNG 16 / 32 | Onglets navigateur |

> La couleur « Solidata » historique (vert `#2D8C4E`) a été remplacée en prod
> par un bleu pétrole / teal. Les tokens Tailwind gardent l'alias
> `solidata-green` pointant désormais vers le teal pour ne pas casser les
> pages existantes, mais toute nouvelle page doit utiliser `primary`.

---

## 3. Palette couleurs

### 3.1 Primaire — bleu pétrole / teal

| Token | Hex | Usage |
|-------|-----|-------|
| `primary.DEFAULT` / `--color-primary` | `#0D9488` | CTA principal, liens actifs, surfaces marquées |
| `primary.dark` / `--color-primary-dark` | `#0F766E` | Hover CTA, bandeau header mobile |
| `primary.light` | `#14B8A6` | Surbrillance, graphique |
| `primary.muted` | `#CCFBF1` | Pastille active, highlight doux |
| `primary.surface` / `--color-primary-surface` | `#F0FDFA` | Fond de zone marquée (non bouton) |

### 3.2 Neutres (palette officielle = Slate)

Tailwind `gray` est aliasé vers `slate` dans `tailwind.config.js` : écrire
`text-gray-500` ou `text-slate-500` produit le même rendu. **Préférer
`slate-*` dans le code récent** pour rendre l'intention explicite.

| Rôle | Token | Hex |
|------|-------|-----|
| Fond application | `--color-bg` / `bg-[var(--color-bg)]` | `#FAFAF9` |
| Fond section douce | `--color-bg-subtle` | `#F1F5F9` |
| Surface carte | `--color-surface` / `bg-white` | `#FFFFFF` |
| Texte principal | `--color-text` / `text-slate-900` | `#0F172A` |
| Texte secondaire | `--color-text-muted` / `text-slate-500` | `#64748B` |
| Bordure standard | `--color-border` / `border-slate-200` | `#E2E8F0` |
| Bordure légère | `--color-border-light` / `border-slate-100` | `#F1F5F9` |

### 3.3 Statuts sémantiques

| Intention | Fond | Texte | Accent |
|-----------|------|-------|--------|
| Succès / terminé | `bg-emerald-100` | `text-emerald-700` | `bg-emerald-500` (dot) |
| En cours / attention | `bg-amber-100` | `text-amber-700` | `bg-amber-500` |
| Planifié / info | `bg-blue-100` | `text-blue-700` | `bg-blue-500` |
| Erreur / critique | `bg-red-100` | `text-red-700` | `bg-red-500` |
| Neutre / inactif | `bg-slate-100` | `text-slate-600` | `bg-slate-400` |
| Validation logistique | `bg-teal-100` | `text-teal-700` | `bg-teal-500` |
| Flux spécial (pesée, PCM) | `bg-purple-100` | `text-purple-700` | `bg-purple-500` |

> Le mapping complet par domaine (candidats, commandes, tournées, véhicules,
> stock, heures) est centralisé dans `components/StatusBadge.jsx`.
> **Toujours réutiliser `<StatusBadge status="..." />`** plutôt que de
> recréer des pastilles à la main.

### 3.4 Accent modules (navigation)

L'`IconSidebar` colore la barre latérale de chaque module. Ces couleurs ne
sont utilisées **que pour la navigation** :

| Section | Couleur |
|---------|---------|
| Accueil, Collecte | teal |
| Recrutement | blue |
| Gestion Équipe | emerald |
| Tri & Production | amber |
| Logistique | purple |
| Boutiques | pink |
| Finances | indigo |
| Reporting | rose |
| Administration | slate |

---

## 4. Typographie

- **Famille unique** : Plus Jakarta Sans (400 / 500 / 600 / 700).
- **Hiérarchie courante** :

| Rôle | Classe Tailwind | Exemple |
|------|----------------|---------|
| Titre de page H1 | `text-2xl font-bold text-slate-800` | "Suivi des collectes en cours" |
| Titre section | `text-lg font-semibold text-slate-800` | "Tournées du jour" |
| Sous-titre / contexte | `text-sm text-slate-500` | "21 avril — 4 tournées actives" |
| Étiquette forme | `text-xs text-slate-500` (classe `.label-modern`) | "Marque *" |
| Valeur KPI | `text-2xl font-bold tracking-tight` | "1 240" |
| Petite pastille / badge | `text-[10px]` ou `text-[11px] uppercase tracking-wide` | "PCM" |
| Mono (ID, immatriculation) | `font-mono text-xs` | "AB-123-CD" |

- **Nombres** : toujours `tabular-nums` dans les tableaux et KPI pour aligner
  les colonnes. Exemple : `<span className="tabular-nums">{value}</span>`.

---

## 5. Spacing, radius, ombres

### Rayons

| Token | Valeur | Usage |
|-------|--------|-------|
| `rounded-button` | 10 px | Boutons `.btn-*` |
| `rounded-input` | 10 px | Inputs, selects, textarea |
| `rounded-card` | 12 px | Cartes via `.card-modern` |
| `rounded-xl` (Tailwind) | 12 px | Cartes ad-hoc |
| `rounded-2xl` | 16 px | Modals, grandes cartes |
| `rounded-full` | pastille, avatar, dot statut | — |

### Ombres

| Token | Usage |
|-------|-------|
| `shadow-card` | Carte repos |
| `shadow-card-hover` | Carte au survol |
| `shadow-elevated` | Popover, dropdown utilisateur, NotificationBell |
| `shadow-sidebar` | Bord droit sidebar (rarement) |
| `shadow-2xl` (Tailwind) | Modal / bottom-sheet |

### Dimensions layout

| Variable | Valeur | Rôle |
|----------|--------|------|
| `--topbar-height` | `3.5rem` (56 px) | Barre supérieure fixe |
| `--icon-sidebar-width` | `60 px` | Sidebar icônes gauche |
| `--content-sidebar-width` | `15rem` (240 px) | Sidebar sous-menu |
| `max-w-[1600px] mx-auto` | Contenu principal | Contenu centré desktop |

---

## 6. Composants de base (web manager)

Tous dans `frontend/src/components/`. Importer via `from '../components'`
quand ré-exporté dans `index.js`, sinon chemin direct.

### 6.1 Boutons (classes CSS globales, pas de composant React)

| Classe | Rôle | Exemple |
|--------|------|---------|
| `.btn-primary` | CTA principal (créer, valider, lancer) | `<button className="btn-primary">Enregistrer</button>` |
| `.btn-secondary` | Action secondaire (annuler, retour, filtres) | Outline teal, texte slate |
| `.btn-danger` | Suppression, désactivation critique | Rouge |
| `.btn-ghost` | Action mineure dans un tableau | Pas de bord, texte slate |

Règles :
- **Une seule action primaire** visible par zone (formulaire, carte, modal).
- Tailles : padding par défaut `px-4 py-2.5`. Pour un bouton compact dans un
  tableau : ajouter `text-sm` et réduire à `px-3 py-1.5` si nécessaire.
- État disabled : automatique via `:disabled` sur `.btn-*`, opacity 50 %.
- Icône gauche optionnelle : `<Save className="w-4 h-4 mr-1.5" />` dans le
  bouton.

### 6.2 Formulaires

| Classe / composant | Rôle |
|--------------------|------|
| `.label-modern` | Label au-dessus du champ (obligatoire pour a11y) |
| `.input-modern` | Input texte / number / date / email |
| `.select-modern` | Select natif stylisé avec chevron SVG |
| `.textarea-modern` | Textarea auto-resize (min 5rem) |

Pattern standard :

```jsx
<div>
  <label className="label-modern">Nom du contrat *</label>
  <input
    required
    className="input-modern"
    value={form.name}
    onChange={(e) => setForm({ ...form, name: e.target.value })}
  />
</div>
```

Validation : afficher l'erreur sous le champ avec
`<p className="text-xs text-red-600 mt-1">Message</p>`.

### 6.3 Cartes

- Classe utilitaire `.card-modern` = fond blanc + bordure claire + ombre
  douce + radius 12 + hover.
- Composant dérivé : `<KPICard title value unit icon accent />` avec
  variantes `primary | emerald | amber | red | slate`.
- Patron "section de page" :

```jsx
<div className="card-modern p-5">
  <h2 className="text-lg font-semibold text-slate-800 mb-3">Titre</h2>
  {/* contenu */}
</div>
```

### 6.4 StatusBadge

Seule source autorisée pour afficher un statut métier. Le mapping contient
déjà candidats, commandes, tournées, véhicules, stock, heures, factures.

```jsx
import { StatusBadge } from '../components';
<StatusBadge status="in_progress" />
```

Pour un statut absent du mapping, ajouter son libellé + ses classes dans
`StatusBadge.jsx` plutôt que de fabriquer un span ad-hoc.

### 6.5 Modal

```jsx
<Modal isOpen={show} onClose={() => setShow(false)} title="…" size="md">
  {/* body */}
  {/* footer optionnel : <Modal footer={<button className="btn-primary">Valider</button>}> */}
</Modal>
```

- Tailles : `sm` (448px), `md` (512px), `lg` (672px), `xl` (896px).
- Fermeture automatique sur `Escape` et clic backdrop.
- `role="dialog"` + `aria-modal` déjà posés.

### 6.6 Composants secondaires prêts à l'emploi

| Composant | Rôle |
|-----------|------|
| `<EmptyState icon title description action={{ label, onClick }} />` | État vide (tableau vide, recherche 0 résultat) |
| `<LoadingSpinner size="sm\|md\|lg" message />` | Chargement générique |
| `<LoadingOverlay />` | Voile semi-transparent plein écran pendant save |
| `<DataTable columns rows />` | Tableau cohérent avec tri / pagination |
| `<KanbanBoard columns onMove />` | Kanban drag-drop (recrutement, commandes) |
| `<PageHeader title subtitle actions />` | En-tête standardisé de page |
| `<HubComponents>` (HubCard, HubGrid) | Pages d'accueil de section |
| `<ConfirmDialog />` | Confirmation destructive |
| `<Toast />` (via `<ToastProvider>`) | Messages éphémères bas de page |
| `<NotificationBell />` | Cloche TopBar + toggle push |
| `<UserDropdown />` | Menu utilisateur TopBar |

### 6.7 Iconographie

- **Librairie unique** : `lucide-react`. Interdit d'importer d'autres pack
  d'icônes.
- Stroke :
  - Web navigation : `1.8` (IconSidebar).
  - Web contenus / KPI : défaut lucide (`2`).
  - Mobile action bar : `2.4` (meilleure visibilité en plein soleil).
- Tailles courantes :
  - Dans un bouton : `w-4 h-4`.
  - KPI, en-tête carte : `w-5 h-5`.
  - Illustration d'état (EmptyState) : `w-8 h-8`.
- Remplacer un emoji par une icône lucide dès que la surface n'est pas un
  écran IA ou récapitulatif.

---

## 7. Layouts

### 7.1 Web manager — shell trois colonnes

Structure imposée par `<Layout>` :

```
┌─────────────────────────────────────────────────────────────┐
│ IconSidebar (60px)  │ ContentSidebar (240px, collapsible)    │
│ ─────────────────── │ ─────────────────────────────────────  │
│                     │                TopBar (56px)           │
│                     │ ────────────────────────────────────   │
│                     │                                        │
│                     │   <main> contenu page                  │
│                     │   p-4 sm:p-6 lg:p-6 max-w-[1600px]     │
└─────────────────────────────────────────────────────────────┘
```

- Une page ne déclare **jamais** sa propre sidebar. Elle s'enveloppe dans
  `<Layout>{...}</Layout>` et c'est tout.
- Les rubriques du menu sont définies dans `Layout.jsx` (`menuSections`) ;
  ajouter une page = ajouter une entrée avec `path`, `label`, `icon`,
  `roles`.
- `ProtectedRoute` dans `App.jsx` contrôle l'accès par rôle.

### 7.2 Mobile PWA — écrans plein écran

La mobile utilise un pattern **un écran = une tâche**, pas de sidebar.

```
┌─────────────────────────────────────┐
│  screen-header (dégradé teal)       │
│  titre + contexte court             │
├─────────────────────────────────────┤
│                                     │
│  contenu scroll vertical            │
│  cartes `.card-mobile` (radius 20)  │
│                                     │
├─────────────────────────────────────┤
│  PrimaryActionBar (fixed bottom)    │
│  1 CTA + 1 action secondaire max    │
└─────────────────────────────────────┘
```

Règles spécifiques mobile :

- **Zones tactiles** ≥ 60 px (`--space-touch`). Classe utilitaire
  `.touch-target` disponible.
- **Safe area iOS** : classes `.safe-bottom` et header utilise
  `env(safe-area-inset-*)`.
- **Gros textes** : taille minimum `text-base` (16 px) pour les champs, pour
  éviter le zoom iOS.
- **Une seule CTA visible** par écran (le chauffeur ne doit pas hésiter).
  Composant `<PrimaryActionBar primaryLabel primaryIcon onPrimary secondaryLabel onSecondary />`.
- **Mode d'usage** : `<UsageModeBanner />` affiche conduite / arrêt court /
  arrêt opérationnel, ce qui change le CTA de certains écrans.
- **Offline-first** : toute action passe par `services/sync.js`. Le
  `<SyncStatusBanner />` affiche l'état (offline / syncing / erreur /
  pending).
- **Haptique** : `vibrateSuccess()`, `vibrateError()`, `vibrateTap()` depuis
  `services/haptic.js` sur chaque action critique.

### 7.3 Pages hub (accueil section)

Chaque grande section (`/hub-collecte`, `/hub-equipe`, `/hub-tri-production`,
`/hub-exutoires`, `/hub-boutiques`, `/hub-reporting`, `/hub-admin`) suit le
même pattern :

- Titre section + description courte.
- Grille de cartes `<ModuleCard icon title description to />` vers les
  sous-pages.
- Optionnel : une ligne de KPI en haut si la section a des chiffres clés
  agrégés (ex : HubCollecte).

---

## 8. Patterns UX

### 8.1 États de page

| État | Composant | Règle |
|------|-----------|-------|
| **Chargement** initial | `<LoadingSpinner size="lg" message="…" />` encapsulé dans `<Layout>` | Affiché seulement au 1er chargement, pas à chaque refresh polling |
| **Chargement partiel** (refresh arrière-plan) | `<LoadingSpinner size="sm" />` inline dans l'en-tête de carte | Ne bloque pas l'UI |
| **Erreur réseau** | Toast rouge + bouton "Réessayer" | Pas de page blanche ; afficher les dernières données connues |
| **Données vides** | `<EmptyState icon title description action />` | Toujours un CTA si une action est possible (créer, importer) |
| **Accès refusé** | Redirection `<Navigate to="/" />` via `ProtectedRoute` | Pas de 403 visuel, l'utilisateur ne voit pas la section |
| **Offline (mobile)** | `<SyncStatusBanner />` en haut + actions différées via `sync.js` | Jamais de perte de donnée silencieuse |

### 8.2 Feedback utilisateur

- **Action réussie** : `<Toast level="success" message />` (ToastProvider
  obligatoire dans l'arbre, déjà branché via `App.jsx`).
- **Action destructive** : `<ConfirmDialog />` avec bouton `btn-danger`. Le
  libellé répète le nom de l'élément ("Supprimer le contrat Norauto ?").
- **Auto-save** : indicateur discret "Enregistré il y a N s" sous le champ.
- **Action asynchrone longue** : `<LoadingOverlay />` pendant la requête,
  pas juste disable du bouton.

### 8.3 Alertes & bandeaux

| Niveau | Classe fond / bordure | Texte | Icône lucide |
|--------|----------------------|-------|-------------|
| `info` | `bg-blue-50 border-blue-100` | `text-blue-800` | `Info` |
| `warn` | `bg-amber-50 border-amber-100` | `text-amber-800` | `AlertTriangle` ou `Clock` |
| `error` | `bg-red-50 border-red-100` | `text-red-800` | `AlertTriangle` |
| `success` | `bg-emerald-50 border-emerald-100` | `text-emerald-800` | `CheckCircle2` |

Structure : `px-4 py-2 rounded-lg border` + icône `w-4 h-4` à gauche + texte
`text-sm`. Référence : `AlertBanner` dans `LiveVehicles.jsx`.

### 8.4 Tableaux

- En-tête : `text-left text-xs text-slate-500 uppercase bg-slate-50`.
- Ligne : `border-t border-slate-100 hover:bg-slate-50`.
- Padding cellule : `px-3 py-2.5` ou `px-4 py-3` selon densité.
- Colonnes numériques : `text-right tabular-nums`.
- Actions de ligne : `<Trash2 className="w-4 h-4 text-red-400 hover:text-red-600" />` sans libellé, avec `title` pour l'a11y.
- État vide : `<tr><td colSpan={N} className="px-4 py-8 text-center text-slate-400 text-sm">Aucune entrée</td></tr>`.

### 8.5 Filtres

- Barre de filtres compacte en haut de la carte/tableau : icône `Filter` +
  boutons radio style pastille + sélecteurs.
- Bouton **Réinitialiser** visible dès qu'un filtre est actif.
- Toujours un compteur à droite : "X / Y résultats".
- Pattern de référence : `CollectionsLive.jsx` (filtres statut + commune).

### 8.6 Dates et nombres

- **Dates affichées** : `toLocaleDateString('fr-FR', { weekday, day, month })`
  pour les dates longues. Format court : `DD/MM/YYYY`.
- **Heures** : `toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })`.
- **Poids** : entier + " kg" (`Math.round(weight)`), jamais de décimale au
  delà de 0.1.
- **Euros** : `toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })`.
- **Pourcentages** : entier + " %" (espace insécable ` %` si possible).
- Devant un "—" pour une valeur absente, jamais "null", "N/A", "undefined".

### 8.7 Couleur = jamais seule information

Toujours doubler par :
- Une icône (`CheckCircle2`, `AlertTriangle`, `CircleDashed`, etc.).
- Un libellé texte.
- Un motif visuel différenciant (pointillé, rempli, opacité).

Exemple `DropSlot` de `PlanningTournees.jsx` : le slot vide est en
`border-dashed` et un slot en conflit en `border-red-300 bg-red-50` + texte
"Conflit" dans le modal.

---

## 9. Accessibilité et i18n

1. **Langue** : `<html lang="fr">` (déjà posé dans `index.html`). Toute
   nouvelle copie reste en français.
2. **Contrastes** : texte principal sur fond blanc = `slate-800` (ratio
   > 12:1). Texte secondaire = `slate-500` (ratio > 4.5:1 WCAG AA).
3. **Focus** : préserver `focus:ring-2 focus:ring-emerald-500` par défaut
   Tailwind + les anneaux déjà inclus dans `.input-modern`, `.btn-*`.
4. **Aria** : `role="dialog"` + `aria-modal="true"` + `aria-label` sur les
   modals, `aria-label` sur chaque bouton icône seule.
5. **Clavier** : `Escape` ferme les modals (déjà implémenté). Tab order
   naturel, ne pas poser de `tabIndex` positif arbitraire.
6. **Mobile chauffeur** : taille touch ≥ 60 px, police de base 16 px, pas
   de hover-only. Classe `.touch-target` disponible.
7. **Lecteur d'écran** : chaque input doit avoir un `<label>` (classe
   `.label-modern`) relié au champ.
8. **Icônes décoratives** : `aria-hidden="true"`. Icônes porteuses de sens
   sans texte : `aria-label` avec la signification (`"Supprimer"`).

---

## 10. Règles mobile spécifiques

- **Token radius** : 12 / 16 / 20 / 24 (plus généreux que le web).
- **Pas de hover** : tout état visible au repos. Utiliser `active:scale-[0.98]`
  pour le feedback tactile.
- **Scroll** : `overscroll-behavior: none` déjà global pour éviter le bounce
  sur iOS.
- **Safe area** : toute barre fixée en bas doit inclure
  `padding-bottom: calc(var(--safe-bottom) + 12px)` ou utiliser
  `.primary-action-bar`.
- **Offline** : pas d'envoi direct vers l'API. Toute action passe par
  `services/sync.js` qui gère la file IndexedDB et l'idempotence.
- **Haptique systématique** : scan OK, collecte validée, incident déclaré,
  tournée terminée.

---

## 11. Checklist création d'une nouvelle page

Avant de merger une nouvelle page web manager :

1. Enveloppée dans `<Layout>{...}</Layout>`.
2. Route déclarée dans `App.jsx` avec `<ProtectedRoute roles={[…]}>` si
   restriction.
3. Entrée ajoutée dans `menuSections` de `Layout.jsx` (icône lucide, rôles,
   libellé FR court).
4. Utilise `--color-*` / classes Tailwind existantes, **pas de couleurs en
   dur** hors status badges déjà mappés.
5. Tous les hooks (`useState`, `useEffect`, `useMemo`, `useCallback`) sont
   appelés **avant tout early return** — sinon page blanche (règle Hooks).
6. Chargement : `<LoadingSpinner>` au 1er render, puis fetch silencieux.
7. Erreur API : toast `error` + dernières données affichées, jamais écran
   vide.
8. État vide : `<EmptyState>` avec action si possible.
9. Boutons : un seul primaire, actions destructives en `btn-danger` +
   `<ConfirmDialog>`.
10. Tableau / liste : `<StatusBadge>` pour tout statut métier.
11. Modal : `<Modal>` standard avec titre, pas de div positionné à la main.
12. Dates / nombres formatés en français avec `toLocaleString`.
13. Pas d'emoji dans les libellés UI (sauf contexte IA explicite).
14. Build passe (`npx vite build`), pas d'erreur console navigateur.

Pour une nouvelle page **mobile** :

1. Un seul objectif par écran (pas de sous-onglets).
2. Header dégradé teal via `.screen-header`.
3. Action principale unique via `<PrimaryActionBar>`.
4. Toute action persistée via `services/sync.js` (offline-first).
5. Zones tactiles ≥ 60 px, polices ≥ 16 px.
6. Haptique sur action principale.
7. Test sur Chrome DevTools "iPhone 12" + mode hors ligne.

---

## 12. Évolutions et exceptions

- Toute exception à cette charte (nouvelle couleur, nouveau composant
  global, nouveau token) doit être documentée dans ce fichier avant merge.
- Les assets marketing (présentations, emails Brevo) peuvent utiliser une
  palette étendue mais doivent rester cohérents avec la palette primaire.
- Les maquettes externes (Figma, Excalidraw) ne font pas foi : la vérité
  est dans ce document + les tokens Tailwind.

---

## 13. Références code

| Concept | Fichier |
|---------|--------|
| Tokens CSS | `frontend/src/index.css`, `mobile/src/index.css` |
| Tokens Tailwind | `frontend/tailwind.config.js`, `mobile/tailwind.config.js` |
| Composants web | `frontend/src/components/` (+ `index.js`) |
| Composants mobile | `mobile/src/components/` |
| Layout web | `frontend/src/components/Layout.jsx` |
| Menu navigation | `frontend/src/components/Layout.jsx` (`menuSections`) |
| StatusBadge mapping | `frontend/src/components/StatusBadge.jsx` |
| Exemple page référence | `frontend/src/pages/LiveVehicles.jsx` (collections-live) |
| Exemple mobile référence | `mobile/src/pages/TourMap.jsx` |

Pour toute question : commencer par lire les fichiers ci-dessus avant de
proposer un changement de charte.
