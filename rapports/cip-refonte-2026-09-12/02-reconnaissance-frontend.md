# Reconnaissance — frontend web du module Insertion (état au 12/09/2026)

> Agent de reconnaissance (lecture seule). React 18 + Vite + Tailwind, `frontend/src`.

## Résumé exécutif
- **11 surfaces** pour un parcours complet (Candidatures, fiche candidat, Collaborateurs, fiche collaborateur, Espace CIP liste, fiche CIP × 7 onglets, DiagnosticForm, EntretienForm, écran ETI, modale satisfaction, Actions CIP) et **250 à 350 clics** de l'embauche au bilan de sortie, dont ~50 % sur le diagnostic d'accueil (14 rubriques, ~80 champs, Kolb 24 items).
- Le module **s'écarte du design system** : cartes, KPI, onglets, modales refaits à la main (`InsertionParcours.jsx` et `AuditInsertion.jsx` n'importent que `LoadingSpinner` et `PageHeader`) ; modales maison sans focus-trap ; `alert()`/`window.confirm` ; ≥ 23 `catch` silencieux.
- **Pass IAE affiché mais saisissable nulle part** dans le frontend (aucun formulaire ne porte `pass_iae_number/start/end`).
- **Écran ETI de renouvellement** présenté comme « lien à envoyer à l'encadrant » mais sous `ProtectedRoute ADMIN/RH/MANAGER` (aucun jeton public).
- Liste des salariés de `/insertion` sans recherche, filtre, ni pagination ; la case « Mes salariés » ne filtre pas la liste de gauche.
- Aucun compteur d'alertes insertion dans la barre latérale.

## 1. Pages

