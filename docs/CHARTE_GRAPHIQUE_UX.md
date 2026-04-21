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
