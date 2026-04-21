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
