# 📐 SOLIDATA Design Guide - Migration vers Claude Design

## Contexte actuel

**Appli :** SOLIDATA ERP Solidarité Textiles  
**Stack :** React 18 + Vite + TailwindCSS + Lucide icons  
**Charte :** Bleu pétrole (#0D9488) + Slate neutre  
**État :** ~100 pages, architecture modulaire  

---

## 🎨 Design System actualisé

### Palette de couleurs

```css
/* PRIMARY (Teal) */
--primary-default: #0D9488    /* Main teal */
--primary-light: #14B8A6      /* Lighter teal */
--primary-dark: #0F766E       /* Darker teal */
--primary-muted: #CCFBF1      /* Very light teal bg */
--primary-surface: #F0FDFA    /* Teal surface */

/* NEUTRAL (Slate) */
--slate-50: #F8FAFC
--slate-100: #F1F5F9
--slate-200: #E2E8F0
--slate-300: #CBD5E1
--slate-400: #94A3B8
--slate-500: #64748B
--slate-600: #475569
--slate-700: #334155
--slate-800: #1E293B
--slate-900: #0F172A

/* SEMANTIC */
--success: #10B981
--warning: #F59E0B
--error: #EF4444
--info: #3B82F6
```

### Typography

```
Font Family: Plus Jakarta Sans
  - Web: Font awesome system
  - Bold (700): Headers, CTAs
  - Semibold (600): Section titles
  - Medium (500): Button text, labels
  - Regular (400): Body text
  
Sizes:
  - H1: 32px / 40px (3xl)
  - H2: 24px / 32px (2xl)
  - H3: 20px / 28px (xl)
  - Body: 14px / 20px (base)
  - Small: 12px / 16px (sm)
```

### Spacing

```
4px   = xs
8px   = sm
12px  = md
16px  = lg
24px  = xl
32px  = 2xl
48px  = 3xl
```

### Border Radius

```
8px   = sm
10px  = md (inputs, buttons)
12px  = card (card border-radius)
16px  = lg
```

### Shadows

```
card:         0 1px 3px rgb(0 0 0 / 0.05)
card-hover:   0 4px 6px -1px rgb(0 0 0 / 0.06)
elevated:     0 10px 15px -3px rgb(0 0 0 / 0.06)
sidebar:      2px 0 8px -2px rgb(0 0 0 / 0.04)
```

---

## 🏗️ Architecture & Composants

### Layout Hierarchy

```
┌─────────────────────────────────────────┐
│           TOP BAR (Search, Notifications)
├─┬───────────────────────────────────────┤
│I│                                       │
│c│   MAIN CONTENT AREA                  │
│o│   (Flex, scrollable)                 │
│n│                                       │
│S│   - Page Header                       │
│i│   - KPI Cards Grid                    │
│d│   - Data Tables / Lists               │
│e│   - Charts / Dashboards               │
│b│   - Forms / Modals                    │
│a│                                       │
│r│                                       │
└─┴───────────────────────────────────────┘
```

### Composants clés à améliorer

#### 1. **Sidebar**
- ✅ Current: Icon-based + content sidebar
- 🎯 Amélioration:
  - Ajouter animations au collapse (smooth transition)
  - Highlight section active avec gradient (teal)
  - Hover states plus discrets (soft bg-teal-50)
  - Grouper le menu par domaines métier

#### 2. **KPI Cards**
```jsx
// Pattern
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  {kpis.map(kpi => (
    <div className="bg-{color}-50 rounded-xl p-6 border border-slate-200 hover:shadow-lg">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-slate-600">{kpi.label}</p>
          <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
          {kpi.trend}
        </span>
      </div>
      {/* Mini chart or progress bar */}
    </div>
  ))}
</div>
```

#### 3. **Data Tables**
- ✅ Current: Basic HTML tables
- 🎯 Amélioration:
  - Ajouter hover states (bg-slate-50)
  - Sticky header + scrollable body
  - Actions (edit/delete) au clic + confirmation
  - Alternating row colors (subtle striping)
  - Responsive: Stack en mobile, horizontal scroll en tablet

#### 4. **Buttons & CTAs**
```jsx
// Primary
className="px-4 py-2 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 transition"

// Secondary
className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 transition"

// Ghost (Minimal)
className="px-4 py-2 rounded-lg text-teal-600 font-medium hover:bg-teal-50 transition"
```

#### 5. **Forms & Inputs**
```jsx
// Standard input
className="w-full px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white transition"

// Label hierarchy
<label className="block text-sm font-medium text-slate-700 mb-2">
  Field Label
</label>
```

#### 6. **Status Badges**
```jsx
// Success
className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold"

// Warning
className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold"

// Error
className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold"
```

---

## 📱 Responsive Patterns

### Mobile-first approach

```
Mobile   < 640px   (sm)
Tablet   640–1024px (md–lg)
Desktop  ≥ 1024px   (lg+)
```

### Grid Responsive

```jsx
// KPI cards
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"

// Content area
className="grid grid-cols-1 lg:grid-cols-3 gap-8"

// Sidebar mobile
className={`${
  mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
} fixed lg:relative ...`}
```

---

## 🎯 Pages à reprendre en priorité

### Phase 1 (Critiques - UI/UX)

1. **Dashboard** (Home)
   - KPI cards modulaires + dynamiques
   - Chart integration (Recharts → enhanced styling)
   - Recent activity feed (Kanban-like cards)
   - Quick action buttons

2. **Recrutement** (Candidates Hub)
   - Kanban board stylisé (drag-drop)
   - Candidate cards (avatar, status, tags)
   - CV preview + PCM test results
   - Conversion funnel visualization

3. **Collecte** (Tours & Collection)
   - Tour list avec status + map integration
   - Collection proposals AI-driven
   - Real-time tracker (live updates)
   - CAV fill rate gauge charts

4. **Production** (Stock & Sorting)
   - Stock MP inventory table (search + filter)
   - Production flow diagram (interactive SVG)
   - Refashion tracking dashboard

### Phase 2 (Standard - UX optimization)

5. **Finances** (Finance Hub)
   - P&L dashboard
   - Cashflow timeline
   - Expense breakdown pie charts

6. **Reporting** (Analytics)
   - Custom report builder
   - Export functionality (PDF, Excel)
   - Date range picker + filters

7. **Administration** (Settings)
   - User management table
   - Vehicle fleet overview
   - Settings panels (modular)

---

## 🚀 Implementation Roadmap

### Step 1: Design System in Claude Design
- Create reusable component library
  - Button variants
  - Form inputs
  - Cards & containers
  - Badges & alerts
  - Modals & dropdowns

### Step 2: Page Mockups
```
solidata-design/
├── 01-dashboard.jsx
├── 02-candidates-kanban.jsx
├── 03-tours-list.jsx
├── 04-production-flow.jsx
├── 05-finance-dashboard.jsx
├── 06-reporting.jsx
└── design-tokens.js
```

### Step 3: Integration Plan
1. Copy component code from Claude Design mockups
2. Adapt to existing React structure
3. Update Tailwind config with new spacing/colors
4. Migrate pages one-by-one
5. Test responsive + accessibility

---

## 🎓 Design Principles

1. **Clarity over decoration**
   - Data-first design
   - Minimal visual clutter
   - Information hierarchy

2. **Consistency**
   - Same button style everywhere
   - Uniform spacing (8px grid)
   - Color usage reflects meaning

3. **Accessibility**
   - WCAG AA contrast ratios
   - Focus states visible
   - Keyboard navigation
   - Screen reader friendly

4. **Performance**
   - Lightweight SVGs for icons (Lucide ✓)
   - CSS transitions (no heavy animations)
   - Lazy load modals/sidebars

5. **Responsiveness**
   - Mobile-first CSS
   - Touch-friendly button sizes (44px minimum)
   - Horizontal scroll for tables (tablet/mobile)

---

## 💡 Quick wins (easy wins first)

1. **Top bar search** → enhanced styling + dark mode toggle
2. **KPI cards** → add mini charts (Recharts integration)
3. **Buttons** → unified style system + hover/active states
4. **Tables** → sorting, filtering, pagination
5. **Modals** → backdrop blur + smooth animations
6. **Sidebar** → smooth collapse animation + section grouping

---

## 🔗 Resources

- **Tailwind Config:** `/frontend/tailwind.config.js`
- **Current Components:** `/frontend/src/components/`
- **Design Tokens:** Colors in config → CSS variables
- **Icon Library:** Lucide React (24+ icons used)

---

## ❓ Decisions to make

1. **Dark mode?** (Optional, low priority)
2. **Animation library?** (Framer Motion? Keep CSS transitions?)
3. **Component storybook?** (For documentation)
4. **Design handoff tool?** (Figma specs for developers)

---

**Author:** Julien Gondé  
**Date:** April 2026  
**Status:** Design Improvement Phase 1  
