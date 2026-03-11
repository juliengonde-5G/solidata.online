# Charte graphique — SOLIDATA ERP

## Principes

- **Moderne, épuré, professionnel** : inspiré Material Design 3, Tailwind UI, panneaux type Notion / Linear / Figma.
- **Responsive** : menu latéral repliable, tableaux en cartes sur mobile, touch targets ≥ 44 px sur l’app mobile.
- **Accessibilité** : contraste suffisant (WCAG), libellés courts sur mobile, icônes plates minimalistes.

---

## Palette

| Usage        | Couleur     | Hex       | Usage (exemples)                          |
|-------------|-------------|-----------|-------------------------------------------|
| Primaire    | Bleu pétrole| `#0D9488`| Boutons, liens actifs, accent sidebar      |
| Primaire foncé | Teal foncé | `#0F766E`| Hover boutons, bordures actives           |
| Primaire clair | Teal clair | `#14B8A6`| Survol léger                               |
| Surface primaire | Fond teal très clair | `#F0FDFA` | Fond item actif menu, badges |
| Fond        | Blanc cassé | `#FAFAF9`| Arrière-plan général                       |
| Fond secondaire | Gris très clair | `#F1F5F9` | Zones alternées, scrollbar track   |
| Texte       | Slate foncé | `#0F172A`| Titres, corps                              |
| Texte atténué | Slate moyen | `#64748B`| Labels, métadonnées                        |
| Bordure     | Slate clair | `#E2E8F0`| Bordures champs, cartes                    |

---

## Typographie

- **Police** : Plus Jakarta Sans (400, 500, 600, 700).
- **Hiérarchie** :
  - Titre page : 24–30 px, bold, `text-slate-800`.
  - Sous-titre / description : 14 px, `text-slate-500`.
  - Corps : 14 px, `text-slate-700`.
  - Légendes / secondaire : 12 px, `text-slate-500`.

---

## Composants

- **Cartes** : `card-modern` — fond blanc, `border-radius` 12 px, ombre légère, bordure discrète, hover ombre renforcée.
- **Tuiles KPI** : même base, icône dans un carré arrondi (couleur accent), valeur en gros, unité en petit.
- **Bouton primaire** : `btn-primary` — fond primaire, texte blanc, `border-radius` 10 px, hover foncé + ombre.
- **Champs** : `input-modern` — bordure slate, focus anneau primaire.
- **Menu latéral** : fond blanc, bordure droite légère, item actif = fond `primary-surface` + bordure gauche primaire 3 px.

---

## Mobile (app terrain)

- **Couleurs** : même palette (primaire bleu pétrole).
- **Zones tactiles** : hauteur / largeur min 48 px pour les boutons et liens.
- **Libellés courts** : « Remplir » au lieu de « Remplissage », « Scan », « Check », « Suivant : Scan » dans la barre d’étapes.
- **Header** : dégradé primaire → primaire foncé, texte blanc.
- **Contraste** : suffisant pour usage en extérieur et pour personnes avec faible maîtrise du français (priorité icônes + texte court).

---

## Fichiers de mise en œuvre

- **Frontend** : `frontend/src/index.css` (variables CSS, `.card-modern`, `.btn-primary`, `.input-modern`), `frontend/tailwind.config.js` (couleurs `primary`, `solidata-*`, ombres, radius).
- **Layout** : `frontend/src/components/Layout.jsx` (sidebar, menu avec `activeClass` / `hoverClass` primaire).
- **Mobile** : `mobile/src/index.css` (variables, `.btn-primary-mobile`, `.input-mobile`, `.screen-header`), `mobile/tailwind.config.js`.