| Page | Route (App.jsx) | Rôles | Structure |
|---|---|---|---|
| `InsertionParcours.jsx` (1 569 l.) « Espace CIP » | `/insertion` (`:204`), deep-link `?employee=` | A/RH/M | Grille 12 col. : liste salariés (3) + fiche (9). En-tête : badges Parcours n°, Pass IAE, CDDI n/24, PCM, Prescripteur, sélecteur CIP référent ; `AlertesBloc` ; boutons + Action, + Entretien, Démarrer le parcours, Mettre à jour les échéances, Fiche PDF, Bilan de prolongation PDF. **7 onglets** : Synthèse (Checklist embauche → Note de profil → encart diagnostic J+30 → FriseParcours → TimelineView → PmsmpPanel → SatisfactionForm → fiche synthèse) · Diagnostic · Entretiens & bilans · Compétences · Objectifs & actions (Objectifs + Actions + NotesSuivi) · Freins (radar) · Assistant IA (recommandations algorithmiques + Analyser le profil + « Tester la connexion IA » exposant clé/modèle/docker). `CohortePanel` interne (`:434`) = tableau de bord CIP. |
| `ActionsCIP.jsx` | `/insertion/actions` (`:205`) | A/RH/M | Filtres salarié / gestionnaire / catégorie / criticité / partenaire / statut / retard / mes salariés ; tableau 8 col., statut éditable en ligne ; pagination 50 ; export CSV client (page seule). |
| `AuditInsertion.jsx` (936 l.) « Pilotage & indicateurs » | `/insertion/audit` (`:206`) | A/RH/M (IA, cibles, export freins : A/RH) | Année ; Synthèse comité CSV ; Tableau des freins (modale : 4 filtres, case judiciaire art. 10, complétude par colonne) ; Export PDF. Sections : indicateurs conventionnels (4 `CibleCard`, ETP approché, délai diagnostic, PMSMP, satisfaction, typologies, encart CVG « en attente »), indicateurs clés, réalisation par échéance, radar 9 freins, sorties, actions, rapport IA. |
| `RenouvellementETI.jsx` | `/insertion/renouvellement/:milestoneId` (`:208`) | A/RH/M, **hors Layout**, FALC (boutons ≥ 48 px) | 3 échelles + participation + compétences + motifs + avis + durée → « Transmettre à la CIP ». Écrit 3 champs seulement. États transmitted / locked / lien périmé. |
| `AdminInsertion.jsx` | `/admin/insertion` (`:209`) | ADMIN | 7 paramètres avec **7 boutons Enregistrer** ; lien vers cibles ; partenaires (CRUD, désactivation) ; grilles de compétences par filière. |
| `PlanFormation.jsx` | `/rh/formation` (`:200`) | A/RH/M | Actions de formation non nominatives ; page conforme au design system. |
| `EffectifsETP.jsx` (1 659 l.) | `/rh/effectifs` (`:201`) | A/RH/M (écriture A/RH) | 5 onglets : Synthèse mensuelle, Comparaison ASP, Grille prévisionnelle, Réalisé & écarts, Paramètres. |
| `Candidates.jsx` | `/candidates` (`:193`) | A/RH/M | Kanban 4 col. ; onglets Fiche/Historique (+ Mise en situation, Entretien, PCM, Documents) ; liaison collaborateur (`LinkEmployeeModal`) ; PCM (Base/Phase, cohérence, PDF). **Aucune saisie Pass IAE.** |
| `Employees.jsx` | `/employees` (`:198`) | A/RH/M | Drawer 5 onglets : Informations, Contrats, Disponibilités, Profil PCM (liaison), Parcours insertion (**lecture seule**, `InsertionReadOnlyTab` : alertes, checklist, note de profil, frise, objectifs, actions, notes, compétences ; « Ouvrir dans l'espace CIP »). Encart contrats < 60 j. `CddiBadge`. |
| `Prescripteurs.jsx` | `/prescripteurs` (`:203`) | A/RH | Page conforme (DataTable, Modal). |
| `Skills.jsx` | `/skills` (`:202`) | A/RH/M (menu A/RH seulement ⚠) | Matrice collaborateurs × 15 compétences ; éditable permis B / CACES ; une requête `/candidates/:id/skills` par salarié. |

## 2. Composants `components/insertion/*`
| Composant | Rôle | Endpoints |
|---|---|---|
| `freins.js` | Miroir des 9 freins + libellés FR, `visibleFreins(baseRole)`, `MANAGER_HIDDEN_FIELDS`, `JUDICIAIRE_LEGAL_NOTICE`, `entretienLabel`, `frDate`, `isAdminRh` | — |
| `DiagnosticForm.jsx` (650 l.) | Stepper **14 rubriques** (Parcours & famille, Logement, Droits & administratif, Santé, Budget, Mobilité, Français & langues, Situation pro, Projet pro, Portefeuille & AFOM, Style d'apprentissage, Expression du salarié, Données FSE+ entrée, Freins & synthèse), autosave 30 s, reprise, relecture, suggestions serveur | `PUT /insertion/diagnostic/:id` |
| `EntretienForm.jsx` (988 l.) | Étapes dynamiques : Situation → Depuis le dernier bilan → Freins → Questionnaire → Objectifs → Actions → [Renouvellement / Sortie] → Clôture ; check-list « Prêt à clôturer » ; 409 avec ancres ; verrou/réouverture ; préparation IA | template, radar, objectifs, actions, PUT milestone, close, reopen, `/ia/entretien` |
| `FriseParcours.jsx` | 4 couloirs (Contrats/Entretiens/Objectifs/PMSMP), « aujourd'hui », regroupement ×N | — |
| `PmsmpPanel.jsx` | Liste, jauge cumul 12 mois, forçage motivé | `/insertion/pmsmp*` |
| `SatisfactionForm.jsx` | Smileys 1-4, situation de sortie | `/insertion/satisfaction/:id` |
| `CompetencesETI.jsx` | Grille filière, notes 0-10 / N/E, triple validation | `/insertion/competences*` |
| `ChecklistEmbauche.jsx` | 7 étapes, complétude | `/insertion/checklist-embauche/:id` |
| `PortefeuilleCompetences.jsx`, `StyleApprentissage.jsx` (Kolb 24 items) | étapes du diagnostic | — |
| `NoteProfilInitial.jsx` | Note IA : parole de la personne en 1er, freins pressentis, PCM en dernier, sources/manques ; Générer / PDF / prise de connaissance | `/insertion/notes-profil*`, `/ia/note-profil` |
| `NotesSuiviPanel.jsx` | Journal 6 catégories, date événement, historique | `/insertion/notes-suivi*` |
| `ObjectifsPanel.jsx`, `ActionsPanel.jsx`, `QuickActionButton.jsx` (+ Action ≤ 30 s, récents localStorage), `AlertesBloc.jsx` (3 niveaux, ack 7 j), `RadarFreins.jsx`, `parametres.js`, `pdf-insertion.js` (5 générateurs PDF via `window.open`) | | |

## 3. Navigation (`Layout.jsx:129-165`, section « RH et Insertion »)
- Recrutement : Besoin au recrutement (A/RH), Gestion candidatures (A/RH/M), Analyse personnalités `/pcm` (A/RH/PCM).
- **Gestion du personnel** : Collaborateurs · **Espace CIP (insertion)** (Heart) · **Actions CIP** (ListChecks) · **Pilotage & indicateurs** (ClipboardList) · Effectifs ETP (Gauge) · Compétences (Star, A/RH) · Plan de formation (GraduationCap) · Prescripteurs (Building2, A/RH) · Réglages → Réglages insertion (ADMIN).
- Hors menu : `/insertion/renouvellement/:id`, `/pcm-test/:token`. Ailleurs : Analyse > RH `/reporting-rh` ; Administration > Importer collaborateurs.
- Sidebar : compteurs seulement sur `/candidates` et `/tours` ; **aucune pastille insertion**.

## 4. Tableau de bord CIP (`CohortePanel`, `InsertionParcours.jsx:434-762`)
1. `AgendaBloc` : retards regroupés par salarié (6 max) ; colonnes Aujourd'hui / Cette semaine avec heure et badge « Préparation IA prête ».
2. `RenouvellementsBloc` : fins de contrat dans 42 j, « Créer l'entretien », état (🔒 / avis reçu / à remplir), lien Formulaire + « Copier le lien ».
3. Bandeau « Espace CIP — mes salariés » : case Mes salariés ; + Action ; exports ADMIN/RH (Excel tout / CSV par dataset ; année + trimestre + **Export FSE+**) ; « Analyser la cohorte (IA) » ; 4 KPI (En parcours, Entretiens en retard, À venir 7 j, Sorties dynamiques) ; jauge objectif DREETS.
4. Grille 2×2 : entretiens en retard · à planifier 7 j · fins de contrat < 60 j · freins moyens.
5. Sorties par catégorie / type.

## 5. Parcours CIP en clics
A liaison candidat↔collaborateur ≈ 6-7 · B ouverture du parcours ≈ 5 · C checklist ≈ 8 + saisie · D note de profil ≈ 3 · E **diagnostic ≈ 50 incompressibles, 120-150 réels** · F période d'essai ≈ 11 · G bilan ≈ 12-25 · H renouvellement (triple validation, lien copié manuellement, l'encadrant doit avoir un compte) ≈ 6-14 + 8 · I + Action ≈ 2 · J bilan de sortie ≈ 22-28 · K post-sortie ≈ 8.

## 6. Exports et PDF côté front
- `pdf-insertion.js` : `exportDiagnosticPDF` (salarié/dossier), `exportEntretienPDF` (salarié → trace `remise_salarie`), `exportBilanProlongationPassIae` (A/RH + Pass renseigné), `exportFicheParcoursPDF`, `exportNoteProfilPDF` ; `printReport()` audit ; `pcm-pdf.js` (Fiche PDF, Export technique, restitution candidat).
- Exports serveur : Excel tout / CSV dataset (`/exports/insertion`), FSE+ (`/exports/fse-plus`), Synthèse comité CSV (tous rôles page), Tableau des freins 23 col. (A/RH, modale avec complétude), Actions CSV client, Grille ETP xlsx, Comparaison ASP.

## 7. Frictions UX
- **Erreurs avalées** : `console.error` seul (`Employees.jsx:239/247/322`), `alert()` (`Employees.jsx:212/226`, `Prescripteurs.jsx:72/77`, `AuditInsertion.jsx:587`, `pdf-insertion.js:32`), `window.confirm` ×8, `window.prompt` (`InsertionParcours.jsx:354`), ≥ 23 `.catch(() => …)`.
- **Formulaires longs** : DiagnosticForm 14 rubriques ; EntretienForm 8 étapes ; AdminInsertion 7 boutons Enregistrer ; drawer Employees ~30 champs.
- **États/incohérences** : `RenouvellementsBloc` retourne `null` sans squelette ; liste `/insertion` sans recherche/filtre/pagination ; **Pass IAE non saisissable** ; `/skills` menu ≠ route ; **écran ETI sans jeton public** ; aucun compteur sidebar ; détails techniques (clé API, docker) exposés ; frise + timeline en double sur Synthèse ; double saisie des freins (diagnostic puis chaque entretien).
- **Libellés** : statuts candidats sans accents (« Recus », « Recrutes ») ; `sortie.par_type` brut ; `avis_global.replace('_',' ')` → « tres positif » ; jargon FSE+/AFOM/COA non explicité.
- **Responsive/a11y** : colonnes empilées sous `md` (liste avant contenu) ; rails d'étapes en défilement horizontal ; check-list « Prêt à clôturer » `hidden md:block` ; modales maison sans focus-trap (`Modal.jsx` existe) ; emojis fonctionnels en dur. Bons points : `aria-pressed`, `role="radiogroup"`, cibles ≥ 44 px sur l'écran ETI.

## 8. Charte (pour maquettage)
- Jetons : primary **#0D9488** (light #14B8A6, dark #0F766E, muted #CCFBF1, surface #F0FDFA) ; neutre slate (`gray-*` → slate) ; fond `#FAFAF9` ; texte `#0F172A` / `#64748B` ; police **Plus Jakarta Sans** ; rayons card 12 / button 10 / input 10 ; ombres `card`, `teal-glow` ; sidebar 15.5 rem, topbar 3.5 rem, contenu `max-w-[1600px] p-4 sm:p-6`.
- Classes : `.card-modern`, `.section-card(-header/-body)`, `.btn-primary/-secondary/-danger/-ghost`, `.input-modern`, `.select-modern`.
- Composants partagés (`components/index.js`) : `Modal` (portail, focus-trap, sm→xl), `FormField`, `ErrorState`, `KPICard` (5 accents), `StatusBadge`, `PageHeader`, `Section`, `DataTable`, `EmptyState`, `LoadingSpinner`, `ConfirmDialog`, `KanbanBoard`, `Toast`/`useToast`, `DateRangePicker`.
- Conventions actuelles du module (à unifier) : cartes `bg-white rounded-lg border p-4` ; KPI maison `DashCard`/`StatCard`/`CibleCard` ; badges `text-xs px-2 py-0.5 rounded` ; couleurs sémantiques des boutons : teal (principal), blue (entretiens/onglets), emerald (+ Action, Excel), violet (IA), blue-700 (FSE+), green-700 (clôture), amber (renouvellement), purple (sortie), red (alertes) ; trois styles d'onglets coexistants ; frise : diagnostic #0D9488, bilan #3B82F6, renouvellement #F59E0B, sortie #8B5CF6, post-sortie #64748B ; freins : mobilité #3B82F6, santé #EF4444, finances #F59E0B, famille #EC4899, linguistique #8B5CF6, administratif #0EA5E9, numérique #10B981, logement #84CC16, judiciaire #64748B ; PDF : en-tête plein #0D9488, cartes #F0FDFA/#99f6e4, pied RGPD.
